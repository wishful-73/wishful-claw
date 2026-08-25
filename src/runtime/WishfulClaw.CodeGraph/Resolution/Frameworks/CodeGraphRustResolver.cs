using System.Runtime.CompilerServices;
using System.Text;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphRustResolver — Rust web framework resolver (port of
// resolution/frameworks/rust.ts + cargo-workspace.ts; analysis/02 §3.3 row 17). The
// heaviest framework port. Contributes:
//   * resolve(): convention lookups for `_handler`/`handle_` fns, Service/Repository
//     traits, PascalCase structs, and snake_case module refs (the last resolved
//     through the Cargo workspace crate map — a manifest hit is trusted at 0.95).
//   * extract(): `route` nodes from three routing styles —
//       - Actix/Rocket attribute macros `#[get("/path")] fn handler(..)`,
//       - Axum `.route("/path", get(h).post(h))` via a balanced-paren scan,
//       - Actix builder API `web::resource("/p").route(web::get().to(h))` / `.to(h)`
//         and app-level `.route("/p", web::get().to(h))`.
//     Namespaced handlers (`self::list`, `module::handler`) reduce to the last segment.
//
// The Cargo.toml/workspace parsing is hand-rolled (no TOML lib), ported verbatim from
// cargo-workspace.ts, cached per-context via a ConditionalWeakTable (≙ the TS WeakMap).
// GLOBAL namespace, all-internal, reflection-free/AOT; [GeneratedRegex] fixed patterns.
// =============================================================================
internal sealed partial class CodeGraphRustResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] RustLanguages = { CodeGraphLanguage.Rust };

    private static readonly CodeGraphFrameworkExtraction EmptyExtraction =
        new(Array.Empty<CodeGraphNode>(), Array.Empty<CodeGraphUnresolvedReference>());

    // Framework-conventional directory patterns (already slashed — checked directly).
    private static readonly string[] HandlerDirs = { "/handlers/", "/handler/", "/api/", "/routes/", "/controllers/" };
    private static readonly string[] ServiceDirs = { "/services/", "/service/", "/repository/", "/domain/" };
    private static readonly string[] ModelDirs = { "/models/", "/model/", "/entities/", "/entity/", "/domain/", "/types/" };

    private static readonly HashSet<string> FunctionKinds = new(StringComparer.Ordinal) { CodeGraphNodeKind.Function };
    private static readonly HashSet<string> ServiceKinds = new(StringComparer.Ordinal) { CodeGraphNodeKind.Struct, CodeGraphNodeKind.Trait };
    private static readonly HashSet<string> StructKinds = new(StringComparer.Ordinal) { CodeGraphNodeKind.Struct };

    // Directories the workspace glob-walk never descends into (cargo-workspace.ts:14).
    private static readonly HashSet<string> SkipDirs = new(StringComparer.Ordinal) { "target", "node_modules", ".git", "dist", "build" };
    private const int MaxGlobWalkDepth = 5;

    // crate-name -> member-dir map, built lazily once per resolution context (≙ the TS
    // per-context WeakMap; ConditionalWeakTable so the context can be GC'd).
    private static readonly ConditionalWeakTable<CodeGraphResolutionContext, Dictionary<string, string>> WorkspaceMapCache = new();

    public string Name => "rust";

    public IReadOnlyList<string>? Languages => RustLanguages;

    public bool Detect(CodeGraphResolutionContext ctx) => ctx.FileExists("Cargo.toml");

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var name = r.ReferenceName;

        // Pattern 1: Handler references.
        if (name.EndsWith("_handler", StringComparison.Ordinal) || name.StartsWith("handle_", StringComparison.Ordinal))
        {
            var target = ResolveByNameAndKind(name, FunctionKinds, HandlerDirs, ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 2: Service / Repository trait implementations.
        if (name.EndsWith("Service", StringComparison.Ordinal) || name.EndsWith("Repository", StringComparison.Ordinal))
        {
            var target = ResolveByNameAndKind(name, ServiceKinds, ServiceDirs, ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 3: Struct references (PascalCase).
        if (PascalNameRegex().IsMatch(name))
        {
            var target = ResolveByNameAndKind(name, StructKinds, ModelDirs, ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.7, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 4: Module references (snake_case). Workspace-manifest hits are an
        // exact crate-name -> crate-root mapping, so trust them (0.95) above the
        // name-matcher self-file matches that otherwise win at 0.7.
        if (ModuleNameRegex().IsMatch(name))
        {
            var mod = ResolveModule(name, ctx);
            if (mod is not null)
            {
                return new CodeGraphResolvedRef(mod.Value.TargetId, mod.Value.FromWorkspace ? 0.95 : 0.6, CodeGraphResolvedBy.Framework);
            }
        }

        return null;
    }

    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        if (!filePath.EndsWith(".rs", StringComparison.Ordinal))
        {
            return EmptyExtraction;
        }

        var nodes = new List<CodeGraphNode>();
        var references = new List<CodeGraphUnresolvedReference>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Rust);

        void PushRoute(string routePath, string method, string handler, int line, int endColumn)
        {
            var routeNode = RouteNode($"route:{filePath}:{line}:{method}:{routePath}", $"{method} {routePath}",
                $"{filePath}::route:{routePath}", filePath, line, endColumn, now);
            nodes.Add(routeNode);
            references.Add(RouteRef(routeNode.Id, handler, line, filePath));
        }

        // Actix builder / app-level helper: push a route whose handler may be namespaced.
        void PushActixRoute(string routePath, string method, string handlerExpr, int line)
        {
            var handler = LastPathSegment(handlerExpr);
            if (handler is null)
            {
                return;
            }

            PushRoute(routePath, method.ToUpperInvariant(), handler, line, 0);
        }

        // Actix-web / Rocket attribute: #[get("/path")] fn handler(..).
        foreach (Match match in AttrRegex().Matches(safe))
        {
            var line = LineAt(safe, match.Index);
            var upper = match.Groups[1].Value.ToUpperInvariant();
            var routePath = match.Groups[2].Value;

            // Match the fn declaration that follows the attribute (skip past the attr).
            var fnMatch = AttrFnRegex().Match(safe, match.Index + match.Length);
            if (fnMatch.Success)
            {
                PushRoute(routePath, upper, fnMatch.Groups[1].Value, line, match.Length);
            }
        }

        // Axum: .route("/path", get(h1).post(h2)…) — balanced-paren scan then one route
        // node per chained method. Handlers may be namespaced; take the last segment.
        foreach (Match match in RouteOpenRegex().Matches(safe))
        {
            var openIdx = safe.IndexOf('(', match.Index);
            if (openIdx < 0)
            {
                continue;
            }

            var closeIdx = FindMatchingParen(safe, openIdx);
            if (closeIdx < 0)
            {
                continue;
            }

            var args = safe.Substring(openIdx + 1, closeIdx - (openIdx + 1));
            var pathMatch = AxumPathRegex().Match(args);
            if (!pathMatch.Success)
            {
                continue;
            }

            var routePath = pathMatch.Groups[1].Value;
            var line = LineAt(safe, match.Index);
            var methodBody = args.Substring(pathMatch.Length);

            foreach (Match mh in AxumMethodHandlerRegex().Matches(methodBody))
            {
                var handler = LastPathSegment(mh.Groups[2].Value);
                if (handler is null)
                {
                    continue;
                }

                PushRoute(routePath, mh.Groups[1].Value.ToUpperInvariant(), handler, line, 0);
            }
        }

        // Actix web::resource("/path") { .route(web::METHOD().to(h)) | .to(h) }.
        foreach (Match match in ResourceRegex().Matches(safe))
        {
            var routePath = match.Groups[1].Value;
            var startLine = LineAt(safe, match.Index);
            var after = match.Index + match.Length;
            // Bound the method chain at the next resource() to avoid bleed.
            var nextRes = safe.IndexOf("web::resource", after, StringComparison.Ordinal);
            var end = Math.Min(after + 500, nextRes == -1 ? safe.Length : nextRes);
            var chain = safe.Substring(after, end - after);

            var found = false;
            foreach (Match m2 in ResourceMethodToRegex().Matches(chain))
            {
                var mLine = startLine + LineAt(chain, m2.Index) - 1;
                PushActixRoute(routePath, m2.Groups[1].Value, m2.Groups[2].Value, mLine);
                found = true;
            }

            // Direct .resource("/x").to(handler) (all methods) when no explicit verb.
            if (!found)
            {
                var direct = ResourceDirectToRegex().Match(chain);
                if (direct.Success)
                {
                    PushActixRoute(routePath, "ANY", direct.Groups[1].Value, startLine);
                }
            }
        }

        // App-level: .route("/path", web::METHOD().to(handler)).
        foreach (Match match in AppRouteRegex().Matches(safe))
        {
            var line = LineAt(safe, match.Index);
            PushActixRoute(match.Groups[1].Value, match.Groups[2].Value, match.Groups[3].Value, line);
        }

        return new CodeGraphFrameworkExtraction(nodes, references);
    }

    // Last `::`-delimited segment of a handler expression (≙ split('::').filter(Boolean).pop()).
    private static string? LastPathSegment(string expr)
    {
        var parts = expr.Split("::", StringSplitOptions.RemoveEmptyEntries);
        return parts.Length > 0 ? parts[^1] : null;
    }

    // Index of the ')' matching the '(' at openIdx, or -1 (≙ findMatchingParen; a plain
    // depth counter — string-unaware, exactly as the TS to preserve parity).
    private static int FindMatchingParen(string s, int openIdx)
    {
        var depth = 0;
        for (var i = openIdx; i < s.Length; i++)
        {
            if (s[i] == '(')
            {
                depth++;
            }
            else if (s[i] == ')')
            {
                depth--;
                if (depth == 0)
                {
                    return i;
                }
            }
        }

        return -1;
    }

    private static string? ResolveByNameAndKind(string name, HashSet<string> kinds, string[] preferredDirPatterns, CodeGraphResolutionContext ctx)
    {
        var candidates = ctx.GetNodesByName(name);
        if (candidates.Count == 0)
        {
            return null;
        }

        List<CodeGraphNode>? kindFiltered = null;
        foreach (var n in candidates)
        {
            if (kinds.Contains(n.Kind))
            {
                (kindFiltered ??= new List<CodeGraphNode>()).Add(n);
            }
        }

        if (kindFiltered is null)
        {
            return null;
        }

        foreach (var n in kindFiltered)
        {
            foreach (var d in preferredDirPatterns)
            {
                if (n.FilePath.Contains(d, StringComparison.Ordinal))
                {
                    return n.Id;
                }
            }
        }

        return kindFiltered[0].Id;
    }

    private static (string TargetId, bool FromWorkspace)? ResolveModule(string name, CodeGraphResolutionContext ctx)
    {
        var workspaceCrates = GetCachedCargoWorkspaceCrateMap(ctx);
        workspaceCrates.TryGetValue(name, out var cratePath);

        // Local paths first (fromWorkspace=false), then workspace crate roots (=true).
        var candidates = new List<(string Path, bool FromWorkspace)>
        {
            ($"src/{name}.rs", false),
            ($"src/{name}/mod.rs", false)
        };
        if (cratePath is not null)
        {
            candidates.Add(($"{cratePath}/src/lib.rs", true));
            candidates.Add(($"{cratePath}/src/main.rs", true));
        }

        foreach (var (modPath, fromWorkspace) in candidates)
        {
            if (!ctx.FileExists(modPath))
            {
                continue;
            }

            var fileNodes = ctx.GetNodesInFile(modPath);
            foreach (var n in fileNodes)
            {
                if (n.Kind == CodeGraphNodeKind.Module)
                {
                    return (n.Id, fromWorkspace);
                }
            }

            if (fileNodes.Count > 0)
            {
                return (fileNodes[0].Id, fromWorkspace);
            }
        }

        return null;
    }

    // ── Cargo workspace parsing (port of cargo-workspace.ts) ────────────────────

    private static Dictionary<string, string> GetCachedCargoWorkspaceCrateMap(CodeGraphResolutionContext ctx) =>
        WorkspaceMapCache.GetValue(ctx, static c => BuildCargoWorkspaceCrateMap(c));

    // crate-name aliases -> workspace member dir (e.g. "my-core"/"my_core" -> "crates/my-core").
    private static Dictionary<string, string> BuildCargoWorkspaceCrateMap(CodeGraphResolutionContext ctx)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        var rootCargoToml = ctx.ReadFile("Cargo.toml");
        if (string.IsNullOrEmpty(rootCargoToml))
        {
            return result;
        }

        var members = ExpandMembers(ParseWorkspaceMembers(rootCargoToml), ctx);
        foreach (var memberPath in members)
        {
            var memberCargoToml = ctx.ReadFile($"{memberPath}/Cargo.toml");
            if (string.IsNullOrEmpty(memberCargoToml))
            {
                continue;
            }

            var packageName = ParsePackageName(memberCargoToml);
            if (string.IsNullOrEmpty(packageName))
            {
                continue;
            }

            AddCrateAlias(result, packageName, memberPath);
        }

        return result;
    }

    private static void AddCrateAlias(Dictionary<string, string> map, string crateName, string memberPath)
    {
        var normalized = crateName.Replace('-', '_');
        map[crateName] = memberPath;
        if (normalized != crateName)
        {
            map[normalized] = memberPath;
        }
    }

    private static List<string> ParseWorkspaceMembers(string cargoToml)
    {
        var workspaceSection = GetSection(cargoToml, "workspace");
        if (string.IsNullOrEmpty(workspaceSection))
        {
            return new List<string>();
        }

        var membersValue = GetArrayValue(workspaceSection, "members");
        if (string.IsNullOrEmpty(membersValue))
        {
            return new List<string>();
        }

        return ExtractQuotedValues(membersValue);
    }

    private static string? ParsePackageName(string cargoToml)
    {
        var packageSection = GetSection(cargoToml, "package");
        if (string.IsNullOrEmpty(packageSection))
        {
            return null;
        }

        var m = PackageNameRegex().Match(packageSection);
        return m.Success ? m.Groups[1].Value.Trim() : null;
    }

    // Return the raw body of a `[section]` block (lines until the next `[...]`), or null
    // if the header is never seen. An empty-but-present section returns "".
    private static string? GetSection(string content, string sectionName)
    {
        var header = $"[{sectionName}]";
        var lines = content.Split('\n');
        var inSection = false;
        var sectionLines = new List<string>();
        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (!inSection)
            {
                if (trimmed == header)
                {
                    inSection = true;
                }

                continue;
            }

            if (SectionHeaderRegex().IsMatch(trimmed))
            {
                break;
            }

            sectionLines.Add(line);
        }

        return inSection ? string.Join('\n', sectionLines) : null;
    }

    // Collect quoted string values from a TOML array body (quote-aware, escape-aware).
    private static List<string> ExtractQuotedValues(string valueList)
    {
        var values = new List<string>();
        char quote = '\0';
        var escaped = false;
        var current = new StringBuilder();
        foreach (var ch in valueList)
        {
            if (quote == '\0')
            {
                if (ch == '"' || ch == '\'')
                {
                    quote = ch;
                    current.Clear();
                }

                continue;
            }

            if (escaped)
            {
                current.Append(ch);
                escaped = false;
                continue;
            }

            if (ch == '\\')
            {
                escaped = true;
                continue;
            }

            if (ch == quote)
            {
                var trimmed = current.ToString().Trim();
                if (trimmed.Length > 0)
                {
                    values.Add(trimmed);
                }

                quote = '\0';
                current.Clear();
                continue;
            }

            current.Append(ch);
        }

        return values;
    }

    // Raw text of the `key = [ ... ]` array body (bracket-balanced, quote-aware), or null.
    private static string? GetArrayValue(string section, string key)
    {
        var keyRegex = new Regex($@"\b{Regex.Escape(key)}\b\s*=", RegexOptions.Multiline | RegexOptions.CultureInvariant);
        var keyMatch = keyRegex.Match(section);
        if (!keyMatch.Success)
        {
            return null;
        }

        var i = keyMatch.Index + keyMatch.Length;
        while (i < section.Length && char.IsWhiteSpace(section[i]))
        {
            i++;
        }

        if (i >= section.Length || section[i] != '[')
        {
            return null;
        }

        i++;
        char inQuote = '\0';
        var escaped = false;
        var depth = 1;
        var start = i;
        while (i < section.Length)
        {
            var ch = section[i];
            if (inQuote != '\0')
            {
                if (escaped)
                {
                    escaped = false;
                }
                else if (ch == '\\')
                {
                    escaped = true;
                }
                else if (ch == inQuote)
                {
                    inQuote = '\0';
                }

                i++;
                continue;
            }

            if (ch == '"' || ch == '\'')
            {
                inQuote = ch;
                i++;
                continue;
            }

            if (ch == '[')
            {
                depth++;
                i++;
                continue;
            }

            if (ch == ']')
            {
                depth--;
                if (depth == 0)
                {
                    return section.Substring(start, i - start);
                }

                i++;
                continue;
            }

            i++;
        }

        return null;
    }

    private static List<string> ExpandMembers(List<string> members, CodeGraphResolutionContext ctx)
    {
        var expanded = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var member in members)
        {
            var candidates = HasGlobChar(member) ? ExpandGlobMember(member, ctx) : new List<string> { member };
            foreach (var candidate in candidates)
            {
                var cleaned = CleanPath(candidate);
                if (seen.Add(cleaned))
                {
                    expanded.Add(cleaned);
                }
            }
        }

        return expanded;
    }

    private static List<string> ExpandGlobMember(string member, CodeGraphResolutionContext ctx)
    {
        var firstGlobIdx = FirstGlobIndex(member);
        var prefix = firstGlobIdx >= 0 ? member.Substring(0, firstGlobIdx) : member;
        var lastSlash = prefix.LastIndexOf('/');
        var staticPrefix = lastSlash >= 0 ? prefix.Substring(0, lastSlash) : string.Empty;

        var matcher = new Regex(GlobToRegexPattern(member), RegexOptions.CultureInvariant);
        var matches = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        void Walk(string dir, int depth)
        {
            if (depth > MaxGlobWalkDepth)
            {
                return;
            }

            foreach (var child in ctx.ListDirectories(dir))
            {
                if (SkipDirs.Contains(child) || child.StartsWith('.'))
                {
                    continue;
                }

                var rel = dir == "." ? child : $"{dir}/{child}";
                if (matcher.IsMatch(rel) && seen.Add(rel))
                {
                    matches.Add(rel);
                }

                Walk(rel, depth + 1);
            }
        }

        Walk(staticPrefix.Length > 0 ? staticPrefix : ".", 0);
        return matches;
    }

    // Pragmatic picomatch subset (Cargo members are almost always `dir/*` or literals):
    // `*`→segment, `**`→any, `?`, `{a,b}`, `[...]`.
    private static string GlobToRegexPattern(string glob)
    {
        var sb = new StringBuilder("^");
        var braceDepth = 0;
        for (var i = 0; i < glob.Length; i++)
        {
            var c = glob[i];
            if (c == '*')
            {
                if (i + 1 < glob.Length && glob[i + 1] == '*')
                {
                    i++;
                    if (i + 1 < glob.Length && glob[i + 1] == '/')
                    {
                        i++;
                        sb.Append("(?:[^/]+/)*");
                    }
                    else
                    {
                        sb.Append(".*");
                    }
                }
                else
                {
                    sb.Append("[^/]*");
                }

                continue;
            }

            switch (c)
            {
                case '?':
                    sb.Append("[^/]");
                    break;
                case '{':
                    braceDepth++;
                    sb.Append("(?:");
                    break;
                case '}':
                    if (braceDepth > 0)
                    {
                        braceDepth--;
                        sb.Append(')');
                    }
                    else
                    {
                        sb.Append("\\}");
                    }

                    break;
                case ',':
                    sb.Append(braceDepth > 0 ? "|" : ",");
                    break;
                case '[':
                    var j = i + 1;
                    sb.Append('[');
                    if (j < glob.Length && glob[j] == '!')
                    {
                        sb.Append('^');
                        j++;
                    }

                    while (j < glob.Length && glob[j] != ']')
                    {
                        sb.Append(glob[j]);
                        j++;
                    }

                    sb.Append(']');
                    i = j;
                    break;
                case '.':
                case '+':
                case '(':
                case ')':
                case '^':
                case '$':
                case '|':
                case '\\':
                    sb.Append('\\').Append(c);
                    break;
                default:
                    sb.Append(c);
                    break;
            }
        }

        sb.Append('$');
        return sb.ToString();
    }

    private static bool HasGlobChar(string s)
    {
        foreach (var c in s)
        {
            if (c is '*' or '?' or '[' or ']' or '{' or '}' or '!')
            {
                return true;
            }
        }

        return false;
    }

    private static int FirstGlobIndex(string s)
    {
        for (var i = 0; i < s.Length; i++)
        {
            if (s[i] is '*' or '?' or '[' or ']' or '{' or '}' or '!')
            {
                return i;
            }
        }

        return -1;
    }

    private static string CleanPath(string memberPath)
    {
        var p = memberPath.Replace('\\', '/');
        return p.EndsWith('/') ? p.Substring(0, p.Length - 1) : p;
    }

    // 1-based line of `index` (≙ safe.slice(0, index).split('\n').length).
    private static int LineAt(string s, int index)
    {
        var line = 1;
        var end = index < s.Length ? index : s.Length;
        for (var i = 0; i < end; i++)
        {
            if (s[i] == '\n')
            {
                line++;
            }
        }

        return line;
    }

    private static CodeGraphNode RouteNode(string id, string name, string qualifiedName, string filePath, int line, int endColumn, long now) =>
        new(id, CodeGraphNodeKind.Route, name, qualifiedName, filePath, CodeGraphLanguage.Rust, line, line, 0, endColumn,
            null, null, null, false, false, false, false, null, null, null, now);

    private static CodeGraphUnresolvedReference RouteRef(string fromNodeId, string referenceName, int line, string filePath) =>
        new(fromNodeId, referenceName, CodeGraphEdgeKind.References, line, 0, filePath, CodeGraphLanguage.Rust, null, null);

    // ── Fixed patterns ([GeneratedRegex]) — verbatim from rust.ts / cargo-workspace.ts ──

    [GeneratedRegex(@"^[A-Z][a-zA-Z]+$")]
    private static partial Regex PascalNameRegex();

    [GeneratedRegex(@"^[a-z_]+$")]
    private static partial Regex ModuleNameRegex();

    [GeneratedRegex(@"#\[(get|post|put|patch|delete|head|options)\s*\(\s*[""']([^""']+)[""'][^\]]*\)\]")]
    private static partial Regex AttrRegex();

    [GeneratedRegex(@"\n\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)")]
    private static partial Regex AttrFnRegex();

    [GeneratedRegex(@"\.route\s*\(")]
    private static partial Regex RouteOpenRegex();

    [GeneratedRegex(@"^\s*""([^""]+)""\s*,")]
    private static partial Regex AxumPathRegex();

    [GeneratedRegex(@"\b(get|post|put|patch|delete|head|options|trace)\s*\(\s*([A-Za-z_][\w:]*)")]
    private static partial Regex AxumMethodHandlerRegex();

    [GeneratedRegex(@"web::resource\s*\(\s*""([^""]+)""\s*\)")]
    private static partial Regex ResourceRegex();

    [GeneratedRegex(@"web::(get|post|put|patch|delete|head)\s*\(\s*\)\s*\.to\s*\(\s*([A-Za-z_][\w:]*)")]
    private static partial Regex ResourceMethodToRegex();

    [GeneratedRegex(@"^\s*\.to\s*\(\s*([A-Za-z_][\w:]*)")]
    private static partial Regex ResourceDirectToRegex();

    [GeneratedRegex(@"\.route\s*\(\s*""([^""]+)""\s*,\s*web::(get|post|put|patch|delete|head)\s*\(\s*\)\s*\.to\s*\(\s*([A-Za-z_][\w:]*)")]
    private static partial Regex AppRouteRegex();

    [GeneratedRegex(@"name\s*=\s*[""']([^""'\n]+)[""']")]
    private static partial Regex PackageNameRegex();

    [GeneratedRegex(@"^\[[^\]]+\]$")]
    private static partial Regex SectionHeaderRegex();
}

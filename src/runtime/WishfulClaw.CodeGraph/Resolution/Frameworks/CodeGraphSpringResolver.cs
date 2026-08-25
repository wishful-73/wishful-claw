using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphSpringResolver — Spring Boot / general Java framework resolver (≙
// frameworks/java.ts `springResolver`). Two jobs:
//   * route -> handler-method edges: `@GetMapping`/`@PostMapping`/…/`@RequestMapping`
//     (class-level prefix + method-level path) are extracted as `route` nodes that
//     `references` the decorated method.
//   * config-key edges: `@Value("${a.b.c}")` and `@ConfigurationProperties(prefix=…)`
//     bind to the YAML/properties leaf-key `constant` nodes emitted by Extract, via
//     Spring's relaxed binding (kebab/camel/snake collapse to lowercase).
//
// The YAML/.properties parsers are hand-rolled (key-only, secret-guarded per #383) —
// ported verbatim from java.ts, no YAML library. The config-key resolve path is
// perf-gated to `references` refs in Java/Kotlin (#1180) so the O(dotted-calls ×
// constant-nodes) scan never fires on ordinary method-call refs.
//
// Global namespace, internal, reflection-free, [GeneratedRegex] fixed patterns.
// =============================================================================
internal sealed partial class CodeGraphSpringResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] SpringLanguages =
    {
        CodeGraphLanguage.Java, CodeGraphLanguage.Kotlin, CodeGraphLanguage.Yaml, CodeGraphLanguage.Properties
    };

    // Framework-conventional directory hints (java.ts:506-510).
    private static readonly string[] ServiceDirs = { "/service/", "/services/" };
    private static readonly string[] RepoDirs = { "/repository/", "/repositories/" };
    private static readonly string[] ControllerDirs = { "/controller/", "/controllers/" };
    private static readonly string[] EntityDirs = { "/entity/", "/entities/", "/model/", "/models/", "/domain/" };
    private static readonly string[] ComponentDirs = { "/component/", "/components/", "/config/" };

    private static readonly string[] ClassKinds = { CodeGraphNodeKind.Class };
    private static readonly string[] ServiceKinds = { CodeGraphNodeKind.Class, CodeGraphNodeKind.Interface };

    private static readonly CodeGraphFrameworkExtraction EmptyExtraction =
        new(Array.Empty<CodeGraphNode>(), Array.Empty<CodeGraphUnresolvedReference>());

    public string Name => "spring";

    public IReadOnlyList<string>? Languages => SpringLanguages;

    // `@ConfigurationProperties(prefix="app.cache")` emits a ref whose name carries the
    // `:prefix` sentinel — no declared symbol spells that, so the name-existence
    // pre-filter would drop it. Opt those through (java.ts:15).
    public bool ClaimsReference(string name) => name.EndsWith(":prefix", StringComparison.Ordinal);

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        // pom.xml / build.gradle(.kts) mentioning Spring.
        var pomXml = ctx.ReadFile("pom.xml");
        if (pomXml is not null && (pomXml.Contains("spring-boot") || pomXml.Contains("springframework")))
        {
            return true;
        }

        var buildGradle = ctx.ReadFile("build.gradle");
        if (buildGradle is not null && (buildGradle.Contains("spring-boot") || buildGradle.Contains("springframework")))
        {
            return true;
        }

        var buildGradleKts = ctx.ReadFile("build.gradle.kts");
        if (buildGradleKts is not null && (buildGradleKts.Contains("spring-boot") || buildGradleKts.Contains("springframework")))
        {
            return true;
        }

        // Spring annotations in any .java file.
        foreach (var file in ctx.GetAllFiles())
        {
            if (!file.EndsWith(".java", StringComparison.Ordinal))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            if (content is not null && (
                content.Contains("@SpringBootApplication") ||
                content.Contains("@RestController") ||
                content.Contains("@Service") ||
                content.Contains("@Repository")))
            {
                return true;
            }
        }

        return false;
    }

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var name = r.ReferenceName;

        // `@ConfigurationProperties(prefix="X")` — the ref binds the entire subtree,
        // marked with the `:prefix` suffix by Extract. Map to the closest matching key.
        if (name.EndsWith(":prefix", StringComparison.Ordinal))
        {
            var prefix = name.Substring(0, name.Length - ":prefix".Length);
            var canonPrefix = CanonicalConfigKey(prefix);
            CodeGraphNode? best = null;
            var bestLen = 0;
            foreach (var n in ctx.GetNodesByKind(CodeGraphNodeKind.Constant))
            {
                if (n.Language != CodeGraphLanguage.Yaml && n.Language != CodeGraphLanguage.Properties)
                {
                    continue;
                }

                var canon = CanonicalConfigKey(n.QualifiedName);
                if (!canon.StartsWith(canonPrefix, StringComparison.Ordinal))
                {
                    continue;
                }

                // Prefer the SHORTEST canonical name — the closest binding point
                // (`app.cache` over `app.cache.name.user-token`). Ties keep the earliest.
                if (best is null || canon.Length < bestLen)
                {
                    best = n;
                    bestLen = canon.Length;
                }
            }

            return best is null ? null : new CodeGraphResolvedRef(best.Id, 0.85, CodeGraphResolvedBy.Framework);
        }

        // Spring config dotted key — `@Value("${a.b.c}")`. Gated to `references` refs in
        // Java/Kotlin (the far more numerous `receiver.method()` calls are `calls` and a
        // config key is never a `calls` ref) so the constant scan below can't dominate
        // resolution on large Spring monorepos (#1180).
        if (r.ReferenceKind == CodeGraphEdgeKind.References &&
            (r.Language == CodeGraphLanguage.Java || r.Language == CodeGraphLanguage.Kotlin) &&
            name.Contains('.') &&
            !name.Contains("::", StringComparison.Ordinal))
        {
            var canonRef = CanonicalConfigKey(name);
            List<CodeGraphNode>? candidates = null;
            foreach (var n in ctx.GetNodesByKind(CodeGraphNodeKind.Constant))
            {
                if (n.Kind != CodeGraphNodeKind.Constant ||
                    (n.Language != CodeGraphLanguage.Yaml && n.Language != CodeGraphLanguage.Properties))
                {
                    continue;
                }

                if (CanonicalConfigKey(n.QualifiedName) == canonRef)
                {
                    (candidates ??= new List<CodeGraphNode>()).Add(n);
                }
            }

            if (candidates is not null)
            {
                if (candidates.Count == 1)
                {
                    return new CodeGraphResolvedRef(candidates[0].Id, 0.9, CodeGraphResolvedBy.Framework);
                }

                // Multiple profile-specific files can define the same key. Prefer the base
                // `application.{yml,yaml,properties}` (score 0) over profile variants, then
                // the shortest basename — deterministic across reindexes.
                var best = candidates[0];
                var bestScore = ConfigScore(best);
                for (var i = 1; i < candidates.Count; i++)
                {
                    var s = ConfigScore(candidates[i]);
                    if (s < bestScore)
                    {
                        best = candidates[i];
                        bestScore = s;
                    }
                }

                return new CodeGraphResolvedRef(best.Id, 0.75, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 1: Service references (dependency injection).
        if (name.EndsWith("Service", StringComparison.Ordinal))
        {
            var id = ResolveByNameAndKind(name, ServiceKinds, ServiceDirs, ctx);
            if (id is not null)
            {
                return new CodeGraphResolvedRef(id, 0.85, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 2: Repository references.
        if (name.EndsWith("Repository", StringComparison.Ordinal))
        {
            var id = ResolveByNameAndKind(name, ServiceKinds, RepoDirs, ctx);
            if (id is not null)
            {
                return new CodeGraphResolvedRef(id, 0.85, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 3: Controller references.
        if (name.EndsWith("Controller", StringComparison.Ordinal))
        {
            var id = ResolveByNameAndKind(name, ClassKinds, ControllerDirs, ctx);
            if (id is not null)
            {
                return new CodeGraphResolvedRef(id, 0.85, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 4: Entity/Model references (PascalCase bare name).
        if (PascalNameRegex().IsMatch(name))
        {
            var id = ResolveByNameAndKind(name, ClassKinds, EntityDirs, ctx);
            if (id is not null)
            {
                return new CodeGraphResolvedRef(id, 0.7, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 5: Component / Config references.
        if (name.EndsWith("Component", StringComparison.Ordinal) || name.EndsWith("Config", StringComparison.Ordinal))
        {
            var id = ResolveByNameAndKind(name, ClassKinds, ComponentDirs, ctx);
            if (id is not null)
            {
                return new CodeGraphResolvedRef(id, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        return null;
    }

    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        // Spring config files become first-class `constant` nodes a `@Value` ref resolves to.
        if (IsSpringConfigFile(filePath))
        {
            return ExtractSpringConfig(filePath, content);
        }

        // Spring Boot is used from both Java and Kotlin (identical annotations); the method
        // syntax difference is handled by the method regex. Comments stripped as 'java'.
        if (!filePath.EndsWith(".java", StringComparison.Ordinal) && !filePath.EndsWith(".kt", StringComparison.Ordinal))
        {
            return EmptyExtraction;
        }

        var nodes = new List<CodeGraphNode>();
        var references = new List<CodeGraphUnresolvedReference>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var lang = filePath.EndsWith(".kt", StringComparison.Ordinal) ? CodeGraphLanguage.Kotlin : CodeGraphLanguage.Java;
        var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Java);

        // Class-level @RequestMapping prefix (an @RequestMapping whose tail leads to a
        // `class`). Joined onto each method's path — NOT itself a route.
        var classPrefix = string.Empty;
        var cls = ClassRequestMappingRegex().Match(safe);
        if (cls.Success)
        {
            classPrefix = ParseMappingPath(cls.Groups[1].Value);
        }

        // Verb-specific method mappings — always method-level, BARE or with a path.
        foreach (Match match in VerbMappingRegex().Matches(safe))
        {
            var method = match.Groups[1].Value switch
            {
                "GetMapping" => "GET",
                "PostMapping" => "POST",
                "PutMapping" => "PUT",
                "PatchMapping" => "PATCH",
                "DeleteMapping" => "DELETE",
                _ => "ANY"
            };
            var sub = ParseMappingPath(StripEnclosingParens(match.Groups[2].Success ? match.Groups[2].Value : string.Empty));
            var routePath = JoinPath(classPrefix, sub);
            var line = LineAt(safe, match.Index);
            var routeNode = RouteNode($"route:{filePath}:{line}:{method}:{routePath}", $"{method} {routePath}",
                $"{filePath}::route:{routePath}", filePath, line, match.Length, lang, now);
            nodes.Add(routeNode);

            // Method it decorates: first declared method after (skip stacked annotations).
            var tail = Slice(safe, match.Index + match.Length, match.Index + match.Length + 600);
            var methodMatch = MethodDeclRegex().Match(tail);
            if (methodMatch.Success)
            {
                var methodName = methodMatch.Groups[1].Success ? methodMatch.Groups[1].Value : methodMatch.Groups[2].Value;
                references.Add(RouteRef(routeNode.Id, methodName, line, filePath, lang));
            }
        }

        // Method-level @RequestMapping (older style). Skip the class-level one (the prefix).
        foreach (Match match in RequestMappingRegex().Matches(safe))
        {
            var args = StripEnclosingParens(match.Groups[1].Success ? match.Groups[1].Value : string.Empty);
            var after = Slice(safe, match.Index + match.Length, match.Index + match.Length + 600);
            if (AfterClassRegex().IsMatch(after))
            {
                continue; // class-level prefix
            }

            var methodMatch = MethodDeclRegex().Match(after);
            if (!methodMatch.Success)
            {
                continue;
            }

            var verbM = RequestMethodVerbRegex().Match(args);
            var method = verbM.Success ? verbM.Groups[1].Value.ToUpperInvariant() : "ANY";
            var routePath = JoinPath(classPrefix, ParseMappingPath(args));
            var line = LineAt(safe, match.Index);
            var routeNode = RouteNode($"route:{filePath}:{line}:{method}:{routePath}", $"{method} {routePath}",
                $"{filePath}::route:{routePath}", filePath, line, match.Length, lang, now);
            nodes.Add(routeNode);
            var methodName = methodMatch.Groups[1].Success ? methodMatch.Groups[1].Value : methodMatch.Groups[2].Value;
            references.Add(RouteRef(routeNode.Id, methodName, line, filePath, lang));
        }

        // @Value("${key}") and @ConfigurationProperties(prefix="...") config-key bindings.
        ExtractSpringValueBindings(filePath, safe, lang, now, nodes, references);

        return new CodeGraphFrameworkExtraction(nodes, references);
    }

    // Spring config file: application(-profile)?.{yml,yaml,properties} + bootstrap variants,
    // matched on the basename (java.ts:311).
    private static bool IsSpringConfigFile(string filePath) =>
        SpringConfigFileRegex().IsMatch(LastSegment(filePath, '/'));

    // Parse a YAML or .properties config file, emitting one `constant` node per LEAF key
    // with qualifiedName = the dotted path. KEY ONLY, never the value (secret guard #383).
    private static CodeGraphFrameworkExtraction ExtractSpringConfig(string filePath, string content)
    {
        var nodes = new List<CodeGraphNode>();
        var isProperties = PropertiesExtRegex().IsMatch(filePath);
        var lang = isProperties ? CodeGraphLanguage.Properties : CodeGraphLanguage.Yaml;
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        void EmitLeaf(string dottedKey, int line, string valueText)
        {
            if (string.IsNullOrEmpty(dottedKey))
            {
                return;
            }

            nodes.Add(ConfigNode($"spring-config:{filePath}:{line}:{dottedKey}", LastSegment(dottedKey, '.'),
                dottedKey, filePath, line, valueText.Length, lang, dottedKey, now));
        }

        if (isProperties)
        {
            // `k1.k2.k3 = value` (or `:` separator, or no value). `#`/`!` lines are comments.
            var lines = SplitLines(content);
            for (var i = 0; i < lines.Count; i++)
            {
                var raw = lines[i];
                var trimmed = raw.Trim();
                if (trimmed.Length == 0 || trimmed.StartsWith('#') || trimmed.StartsWith('!'))
                {
                    continue;
                }

                var sep = -1;
                for (var j = 0; j < raw.Length; j++)
                {
                    var ch = raw[j];
                    if (ch == '=' || ch == ':')
                    {
                        sep = j;
                        break;
                    }

                    if (ch == '\\' && j + 1 < raw.Length)
                    {
                        j++;
                    }
                }

                if (sep < 0)
                {
                    continue;
                }

                var key = raw.Substring(0, sep).Trim();
                var val = raw.Substring(sep + 1).Trim();
                EmitLeaf(key, i + 1, val);
            }

            return new CodeGraphFrameworkExtraction(nodes, Array.Empty<CodeGraphUnresolvedReference>());
        }

        // YAML: indent-based. Track a stack of (indent, key) so the dotted path is built by
        // joining ancestor keys. A leaf is a line with an inline value after `:`. List items,
        // flow scalars, `---` separators are ignored (they don't bind to @Value).
        var stack = new List<(int Indent, string Key)>();
        var yamlLines = SplitLines(content);
        for (var i = 0; i < yamlLines.Count; i++)
        {
            var raw = yamlLines[i];
            var trimmed = raw.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith('#') || trimmed == "---" || trimmed.StartsWith("- ", StringComparison.Ordinal))
            {
                continue;
            }

            var indent = 0;
            while (indent < raw.Length && (raw[indent] == ' ' || raw[indent] == '\t'))
            {
                indent++;
            }

            var colonIdx = -1;
            char inStr = '\0';
            for (var j = 0; j < raw.Length; j++)
            {
                var ch = raw[j];
                if (inStr != '\0')
                {
                    if (ch == inStr && (j == 0 || raw[j - 1] != '\\'))
                    {
                        inStr = '\0';
                    }

                    continue;
                }

                if (ch == '"' || ch == '\'')
                {
                    inStr = ch;
                    continue;
                }

                if (ch == ':')
                {
                    colonIdx = j;
                    break;
                }
            }

            if (colonIdx < 0)
            {
                continue;
            }

            var key = raw.Substring(indent, colonIdx - indent).Trim();
            if (key.Length == 0)
            {
                continue;
            }

            var after = raw.Substring(colonIdx + 1).Trim();
            while (stack.Count > 0 && stack[^1].Indent >= indent)
            {
                stack.RemoveAt(stack.Count - 1);
            }

            var dotted = BuildDottedKey(stack, key);
            if (after.Length == 0 || after.StartsWith('#'))
            {
                stack.Add((indent, key));
            }
            else
            {
                EmitLeaf(dotted, i + 1, StripOuterQuotes(after));
            }
        }

        return new CodeGraphFrameworkExtraction(nodes, Array.Empty<CodeGraphUnresolvedReference>());
    }

    // Append @Value("${k}") and @ConfigurationProperties(prefix=…) references (java.ts:424).
    private static void ExtractSpringValueBindings(
        string filePath,
        string safe,
        string lang,
        long now,
        List<CodeGraphNode> nodes,
        List<CodeGraphUnresolvedReference> references)
    {
        foreach (Match m in ValueBindingRegex().Matches(safe))
        {
            var key = m.Groups[1].Value.Trim();
            if (key.Length == 0)
            {
                continue;
            }

            var line = LineAt(safe, m.Index);
            var bindNode = ConfigNode($"spring-value:{filePath}:{line}:{key}", key, $"{filePath}::@Value:{key}",
                filePath, line, m.Length, lang, $"@Value(\"{key}\")", now);
            nodes.Add(bindNode);
            references.Add(RouteRef(bindNode.Id, key, line, filePath, lang));
        }

        foreach (Match m in ConfigPropertiesRegex().Matches(safe))
        {
            var prefix = m.Groups[1].Value.Trim();
            if (prefix.Length == 0)
            {
                continue;
            }

            var line = LineAt(safe, m.Index);
            var bindNode = ConfigNode($"spring-cp:{filePath}:{line}:{prefix}", prefix,
                $"{filePath}::@ConfigurationProperties:{prefix}", filePath, line, m.Length, lang,
                $"@ConfigurationProperties(\"{prefix}\")", now);
            nodes.Add(bindNode);
            // `:prefix` suffix tells Resolve to expand into the SUBTREE, not a single key.
            references.Add(RouteRef(bindNode.Id, $"{prefix}:prefix", line, filePath, lang));
        }
    }

    // Spring relaxed binding: `cache-list` ↔ `cacheList` ↔ `cache_list` ↔ `CACHE_LIST`
    // collapse on lowercase + dash/underscore removal (java.ts:501).
    private static string CanonicalConfigKey(string key) => DashUnderscoreRegex().Replace(key.ToLowerInvariant(), string.Empty);

    // Deterministic tie-break score for a duplicate config key: base file (0) beats profile
    // variants (1000), then shorter basename wins (java.ts:119-123).
    private static int ConfigScore(CodeGraphNode n)
    {
        var baseName = LastSegment(n.FilePath, '/');
        var isBase = BaseConfigFileRegex().IsMatch(baseName);
        return (isBase ? 0 : 1) * 1000 + baseName.Length;
    }

    // Path string from a mapping's args (`"/x"`, `value = "/x"`, `path = "/x"`); '' if bare.
    private static string ParseMappingPath(string args)
    {
        var m = MappingPathRegex().Match(args);
        return m.Success ? m.Groups[1].Value : string.Empty;
    }

    // Join a class-level prefix and a method sub-path into one normalized `/path`.
    private static string JoinPath(string prefix, string sub)
    {
        var parts = new List<string>(2);
        var a = prefix.Trim('/');
        if (a.Length > 0)
        {
            parts.Add(a);
        }

        var b = sub.Trim('/');
        if (b.Length > 0)
        {
            parts.Add(b);
        }

        return "/" + string.Join('/', parts);
    }

    // Resolve a symbol by name via the indexed name query, preferring framework-conventional
    // directories (java.ts:530).
    private static string? ResolveByNameAndKind(string name, string[] kinds, string[] preferredDirPatterns, CodeGraphResolutionContext ctx)
    {
        var candidates = ctx.GetNodesByName(name);
        if (candidates.Count == 0)
        {
            return null;
        }

        CodeGraphNode? firstKindMatch = null;
        foreach (var n in candidates)
        {
            if (!KindMatches(n.Kind, kinds))
            {
                continue;
            }

            firstKindMatch ??= n;
            foreach (var dir in preferredDirPatterns)
            {
                if (n.FilePath.Contains(dir))
                {
                    return n.Id;
                }
            }
        }

        return firstKindMatch?.Id;
    }

    private static bool KindMatches(string kind, string[] kinds)
    {
        foreach (var k in kinds)
        {
            if (kind == k)
            {
                return true;
            }
        }

        return false;
    }

    private static string BuildDottedKey(List<(int Indent, string Key)> stack, string key)
    {
        var sb = new System.Text.StringBuilder();
        foreach (var s in stack)
        {
            sb.Append(s.Key).Append('.');
        }

        sb.Append(key);
        return sb.ToString();
    }

    // ── Shared node/ref factories ─────────────────────────────────────────────
    private static CodeGraphNode RouteNode(string id, string name, string qualifiedName, string filePath, int line, int endColumn, string language, long now) =>
        new(id, CodeGraphNodeKind.Route, name, qualifiedName, filePath, language, line, line, 0, endColumn,
            null, null, null, false, false, false, false, null, null, null, now);

    private static CodeGraphNode ConfigNode(string id, string name, string qualifiedName, string filePath, int line, int endColumn, string language, string signature, long now) =>
        new(id, CodeGraphNodeKind.Constant, name, qualifiedName, filePath, language, line, line, 0, endColumn,
            null, signature, null, false, false, false, false, null, null, null, now);

    private static CodeGraphUnresolvedReference RouteRef(string fromNodeId, string referenceName, int line, string filePath, string language) =>
        new(fromNodeId, referenceName, CodeGraphEdgeKind.References, line, 0, filePath, language, null, null);

    // ── JS-semantics string helpers ───────────────────────────────────────────

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

    // JS String.slice(start, end) — clamps to [0, length], never throws.
    private static string Slice(string s, int start, int end)
    {
        if (start < 0)
        {
            start = 0;
        }

        if (end > s.Length)
        {
            end = s.Length;
        }

        if (end < start)
        {
            end = start;
        }

        return s.Substring(start, end - start);
    }

    // Split on /\r?\n/ (drop the '\r' consumed by the delimiter).
    private static IReadOnlyList<string> SplitLines(string content)
    {
        var parts = content.Split('\n');
        for (var i = 0; i < parts.Length; i++)
        {
            if (parts[i].Length > 0 && parts[i][^1] == '\r')
            {
                parts[i] = parts[i][..^1];
            }
        }

        return parts;
    }

    private static string LastSegment(string s, char sep)
    {
        var idx = s.LastIndexOf(sep);
        return idx >= 0 ? s.Substring(idx + 1) : s;
    }

    // ≙ .replace(/^\(|\)$/g, '') — strip one enclosing paren pair.
    private static string StripEnclosingParens(string s)
    {
        if (s.StartsWith('('))
        {
            s = s.Substring(1);
        }

        if (s.EndsWith(')'))
        {
            s = s.Substring(0, s.Length - 1);
        }

        return s;
    }

    // ≙ .replace(/^["']|["']$/g, '') — strip one enclosing quote pair.
    private static string StripOuterQuotes(string s)
    {
        if (s.Length > 0 && (s[0] == '"' || s[0] == '\''))
        {
            s = s.Substring(1);
        }

        if (s.Length > 0 && (s[^1] == '"' || s[^1] == '\''))
        {
            s = s.Substring(0, s.Length - 1);
        }

        return s;
    }

    // ── Fixed patterns ([GeneratedRegex]) ─────────────────────────────────────

    [GeneratedRegex(@"^[A-Z][a-zA-Z]+$")]
    private static partial Regex PascalNameRegex();

    [GeneratedRegex(@"@RequestMapping\s*\(([^)]*)\)\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*(?:public\s+|final\s+|abstract\s+|open\s+|data\s+|sealed\s+)*class\b")]
    private static partial Regex ClassRequestMappingRegex();

    [GeneratedRegex(@"@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\b\s*(\([^)]*\))?")]
    private static partial Regex VerbMappingRegex();

    [GeneratedRegex(@"@RequestMapping\b\s*(\([^)]*\))?")]
    private static partial Regex RequestMappingRegex();

    [GeneratedRegex(@"^\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*(?:public\s+|final\s+|abstract\s+|open\s+|data\s+|sealed\s+)*class\b")]
    private static partial Regex AfterClassRegex();

    [GeneratedRegex(@"\bfun\s+(\w+)\s*\(|\b(?:public|private|protected)\s+[^;{=]*?\s+(\w+)\s*\(")]
    private static partial Regex MethodDeclRegex();

    [GeneratedRegex(@"method\s*=\s*(?:RequestMethod\.)?(\w+)")]
    private static partial Regex RequestMethodVerbRegex();

    [GeneratedRegex(@"[""']([^""']*)[""']")]
    private static partial Regex MappingPathRegex();

    [GeneratedRegex(@"@Value\s*\(\s*[""']\$\{([^}:]+)(?::[^}]*)?\}[""']\s*\)")]
    private static partial Regex ValueBindingRegex();

    [GeneratedRegex(@"@ConfigurationProperties\s*\(\s*(?:prefix\s*=\s*)?[""']([^""']+)[""']")]
    private static partial Regex ConfigPropertiesRegex();

    [GeneratedRegex(@"^(application|bootstrap)(-[\w.-]+)?\.(yml|yaml|properties)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SpringConfigFileRegex();

    [GeneratedRegex(@"\.properties$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex PropertiesExtRegex();

    [GeneratedRegex(@"^(application|bootstrap)\.(yml|yaml|properties)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex BaseConfigFileRegex();

    [GeneratedRegex(@"[-_]")]
    private static partial Regex DashUnderscoreRegex();
}

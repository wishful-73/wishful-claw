using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphGoWebResolver — Go web framework resolver (port of
// resolution/frameworks/go.ts; analysis/02 §3.3 row 15). Handles Gin, Echo, Fiber,
// Chi, and net/http patterns. Contributes:
//   * resolve(): convention lookups for Handler/Service/Repository/Store/Middleware
//     symbols and PascalCase model structs, preferring framework-conventional dirs.
//   * extract(): `route` nodes for `<var>.METHOD("/path", handler)`. The receiver is
//     ANY identifier (routes group on `v1.GET`, `userRouter.POST`, …), gated by the
//     HTTP verb + string-path + handler-arg shape. The handler's tail identifier
//     becomes a `references` edge.
//
// Named CodeGraphGoWebResolver (Name = "go") to avoid any type-name collision.
// GLOBAL namespace, all-internal, reflection-free/AOT; [GeneratedRegex] fixed patterns.
// =============================================================================
internal sealed partial class CodeGraphGoWebResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] GoLanguages = { CodeGraphLanguage.Go };

    private static readonly CodeGraphFrameworkExtraction EmptyExtraction =
        new(Array.Empty<CodeGraphNode>(), Array.Empty<CodeGraphUnresolvedReference>());

    // Framework-conventional directory hints (go.ts:146). Bare segment names — the
    // path check wraps each as `/<dir>/`.
    private static readonly string[] HandlerDirs = { "handler", "handlers", "api", "routes", "controller", "controllers" };
    private static readonly string[] ServiceDirs = { "service", "services", "repository", "store", "pkg" };
    private static readonly string[] MiddlewareDirs = { "middleware", "middlewares" };
    private static readonly string[] ModelDirs = { "model", "models", "entity", "entities", "domain", "pkg" };

    private static readonly HashSet<string> ServiceKinds = new(StringComparer.Ordinal)
    {
        CodeGraphNodeKind.Struct, CodeGraphNodeKind.Interface
    };

    public string Name => "go";

    public IReadOnlyList<string>? Languages => GoLanguages;

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        // go.mod signals a Go module.
        if (ctx.ReadFile("go.mod") is not null)
        {
            return true;
        }

        // Otherwise any .go file.
        foreach (var f in ctx.GetAllFiles())
        {
            if (f.EndsWith(".go", StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var name = r.ReferenceName;

        // Pattern 1: Handler references.
        if (name.EndsWith("Handler", StringComparison.Ordinal) || name.StartsWith("Handle", StringComparison.Ordinal))
        {
            var target = ResolveByNameAndKind(name, CodeGraphNodeKind.Function, null, HandlerDirs, ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 2: Service / Repository / Store references.
        if (name.EndsWith("Service", StringComparison.Ordinal) ||
            name.EndsWith("Repository", StringComparison.Ordinal) ||
            name.EndsWith("Store", StringComparison.Ordinal))
        {
            var target = ResolveByNameAndKind(name, null, ServiceKinds, ServiceDirs, ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 3: Middleware references.
        if (name.EndsWith("Middleware", StringComparison.Ordinal) ||
            name.StartsWith("Auth", StringComparison.Ordinal) ||
            name.StartsWith("Log", StringComparison.Ordinal))
        {
            var target = ResolveByNameAndKind(name, CodeGraphNodeKind.Function, null, MiddlewareDirs, ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.75, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 4: Model / Entity references (PascalCase structs).
        if (PascalNameRegex().IsMatch(name))
        {
            var target = ResolveByNameAndKind(name, CodeGraphNodeKind.Struct, null, ModelDirs, ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.7, CodeGraphResolvedBy.Framework);
            }
        }

        return null;
    }

    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        if (!filePath.EndsWith(".go", StringComparison.Ordinal))
        {
            return EmptyExtraction;
        }

        var nodes = new List<CodeGraphNode>();
        var references = new List<CodeGraphUnresolvedReference>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Go);

        // <anyVar>.METHOD("/path", handler) — Gin (GET/POST/…), Chi (Get/Post/…),
        // net/http (HandleFunc/Handle). Handle/HandleFunc map to the ANY verb.
        foreach (Match match in RouteRegex().Matches(safe))
        {
            var rawMethod = match.Groups[1].Value;
            var routePath = match.Groups[2].Value;
            var line = LineAt(safe, match.Index);
            var method = rawMethod is "Handle" or "HandleFunc" ? "ANY" : rawMethod.ToUpperInvariant();

            var routeNode = RouteNode($"route:{filePath}:{line}:{method}:{routePath}", $"{method} {routePath}",
                $"{filePath}::route:{routePath}", filePath, line, match.Length, now);
            nodes.Add(routeNode);

            var handlerName = ExtractGoTailIdent(match.Groups[3].Value);
            if (handlerName is not null)
            {
                references.Add(RouteRef(routeNode.Id, handlerName, line, filePath));
            }
        }

        return new CodeGraphFrameworkExtraction(nodes, references);
    }

    // Last identifier of an expression like `pkg.Sub.handler` or `handler` (go.ts:139).
    private static string? ExtractGoTailIdent(string expr)
    {
        var cleaned = WhitespaceRegex().Replace(expr.Trim(), string.Empty);
        cleaned = TrailingParensRegex().Replace(cleaned, string.Empty);
        var m = TailIdentRegex().Match(cleaned);
        return m.Success ? m.Groups[1].Value : null;
    }

    // Resolve a symbol by name via the indexed name query, preferring framework-
    // conventional directories. `kind` (single) OR `kinds` (set) filter; both null =
    // any kind (go.ts:156).
    private static string? ResolveByNameAndKind(
        string name, string? kind, HashSet<string>? kinds, string[] preferredDirs, CodeGraphResolutionContext ctx)
    {
        var candidates = ctx.GetNodesByName(name);
        if (candidates.Count == 0)
        {
            return null;
        }

        List<CodeGraphNode>? kindFiltered = null;
        foreach (var n in candidates)
        {
            var ok = kinds is not null ? kinds.Contains(n.Kind) : kind is null || n.Kind == kind;
            if (ok)
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
            foreach (var d in preferredDirs)
            {
                if (n.FilePath.Contains($"/{d}/", StringComparison.Ordinal))
                {
                    return n.Id;
                }
            }
        }

        return kindFiltered[0].Id;
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
        new(id, CodeGraphNodeKind.Route, name, qualifiedName, filePath, CodeGraphLanguage.Go, line, line, 0, endColumn,
            null, null, null, false, false, false, false, null, null, null, now);

    private static CodeGraphUnresolvedReference RouteRef(string fromNodeId, string referenceName, int line, string filePath) =>
        new(fromNodeId, referenceName, CodeGraphEdgeKind.References, line, 0, filePath, CodeGraphLanguage.Go, null, null);

    // ── Fixed patterns ([GeneratedRegex]) — verbatim from go.ts ────────────────

    [GeneratedRegex(@"\b\w+\.(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|Get|Post|Put|Patch|Delete|Handle|HandleFunc)\s*\(\s*""([^""]+)""\s*,\s*([^)]+)\)")]
    private static partial Regex RouteRegex();

    [GeneratedRegex(@"^[A-Z][a-zA-Z]+$")]
    private static partial Regex PascalNameRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();

    [GeneratedRegex(@"\(\)$")]
    private static partial Regex TrailingParensRegex();

    [GeneratedRegex(@"(?:\.|^)([A-Za-z_][A-Za-z0-9_]*)$")]
    private static partial Regex TailIdentRegex();
}

using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphFastApiResolver — FastAPI framework resolver (≙ fastapiResolver,
// frameworks/python.ts). Emits route->handler edges from method decorators
// (`@x.get('/path')` -> the next `def`) using the SAME shared decorator-route
// extractor as Flask (CodeGraphFlaskResolver.ExtractDecoratorRoutes), and
// resolves `*_router`/`router` variable refs and `get_*`/`Depends*` dependency
// refs to their conventional-directory declarations.
//
// GLOBAL namespace, internal, reflection-free/AOT; static patterns are
// [GeneratedRegex] partial methods (the codebase convention).
// =============================================================================
internal sealed partial class CodeGraphFastApiResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] PythonLanguages = { CodeGraphLanguage.Python };

    // detect(): entrypoint files scanned for a `FastAPI(` instantiation.
    private static readonly string[] DetectEntrypoints = { "app.py", "main.py", "api.py" };

    private static readonly string[] RouterDirs = { "/routers/", "/api/", "/routes/", "/endpoints/" };
    private static readonly string[] DepDirs = { "/dependencies/", "/deps/", "/core/" };

    private static readonly HashSet<string> VariableKinds =
        new(StringComparer.Ordinal) { CodeGraphNodeKind.Variable };
    private static readonly HashSet<string> FunctionKinds =
        new(StringComparer.Ordinal) { CodeGraphNodeKind.Function };

    public string Name => "fastapi";

    public IReadOnlyList<string>? Languages => PythonLanguages;

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        var requirements = ctx.ReadFile("requirements.txt");
        if (requirements is not null && FastApiWordRegex().IsMatch(requirements))
        {
            return true;
        }

        var pyproject = ctx.ReadFile("pyproject.toml");
        if (pyproject is not null && FastApiWordRegex().IsMatch(pyproject))
        {
            return true;
        }

        foreach (var file in DetectEntrypoints)
        {
            var content = ctx.ReadFile(file);
            if (content is not null && content.Contains("FastAPI(", StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var name = r.ReferenceName;
        if (name.EndsWith("_router", StringComparison.Ordinal) || name == "router")
        {
            var result = ResolveByNameAndKind(name, VariableKinds, RouterDirs, ctx);
            if (result is not null)
            {
                return new CodeGraphResolvedRef(result, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        if (name.StartsWith("get_", StringComparison.Ordinal) ||
            name.StartsWith("Depends", StringComparison.Ordinal))
        {
            var result = ResolveByNameAndKind(name, FunctionKinds, DepDirs, ctx);
            if (result is not null)
            {
                return new CodeGraphResolvedRef(result, 0.75, CodeGraphResolvedBy.Framework);
            }
        }

        return null;
    }

    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        if (!filePath.EndsWith(".py", StringComparison.Ordinal))
        {
            return new CodeGraphFrameworkExtraction(
                Array.Empty<CodeGraphNode>(),
                Array.Empty<CodeGraphUnresolvedReference>());
        }

        var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Python);

        // FastAPI: @x.METHOD('/path') -> handler on the next def line. Path may
        // be empty ("") for routes mounted at the router/prefix root. Same shared
        // extractor as Flask; the method is a captured group, no default.
        return CodeGraphFlaskResolver.ExtractDecoratorRoutes(
            filePath,
            safe,
            FastApiRouteDecoratorRegex(),
            defaultMethod: "",
            methodGroup: 2,
            methodFromGroup: 0,
            pathGroup: 3,
            handlerGroup: 0,
            findHandler: true,
            language: CodeGraphLanguage.Python);
    }

    // Resolve a symbol by name using indexed queries, preferring framework-
    // conventional directories (≙ resolveByNameAndKind, python.ts).
    private static string? ResolveByNameAndKind(
        string name,
        HashSet<string> kinds,
        string[] preferredDirPatterns,
        CodeGraphResolutionContext ctx)
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

        if (preferredDirPatterns.Length > 0)
        {
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
        }

        return kindFiltered[0].Id;
    }

    // ── Fixed patterns ([GeneratedRegex]) ─────────────────────────────────────

    [GeneratedRegex(@"\bfastapi\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex FastApiWordRegex();

    [GeneratedRegex(@"@(\w+)\.(get|post|put|patch|delete|options|head)\s*\(\s*['""]([^'""]*)['""]")]
    private static partial Regex FastApiRouteDecoratorRegex();
}

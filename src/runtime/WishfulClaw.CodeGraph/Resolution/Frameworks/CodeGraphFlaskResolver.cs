using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphFlaskResolver — Flask framework resolver (≙ flaskResolver,
// frameworks/python.ts). Emits route->handler edges from decorator routes
// (`@x.route('/path')` -> the next `def`) plus Flask-RESTful `add_resource`
// registrations, and resolves `*_bp` / `*_blueprint` variable refs to the
// Blueprint object.
//
// Hosts the SHARED decorator-route extractor (ExtractDecoratorRoutes) that
// CodeGraphFastApiResolver reuses verbatim — the TS `extractDecoratorRoutes`
// free function lived in python.ts and served both resolvers.
//
// GLOBAL namespace, internal, reflection-free/AOT; static patterns are
// [GeneratedRegex] partial methods (the codebase convention).
// =============================================================================
internal sealed partial class CodeGraphFlaskResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] PythonLanguages = { CodeGraphLanguage.Python };

    // detect(): config files scanned for a bare `flask` token.
    private static readonly string[] DetectConfigFiles =
    {
        "requirements.txt", "pyproject.toml", "Pipfile", "setup.py"
    };

    private static readonly string[] EmptyDirs = Array.Empty<string>();
    private static readonly HashSet<string> VariableKinds =
        new(StringComparer.Ordinal) { CodeGraphNodeKind.Variable };

    public string Name => "flask";

    public IReadOnlyList<string>? Languages => PythonLanguages;

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        foreach (var f in DetectConfigFiles)
        {
            var c = ctx.ReadFile(f);
            if (c is not null && FlaskWordRegex().IsMatch(c))
            {
                return true;
            }
        }

        // Any app entrypoint (root OR subdir, e.g. conduit/app.py) that imports
        // flask and instantiates Flask(...) — Flask(__name__), the app-factory
        // pattern, etc. Bounded to the first 50 entrypoint-named files.
        var checked_ = 0;
        foreach (var f in ctx.GetAllFiles())
        {
            if (!EntrypointRegex().IsMatch(f))
            {
                continue;
            }

            if (checked_ >= 50)
            {
                break;
            }

            checked_++;
            var c = ctx.ReadFile(f);
            if (c is not null && FlaskCtorRegex().IsMatch(c) && FlaskImportRegex().IsMatch(c))
            {
                return true;
            }
        }

        return false;
    }

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var name = r.ReferenceName;
        if (name.EndsWith("_bp", StringComparison.Ordinal) ||
            name.EndsWith("_blueprint", StringComparison.Ordinal))
        {
            var result = ResolveByNameAndKind(name, VariableKinds, EmptyDirs, ctx);
            if (result is not null)
            {
                return new CodeGraphResolvedRef(result, 0.8, CodeGraphResolvedBy.Framework);
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

        // Flask: @x.route('/path', methods=[...] | (...)) — the handler is the
        // next `def`, allowing intervening decorators (@login_required) and
        // stacked @x.route() lines. methods may be a list OR a tuple.
        var decorator = ExtractDecoratorRoutes(
            filePath,
            safe,
            FlaskRouteDecoratorRegex(),
            defaultMethod: "GET",
            methodGroup: 0,
            methodFromGroup: 3,
            pathGroup: 2,
            handlerGroup: 0,
            findHandler: true,
            language: CodeGraphLanguage.Python);

        var restful = ExtractFlaskRestful(filePath, safe);

        var nodes = new List<CodeGraphNode>(decorator.Nodes.Count + restful.Nodes.Count);
        nodes.AddRange(decorator.Nodes);
        nodes.AddRange(restful.Nodes);
        var references = new List<CodeGraphUnresolvedReference>(
            decorator.References.Count + restful.References.Count);
        references.AddRange(decorator.References);
        references.AddRange(restful.References);
        return new CodeGraphFrameworkExtraction(nodes, references);
    }

    // ------------------------------------------------------------------
    // Shared decorator-route extractor (≙ extractDecoratorRoutes, python.ts) —
    // used by Flask above and by CodeGraphFastApiResolver. `*Group` indices are
    // 1-based regex groups; 0 = "absent" (the TS optional-field truthiness test).
    // ------------------------------------------------------------------
    internal static CodeGraphFrameworkExtraction ExtractDecoratorRoutes(
        string filePath,
        string content,
        Regex decoratorRegex,
        string defaultMethod,
        int methodGroup,
        int methodFromGroup,
        int pathGroup,
        int handlerGroup,
        bool findHandler,
        string language)
    {
        var nodes = new List<CodeGraphNode>();
        var references = new List<CodeGraphUnresolvedReference>();
        var now = NowMs();

        foreach (Match match in decoratorRegex.Matches(content))
        {
            var routePath = match.Groups[pathGroup].Value;
            var method = defaultMethod;
            if (methodGroup != 0 && match.Groups[methodGroup].Success && match.Groups[methodGroup].Value.Length > 0)
            {
                method = match.Groups[methodGroup].Value.ToUpperInvariant();
            }
            else if (methodFromGroup != 0 && match.Groups[methodFromGroup].Success &&
                     match.Groups[methodFromGroup].Value.Length > 0)
            {
                var m = MethodsListRegex().Match(match.Groups[methodFromGroup].Value);
                if (m.Success)
                {
                    method = m.Groups[1].Value.ToUpperInvariant();
                }
            }

            var line = LineFromIndex(content, match.Index);
            var pathOrRoot = routePath.Length > 0 ? routePath : "/";
            var name = method.Length > 0 ? method + " " + pathOrRoot : pathOrRoot;

            var routeNode = new CodeGraphNode(
                Id: $"route:{filePath}:{line}:{method}:{routePath}",
                Kind: CodeGraphNodeKind.Route,
                Name: name,
                QualifiedName: $"{filePath}::{method}:{routePath}",
                FilePath: filePath,
                Language: language,
                StartLine: line,
                EndLine: line,
                StartColumn: 0,
                EndColumn: match.Length,
                Docstring: null,
                Signature: null,
                Visibility: null,
                IsExported: false,
                IsAsync: false,
                IsStatic: false,
                IsAbstract: false,
                Decorators: null,
                TypeParameters: null,
                ReturnType: null,
                UpdatedAt: now);
            nodes.Add(routeNode);

            string? handlerName = null;
            if (handlerGroup != 0 && match.Groups[handlerGroup].Success && match.Groups[handlerGroup].Value.Length > 0)
            {
                handlerName = match.Groups[handlerGroup].Value;
            }
            else if (findHandler)
            {
                var tail = content.Substring(match.Index + match.Length);
                var defMatch = HandlerDefRegex().Match(tail);
                if (defMatch.Success)
                {
                    handlerName = defMatch.Groups[1].Value;
                }
            }

            if (!string.IsNullOrEmpty(handlerName))
            {
                references.Add(new CodeGraphUnresolvedReference(
                    routeNode.Id,
                    handlerName,
                    CodeGraphEdgeKind.References,
                    line,
                    0,
                    filePath,
                    CodeGraphLanguage.Python,
                    Candidates: null,
                    RowId: null));
            }
        }

        return new CodeGraphFrameworkExtraction(nodes, references);
    }

    // ------------------------------------------------------------------
    // Flask-RESTful: `api.add_resource(ResourceClass, '/path'[, '/path2'])` (and
    // variants like `add_org_resource`). The ResourceClass holds the HTTP-verb
    // methods, so each route references the class; method is ANY. (≙ extractFlaskRestful)
    // ------------------------------------------------------------------
    private static CodeGraphFrameworkExtraction ExtractFlaskRestful(string filePath, string safe)
    {
        var nodes = new List<CodeGraphNode>();
        var references = new List<CodeGraphUnresolvedReference>();
        var now = NowMs();

        foreach (Match m in FlaskRestfulRegex().Matches(safe))
        {
            var className = m.Groups[1].Value;
            var paths = new List<string>();
            foreach (Match pm in QuotedStringRegex().Matches(m.Groups[2].Value))
            {
                paths.Add(pm.Groups[1].Value);
            }

            var line = LineFromIndex(safe, m.Index);
            foreach (var routePath in paths)
            {
                var routeNode = new CodeGraphNode(
                    Id: $"route:{filePath}:{line}:ANY:{routePath}",
                    Kind: CodeGraphNodeKind.Route,
                    Name: $"ANY {routePath}",
                    QualifiedName: $"{filePath}::ANY:{routePath}",
                    FilePath: filePath,
                    Language: CodeGraphLanguage.Python,
                    StartLine: line,
                    EndLine: line,
                    StartColumn: 0,
                    EndColumn: 0,
                    Docstring: null,
                    Signature: null,
                    Visibility: null,
                    IsExported: false,
                    IsAsync: false,
                    IsStatic: false,
                    IsAbstract: false,
                    Decorators: null,
                    TypeParameters: null,
                    ReturnType: null,
                    UpdatedAt: now);
                nodes.Add(routeNode);
                references.Add(new CodeGraphUnresolvedReference(
                    routeNode.Id,
                    className,
                    CodeGraphEdgeKind.References,
                    line,
                    0,
                    filePath,
                    CodeGraphLanguage.Python,
                    Candidates: null,
                    RowId: null));
            }
        }

        return new CodeGraphFrameworkExtraction(nodes, references);
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

    // content.slice(0, index).split('\n').length — 1-based line of a match offset.
    private static int LineFromIndex(string content, int index)
    {
        var count = 1;
        for (var i = 0; i < index && i < content.Length; i++)
        {
            if (content[i] == '\n')
            {
                count++;
            }
        }

        return count;
    }

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // ── Fixed patterns ([GeneratedRegex]) ─────────────────────────────────────

    [GeneratedRegex(@"\bflask\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex FlaskWordRegex();

    [GeneratedRegex(@"(?:^|/)(app|application|main|wsgi|__init__)\.py$")]
    private static partial Regex EntrypointRegex();

    [GeneratedRegex(@"\bFlask\s*\(")]
    private static partial Regex FlaskCtorRegex();

    [GeneratedRegex(@"\bimport\s+flask\b|\bfrom\s+flask\b")]
    private static partial Regex FlaskImportRegex();

    [GeneratedRegex(@"@(\w+)\.route\s*\(\s*['""]([^'""]*)['""](?:\s*,\s*methods\s*=\s*[[(]([^\])]+)[\])])?\s*\)")]
    private static partial Regex FlaskRouteDecoratorRegex();

    [GeneratedRegex(@"\.add\w*[Rr]esource\s*\(\s*(\w+)\s*,\s*((?:['""][^'""]+['""]\s*,?\s*)+)")]
    private static partial Regex FlaskRestfulRegex();

    [GeneratedRegex(@"['""]([^'""]+)['""]")]
    private static partial Regex QuotedStringRegex();

    [GeneratedRegex(@"['""]([A-Z]+)['""]", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex MethodsListRegex();

    [GeneratedRegex(@"\n\s*(?:async\s+)?def\s+(\w+)")]
    private static partial Regex HandlerDefRegex();
}

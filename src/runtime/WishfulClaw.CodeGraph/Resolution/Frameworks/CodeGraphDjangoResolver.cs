using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphDjangoResolver — Django framework resolver (≙ djangoResolver,
// frameworks/python.ts). Contributes edges a static parse can't see:
//   * URLconf route -> view (path/re_path/url(...) + `.as_view()` / dotted-handler
//     suffix heuristics),
//   * `include('app.urls')` -> the included urls.py file (an `imports` ref),
//   * DRF `router.register(r'x', XViewSet)` -> the ViewSet class,
//   * the ORM dynamic dispatch `self._iterable_class(self)` -> ModelIterable.__iter__,
//   * suffix-convention name refs (Model/View/ViewSet/Form) -> their declarations.
//
// GLOBAL namespace, internal, reflection-free/AOT; static patterns are
// [GeneratedRegex] partial methods (the codebase convention). Comments are
// blanked via CodeGraphStripComments before the route scans.
// =============================================================================
internal sealed partial class CodeGraphDjangoResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] PythonLanguages = { CodeGraphLanguage.Python };

    // Framework-conventional directory hints (resolveByNameAndKind).
    private static readonly string[] ModelDirs = { "models", "app/models", "src/models" };
    private static readonly string[] ViewDirs = { "views", "app/views", "src/views", "api/views" };
    private static readonly string[] FormDirs = { "forms", "app/forms", "src/forms" };

    private static readonly HashSet<string> ClassKinds =
        new(StringComparer.Ordinal) { CodeGraphNodeKind.Class };
    private static readonly HashSet<string> ViewKinds =
        new(StringComparer.Ordinal) { CodeGraphNodeKind.Class, CodeGraphNodeKind.Function };

    public string Name => "django";

    public IReadOnlyList<string>? Languages => PythonLanguages;

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        var requirements = ctx.ReadFile("requirements.txt");
        if (requirements is not null && requirements.Contains("django", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var setup = ctx.ReadFile("setup.py");
        if (setup is not null && setup.Contains("django", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var pyproject = ctx.ReadFile("pyproject.toml");
        if (pyproject is not null && pyproject.Contains("django", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return ctx.FileExists("manage.py");
    }

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var name = r.ReferenceName;

        if (name.EndsWith("Model", StringComparison.Ordinal) || SingleCapWordRegex().IsMatch(name))
        {
            var result = ResolveByNameAndKind(name, ClassKinds, ModelDirs, ctx);
            if (result is not null)
            {
                return new CodeGraphResolvedRef(result, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        if (name.EndsWith("View", StringComparison.Ordinal) || name.EndsWith("ViewSet", StringComparison.Ordinal))
        {
            var result = ResolveByNameAndKind(name, ViewKinds, ViewDirs, ctx);
            if (result is not null)
            {
                return new CodeGraphResolvedRef(result, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        if (name.EndsWith("Form", StringComparison.Ordinal))
        {
            var result = ResolveByNameAndKind(name, ClassKinds, FormDirs, ctx);
            if (result is not null)
            {
                return new CodeGraphResolvedRef(result, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        // ORM dynamic dispatch: QuerySet iterables call `self._iterable_class(self)`
        // — bridge it to ModelIterable.__iter__ (the default iterable's SQL entry).
        if (name == "_iterable_class")
        {
            var target = ResolveModelIterableIter(ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.7, CodeGraphResolvedBy.Framework);
            }
        }

        return null;
    }

    // Let the ORM dynamic-dispatch attribute and a dotted `x.urls` module path past
    // resolveOne's "no possible match" pre-filter (≙ claimsReference, python.ts).
    public bool ClaimsReference(string name) =>
        name == "_iterable_class" || name.EndsWith(".urls", StringComparison.Ordinal);

    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        if (!filePath.EndsWith(".py", StringComparison.Ordinal))
        {
            return new CodeGraphFrameworkExtraction(
                Array.Empty<CodeGraphNode>(),
                Array.Empty<CodeGraphUnresolvedReference>());
        }

        var nodes = new List<CodeGraphNode>();
        var references = new List<CodeGraphUnresolvedReference>();
        var now = NowMs();
        var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Python);

        // path('url', handler, name=...) / re_path(r'...', handler) / url(r'...', handler).
        // Group 1=function name, 2=url string, 3=handler expr (may hold one balanced () pair).
        foreach (Match match in RouteRegex().Matches(safe))
        {
            var urlPath = match.Groups[2].Value;
            var handlerExpr = match.Groups[3].Value;
            var line = LineFromIndex(safe, match.Index);

            var routeNode = new CodeGraphNode(
                Id: $"route:{filePath}:{line}:{urlPath}",
                Kind: CodeGraphNodeKind.Route,
                Name: urlPath,
                QualifiedName: $"{filePath}::route:{urlPath}",
                FilePath: filePath,
                Language: CodeGraphLanguage.Python,
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

            var target = ResolveHandlerName(handlerExpr.Trim());
            if (target is not null)
            {
                references.Add(new CodeGraphUnresolvedReference(
                    routeNode.Id,
                    target.Value.Name,
                    target.Value.Kind,
                    line,
                    0,
                    filePath,
                    CodeGraphLanguage.Python,
                    Candidates: null,
                    RowId: null));
            }
        }

        // DRF router registration: `router.register(r'articles', ArticleViewSet)` ->
        // route -> the ViewSet class. The STRING first arg separates this from
        // `admin.site.register(Model, Admin)`; the View/ViewSet suffix keeps it to DRF.
        foreach (Match match in RouterRegex().Matches(safe))
        {
            var prefix = RouterPrefixCleanupRegex().Replace(match.Groups[1].Value, string.Empty);
            var viewsetRaw = match.Groups[2].Value;
            var dotIdx = viewsetRaw.LastIndexOf('.');
            var viewset = dotIdx >= 0 ? viewsetRaw[(dotIdx + 1)..] : viewsetRaw;
            if (!ViewSuffixRegex().IsMatch(viewset))
            {
                continue;
            }

            var line = LineFromIndex(safe, match.Index);
            var routeNode = new CodeGraphNode(
                Id: $"route:{filePath}:{line}:VIEWSET:{prefix}",
                Kind: CodeGraphNodeKind.Route,
                Name: $"VIEWSET /{prefix}",
                QualifiedName: $"{filePath}::route:{prefix}",
                FilePath: filePath,
                Language: CodeGraphLanguage.Python,
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
            references.Add(new CodeGraphUnresolvedReference(
                routeNode.Id,
                viewset,
                CodeGraphEdgeKind.References,
                line,
                0,
                filePath,
                CodeGraphLanguage.Python,
                Candidates: null,
                RowId: null));
        }

        return new CodeGraphFrameworkExtraction(nodes, references);
    }

    // Parse a Django URL handler expression into the symbol/module to link, or null
    // for shapes we can't confidently bind (e.g. lambdas). (≙ resolveHandlerName)
    private static (string Name, string Kind)? ResolveHandlerName(string expr)
    {
        // include('module.path') -> an imports ref onto the included URLconf module.
        var includeMatch = IncludeRegex().Match(expr);
        if (includeMatch.Success)
        {
            return (includeMatch.Groups[1].Value, CodeGraphEdgeKind.Imports);
        }

        // Strip a trailing .as_view(...) then any other trailing method call.
        var head = AsViewStripRegex().Replace(expr, string.Empty);
        head = TrailingMethodStripRegex().Replace(head, string.Empty);

        string? last = null;
        foreach (var seg in head.Split('.'))
        {
            if (seg.Length > 0)
            {
                last = seg;
            }
        }

        if (last is null || !IdentifierRegex().IsMatch(last))
        {
            return null;
        }

        return (last, CodeGraphEdgeKind.References);
    }

    // ModelIterable.__iter__ — the default iterable QuerySet invokes via
    // `self._iterable_class(self)`; its __iter__ statically calls the SQL compiler,
    // so linking the dynamic dispatch here closes the QuerySet->SQL chain.
    private static string? ResolveModelIterableIter(CodeGraphResolutionContext ctx)
    {
        CodeGraphNode? cls = null;
        foreach (var n in ctx.GetNodesByName("ModelIterable"))
        {
            if (n.Kind == CodeGraphNodeKind.Class)
            {
                cls = n;
                break;
            }
        }

        if (cls is null)
        {
            return null;
        }

        foreach (var n in ctx.GetNodesByName("__iter__"))
        {
            if (n.FilePath == cls.FilePath && n.StartLine >= cls.StartLine && n.StartLine <= cls.EndLine)
            {
                return n.Id;
            }
        }

        return null;
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

    [GeneratedRegex(@"^[A-Z][a-z]+$")]
    private static partial Regex SingleCapWordRegex();

    [GeneratedRegex(@"\b(path|re_path|url)\s*\(\s*r?['""]([^'""]+)['""]\s*,\s*([\w.]+(?:\s*\([^)]*\))?)")]
    private static partial Regex RouteRegex();

    [GeneratedRegex(@"\.register\s*\(\s*r?['""]([^'""]+)['""]\s*,\s*([\w.]+)")]
    private static partial Regex RouterRegex();

    [GeneratedRegex(@"^\^|/?\$$")]
    private static partial Regex RouterPrefixCleanupRegex();

    [GeneratedRegex(@"View(Set)?$")]
    private static partial Regex ViewSuffixRegex();

    [GeneratedRegex(@"^include\s*\(\s*['""]([^'""]+)['""]")]
    private static partial Regex IncludeRegex();

    [GeneratedRegex(@"\.as_view\s*\([^)]*\)\s*$")]
    private static partial Regex AsViewStripRegex();

    [GeneratedRegex(@"\.\w+\s*\([^)]*\)\s*$")]
    private static partial Regex TrailingMethodStripRegex();

    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_]*$")]
    private static partial Regex IdentifierRegex();
}

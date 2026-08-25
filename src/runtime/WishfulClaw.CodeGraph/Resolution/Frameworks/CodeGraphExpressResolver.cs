using System.Text.Json;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphExpressResolver — Express / general Node.js framework resolver (port of
// resolution/frameworks/express.ts; analysis/02 §3.3 row 3). Contributes:
//   * resolve(): middleware names, `XController.method`, `XService.method` refs.
//   * extract(): route nodes for `(app|router).METHOD('/path', …)`. A NAMED handler
//     (the last comma-separated arg) becomes a `references` edge; an INLINE ARROW
//     handler's body calls become `calls` edges so route->service traces connect.
//     Uses a string-aware balanced-paren reader (MatchDelim) so `)`/`}` inside the
//     handler body/strings don't truncate the argument list.
//
// GLOBAL namespace, all-internal, reflection-free/AOT. Fixed patterns via
// [GeneratedRegex]; package.json parsed with JsonDocument (never Deserialize<T>).
// =============================================================================
internal sealed partial class CodeGraphExpressResolver : ICodeGraphFrameworkResolver
{
    public string Name => "express";

    public IReadOnlyList<string>? Languages { get; } = new[]
    {
        CodeGraphLanguage.JavaScript, CodeGraphLanguage.TypeScript
    };

    // Express res/req methods + common JS builtins — calls to these inside a handler
    // body are framework/noise, not the business flow surfaced as route edges.
    private static readonly HashSet<string> ReservedCalls = new(StringComparer.Ordinal)
    {
        "json", "jsonp", "send", "sendStatus", "sendFile", "status", "end", "redirect",
        "render", "set", "get", "header", "type", "format", "attachment", "download",
        "cookie", "clearCookie", "append", "location", "vary", "links", "accepts", "is",
        "next", "then", "catch", "finally", "resolve", "reject", "all", "race",
        "map", "filter", "forEach", "reduce", "find", "push", "pop", "slice", "splice",
        "includes", "keys", "values", "entries", "assign", "parse", "stringify",
        "log", "error", "warn", "info", "String", "Number", "Boolean", "Array", "Object",
        "Date", "Math", "JSON", "Promise", "require", "fail"
    };

    private static readonly string[] MiddlewareDirs = { "/middleware/", "/middlewares/" };

    // ------------------------------------------------------------------
    // detect
    // ------------------------------------------------------------------
    public bool Detect(CodeGraphResolutionContext ctx)
    {
        var packageJson = ctx.ReadFile("package.json");
        if (packageJson is not null &&
            PackageJsonHasDependency(packageJson, static k => k == "express" || k == "fastify" || k == "koa" || k == "hapi"))
        {
            return true;
        }

        // Common Express patterns in conventionally named files.
        foreach (var file in ctx.GetAllFiles())
        {
            if (file.Contains("routes", StringComparison.Ordinal) ||
                file.Contains("controllers", StringComparison.Ordinal) ||
                file.Contains("middleware", StringComparison.Ordinal))
            {
                var content = ctx.ReadFile(file);
                if (content is not null &&
                    (content.Contains("express", StringComparison.Ordinal) ||
                     content.Contains("app.get", StringComparison.Ordinal) ||
                     content.Contains("router.get", StringComparison.Ordinal)))
                {
                    return true;
                }
            }
        }

        return false;
    }

    // ------------------------------------------------------------------
    // resolve
    // ------------------------------------------------------------------
    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var name = r.ReferenceName;

        // Pattern 1: middleware references.
        if (IsMiddlewareName(name))
        {
            var target = ResolveMiddleware(name, ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 2: controller method references (XController.method).
        var controllerMatch = ControllerMethodRegex().Match(name);
        if (controllerMatch.Success)
        {
            var target = ResolveControllerMethod(controllerMatch.Groups[1].Value, controllerMatch.Groups[2].Value, ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.85, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 3: service/helper method references (XService.method).
        var serviceMatch = ServiceMethodRegex().Match(name);
        if (serviceMatch.Success)
        {
            var target = ResolveServiceMethod(
                serviceMatch.Groups[1].Value + serviceMatch.Groups[2].Value,
                serviceMatch.Groups[3].Value,
                ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        return null;
    }

    private static bool IsMiddlewareName(string name) => MiddlewareNameRegex().IsMatch(name);

    private static string? ResolveMiddleware(string name, CodeGraphResolutionContext ctx)
    {
        var candidates = ctx.GetNodesByName(name);
        var nameLower = name.ToLowerInvariant();
        var strippedLower = MiddlewareSuffixRegex().Replace(name, string.Empty).ToLowerInvariant();
        foreach (var n in candidates)
        {
            var lower = n.Name.ToLowerInvariant();
            if (lower == nameLower || lower == strippedLower)
            {
                return n.Id;
            }
        }

        var baseName = MiddlewareSuffixRegex().Replace(name, string.Empty);
        if (baseName != name)
        {
            var baseCandidates = ctx.GetNodesByName(baseName);
            var preferred = FilterByDirs(baseCandidates, MiddlewareDirs);
            if (preferred is { Count: > 0 })
            {
                return preferred[0].Id;
            }

            if (baseCandidates.Count > 0)
            {
                return baseCandidates[0].Id;
            }
        }

        return null;
    }

    private static string? ResolveControllerMethod(string controller, string method, CodeGraphResolutionContext ctx)
    {
        var controllerLower = controller.ToLowerInvariant();
        foreach (var n in ctx.GetNodesByName(method))
        {
            if ((n.Kind == CodeGraphNodeKind.Method || n.Kind == CodeGraphNodeKind.Function) &&
                n.FilePath.ToLowerInvariant().Contains(controllerLower, StringComparison.Ordinal))
            {
                return n.Id;
            }
        }

        // Fall back: find the controller class, then the method in its file.
        var controllerName = controller + "Controller";
        foreach (var ctrl in ctx.GetNodesByName(controllerName))
        {
            foreach (var n in ctx.GetNodesInFile(ctrl.FilePath))
            {
                if ((n.Kind == CodeGraphNodeKind.Method || n.Kind == CodeGraphNodeKind.Function) && n.Name == method)
                {
                    return n.Id;
                }
            }
        }

        return null;
    }

    private static string? ResolveServiceMethod(string serviceName, string method, CodeGraphResolutionContext ctx)
    {
        var stripped = ServiceSuffixRegex().Replace(serviceName, string.Empty).ToLowerInvariant();
        foreach (var n in ctx.GetNodesByName(method))
        {
            if ((n.Kind == CodeGraphNodeKind.Method || n.Kind == CodeGraphNodeKind.Function) &&
                n.FilePath.ToLowerInvariant().Contains(stripped, StringComparison.Ordinal))
            {
                return n.Id;
            }
        }

        return null;
    }

    // ------------------------------------------------------------------
    // extract
    // ------------------------------------------------------------------
    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        if (!ExtGuardRegex().IsMatch(filePath))
        {
            return new CodeGraphFrameworkExtraction(Array.Empty<CodeGraphNode>(), Array.Empty<CodeGraphUnresolvedReference>());
        }

        var nodes = new List<CodeGraphNode>();
        var references = new List<CodeGraphUnresolvedReference>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var lang = DetectLanguage(filePath);
        var safe = CodeGraphStripComments.StripForRegex(content, lang);

        // Match the route head up to the first arg: (app|router).METHOD('/path',
        foreach (Match match in HeadRegex().Matches(safe))
        {
            var method = match.Groups[2].Value;
            var routePath = match.Groups[3].Value;
            if (method == "use" && !routePath.StartsWith('/'))
            {
                continue;
            }

            var upper = method.ToUpperInvariant();
            var line = LineAt(safe, match.Index);
            var routeNode = RouteNode(
                $"route:{filePath}:{line}:{upper}:{routePath}",
                $"{upper} {routePath}",
                $"{filePath}::{upper}:{routePath}",
                filePath, line, match.Length, lang, now);
            nodes.Add(routeNode);

            // The full argument list = balanced parens from the route call's open paren.
            var openParen = safe.IndexOf('(', match.Index);
            var closeParen = openParen >= 0 ? MatchDelim(safe, openParen, '(', ')') : -1;
            var args = closeParen > openParen ? safe[(openParen + 1)..closeParen] : string.Empty;
            var arrowAt = args.IndexOf("=>", StringComparison.Ordinal);

            if (arrowAt >= 0)
            {
                // Inline arrow handler — attribute the body's calls to the route node as
                // `calls` edges. Body = balanced `{…}` after `=>`, or the whole tail.
                var afterArrow = args[(arrowAt + 2)..];
                var braceAt = afterArrow.IndexOf('{');
                var body = afterArrow;
                if (braceAt >= 0 && afterArrow[..braceAt].Trim().Length == 0)
                {
                    var end = MatchDelim(afterArrow, braceAt, '{', '}');
                    if (end > braceAt)
                    {
                        body = afterArrow[(braceAt + 1)..end];
                    }
                }

                var seen = new HashSet<string>(StringComparer.Ordinal);
                foreach (Match cm in CallRegex().Matches(body))
                {
                    var callName = cm.Groups[1].Value;
                    if (!seen.Add(callName) || ReservedCalls.Contains(callName))
                    {
                        continue;
                    }

                    references.Add(RouteRef(routeNode.Id, callName, CodeGraphEdgeKind.Calls, line, filePath, lang));
                }
            }
            else
            {
                // Named handler: the LAST comma-separated arg (earlier ones are middleware).
                string? last = null;
                foreach (var part in args.Split(','))
                {
                    var trimmed = part.Trim();
                    if (trimmed.Length > 0)
                    {
                        last = trimmed;
                    }
                }

                var handlerName = last is not null ? ExtractTailIdent(last) : null;
                if (handlerName is not null)
                {
                    references.Add(RouteRef(routeNode.Id, handlerName, CodeGraphEdgeKind.References, line, filePath, lang));
                }
            }
        }

        return new CodeGraphFrameworkExtraction(nodes, references);
    }

    // The trailing identifier of an expression: strip whitespace + a trailing `()`,
    // then the final `.ident` / leading ident.
    private static string? ExtractTailIdent(string expr)
    {
        var cleaned = WhitespaceRegex().Replace(expr, string.Empty);
        cleaned = TrailingParensRegex().Replace(cleaned, string.Empty);
        var m = TailIdentRegex().Match(cleaned);
        return m.Success ? m.Groups[1].Value : null;
    }

    // Index of the delimiter matching the one at `open`, skipping string/template
    // literals so a `)` or `}` inside a string doesn't throw off the balance.
    private static int MatchDelim(string s, int open, char oc, char cc)
    {
        var depth = 0;
        for (var i = open; i < s.Length; i++)
        {
            var ch = s[i];
            if (ch == '"' || ch == '\'' || ch == '`')
            {
                var q = ch;
                i++;
                while (i < s.Length && s[i] != q)
                {
                    if (s[i] == '\\')
                    {
                        i++;
                    }

                    i++;
                }

                continue;
            }

            if (ch == oc)
            {
                depth++;
            }
            else if (ch == cc)
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

    private static string DetectLanguage(string filePath) =>
        filePath.EndsWith(".ts", StringComparison.Ordinal) || filePath.EndsWith(".tsx", StringComparison.Ordinal)
            ? CodeGraphLanguage.TypeScript
            : CodeGraphLanguage.JavaScript;

    // ------------------------------------------------------------------
    // Shared helpers
    // ------------------------------------------------------------------
    private static List<CodeGraphNode>? FilterByDirs(IReadOnlyList<CodeGraphNode> nodes, string[] dirs)
    {
        List<CodeGraphNode>? preferred = null;
        foreach (var n in nodes)
        {
            foreach (var d in dirs)
            {
                if (n.FilePath.Contains(d, StringComparison.Ordinal))
                {
                    (preferred ??= new List<CodeGraphNode>()).Add(n);
                    break;
                }
            }
        }

        return preferred;
    }

    private static bool PackageJsonHasDependency(string packageJson, Func<string, bool> keyMatches)
    {
        try
        {
            using var doc = JsonDocument.Parse(packageJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return false;
            }

            foreach (var section in DependencySections)
            {
                if (root.TryGetProperty(section, out var deps) && deps.ValueKind == JsonValueKind.Object)
                {
                    foreach (var prop in deps.EnumerateObject())
                    {
                        if (keyMatches(prop.Name))
                        {
                            return true;
                        }
                    }
                }
            }
        }
        catch (JsonException)
        {
            // Invalid JSON — no dependency signal.
        }

        return false;
    }

    private static readonly string[] DependencySections = { "dependencies", "devDependencies" };

    private static int LineAt(string s, int index)
    {
        var line = 1;
        var limit = Math.Min(index, s.Length);
        for (var i = 0; i < limit; i++)
        {
            if (s[i] == '\n')
            {
                line++;
            }
        }

        return line;
    }

    private static CodeGraphNode RouteNode(
        string id, string name, string qualifiedName, string filePath, int line, int endColumn, string language, long now) =>
        new(
            Id: id,
            Kind: CodeGraphNodeKind.Route,
            Name: name,
            QualifiedName: qualifiedName,
            FilePath: filePath,
            Language: language,
            StartLine: line,
            EndLine: line,
            StartColumn: 0,
            EndColumn: endColumn,
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

    private static CodeGraphUnresolvedReference RouteRef(
        string fromNodeId, string referenceName, string referenceKind, int line, string filePath, string language) =>
        new(
            FromNodeId: fromNodeId,
            ReferenceName: referenceName,
            ReferenceKind: referenceKind,
            Line: line,
            Column: 0,
            FilePath: filePath,
            Language: language,
            Candidates: null,
            RowId: null);

    // ------------------------------------------------------------------
    // Fixed patterns ([GeneratedRegex]) — verbatim from express.ts
    // ------------------------------------------------------------------
    [GeneratedRegex(@"\b(app|router)\.(get|post|put|patch|delete|all|use)\s*\(\s*[""']([^""']+)[""']\s*,")]
    private static partial Regex HeadRegex();

    [GeneratedRegex(@"\b([A-Za-z_$][\w$]*)\s*\(")]
    private static partial Regex CallRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();

    [GeneratedRegex(@"\(\)$")]
    private static partial Regex TrailingParensRegex();

    [GeneratedRegex(@"(?:\.|^)([A-Za-z_][A-Za-z0-9_]*)$")]
    private static partial Regex TailIdentRegex();

    [GeneratedRegex(@"^(?:auth|authenticate|authorization|cors|helmet|logger|errorHandler|notFound)$|^(?:validate|sanitize|rateLimit)|Middleware$", RegexOptions.IgnoreCase)]
    private static partial Regex MiddlewareNameRegex();

    [GeneratedRegex(@"Middleware$", RegexOptions.IgnoreCase)]
    private static partial Regex MiddlewareSuffixRegex();

    [GeneratedRegex(@"^(\w+)Controller\.(\w+)$")]
    private static partial Regex ControllerMethodRegex();

    [GeneratedRegex(@"^(\w+)(Service|Helper|Utils?)\.(\w+)$")]
    private static partial Regex ServiceMethodRegex();

    [GeneratedRegex(@"(Service|Helper|Utils?)$", RegexOptions.IgnoreCase)]
    private static partial Regex ServiceSuffixRegex();

    [GeneratedRegex(@"\.(m?js|tsx?|cjs)$")]
    private static partial Regex ExtGuardRegex();
}

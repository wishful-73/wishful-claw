using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphAspNetResolver — ASP.NET Core / MVC framework resolver (≙ frameworks/
// csharp.ts `aspnetResolver`). Two jobs:
//   * route -> action edges: attribute routes (`[Route("api/[controller]")]` class
//     prefix + `[HttpGet("path")]`/bare method attributes) AND minimal APIs
//     (`app.MapGet("/path", handler)`) become `route` nodes that `references` the
//     action method (attribute) or handler identifier (minimal API).
//   * convention lookups: Controller, Service (incl. `I…` interfaces), Repository,
//     Model/Entity, ViewModel/Dto refs resolved by conventional directory.
//
// Global namespace, internal, reflection-free, [GeneratedRegex] fixed patterns.
// =============================================================================
internal sealed partial class CodeGraphAspNetResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] CSharpLanguages = { CodeGraphLanguage.CSharp };

    // Framework-conventional directory hints (csharp.ts:242-246).
    private static readonly string[] ControllerDirs = { "/Controllers/" };
    private static readonly string[] ServiceDirs = { "/Services/", "/Service/", "/Application/" };
    private static readonly string[] RepoDirs = { "/Repositories/", "/Repository/", "/Data/", "/Infrastructure/" };
    private static readonly string[] ModelDirs = { "/Models/", "/Model/", "/Entities/", "/Entity/", "/Domain/" };
    private static readonly string[] ViewModelDirs = { "/ViewModels/", "/ViewModel/", "/DTOs/", "/Dto/" };

    private static readonly string[] ClassKinds = { CodeGraphNodeKind.Class };
    private static readonly string[] ServiceKinds = { CodeGraphNodeKind.Class, CodeGraphNodeKind.Interface };

    private static readonly CodeGraphFrameworkExtraction EmptyExtraction =
        new(Array.Empty<CodeGraphNode>(), Array.Empty<CodeGraphUnresolvedReference>());

    public string Name => "aspnet";

    public IReadOnlyList<string>? Languages => CSharpLanguages;

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        var allFiles = ctx.GetAllFiles();

        // .csproj files with ASP.NET references.
        foreach (var file in allFiles)
        {
            if (!file.EndsWith(".csproj", StringComparison.Ordinal))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            if (content is not null && (
                content.Contains("Microsoft.AspNetCore") ||
                content.Contains("Microsoft.NET.Sdk.Web") ||
                content.Contains("System.Web.Mvc")))
            {
                return true;
            }
        }

        // Program.cs with WebApplication / host builder.
        var programCs = ctx.ReadFile("Program.cs");
        if (programCs is not null && (
            programCs.Contains("WebApplication") ||
            programCs.Contains("CreateHostBuilder") ||
            programCs.Contains("UseStartup")))
        {
            return true;
        }

        // Startup.cs (ASP.NET Core signature).
        if (ctx.FileExists("Startup.cs"))
        {
            return true;
        }

        // ASP.NET signatures in controller/entrypoint SOURCE — covers feature-folder apps
        // with no /Controllers/ dir and a subdir Program.cs the root-only checks miss;
        // .csproj often isn't in the indexed source set, so source-scan is the reliable signal.
        foreach (var file in allFiles)
        {
            if (!DetectFileRegex().IsMatch(file))
            {
                continue;
            }

            var c = ctx.ReadFile(file);
            if (c is not null && (
                DetectAttrRegex().IsMatch(c) ||
                c.Contains("ControllerBase") || c.Contains(": Controller") ||
                c.Contains("MapControllers") || c.Contains("WebApplication") ||
                c.Contains("Microsoft.AspNetCore")))
            {
                return true;
            }
        }

        return false;
    }

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var name = r.ReferenceName;

        // Pattern 1: Controller references.
        if (name.EndsWith("Controller", StringComparison.Ordinal))
        {
            var id = ResolveByNameAndKind(name, ClassKinds, ControllerDirs, ctx);
            if (id is not null)
            {
                return new CodeGraphResolvedRef(id, 0.85, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 2: Service references (DI) — `…Service` or an `I…` interface.
        if (name.EndsWith("Service", StringComparison.Ordinal) || (name.StartsWith('I') && name.Length > 1))
        {
            var id = ResolveByNameAndKind(name, ServiceKinds, ServiceDirs, ctx);
            if (id is not null)
            {
                return new CodeGraphResolvedRef(id, 0.85, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 3: Repository references.
        if (name.EndsWith("Repository", StringComparison.Ordinal))
        {
            var id = ResolveByNameAndKind(name, ServiceKinds, RepoDirs, ctx);
            if (id is not null)
            {
                return new CodeGraphResolvedRef(id, 0.85, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 4: Model/Entity references (PascalCase bare name).
        if (PascalNameRegex().IsMatch(name))
        {
            var id = ResolveByNameAndKind(name, ClassKinds, ModelDirs, ctx);
            if (id is not null)
            {
                return new CodeGraphResolvedRef(id, 0.7, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 5: ViewModel / Dto references.
        if (name.EndsWith("ViewModel", StringComparison.Ordinal) || name.EndsWith("Dto", StringComparison.Ordinal))
        {
            var id = ResolveByNameAndKind(name, ClassKinds, ViewModelDirs, ctx);
            if (id is not null)
            {
                return new CodeGraphResolvedRef(id, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        return null;
    }

    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        if (!filePath.EndsWith(".cs", StringComparison.Ordinal))
        {
            return EmptyExtraction;
        }

        var nodes = new List<CodeGraphNode>();
        var references = new List<CodeGraphUnresolvedReference>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.CSharp);

        // Class-level [Route("api/[controller]")] prefix — joined onto each action.
        var classPrefix = string.Empty;
        var cls = ClassRouteRegex().Match(safe);
        if (cls.Success)
        {
            classPrefix = cls.Groups[1].Value;
        }

        // [HttpGet], [HttpGet("path")], [HttpPost("path", Name="x")] — BARE or with a path.
        foreach (Match match in HttpAttrRegex().Matches(safe))
        {
            var verb = match.Groups[1].Value;
            var method = verb.Substring("Http".Length).ToUpperInvariant();
            var routePath = JoinCsPath(classPrefix, match.Groups[2].Success ? match.Groups[2].Value : string.Empty);
            var line = LineAt(safe, match.Index);
            var routeNode = RouteNode($"route:{filePath}:{line}:{method}:{routePath}", $"{method} {routePath}",
                $"{filePath}::route:{routePath}", filePath, line, match.Length, now);
            nodes.Add(routeNode);

            // Next method declaration (skip stacked attributes; the return type precedes the name).
            var tail = Slice(safe, match.Index + match.Length, match.Index + match.Length + 600);
            var methodMatch = MethodDeclRegex().Match(tail);
            if (methodMatch.Success)
            {
                references.Add(RouteRef(routeNode.Id, methodMatch.Groups[1].Value, line, filePath));
            }
        }

        // Minimal APIs: app.MapGet("/path", handler).
        foreach (Match match in MinimalApiRegex().Matches(safe))
        {
            var method = match.Groups[1].Value.ToUpperInvariant();
            var routePath = match.Groups[2].Value;
            var handlerExpr = match.Groups[3].Value;
            var line = LineAt(safe, match.Index);
            var routeNode = RouteNode($"route:{filePath}:{line}:{method}:{routePath}", $"{method} {routePath}",
                $"{filePath}::route:{routePath}", filePath, line, match.Length, now);
            nodes.Add(routeNode);

            var handlerName = ExtractCSharpTailIdent(handlerExpr);
            if (handlerName is not null)
            {
                references.Add(RouteRef(routeNode.Id, handlerName, line, filePath));
            }
        }

        return new CodeGraphFrameworkExtraction(nodes, references);
    }

    // Join a class-level [Route] prefix and an action's path into one normalized `/path`.
    private static string JoinCsPath(string prefix, string sub)
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

    // Extract the last identifier from an expression like `MyService.Handler` or `Handler`.
    private static string? ExtractCSharpTailIdent(string expr)
    {
        var cleaned = WhitespaceRegex().Replace(expr.Trim(), string.Empty);
        var m = TailIdentRegex().Match(cleaned);
        return m.Success ? m.Groups[1].Value : null;
    }

    // Resolve a symbol by name via the indexed name query, preferring conventional dirs.
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

    private static CodeGraphNode RouteNode(string id, string name, string qualifiedName, string filePath, int line, int endColumn, long now) =>
        new(id, CodeGraphNodeKind.Route, name, qualifiedName, filePath, CodeGraphLanguage.CSharp, line, line, 0, endColumn,
            null, null, null, false, false, false, false, null, null, null, now);

    private static CodeGraphUnresolvedReference RouteRef(string fromNodeId, string referenceName, int line, string filePath) =>
        new(fromNodeId, referenceName, CodeGraphEdgeKind.References, line, 0, filePath, CodeGraphLanguage.CSharp, null, null);

    // ── Fixed patterns ([GeneratedRegex]) ─────────────────────────────────────

    [GeneratedRegex(@"^[A-Z][a-zA-Z]+$")]
    private static partial Regex PascalNameRegex();

    [GeneratedRegex(@"(?:Controller|Program|Startup)\.cs$")]
    private static partial Regex DetectFileRegex();

    [GeneratedRegex(@"\[(?:ApiController|Route|Http(?:Get|Post|Put|Patch|Delete))\b")]
    private static partial Regex DetectAttrRegex();

    [GeneratedRegex(@"\[Route\s*\(\s*""([^""]+)""[^)]*\)\]\s*(?:\[[^\]]*\]\s*)*(?:public\s+|sealed\s+|abstract\s+|partial\s+)*class\b")]
    private static partial Regex ClassRouteRegex();

    [GeneratedRegex(@"\[(HttpGet|HttpPost|HttpPut|HttpPatch|HttpDelete)(?:\s*\(\s*""([^""]+)""[^)]*\))?\s*\]")]
    private static partial Regex HttpAttrRegex();

    [GeneratedRegex(@"(?:public|private|protected|internal)\s+[\w<>,\s\[\]?.]+?\s+(\w+)\s*\(")]
    private static partial Regex MethodDeclRegex();

    [GeneratedRegex(@"\.Map(Get|Post|Put|Patch|Delete)\s*\(\s*""([^""]+)""\s*,\s*([^,)]+)")]
    private static partial Regex MinimalApiRegex();

    [GeneratedRegex(@"(?:\.|^)([A-Za-z_][A-Za-z0-9_]*)$")]
    private static partial Regex TailIdentRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();
}

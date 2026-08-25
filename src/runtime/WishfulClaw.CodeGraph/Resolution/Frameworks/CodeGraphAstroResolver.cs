using System.Text.Json;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphAstroResolver — Astro framework resolver (port of
// resolution/frameworks/astro.ts). Contributes:
//   * resolve(): the `Astro` global (Astro.props, Astro.url, …), astro:* virtual
//     module imports (astro:content, astro:assets, …), and PascalCase component
//     `references`/`calls` -> component nodes.
//   * extract(): Astro file-based routing under src/pages/ — .astro pages and
//     .ts/.js API endpoints -> route nodes (underscore-prefixed segments excluded).
//
// GLOBAL namespace, all-internal, reflection-free/AOT. Fixed patterns via
// [GeneratedRegex]; package.json parsed with JsonDocument (never Deserialize<T>).
// =============================================================================
internal sealed partial class CodeGraphAstroResolver : ICodeGraphFrameworkResolver
{
    public string Name => "astro";

    public IReadOnlyList<string>? Languages => null;

    // Astro virtual module prefixes — framework-provided, not user code.
    private static readonly string[] AstroVirtualModules =
    {
        "astro:content", "astro:assets", "astro:actions", "astro:env", "astro:i18n",
        "astro:middleware", "astro:transitions", "astro:components", "astro:schema"
    };

    private static readonly char[] SlashChars = { '/', '\\' };
    private static readonly string[] DependencySections = { "dependencies", "devDependencies" };

    // ------------------------------------------------------------------
    // detect
    // ------------------------------------------------------------------
    public bool Detect(CodeGraphResolutionContext ctx)
    {
        var packageJson = ctx.ReadFile("package.json");
        if (packageJson is not null &&
            PackageJsonHasDependency(packageJson, static k => k == "astro"))
        {
            return true;
        }

        foreach (var f in ctx.GetAllFiles())
        {
            if (f.EndsWith(".astro", StringComparison.Ordinal))
            {
                return true;
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

        // Pattern 1: the `Astro` global (Astro.props, Astro.url, Astro.params, …).
        if (name == "Astro" || name.StartsWith("Astro.", StringComparison.Ordinal))
        {
            return new CodeGraphResolvedRef(r.FromNodeId, 1.0, CodeGraphResolvedBy.Framework);
        }

        // Pattern 2: astro:* virtual module imports.
        if (r.ReferenceKind == CodeGraphEdgeKind.Imports && name.StartsWith("astro:", StringComparison.Ordinal) &&
            StartsWithAny(name, AstroVirtualModules))
        {
            return new CodeGraphResolvedRef(r.FromNodeId, 1.0, CodeGraphResolvedBy.Framework);
        }

        // Pattern 3: Component references (PascalCase). Template tags arrive as
        // `references`, frontmatter expression usages as `calls`.
        if (PascalCaseRegex().IsMatch(name) &&
            (r.ReferenceKind == CodeGraphEdgeKind.References || r.ReferenceKind == CodeGraphEdgeKind.Calls))
        {
            var target = ResolveComponent(name, r.FilePath ?? string.Empty, ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        return null;
    }

    private static string? ResolveComponent(string name, string fromFile, CodeGraphResolutionContext ctx)
    {
        List<CodeGraphNode>? components = null;
        foreach (var n in ctx.GetNodesByName(name))
        {
            if (n.Kind == CodeGraphNodeKind.Component)
            {
                (components ??= new List<CodeGraphNode>()).Add(n);
            }
        }

        if (components is null)
        {
            return null;
        }

        var lastSlash = fromFile.LastIndexOf('/');
        var fromDir = lastSlash >= 0 ? fromFile[..lastSlash] : string.Empty;
        foreach (var n in components)
        {
            if (n.FilePath.StartsWith(fromDir, StringComparison.Ordinal))
            {
                return n.Id;
            }
        }

        return components.Count == 1 ? components[0].Id : null;
    }

    // ------------------------------------------------------------------
    // extract — Astro src/pages/ file-based routing
    // ------------------------------------------------------------------
    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        var nodes = new List<CodeGraphNode>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var normalized = filePath.Replace('\\', '/');

        Match pagesMatch = PagesSegmentRegex().Match(normalized);
        if (pagesMatch.Success && PageExtRegex().IsMatch(normalized))
        {
            var afterPages = normalized[(pagesMatch.Index + pagesMatch.Length)..];
            var segments = afterPages.Split('/');
            var baseName = segments.Length > 0 ? segments[^1] : string.Empty;

            // Underscore-prefixed segments are excluded from routing; a stray
            // `*.config.*` in a pages dir is never a route.
            if (!HasUnderscoreSegment(segments) && !ConfigFileRegex().IsMatch(baseName))
            {
                var routePath = FilePathToAstroRoute(afterPages);
                nodes.Add(RouteNode(
                    $"route:{filePath}:{routePath}:1", routePath, $"{filePath}::route:{routePath}",
                    filePath,
                    normalized.EndsWith(".astro", StringComparison.Ordinal) ? CodeGraphLanguage.Astro : CodeGraphLanguage.TypeScript,
                    now));
            }
        }

        return new CodeGraphFrameworkExtraction(nodes, Array.Empty<CodeGraphUnresolvedReference>());
    }

    // blog/[slug].astro -> /blog/:slug, blog/[...path].astro -> /blog/*path,
    // api/posts.ts -> /api/posts, index.astro -> /.
    private static string FilePathToAstroRoute(string afterPages)
    {
        var withoutExt = PageExtRegex().Replace(afterPages, string.Empty);
        var withoutIndex = TrailingSlashRegex().Replace(IndexSegmentRegex().Replace(withoutExt, "$1"), string.Empty);

        var route = "/" + ParamRegex().Replace(CatchAllParamRegex().Replace(withoutIndex, "*$1"), ":$1");
        if (route == "/")
        {
            return "/";
        }

        return TrailingSlashRegex().Replace(route, string.Empty);
    }

    private static bool HasUnderscoreSegment(string[] segments)
    {
        foreach (var segment in segments)
        {
            if (segment.StartsWith('_'))
            {
                return true;
            }
        }

        return false;
    }

    // ------------------------------------------------------------------
    // Shared helpers
    // ------------------------------------------------------------------
    private static bool StartsWithAny(string s, string[] prefixes)
    {
        foreach (var p in prefixes)
        {
            if (s.StartsWith(p, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
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

    private static CodeGraphNode RouteNode(
        string id, string name, string qualifiedName, string filePath, string language, long now) =>
        new(
            Id: id,
            Kind: CodeGraphNodeKind.Route,
            Name: name,
            QualifiedName: qualifiedName,
            FilePath: filePath,
            Language: language,
            StartLine: 1,
            EndLine: 1,
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

    // ------------------------------------------------------------------
    // Fixed patterns ([GeneratedRegex]) — verbatim from astro.ts
    // ------------------------------------------------------------------
    [GeneratedRegex(@"^[A-Z][a-zA-Z0-9]*$")]
    private static partial Regex PascalCaseRegex();

    [GeneratedRegex(@"(?:^|/)src/pages/")]
    private static partial Regex PagesSegmentRegex();

    [GeneratedRegex(@"\.(astro|ts|js|mjs)$")]
    private static partial Regex PageExtRegex();

    [GeneratedRegex(@"\.config\.[a-z]+$")]
    private static partial Regex ConfigFileRegex();

    [GeneratedRegex(@"(^|/)index$")]
    private static partial Regex IndexSegmentRegex();

    [GeneratedRegex(@"/$")]
    private static partial Regex TrailingSlashRegex();

    [GeneratedRegex(@"\[\.\.\.([^\]]+)\]")]
    private static partial Regex CatchAllParamRegex();

    [GeneratedRegex(@"\[([^\]]+)\]")]
    private static partial Regex ParamRegex();
}

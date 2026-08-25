using System.Text.Json;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphSvelteResolver — Svelte / SvelteKit framework resolver (port of
// resolution/frameworks/svelte.ts). Contributes:
//   * resolve(): Svelte 5 runes ($state, $derived, …), store auto-subscriptions
//     ($storeName), SvelteKit framework module imports ($app/*, $env/*, $lib/*), and
//     PascalCase component `calls` -> .svelte component nodes.
//   * extract(): SvelteKit route files (+page.svelte, +server.ts, …) -> route nodes,
//     with the route path derived from the src/routes/ directory structure.
//
// GLOBAL namespace, all-internal, reflection-free/AOT. Fixed patterns via
// [GeneratedRegex]; package.json parsed with JsonDocument (never Deserialize<T>).
// =============================================================================
internal sealed partial class CodeGraphSvelteResolver : ICodeGraphFrameworkResolver
{
    public string Name => "svelte";

    public IReadOnlyList<string>? Languages { get; } = new[] { CodeGraphLanguage.Svelte };

    // Svelte 5 runes — compiler-provided, not user code.
    private static readonly HashSet<string> SvelteRunes = new(StringComparer.Ordinal)
    {
        "$state", "$state.raw", "$state.snapshot", "$derived", "$derived.by",
        "$effect", "$effect.pre", "$effect.root", "$effect.tracking",
        "$props", "$bindable", "$inspect", "$host"
    };

    // SvelteKit framework-provided module prefixes.
    private static readonly string[] SvelteKitModulePrefixes =
    {
        "$app/navigation", "$app/stores", "$app/environment", "$app/forms", "$app/paths",
        "$env/static/private", "$env/static/public", "$env/dynamic/private", "$env/dynamic/public"
    };

    // Extensions tried when resolving a $lib/* import to a file.
    private static readonly string[] LibExtensions =
    {
        string.Empty, ".ts", ".js", ".svelte", "/index.ts", "/index.js"
    };

    // SvelteKit route filenames (values in the TS map are labels; only membership matters here).
    private static readonly HashSet<string> SvelteKitRouteFiles = new(StringComparer.Ordinal)
    {
        "+page.svelte", "+page.ts", "+page.js", "+page.server.ts", "+page.server.js",
        "+layout.svelte", "+layout.ts", "+layout.js", "+layout.server.ts", "+layout.server.js",
        "+server.ts", "+server.js", "+error.svelte"
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
            PackageJsonHasDependency(packageJson, static k => k == "svelte" || k == "@sveltejs/kit"))
        {
            return true;
        }

        foreach (var f in ctx.GetAllFiles())
        {
            if (f.EndsWith(".svelte", StringComparison.Ordinal))
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

        // Pattern 1: Svelte runes ($state, $derived, $effect, …) — compiler-provided.
        if (IsRuneReference(name))
        {
            return new CodeGraphResolvedRef(r.FromNodeId, 1.0, CodeGraphResolvedBy.Framework);
        }

        // Pattern 2: store auto-subscriptions ($storeName).
        if (name.StartsWith('$') && !name.StartsWith("$$", StringComparison.Ordinal))
        {
            var storeName = name[1..];
            foreach (var n in ctx.GetNodesByName(storeName))
            {
                if (n.Kind == CodeGraphNodeKind.Variable || n.Kind == CodeGraphNodeKind.Constant)
                {
                    return new CodeGraphResolvedRef(n.Id, 0.85, CodeGraphResolvedBy.Framework);
                }
            }
        }

        // Pattern 3: SvelteKit module imports ($app/*, $env/*, $lib/*).
        if (r.ReferenceKind == CodeGraphEdgeKind.Imports && name.StartsWith('$'))
        {
            // $lib/* resolves to src/lib/* — try to find the target file.
            if (name.StartsWith("$lib/", StringComparison.Ordinal))
            {
                var libPath = "src/lib/" + name["$lib/".Length..];
                foreach (var ext in LibExtensions)
                {
                    var fullPath = libPath + ext;
                    if (ctx.FileExists(fullPath))
                    {
                        var fileNodes = ctx.GetNodesInFile(fullPath);
                        if (fileNodes.Count > 0)
                        {
                            return new CodeGraphResolvedRef(fileNodes[0].Id, 0.9, CodeGraphResolvedBy.Framework);
                        }
                    }
                }
            }

            // $app/* and $env/* are framework-provided.
            if (StartsWithAny(name, SvelteKitModulePrefixes))
            {
                return new CodeGraphResolvedRef(r.FromNodeId, 1.0, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 4: Component references (PascalCase) -> .svelte files.
        if (PascalCaseRegex().IsMatch(name) && r.ReferenceKind == CodeGraphEdgeKind.Calls)
        {
            var target = ResolveComponent(name, r.FilePath ?? string.Empty, ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        return null;
    }

    // Direct rune match, or a base rune that has sub-methods ($state.raw arrives as $state).
    private static bool IsRuneReference(string name) =>
        SvelteRunes.Contains(name) || name is "$state" or "$derived" or "$effect";

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
    // extract — SvelteKit route files
    // ------------------------------------------------------------------
    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        var nodes = new List<CodeGraphNode>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var fileName = BaseName(filePath);
        if (SvelteKitRouteFiles.Contains(fileName))
        {
            var routePath = FilePathToSvelteKitRoute(filePath);
            if (routePath is not null)
            {
                nodes.Add(RouteNode(
                    $"route:{filePath}:{routePath}:1", routePath, $"{filePath}::route:{routePath}",
                    filePath,
                    filePath.EndsWith(".svelte", StringComparison.Ordinal) ? CodeGraphLanguage.Svelte : CodeGraphLanguage.TypeScript,
                    now));
            }
        }

        return new CodeGraphFrameworkExtraction(nodes, Array.Empty<CodeGraphUnresolvedReference>());
    }

    // Convert a file path to a SvelteKit route path (from the src/routes/ structure).
    private static string? FilePathToSvelteKitRoute(string filePath)
    {
        var normalized = filePath.Replace('\\', '/');
        var routesIndex = normalized.IndexOf("/routes/", StringComparison.Ordinal);
        if (routesIndex == -1)
        {
            return null;
        }

        var afterRoutes = normalized[(routesIndex + "/routes/".Length)..];
        var lastSlash = afterRoutes.LastIndexOf('/');
        var dirPath = lastSlash == -1 ? string.Empty : afterRoutes[..lastSlash];

        var route = "/" + ParamSyntax(dirPath);
        if (route == "/")
        {
            return "/";
        }

        return TrailingSlashRegex().Replace(route, string.Empty);
    }

    // [...rest] -> *rest, [[optional]] -> :optional?, [param] -> :param.
    private static string ParamSyntax(string segment)
    {
        segment = CatchAllParamRegex().Replace(segment, "*$1");
        segment = OptionalParamRegex().Replace(segment, ":$1?");
        segment = ParamRegex().Replace(segment, ":$1");
        return segment;
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

    private static string BaseName(string path)
    {
        var slash = path.LastIndexOfAny(SlashChars);
        return slash >= 0 && slash + 1 <= path.Length ? path[(slash + 1)..] : path;
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
    // Fixed patterns ([GeneratedRegex]) — verbatim from svelte.ts
    // ------------------------------------------------------------------
    [GeneratedRegex(@"^[A-Z][a-zA-Z0-9]*$")]
    private static partial Regex PascalCaseRegex();

    [GeneratedRegex(@"/$")]
    private static partial Regex TrailingSlashRegex();

    [GeneratedRegex(@"\[\.\.\.([^\]]+)\]")]
    private static partial Regex CatchAllParamRegex();

    [GeneratedRegex(@"\[\[([^\]]+)\]\]")]
    private static partial Regex OptionalParamRegex();

    [GeneratedRegex(@"\[([^\]]+)\]")]
    private static partial Regex ParamRegex();
}

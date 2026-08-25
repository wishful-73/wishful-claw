using System.Text.Json;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphVueResolver — Vue / Nuxt framework resolver (port of
// resolution/frameworks/vue.ts). Contributes:
//   * resolve(): Vue 3 compiler macros (defineProps, …), Nuxt auto-imported
//     composables (useFetch, …), Nuxt virtual-module imports (#imports, …), `@/` and
//     `~/` alias imports, and PascalCase component `calls` -> .vue component nodes.
//   * extract(): Nuxt file-based routing — pages/*.vue routes, server/api/* endpoints,
//     and middleware/* functions.
//
// GLOBAL namespace, all-internal, reflection-free/AOT. Fixed patterns via
// [GeneratedRegex]; package.json parsed with JsonDocument (never Deserialize<T>).
// =============================================================================
internal sealed partial class CodeGraphVueResolver : ICodeGraphFrameworkResolver
{
    public string Name => "vue";

    // vueResolver declares no `languages` — it applies to all (Nuxt routes live in
    // .ts/.js too; components in .vue).
    public IReadOnlyList<string>? Languages => null;

    // Vue 3 compiler macros — compiler-provided, not user code.
    private static readonly HashSet<string> VueCompilerMacros = new(StringComparer.Ordinal)
    {
        "defineProps", "defineEmits", "defineExpose", "defineOptions", "defineSlots", "defineModel", "withDefaults"
    };

    // Nuxt auto-imported composables and utilities.
    private static readonly HashSet<string> NuxtAutoImports = new(StringComparer.Ordinal)
    {
        "useRoute", "useRouter", "navigateTo", "abortNavigation",
        "useFetch", "useAsyncData", "useLazyFetch", "useLazyAsyncData", "refreshNuxtData",
        "useState", "clearNuxtState",
        "useHead", "useSeoMeta", "useServerSeoMeta",
        "useRuntimeConfig", "useAppConfig", "useNuxtApp",
        "useCookie",
        "useError", "createError", "showError", "clearError",
        "definePageMeta", "defineNuxtConfig", "defineNuxtPlugin", "defineNuxtRouteMiddleware",
        "useRequestHeaders", "useRequestEvent", "useRequestFetch", "useRequestURL"
    };

    // Nuxt virtual module prefixes (auto-import namespaces).
    private static readonly string[] NuxtVirtualModules = { "#imports", "#components", "#app", "#build", "#head" };

    // Extensions tried when resolving an @/ or ~/ alias import to a file.
    private static readonly string[] AliasExtensions =
    {
        string.Empty, ".ts", ".js", ".vue", "/index.ts", "/index.js", "/index.vue"
    };

    private static readonly string[] DependencySections = { "dependencies", "devDependencies" };

    // ------------------------------------------------------------------
    // detect
    // ------------------------------------------------------------------
    public bool Detect(CodeGraphResolutionContext ctx)
    {
        var packageJson = ctx.ReadFile("package.json");
        if (packageJson is not null &&
            PackageJsonHasDependency(packageJson, static k => k == "vue" || k == "nuxt" || k == "@nuxt/kit"))
        {
            return true;
        }

        foreach (var f in ctx.GetAllFiles())
        {
            if (f.EndsWith(".vue", StringComparison.Ordinal))
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

        // Pattern 1: Vue compiler macros (defineProps, defineEmits, …).
        if (VueCompilerMacros.Contains(name))
        {
            return new CodeGraphResolvedRef(r.FromNodeId, 1.0, CodeGraphResolvedBy.Framework);
        }

        // Pattern 2: Nuxt auto-imported composables.
        if (NuxtAutoImports.Contains(name))
        {
            return new CodeGraphResolvedRef(r.FromNodeId, 1.0, CodeGraphResolvedBy.Framework);
        }

        // Pattern 3: Nuxt virtual module imports (#imports, #components, …).
        if (r.ReferenceKind == CodeGraphEdgeKind.Imports && name.StartsWith('#') && StartsWithAny(name, NuxtVirtualModules))
        {
            return new CodeGraphResolvedRef(r.FromNodeId, 1.0, CodeGraphResolvedBy.Framework);
        }

        // Pattern 4: @ alias imports (@/components/Foo -> src/components/Foo).
        if (r.ReferenceKind == CodeGraphEdgeKind.Imports && name.StartsWith("@/", StringComparison.Ordinal))
        {
            var target = ResolveAliasImport(name["@/".Length..], ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.9, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 5: ~ alias imports (~/components/Foo -> src/components/Foo, Nuxt).
        if (r.ReferenceKind == CodeGraphEdgeKind.Imports && name.StartsWith("~/", StringComparison.Ordinal))
        {
            var target = ResolveAliasImport(name["~/".Length..], ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.9, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 6: Component references (PascalCase) -> .vue files.
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

    private static string? ResolveAliasImport(string afterPrefix, CodeGraphResolutionContext ctx)
    {
        var aliasPath = "src/" + afterPrefix;
        foreach (var ext in AliasExtensions)
        {
            var fullPath = aliasPath + ext;
            if (ctx.FileExists(fullPath))
            {
                var fileNodes = ctx.GetNodesInFile(fullPath);
                if (fileNodes.Count > 0)
                {
                    return fileNodes[0].Id;
                }
            }
        }

        return null;
    }

    // Collect ALL .vue basename matches, then prefer same-directory; only an
    // UNAMBIGUOUS basename may resolve with no positional signal (#764).
    private static string? ResolveComponent(string name, string fromFile, CodeGraphResolutionContext ctx)
    {
        var matches = new List<string>();
        foreach (var file in ctx.GetAllFiles())
        {
            if (!file.EndsWith(".vue", StringComparison.Ordinal))
            {
                continue;
            }

            var fileName = BaseName(file);
            if (fileName[..^".vue".Length] == name)
            {
                matches.Add(file);
            }
        }

        if (matches.Count == 0)
        {
            return null;
        }

        var lastSlash = fromFile.LastIndexOf('/');
        var fromDir = lastSlash >= 0 ? fromFile[..lastSlash] : string.Empty;
        foreach (var f in matches)
        {
            if (f.StartsWith(fromDir, StringComparison.Ordinal))
            {
                return ComponentIn(f, name, ctx);
            }
        }

        return matches.Count == 1 ? ComponentIn(matches[0], name, ctx) : null;
    }

    private static string? ComponentIn(string file, string name, CodeGraphResolutionContext ctx)
    {
        foreach (var n in ctx.GetNodesInFile(file))
        {
            if (n.Kind == CodeGraphNodeKind.Component && n.Name == name)
            {
                return n.Id;
            }
        }

        return null;
    }

    // ------------------------------------------------------------------
    // extract — Nuxt file-based routing
    // ------------------------------------------------------------------
    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        var nodes = new List<CodeGraphNode>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var normalized = filePath.Replace('\\', '/');

        // Nuxt page routes (pages/ directory).
        var pagesIndex = normalized.IndexOf("/pages/", StringComparison.Ordinal);
        if (pagesIndex != -1 && normalized.EndsWith(".vue", StringComparison.Ordinal))
        {
            var routePath = FilePathToNuxtRoute(normalized[(pagesIndex + "/pages/".Length)..]);
            if (routePath is not null)
            {
                nodes.Add(RouteNode(
                    $"route:{filePath}:{routePath}:1", routePath, $"{filePath}::route:{routePath}",
                    filePath, CodeGraphLanguage.Vue, now));
            }
        }

        // Nuxt API routes (server/api/ directory).
        var apiIndex = normalized.IndexOf("/server/api/", StringComparison.Ordinal);
        if (apiIndex != -1)
        {
            var afterApi = normalized[(apiIndex + "/server/api/".Length)..];
            var routeName = StripIndexSuffix(StripExtension(afterApi));
            var apiRoute = "/api/" + routeName;
            nodes.Add(RouteNode(
                $"route:{filePath}:{apiRoute}:1", apiRoute, $"{filePath}::route:{apiRoute}",
                filePath, normalized.EndsWith(".vue", StringComparison.Ordinal) ? CodeGraphLanguage.Vue : CodeGraphLanguage.TypeScript, now));
        }

        // Nuxt middleware (middleware/ directory).
        var middlewareIndex = normalized.IndexOf("/middleware/", StringComparison.Ordinal);
        if (middlewareIndex != -1)
        {
            var afterMiddleware = normalized[(middlewareIndex + "/middleware/".Length)..];
            var middlewareName = StripExtension(afterMiddleware);
            nodes.Add(FunctionNode(
                $"middleware:{filePath}:{middlewareName}:1", middlewareName, $"{filePath}::middleware:{middlewareName}",
                filePath, normalized.EndsWith(".vue", StringComparison.Ordinal) ? CodeGraphLanguage.Vue : CodeGraphLanguage.TypeScript, now));
        }

        return new CodeGraphFrameworkExtraction(nodes, Array.Empty<CodeGraphUnresolvedReference>());
    }

    // Convert a path under pages/ to a Nuxt route, or null when it is not a page.
    private static string? FilePathToNuxtRoute(string afterPages)
    {
        var withoutExt = VueExtRegex().Replace(afterPages, string.Empty);
        var withoutIndex = IndexSuffixRegex().Replace(withoutExt, string.Empty);

        var route = "/" + ParamSyntax(withoutIndex);
        if (route == "/")
        {
            return "/";
        }

        return TrailingSlashRegex().Replace(route, string.Empty);
    }

    // [...slug] -> *slug, [[optional]] -> :optional?, [param] -> :param.
    private static string ParamSyntax(string segment)
    {
        segment = CatchAllParamRegex().Replace(segment, "*$1");
        segment = OptionalParamRegex().Replace(segment, ":$1?");
        segment = ParamRegex().Replace(segment, ":$1");
        return segment;
    }

    private static string StripExtension(string s) => LastExtRegex().Replace(s, string.Empty);

    private static string StripIndexSuffix(string s) => IndexSuffixRegex().Replace(s, string.Empty);

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

    private static readonly char[] SlashChars = { '/', '\\' };

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
        FileScopedNode(id, CodeGraphNodeKind.Route, name, qualifiedName, filePath, language, now);

    private static CodeGraphNode FunctionNode(
        string id, string name, string qualifiedName, string filePath, string language, long now) =>
        FileScopedNode(id, CodeGraphNodeKind.Function, name, qualifiedName, filePath, language, now);

    private static CodeGraphNode FileScopedNode(
        string id, string kind, string name, string qualifiedName, string filePath, string language, long now) =>
        new(
            Id: id,
            Kind: kind,
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
    // Fixed patterns ([GeneratedRegex]) — verbatim from vue.ts
    // ------------------------------------------------------------------
    [GeneratedRegex(@"^[A-Z][a-zA-Z0-9]*$")]
    private static partial Regex PascalCaseRegex();

    [GeneratedRegex(@"\.vue$")]
    private static partial Regex VueExtRegex();

    [GeneratedRegex(@"\.[^/.]+$")]
    private static partial Regex LastExtRegex();

    [GeneratedRegex(@"/index$")]
    private static partial Regex IndexSuffixRegex();

    [GeneratedRegex(@"/$")]
    private static partial Regex TrailingSlashRegex();

    [GeneratedRegex(@"\[\.\.\.([^\]]+)\]")]
    private static partial Regex CatchAllParamRegex();

    [GeneratedRegex(@"\[\[([^\]]+)\]\]")]
    private static partial Regex OptionalParamRegex();

    [GeneratedRegex(@"\[([^\]]+)\]")]
    private static partial Regex ParamRegex();
}

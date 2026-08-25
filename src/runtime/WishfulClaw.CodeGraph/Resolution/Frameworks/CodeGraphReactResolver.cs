using System.Text.Json;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphReactResolver — React / Next.js framework resolver (port of
// resolution/frameworks/react.ts; analysis/02 §3.3 row 5). Contributes:
//   * resolve(): route/component reference resolution — PascalCase component
//     (JSX files only), `use*` hooks, `*Context`/`*Provider` bindings.
//   * extract(): route nodes tree-sitter can't emit — React Router `<Route>` (v5
//     component / v6 element), the v6.4 `createBrowserRouter([...])` data-router,
//     and the Next.js pages/app filename convention (filePathToRoute).
//
// Components + custom hooks are NOT extracted here (the tree-sitter extractor emits
// them natively); this resolver only adds route nodes + route->component refs.
//
// GLOBAL namespace, all-internal, reflection-free/AOT. Fixed patterns via
// [GeneratedRegex]; package.json parsed with JsonDocument (never Deserialize<T>).
// =============================================================================
internal sealed partial class CodeGraphReactResolver : ICodeGraphFrameworkResolver
{
    public string Name => "react";

    // Includes tsx/jsx so route extraction runs on JSX files (where `<Route>` routes
    // live). resolve() is language-agnostic; only the extract pass filters on this.
    public IReadOnlyList<string>? Languages { get; } = new[]
    {
        CodeGraphLanguage.JavaScript, CodeGraphLanguage.TypeScript,
        CodeGraphLanguage.Tsx, CodeGraphLanguage.Jsx
    };

    // Built-in / library type names that must never resolve as user components.
    private static readonly HashSet<string> BuiltInTypes = new(StringComparer.Ordinal)
    {
        "Array", "Boolean", "Date", "Error", "Function", "JSON", "Math", "Number",
        "Object", "Promise", "RegExp", "String", "Symbol", "Map", "Set", "WeakMap", "WeakSet",
        "React", "Component", "Fragment", "Suspense", "StrictMode"
    };

    // Node kinds a component reference may bind to.
    private static readonly HashSet<string> ComponentKinds = new(StringComparer.Ordinal)
    {
        CodeGraphNodeKind.Component, CodeGraphNodeKind.Function, CodeGraphNodeKind.Class
    };

    private static readonly string[] ComponentDirs =
    {
        "/components/", "/src/components/", "/app/components/", "/pages/", "/src/pages/", "/views/", "/src/views/"
    };

    private static readonly string[] HookDirs =
    {
        "/hooks/", "/src/hooks/", "/lib/hooks/", "/utils/hooks/"
    };

    private static readonly string[] ContextDirs =
    {
        "/context/", "/contexts/", "/src/context/", "/src/contexts/", "/providers/", "/src/providers/"
    };

    // ------------------------------------------------------------------
    // detect
    // ------------------------------------------------------------------
    public bool Detect(CodeGraphResolutionContext ctx)
    {
        var packageJson = ctx.ReadFile("package.json");
        if (packageJson is not null &&
            PackageJsonHasDependency(packageJson, static k => k == "react" || k == "next" || k == "react-native"))
        {
            return true;
        }

        foreach (var f in ctx.GetAllFiles())
        {
            if (f.EndsWith(".jsx", StringComparison.Ordinal) || f.EndsWith(".tsx", StringComparison.Ordinal))
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

        // Pattern 1: component references (PascalCase) — JSX-capable files only. A
        // component is USED in markup, which only parses in .tsx/.jsx.
        if ((r.Language == CodeGraphLanguage.Tsx || r.Language == CodeGraphLanguage.Jsx) &&
            PascalCaseRegex().IsMatch(name) &&
            !BuiltInTypes.Contains(name))
        {
            var target = ResolveComponent(name, r.FilePath ?? string.Empty, ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 2: hook references (use*).
        if (name.StartsWith("use", StringComparison.Ordinal) && name.Length > 3)
        {
            var target = ResolveHook(name, ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.85, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 3: context references.
        if (name.EndsWith("Context", StringComparison.Ordinal) || name.EndsWith("Provider", StringComparison.Ordinal))
        {
            var target = ResolveContext(name, ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        return null;
    }

    private static string? ResolveComponent(string name, string fromFile, CodeGraphResolutionContext ctx)
    {
        var candidates = ctx.GetNodesByName(name);
        if (candidates.Count == 0)
        {
            return null;
        }

        var components = new List<CodeGraphNode>();
        foreach (var n in candidates)
        {
            if (ComponentKinds.Contains(n.Kind))
            {
                components.Add(n);
            }
        }

        if (components.Count == 0)
        {
            return null;
        }

        // Prefer same directory. `fromFile.substring(0, lastIndexOf('/'))`: JS clamps a
        // missing slash to '' (which startsWith-matches everything, as in the source).
        var lastSlash = fromFile.LastIndexOf('/');
        var fromDir = lastSlash >= 0 ? fromFile[..lastSlash] : string.Empty;
        List<CodeGraphNode>? sameDir = null;
        foreach (var n in components)
        {
            if (n.FilePath.StartsWith(fromDir, StringComparison.Ordinal))
            {
                (sameDir ??= new List<CodeGraphNode>()).Add(n);
            }
        }

        if (sameDir is { Count: > 0 })
        {
            return sameDir[0].Id;
        }

        // Prefer component directories.
        var preferred = FilterByDirs(components, ComponentDirs);
        if (preferred is { Count: > 0 })
        {
            return preferred[0].Id;
        }

        // No positional signal: only an UNAMBIGUOUS name may resolve.
        return components.Count == 1 ? components[0].Id : null;
    }

    private static string? ResolveHook(string name, CodeGraphResolutionContext ctx)
    {
        var candidates = ctx.GetNodesByName(name);
        if (candidates.Count == 0)
        {
            return null;
        }

        var hooks = new List<CodeGraphNode>();
        foreach (var n in candidates)
        {
            if (n.Kind == CodeGraphNodeKind.Function && n.Name.StartsWith("use", StringComparison.Ordinal))
            {
                hooks.Add(n);
            }
        }

        if (hooks.Count == 0)
        {
            return null;
        }

        var preferred = FilterByDirs(hooks, HookDirs);
        if (preferred is { Count: > 0 })
        {
            return preferred[0].Id;
        }

        return hooks[0].Id;
    }

    private static string? ResolveContext(string name, CodeGraphResolutionContext ctx)
    {
        var candidates = ctx.GetNodesByName(name);
        if (candidates.Count == 0)
        {
            // Try without the Context/Provider suffix.
            var baseName = StripContextProviderSuffix(name);
            if (baseName != name)
            {
                var baseCandidates = ctx.GetNodesByName(baseName);
                if (baseCandidates.Count > 0)
                {
                    return baseCandidates[0].Id;
                }
            }

            return null;
        }

        var preferred = FilterByDirs(candidates, ContextDirs);
        if (preferred is { Count: > 0 })
        {
            return preferred[0].Id;
        }

        return candidates[0].Id;
    }

    // Mirrors `name.replace(/Context$|Provider$/, '')`: strip a single trailing
    // Context (tried first) or Provider.
    private static string StripContextProviderSuffix(string name)
    {
        if (name.EndsWith("Context", StringComparison.Ordinal))
        {
            return name[..^"Context".Length];
        }

        if (name.EndsWith("Provider", StringComparison.Ordinal))
        {
            return name[..^"Provider".Length];
        }

        return name;
    }

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

    // ------------------------------------------------------------------
    // extract
    // ------------------------------------------------------------------
    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        var nodes = new List<CodeGraphNode>();
        var references = new List<CodeGraphUnresolvedReference>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var jsxLang = filePath.EndsWith(".tsx", StringComparison.Ordinal) ? CodeGraphLanguage.Tsx : CodeGraphLanguage.Jsx;

        // React Router: <Route path="/x" component={Comp}/> (v5) or element={<Comp/>} (v6).
        // Attributes appear in any order and element={...} nests a `>`, so scan a window
        // after each <Route rather than matching the whole (possibly multi-line) tag.
        foreach (Match routeMatch in RouteTagRegex().Matches(content))
        {
            var window = Slice(content, routeMatch.Index, routeMatch.Index + 400);
            var pathMatch = RoutePathAttrRegex().Match(window);
            if (!pathMatch.Success)
            {
                continue; // index/layout routes without a path
            }

            var routePath = pathMatch.Groups[1].Value;
            var compMatch = RouteComponentAttrRegex().Match(window);
            if (!compMatch.Success)
            {
                compMatch = RouteElementAttrRegex().Match(window);
            }

            var line = LineAt(content, routeMatch.Index);
            var routeNode = RouteNode(
                $"route:{filePath}:{line}:{routePath}",
                routePath,
                $"{filePath}::route:{routePath}",
                filePath, line, 0, jsxLang, now);
            nodes.Add(routeNode);
            if (compMatch.Success)
            {
                references.Add(RouteRef(routeNode.Id, compMatch.Groups[1].Value, CodeGraphEdgeKind.References, line, filePath, jsxLang));
            }
        }

        // React Router data-router (v6.4+): createBrowserRouter([{ path, element }]).
        // Only scan files that use the data-router API, then pull each route object's
        // `path` + `element={<Comp/>}` / `Component: Comp`.
        if (DataRouterGuardRegex().IsMatch(content))
        {
            foreach (Match om in ObjPathRegex().Matches(content))
            {
                var win = Slice(content, om.Index, om.Index + 300);
                var compMatch = ObjElementRegex().Match(win);
                if (!compMatch.Success)
                {
                    compMatch = ObjComponentRegex().Match(win);
                }

                if (!compMatch.Success)
                {
                    continue; // require a component -> it's a real route object
                }

                var routePath = om.Groups[1].Value.Length > 0 ? om.Groups[1].Value : "/";
                var line = LineAt(content, om.Index);
                var routeNode = RouteNode(
                    $"route:{filePath}:{line}:{routePath}",
                    routePath,
                    $"{filePath}::route:{routePath}",
                    filePath, line, 0, jsxLang, now);
                nodes.Add(routeNode);
                references.Add(RouteRef(routeNode.Id, compMatch.Groups[1].Value, CodeGraphEdgeKind.References, line, filePath, jsxLang));
            }
        }

        // Next.js pages/app filename convention: a default export becomes a route.
        if (filePath.Contains("pages/", StringComparison.Ordinal) || filePath.Contains("app/", StringComparison.Ordinal))
        {
            if (content.Contains("export default", StringComparison.Ordinal))
            {
                var routePath = FilePathToRoute(filePath);
                if (routePath is not null)
                {
                    var idx = content.IndexOf("export default", StringComparison.Ordinal);
                    var lineNum = LineAt(content, idx);
                    var lang = filePath.EndsWith(".tsx", StringComparison.Ordinal)
                        ? CodeGraphLanguage.Tsx
                        : filePath.EndsWith(".ts", StringComparison.Ordinal)
                            ? CodeGraphLanguage.TypeScript
                            : CodeGraphLanguage.JavaScript;
                    nodes.Add(RouteNode(
                        $"route:{filePath}:{routePath}:{lineNum}",
                        routePath,
                        $"{filePath}::route:{routePath}",
                        filePath, lineNum, 0, lang, now));
                }
            }
        }

        return new CodeGraphFrameworkExtraction(nodes, references);
    }

    // Convert a Next.js file path to its route, or null when it is not a page file.
    private static string? FilePathToRoute(string filePath)
    {
        var segs = filePath.Split('/');
        var baseName = segs[^1];
        if (!PageExtRegex().IsMatch(baseName))
        {
            return null;
        }

        if (baseName.StartsWith('_') || ConfigFileRegex().IsMatch(baseName))
        {
            return null;
        }

        if (PagesSegmentRegex().IsMatch(filePath))
        {
            var route = PagesPrefixRegex().Replace(filePath, "/");
            route = IndexFileRegex().Replace(route, string.Empty);
            route = PageExtRegex().Replace(route, string.Empty);
            route = DynamicSegRegex().Replace(route, ":$1");
            return route.Length == 0 ? "/" : route;
        }

        if (AppSegmentRegex().IsMatch(filePath))
        {
            // App router — only page.tsx files are routes.
            if (!filePath.Contains("page.", StringComparison.Ordinal))
            {
                return null;
            }

            var route = AppPrefixRegex().Replace(filePath, "/");
            route = AppPageFileRegex().Replace(route, string.Empty);
            route = DynamicSegRegex().Replace(route, ":$1");
            return route.Length == 0 ? "/" : route;
        }

        return null;
    }

    // ------------------------------------------------------------------
    // Shared helpers
    // ------------------------------------------------------------------

    // Enumerate dependencies + devDependencies keys, returning true when `keyMatches`
    // holds for any. JsonDocument (DOM, reflection-free); a parse failure is swallowed.
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

    // `content.slice(0, index).split('\n').length` — 1-based line of `index`.
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

    // JS String.slice(start, end) with end clamped to the string length.
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

        return end <= start ? string.Empty : s[start..end];
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
    // Fixed patterns ([GeneratedRegex]) — verbatim from react.ts
    // ------------------------------------------------------------------
    [GeneratedRegex(@"^[A-Z][a-zA-Z0-9]*$")]
    private static partial Regex PascalCaseRegex();

    [GeneratedRegex(@"<Route\b")]
    private static partial Regex RouteTagRegex();

    [GeneratedRegex(@"\bpath\s*=\s*[""']([^""']+)[""']")]
    private static partial Regex RoutePathAttrRegex();

    [GeneratedRegex(@"\bcomponent\s*=\s*\{\s*([A-Z][A-Za-z0-9_]*)")]
    private static partial Regex RouteComponentAttrRegex();

    [GeneratedRegex(@"\belement\s*=\s*\{\s*<\s*([A-Z][A-Za-z0-9_]*)")]
    private static partial Regex RouteElementAttrRegex();

    [GeneratedRegex(@"\b(?:createBrowserRouter|createHashRouter|createMemoryRouter|createRoutesFromElements)\b")]
    private static partial Regex DataRouterGuardRegex();

    [GeneratedRegex(@"\bpath\s*:\s*['""]([^'""]*)['""]")]
    private static partial Regex ObjPathRegex();

    [GeneratedRegex(@"\belement\s*:\s*<\s*([A-Z][A-Za-z0-9_]*)")]
    private static partial Regex ObjElementRegex();

    [GeneratedRegex(@"\bComponent\s*:\s*([A-Z][A-Za-z0-9_]*)")]
    private static partial Regex ObjComponentRegex();

    [GeneratedRegex(@"\.(tsx?|jsx?)$")]
    private static partial Regex PageExtRegex();

    [GeneratedRegex(@"\.config\.[a-z]+$")]
    private static partial Regex ConfigFileRegex();

    [GeneratedRegex(@"(?:^|/)pages/")]
    private static partial Regex PagesSegmentRegex();

    [GeneratedRegex(@"(?:^|/)app/")]
    private static partial Regex AppSegmentRegex();

    [GeneratedRegex(@"^.*pages/")]
    private static partial Regex PagesPrefixRegex();

    [GeneratedRegex(@"/index\.(tsx?|jsx?)$")]
    private static partial Regex IndexFileRegex();

    [GeneratedRegex(@"\[([^\]]+)\]")]
    private static partial Regex DynamicSegRegex();

    [GeneratedRegex(@"^.*app/")]
    private static partial Regex AppPrefixRegex();

    [GeneratedRegex(@"/page\.(tsx?|jsx?)$")]
    private static partial Regex AppPageFileRegex();
}

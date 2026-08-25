using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphFabricViewResolver — React Native Fabric / Codegen view-component resolver
// (port of frameworks/fabric.ts). Emits JS-visible view `component` + `property` nodes
// the JSX synthesizer and a companion cross-language synthesizer chain through:
//   * TS Codegen spec: `codegenNativeComponent<NativeProps>('Name')` + the NativeProps
//     interface props.
//   * Legacy Paper ObjC ViewManager: `@implementation FooManager` +
//     `RCT_EXPORT/CUSTOM/REMAP_VIEW_PROPERTY(name, ...)` macros.
//   * Android Java/Kotlin ViewManager: `class FooManager` + `@ReactProp("name")` setters.
// resolve() is a no-op (the synthesizers + standard name-matching do the linking).
//
// Regex-scans raw source. Global namespace, all-internal, reflection-free/AOT; fixed
// patterns via [GeneratedRegex].
// =============================================================================
internal sealed partial class CodeGraphFabricViewResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] FabricLanguages =
    {
        CodeGraphLanguage.TypeScript, CodeGraphLanguage.Tsx,
        CodeGraphLanguage.ObjC, CodeGraphLanguage.Java, CodeGraphLanguage.Kotlin
    };

    private static readonly string[] WorkspaceRoots = { "packages", "apps", "modules", "libraries" };

    public string Name => "fabric-view";

    public IReadOnlyList<string>? Languages => FabricLanguages;

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        if (CheckPkg(ctx, "package.json"))
        {
            return true;
        }

        // Monorepo escape hatch — walk common workspace roots one level deep.
        foreach (var root in WorkspaceRoots)
        {
            foreach (var sub in ctx.ListDirectories(root))
            {
                if (CheckPkg(ctx, $"{root}/{sub}/package.json"))
                {
                    return true;
                }
            }
        }

        return false;
    }

    private static bool CheckPkg(CodeGraphResolutionContext ctx, string relativePath)
    {
        var pkg = ctx.ReadFile(relativePath);
        return pkg is not null && ReactNativeDepRegex().IsMatch(pkg);
    }

    public CodeGraphFrameworkExtraction? Extract(string filePath, string source)
    {
        List<CodeGraphNode> nodes;
        if (filePath.EndsWith(".ts", StringComparison.Ordinal) || filePath.EndsWith(".tsx", StringComparison.Ordinal))
        {
            nodes = ExtractFabricNodes(filePath, source);
        }
        else if (filePath.EndsWith(".m", StringComparison.Ordinal) || filePath.EndsWith(".mm", StringComparison.Ordinal))
        {
            nodes = ExtractLegacyViewManagerNodes(filePath, source);
        }
        else if (filePath.EndsWith(".java", StringComparison.Ordinal) || filePath.EndsWith(".kt", StringComparison.Ordinal))
        {
            nodes = ExtractJvmViewManagerNodes(filePath, source);
        }
        else
        {
            nodes = new List<CodeGraphNode>();
        }

        return new CodeGraphFrameworkExtraction(nodes, Array.Empty<CodeGraphUnresolvedReference>());
    }

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx) => null;

    // Strip a trailing ViewManager > Manager and a leading RCT prefix.
    private static string DeriveComponentNameFromManager(string className)
    {
        var name = className.StartsWith("RCT", StringComparison.Ordinal) ? className[3..] : className;
        if (name.EndsWith("ViewManager", StringComparison.Ordinal))
        {
            name = name[..^"ViewManager".Length];
        }
        else if (name.EndsWith("Manager", StringComparison.Ordinal))
        {
            name = name[..^"Manager".Length];
        }

        return name;
    }

    private static List<CodeGraphNode> ExtractFabricNodes(string filePath, string source)
    {
        if (!source.Contains("codegenNativeComponent", StringComparison.Ordinal))
        {
            return new List<CodeGraphNode>();
        }

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var lang = filePath.EndsWith(".tsx", StringComparison.Ordinal) ? CodeGraphLanguage.Tsx : CodeGraphLanguage.TypeScript;
        var nodes = new List<CodeGraphNode>();

        foreach (Match m in CodegenDeclRegex().Matches(source))
        {
            var componentName = m.Groups[1].Value;
            var before = source[..m.Index];
            var startLine = CountLines(before);
            var startColumn = before.Length - before.LastIndexOf('\n') - 1;
            nodes.Add(MakeNode(
                $"fabric-component:{filePath}:{componentName}:{startLine}", CodeGraphNodeKind.Component, componentName,
                $"{filePath}::{componentName}", filePath, lang, startLine, startColumn,
                startColumn + "codegenNativeComponent".Length,
                $"Fabric/Codegen native component '{componentName}'",
                $"codegenNativeComponent<NativeProps>('{componentName}')", now));
        }

        // Props from the NativeProps interface.
        var body = FindNativePropsBody(source);
        if (body is not null)
        {
            var bodyStart = source.IndexOf(body, StringComparison.Ordinal);
            if (bodyStart < 0)
            {
                bodyStart = 0;
            }

            foreach (var propName in ExtractPropNames(body))
            {
                var propBefore = source.IndexOf(propName, bodyStart, StringComparison.Ordinal);
                var propLine = propBefore >= 0 ? CountLines(source[..propBefore]) : 1;
                nodes.Add(MakeNode(
                    $"fabric-prop:{filePath}:{propName}:{propLine}", CodeGraphNodeKind.Property, propName,
                    $"{filePath}::NativeProps.{propName}", filePath, lang, propLine, 0, propName.Length,
                    $"Fabric NativeProps prop '{propName}'", null, now));
            }
        }

        return nodes;
    }

    private static List<CodeGraphNode> ExtractLegacyViewManagerNodes(string filePath, string source)
    {
        if (!source.Contains("RCT_EXPORT_VIEW_PROPERTY", StringComparison.Ordinal) &&
            !source.Contains("RCT_CUSTOM_VIEW_PROPERTY", StringComparison.Ordinal) &&
            !source.Contains("RCT_REMAP_VIEW_PROPERTY", StringComparison.Ordinal))
        {
            return new List<CodeGraphNode>();
        }

        var implMatch = ObjcImplRegex().Match(source);
        if (!implMatch.Success || implMatch.Groups[1].Value.Length == 0)
        {
            return new List<CodeGraphNode>();
        }

        var className = implMatch.Groups[1].Value;
        if (!className.EndsWith("Manager", StringComparison.Ordinal) && !className.EndsWith("ViewManager", StringComparison.Ordinal))
        {
            return new List<CodeGraphNode>();
        }

        var componentName = DeriveComponentNameFromManager(className);
        if (componentName.Length == 0)
        {
            return new List<CodeGraphNode>();
        }

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var nodes = new List<CodeGraphNode>();

        var startLine = CountLines(source[..implMatch.Index]);
        nodes.Add(MakeNode(
            $"fabric-component:{filePath}:{componentName}:{startLine}", CodeGraphNodeKind.Component, componentName,
            $"{filePath}::{componentName}", filePath, CodeGraphLanguage.ObjC, startLine, 0, componentName.Length,
            $"Legacy Paper ViewManager component '{componentName}' (from @implementation {className})",
            $"RCT_EXPORT_MODULE() // ViewManager: {className}", now));

        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (Match m in RctViewPropRegex().Matches(source))
        {
            var propName = m.Groups[1].Value;
            if (!seen.Add(propName))
            {
                continue;
            }

            var propLine = CountLines(source[..m.Index]);
            nodes.Add(MakeNode(
                $"fabric-prop:{filePath}:{propName}:{propLine}", CodeGraphNodeKind.Property, propName,
                $"{filePath}::{componentName}.{propName}", filePath, CodeGraphLanguage.ObjC, propLine, 0, propName.Length,
                $"Legacy Paper view prop '{propName}' on {componentName}", null, now));
        }

        return nodes;
    }

    private static List<CodeGraphNode> ExtractJvmViewManagerNodes(string filePath, string source)
    {
        if (!source.Contains("@ReactProp", StringComparison.Ordinal))
        {
            return new List<CodeGraphNode>();
        }

        var classMatch = ClassNameRegex().Match(source);
        if (!classMatch.Success || classMatch.Groups[1].Value.Length == 0)
        {
            return new List<CodeGraphNode>();
        }

        var className = classMatch.Groups[1].Value;
        if (!className.EndsWith("Manager", StringComparison.Ordinal) && !className.EndsWith("ViewManager", StringComparison.Ordinal))
        {
            return new List<CodeGraphNode>();
        }

        var componentName = DeriveComponentNameFromManager(className);
        if (componentName.Length == 0)
        {
            return new List<CodeGraphNode>();
        }

        var language = filePath.EndsWith(".kt", StringComparison.Ordinal) ? CodeGraphLanguage.Kotlin : CodeGraphLanguage.Java;
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var nodes = new List<CodeGraphNode>();

        var startLine = CountLines(source[..classMatch.Index]);
        nodes.Add(MakeNode(
            $"fabric-component:{filePath}:{componentName}:{startLine}", CodeGraphNodeKind.Component, componentName,
            $"{filePath}::{componentName}", filePath, language, startLine, 0, componentName.Length,
            $"Android view-manager component '{componentName}' (from class {className})",
            $"class {className} : ViewManager", now));

        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (Match m in ReactPropRegex().Matches(source))
        {
            var propName = m.Groups[1].Value;
            if (!seen.Add(propName))
            {
                continue;
            }

            var propLine = CountLines(source[..m.Index]);
            nodes.Add(MakeNode(
                $"fabric-prop:{filePath}:{propName}:{propLine}", CodeGraphNodeKind.Property, propName,
                $"{filePath}::{componentName}.{propName}", filePath, language, propLine, 0, propName.Length,
                $"Android @ReactProp prop '{propName}' on {componentName}", null, now));
        }

        return nodes;
    }

    // export interface NativeProps [extends X] { … } body, or null.
    private static string? FindNativePropsBody(string source)
    {
        var m = NativePropsRegex().Match(source);
        return m.Success ? m.Groups[1].Value : null;
    }

    // Prop names in the interface body: `name?: Type;`. Skip method-shape (`name(`).
    private static List<string> ExtractPropNames(string body)
    {
        var props = new List<string>();
        foreach (Match m in PropDeclRegex().Matches(body))
        {
            var name = m.Groups[1].Value;
            var afterStart = m.Index + m.Length;
            var after = afterStart < body.Length ? body[afterStart..Math.Min(body.Length, afterStart + 80)] : string.Empty;
            if (MethodShapeRegex().IsMatch(after))
            {
                continue; // method-shape, skip
            }

            props.Add(name);
        }

        return props;
    }

    private static CodeGraphNode MakeNode(
        string id, string kind, string name, string qualifiedName, string filePath, string language,
        int startLine, int startColumn, int endColumn, string docstring, string? signature, long now) =>
        new(id, kind, name, qualifiedName, filePath, language, startLine, startLine, startColumn, endColumn,
            docstring, signature, null, true, false, false, false, null, null, null, now);

    // before.split('\n').length — 1-based line count of the text before the match.
    private static int CountLines(string before)
    {
        var count = 1;
        foreach (var ch in before)
        {
            if (ch == '\n')
            {
                count++;
            }
        }

        return count;
    }

    [GeneratedRegex(@"[""']react-native[""']\s*:")]
    private static partial Regex ReactNativeDepRegex();

    [GeneratedRegex(@"codegenNativeComponent\s*(?:<[^>]+>)?\s*\(\s*['""]([A-Za-z_][A-Za-z0-9_]*)['""]")]
    private static partial Regex CodegenDeclRegex();

    [GeneratedRegex(@"\bRCT_(?:EXPORT|CUSTOM|REMAP)_VIEW_PROPERTY\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)")]
    private static partial Regex RctViewPropRegex();

    [GeneratedRegex(@"@implementation\s+([A-Za-z_][A-Za-z0-9_]*)")]
    private static partial Regex ObjcImplRegex();

    [GeneratedRegex(@"\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b")]
    private static partial Regex ClassNameRegex();

    [GeneratedRegex(@"@ReactProp\s*\(\s*(?:name\s*=\s*)?""([^""]+)""")]
    private static partial Regex ReactPropRegex();

    [GeneratedRegex(@"export\s+interface\s+NativeProps\b[^{]*\{([\s\S]*?)\n\}")]
    private static partial Regex NativePropsRegex();

    [GeneratedRegex(@"^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:", RegexOptions.Multiline)]
    private static partial Regex PropDeclRegex();

    [GeneratedRegex(@"^\s*\(")]
    private static partial Regex MethodShapeRegex();
}

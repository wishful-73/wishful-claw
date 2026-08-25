using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphReactNativeBridgeResolver — React Native JS <-> native bridge resolver
// (port of frameworks/react-native.ts). Closes the JS -> native flow for both the
// legacy bridge (ObjC RCT_EXPORT_MODULE/METHOD/REMAP, Java/Kotlin @ReactMethod) and
// TurboModules (TS `TurboModuleRegistry.get*<Spec>('Module')` spec interfaces).
//   * extract(): emits method nodes for RCT_EXPORT_METHOD/REMAP macros (which parse as
//     ERROR nodes, so the ObjC extractor never saw them).
//   * resolve(): redirects a JS `obj.method()` call to its native implementation via a
//     per-context map from JS method name -> native method node (iOS preferred).
//
// Regex-scans raw source. Global namespace, all-internal, reflection-free/AOT; fixed
// patterns via [GeneratedRegex]. The per-context method map (a JS WeakMap) is a
// ConditionalWeakTable.
// =============================================================================
internal sealed partial class CodeGraphReactNativeBridgeResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] BridgeLanguages =
    {
        CodeGraphLanguage.JavaScript, CodeGraphLanguage.TypeScript,
        CodeGraphLanguage.Tsx, CodeGraphLanguage.Jsx, CodeGraphLanguage.ObjC
    };

    // RCTEventEmitter built-ins every emitter subclass inherits — skip during map
    // building so ordinary JS addListener/remove calls don't mis-bridge.
    private static readonly HashSet<string> RnEmitterBuiltins = new(StringComparer.Ordinal)
    {
        "addListener", "removeListeners", "remove", "invalidate", "startObserving", "stopObserving"
    };

    private static readonly CodeGraphFrameworkExtraction EmptyExtraction =
        new(Array.Empty<CodeGraphNode>(), Array.Empty<CodeGraphUnresolvedReference>());

    // Per-context lazy map cache: JS-visible method name -> native method entries.
    private static readonly ConditionalWeakTable<CodeGraphResolutionContext, Dictionary<string, List<NativeMethod>>>
        NativeMethodMaps = new();

    // One native RN method known to the resolver.
    private readonly record struct NativeMethod(string ModuleName, string JsName, CodeGraphNode Node);

    // One parsed ObjC export declaration.
    private readonly record struct ObjcExport(string ModuleName, string JsName, string NativeSelectorFirstKw, int Line);

    public string Name => "react-native-bridge";

    public IReadOnlyList<string>? Languages => BridgeLanguages;

    public bool ClaimsReference(string name) => false;

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        var pkg = ctx.ReadFile("package.json");
        if (pkg is not null && ReactNativeDepRegex().IsMatch(pkg))
        {
            return true;
        }

        var files = ctx.GetAllFiles();
        var limit = Math.Min(files.Count, 200);
        for (var i = 0; i < limit; i++)
        {
            var f = files[i];
            if (f.EndsWith(".mm", StringComparison.Ordinal) || f.EndsWith(".m", StringComparison.Ordinal))
            {
                var src = ctx.ReadFile(f);
                if (src is not null && ExportModuleGuardRegex().IsMatch(src))
                {
                    return true;
                }
            }

            if (f.EndsWith(".ts", StringComparison.Ordinal) || f.EndsWith(".tsx", StringComparison.Ordinal))
            {
                var src = ctx.ReadFile(f);
                if (src is not null && TurboModuleGuardRegex().IsMatch(src))
                {
                    return true;
                }
            }
        }

        return false;
    }

    public CodeGraphFrameworkExtraction? Extract(string filePath, string source)
    {
        if (!filePath.EndsWith(".m", StringComparison.Ordinal) && !filePath.EndsWith(".mm", StringComparison.Ordinal))
        {
            return EmptyExtraction;
        }

        if (!ExportModuleGuardRegex().IsMatch(source))
        {
            return EmptyExtraction;
        }

        var exports = ParseObjcRnExports(source, FindObjcClassName(source));
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var nodes = new List<CodeGraphNode>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var e in exports)
        {
            if (!seen.Add(e.JsName))
            {
                continue;
            }

            nodes.Add(new CodeGraphNode(
                Id: $"rn-export:{filePath}:{e.ModuleName}.{e.JsName}",
                Kind: CodeGraphNodeKind.Method,
                Name: e.JsName,
                QualifiedName: $"{filePath}::{e.ModuleName}.{e.JsName}",
                FilePath: filePath,
                Language: CodeGraphLanguage.ObjC,
                StartLine: e.Line,
                EndLine: e.Line,
                StartColumn: 0,
                EndColumn: 0,
                Docstring: $"RCT_EXPORT_METHOD {e.NativeSelectorFirstKw} (module {e.ModuleName})",
                Signature: $"RCT_EXPORT_METHOD({e.NativeSelectorFirstKw}:…)",
                Visibility: null,
                IsExported: true,
                IsAsync: false,
                IsStatic: false,
                IsAbstract: false,
                Decorators: null,
                TypeParameters: null,
                ReturnType: null,
                UpdatedAt: now));
        }

        return new CodeGraphFrameworkExtraction(nodes, Array.Empty<CodeGraphUnresolvedReference>());
    }

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        // Only redirect JS callers.
        if (r.Language != CodeGraphLanguage.JavaScript &&
            r.Language != CodeGraphLanguage.TypeScript &&
            r.Language != CodeGraphLanguage.Tsx &&
            r.Language != CodeGraphLanguage.Jsx)
        {
            return null;
        }

        var name = LastDotSegment(r.ReferenceName);
        var maps = BuildRnMaps(ctx);
        if (!maps.TryGetValue(name, out var entries) || entries.Count == 0)
        {
            return null;
        }

        // Prefer the iOS (ObjC) target over Android when both exist.
        NativeMethod? objc = null;
        foreach (var e in entries)
        {
            if (e.Node.Language == CodeGraphLanguage.ObjC)
            {
                objc = e;
                break;
            }
        }

        var target = objc ?? entries[0];
        return new CodeGraphResolvedRef(target.Node.Id, 0.6, CodeGraphResolvedBy.Framework);
    }

    // ── Native-side extraction ─────────────────────────────────────────────────

    // Default ObjC module name when RCT_EXPORT_MODULE() has no argument: strip a leading
    // RCT prefix from the class name (RCTGeolocation -> Geolocation).
    private static string DefaultObjcModuleName(string className) =>
        className.StartsWith("RCT", StringComparison.Ordinal) && className.Length > 3 ? className[3..] : className;

    private static List<ObjcExport> ParseObjcRnExports(string source, string? className)
    {
        var results = new List<ObjcExport>();

        var moduleMatch = ExportModuleRegex().Match(source);
        string? moduleName = moduleMatch.Success && moduleMatch.Groups[1].Success
            ? moduleMatch.Groups[1].Value
            : className is not null ? DefaultObjcModuleName(className) : null;
        if (moduleName is null)
        {
            return results;
        }

        foreach (Match m in ExportMethodRegex().Matches(source))
        {
            var kw = m.Groups[1].Value;
            if (kw.Length > 0)
            {
                results.Add(new ObjcExport(moduleName, kw, kw, LineOf(source, m.Index)));
            }
        }

        foreach (Match m in RemapMethodRegex().Matches(source))
        {
            var jsName = m.Groups[1].Value;
            var nativeKw = m.Groups[2].Value;
            if (jsName.Length > 0 && nativeKw.Length > 0)
            {
                results.Add(new ObjcExport(moduleName, jsName, nativeKw, LineOf(source, m.Index)));
            }
        }

        return results;
    }

    private static string? FindObjcClassName(string source)
    {
        var m = ObjcImplRegex().Match(source);
        return m.Success ? m.Groups[1].Value : null;
    }

    private static List<(string ModuleName, string JsName)> ParseJvmRnExports(string source)
    {
        var results = new List<(string, string)>();

        var getName = GetNameLiteralRegex().Match(source);
        var classMatch = ReactModuleClassRegex().Match(source);
        if (!classMatch.Success)
        {
            classMatch = ReactPackageClassRegex().Match(source);
        }

        string? moduleName;
        if (getName.Success && getName.Groups[1].Success)
        {
            moduleName = getName.Groups[1].Value;
        }
        else if (classMatch.Success && classMatch.Groups[1].Success)
        {
            moduleName = ModuleSuffixRegex().Replace(classMatch.Groups[1].Value, string.Empty);
        }
        else
        {
            moduleName = null;
        }

        if (moduleName is null)
        {
            return results;
        }

        foreach (Match m in ReactMethodRegex().Matches(source))
        {
            var jsName = m.Groups[1].Value;
            if (jsName.Length > 0)
            {
                results.Add((moduleName, jsName));
            }
        }

        return results;
    }

    private static (string ModuleName, List<string> Methods)? ParseTurboModuleSpec(string source)
    {
        var regMatch = TurboRegistryRegex().Match(source);
        if (!regMatch.Success || regMatch.Groups[1].Value.Length == 0)
        {
            return null;
        }

        var moduleName = regMatch.Groups[1].Value;

        var ifaceMatch = SpecInterfaceRegex().Match(source);
        if (!ifaceMatch.Success || ifaceMatch.Groups[1].Value.Length == 0)
        {
            return null;
        }

        var body = ifaceMatch.Groups[1].Value;
        var methods = new List<string>();
        foreach (Match m in SpecMethodRegex().Matches(body))
        {
            var mName = m.Groups[1].Value;
            if (mName.Length > 0)
            {
                methods.Add(mName);
            }
        }

        return (moduleName, methods);
    }

    // ── Map building ────────────────────────────────────────────────────────────

    private static Dictionary<string, List<NativeMethod>> BuildRnMaps(CodeGraphResolutionContext ctx)
    {
        if (NativeMethodMaps.TryGetValue(ctx, out var cached))
        {
            return cached;
        }

        var byJsName = new Dictionary<string, List<NativeMethod>>(StringComparer.Ordinal);
        var allFiles = ctx.GetAllFiles();

        // Pre-index native methods by name.
        var objcMethodsByFirstKw = new Dictionary<string, List<CodeGraphNode>>(StringComparer.Ordinal);
        var jvmMethodsByName = new Dictionary<string, List<CodeGraphNode>>(StringComparer.Ordinal);
        foreach (var node in ctx.GetNodesByKind(CodeGraphNodeKind.Method))
        {
            if (node.Language == CodeGraphLanguage.ObjC)
            {
                var colon = node.Name.IndexOf(':');
                var firstKw = colon >= 0 ? node.Name[..colon] : node.Name;
                if (firstKw.Length > 0)
                {
                    AddTo(objcMethodsByFirstKw, firstKw, node);
                }
            }
            else if (node.Language == CodeGraphLanguage.Java || node.Language == CodeGraphLanguage.Kotlin)
            {
                AddTo(jvmMethodsByName, node.Name, node);
            }
        }

        foreach (var file in allFiles)
        {
            // Legacy bridge — ObjC side.
            if (file.EndsWith(".m", StringComparison.Ordinal) || file.EndsWith(".mm", StringComparison.Ordinal))
            {
                var source = ctx.ReadFile(file);
                if (source is null)
                {
                    continue;
                }

                var className = FindObjcClassName(source);
                foreach (var exp in ParseObjcRnExports(source, className))
                {
                    if (RnEmitterBuiltins.Contains(exp.JsName))
                    {
                        continue;
                    }

                    var candidates = objcMethodsByFirstKw.TryGetValue(exp.NativeSelectorFirstKw, out var c) ? c : null;
                    var node = PickNode(candidates, file);
                    if (node is null)
                    {
                        continue;
                    }

                    AddEntry(byJsName, exp.JsName, new NativeMethod(exp.ModuleName, exp.JsName, node));
                }
            }

            // Legacy bridge — Java/Kotlin side.
            if (file.EndsWith(".java", StringComparison.Ordinal) || file.EndsWith(".kt", StringComparison.Ordinal))
            {
                var source = ctx.ReadFile(file);
                if (source is null)
                {
                    continue;
                }

                foreach (var exp in ParseJvmRnExports(source))
                {
                    if (RnEmitterBuiltins.Contains(exp.JsName))
                    {
                        continue;
                    }

                    var candidates = jvmMethodsByName.TryGetValue(exp.JsName, out var c) ? c : null;
                    var node = PickNode(candidates, file);
                    if (node is null)
                    {
                        continue;
                    }

                    AddEntry(byJsName, exp.JsName, new NativeMethod(exp.ModuleName, exp.JsName, node));
                }
            }

            // TurboModule spec — TS side.
            if (file.EndsWith(".ts", StringComparison.Ordinal) || file.EndsWith(".tsx", StringComparison.Ordinal))
            {
                var source = ctx.ReadFile(file);
                if (source is null)
                {
                    continue;
                }

                var spec = ParseTurboModuleSpec(source);
                if (spec is null)
                {
                    continue;
                }

                foreach (var methodName in spec.Value.Methods)
                {
                    if (RnEmitterBuiltins.Contains(methodName))
                    {
                        continue;
                    }

                    if (objcMethodsByFirstKw.TryGetValue(methodName, out var objcCands))
                    {
                        foreach (var node in objcCands)
                        {
                            AddEntry(byJsName, methodName, new NativeMethod(spec.Value.ModuleName, methodName, node));
                        }
                    }

                    if (jvmMethodsByName.TryGetValue(methodName, out var jvmCands))
                    {
                        foreach (var node in jvmCands)
                        {
                            AddEntry(byJsName, methodName, new NativeMethod(spec.Value.ModuleName, methodName, node));
                        }
                    }
                }
            }
        }

        NativeMethodMaps.AddOrUpdate(ctx, byJsName);
        return byJsName;
    }

    // candidates.find(c => c.filePath === file) ?? candidates[0]
    private static CodeGraphNode? PickNode(List<CodeGraphNode>? candidates, string file)
    {
        if (candidates is null || candidates.Count == 0)
        {
            return null;
        }

        foreach (var c in candidates)
        {
            if (c.FilePath == file)
            {
                return c;
            }
        }

        return candidates[0];
    }

    private static void AddTo(Dictionary<string, List<CodeGraphNode>> map, string key, CodeGraphNode node)
    {
        if (map.TryGetValue(key, out var arr))
        {
            arr.Add(node);
        }
        else
        {
            map[key] = new List<CodeGraphNode> { node };
        }
    }

    private static void AddEntry(Dictionary<string, List<NativeMethod>> map, string key, NativeMethod entry)
    {
        if (map.TryGetValue(key, out var arr))
        {
            arr.Add(entry);
        }
        else
        {
            map[key] = new List<NativeMethod> { entry };
        }
    }

    // ref.referenceName after the final '.', or the whole string.
    private static string LastDotSegment(string name)
    {
        var idx = name.LastIndexOf('.');
        return idx >= 0 ? name[(idx + 1)..] : name;
    }

    // 1-based line of `idx` (count '\n' before it).
    private static int LineOf(string s, int idx)
    {
        var line = 1;
        var limit = idx < s.Length ? idx : s.Length;
        for (var i = 0; i < limit; i++)
        {
            if (s[i] == '\n')
            {
                line++;
            }
        }

        return line;
    }

    // ── Fixed patterns ([GeneratedRegex]) ─────────────────────────────────────

    [GeneratedRegex(@"[""']react-native[""']\s*:")]
    private static partial Regex ReactNativeDepRegex();

    [GeneratedRegex(@"RCT_EXPORT_MODULE\b")]
    private static partial Regex ExportModuleGuardRegex();

    [GeneratedRegex(@"TurboModuleRegistry\.(?:get|getEnforcing)\s*<")]
    private static partial Regex TurboModuleGuardRegex();

    [GeneratedRegex(@"RCT_EXPORT_MODULE\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)?\s*\)")]
    private static partial Regex ExportModuleRegex();

    [GeneratedRegex(@"RCT_EXPORT_METHOD\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)")]
    private static partial Regex ExportMethodRegex();

    [GeneratedRegex(@"RCT_REMAP_METHOD\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)")]
    private static partial Regex RemapMethodRegex();

    [GeneratedRegex(@"@implementation\s+([A-Za-z_][A-Za-z0-9_]*)")]
    private static partial Regex ObjcImplRegex();

    [GeneratedRegex(@"\bgetName\s*\([^)]*\)\s*(?::\s*String)?\s*(?:=\s*|\{[^}]*return\s*)""([^""]+)""")]
    private static partial Regex GetNameLiteralRegex();

    [GeneratedRegex(@"\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b[^{]*ReactContextBaseJavaModule")]
    private static partial Regex ReactModuleClassRegex();

    [GeneratedRegex(@"\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b[^{]*ReactPackage")]
    private static partial Regex ReactPackageClassRegex();

    [GeneratedRegex(@"Module$")]
    private static partial Regex ModuleSuffixRegex();

    [GeneratedRegex(@"@ReactMethod\b[^{]*?(?:\bfun\s+|\bvoid\s+|\bpublic\s+\w[\w<>\[\]]*\s+)([A-Za-z_][A-Za-z0-9_]*)\s*\(")]
    private static partial Regex ReactMethodRegex();

    [GeneratedRegex(@"TurboModuleRegistry\.(?:getEnforcing|get)\s*<[^>]*>\s*\(\s*['""]([^'""]+)['""]\s*\)")]
    private static partial Regex TurboRegistryRegex();

    [GeneratedRegex(@"export\s+interface\s+Spec\b[^{]*\{([\s\S]*?)\n\}")]
    private static partial Regex SpecInterfaceRegex();

    [GeneratedRegex(@"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(", RegexOptions.Multiline)]
    private static partial Regex SpecMethodRegex();
}

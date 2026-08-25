using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphExpoModulesResolver — Expo Modules framework resolver (port of
// frameworks/expo-modules.ts). Closes the JS -> native flow for Expo SDK packages,
// whose Swift/Kotlin DSL declares the JS surface via literal `Function("x")`,
// `AsyncFunction("x")`, `Property("x")`, `Constants("x")` calls inside a `definition()`
// body. extract() emits a `method` node per declared literal so the standard
// name-matcher resolves JS `Foo.takePictureAsync(...)` to it (no bespoke resolve()).
//
// Regex-scans raw source. Global namespace, all-internal, reflection-free/AOT; fixed
// patterns via [GeneratedRegex].
// =============================================================================
internal sealed partial class CodeGraphExpoModulesResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] ExpoLanguages = { CodeGraphLanguage.Swift, CodeGraphLanguage.Kotlin };

    private static readonly CodeGraphFrameworkExtraction EmptyExtraction =
        new(Array.Empty<CodeGraphNode>(), Array.Empty<CodeGraphUnresolvedReference>());

    public string Name => "expo-modules";

    public IReadOnlyList<string>? Languages => ExpoLanguages;

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        var pkg = ctx.ReadFile("package.json");
        if (pkg is not null && ExpoCoreDepRegex().IsMatch(pkg))
        {
            return true;
        }

        var files = ctx.GetAllFiles();
        var limit = Math.Min(files.Count, 200);
        for (var i = 0; i < limit; i++)
        {
            var f = files[i];
            if (f.EndsWith(".swift", StringComparison.Ordinal) || f.EndsWith(".kt", StringComparison.Ordinal))
            {
                var src = ctx.ReadFile(f);
                if (src is not null && IsExpoModuleSource(src))
                {
                    return true;
                }
            }
        }

        return false;
    }

    public CodeGraphFrameworkExtraction? Extract(string filePath, string source)
    {
        var language = filePath.EndsWith(".kt", StringComparison.Ordinal) ? CodeGraphLanguage.Kotlin : CodeGraphLanguage.Swift;
        return new CodeGraphFrameworkExtraction(ExtractExpoMethods(filePath, source, language), Array.Empty<CodeGraphUnresolvedReference>());
    }

    // No bespoke resolution — the synthetic method nodes get picked up by the standard
    // name-matcher via the obj.method -> method-name path.
    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx) => null;

    private static bool IsExpoModuleSource(string source) =>
        ExpoClassRegex().IsMatch(source) && ExpoDeclRegex().IsMatch(source);

    private static List<CodeGraphNode> ExtractExpoMethods(string filePath, string source, string language)
    {
        if (!IsExpoModuleSource(source))
        {
            return new List<CodeGraphNode>();
        }

        var nodes = new List<CodeGraphNode>();

        var nameMatch = ExpoModuleNameRegex().Match(source);
        var classMatch = ExpoClassRegex().Match(source);
        // Prefer the explicit Name("X") literal; class name is the fallback.
        var moduleName = nameMatch.Success ? nameMatch.Groups[1].Value
            : classMatch.Success ? classMatch.Groups[1].Value
            : "ExpoModule";

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var seenAtLine = new HashSet<string>(StringComparer.Ordinal);
        foreach (Match m in ExpoDeclRegex().Matches(source))
        {
            var kind = m.Groups[1].Value;
            var methodName = m.Groups[2].Value;
            var before = source[..m.Index];
            var startLine = CountLines(before);
            var dedupKey = $"{methodName}:{startLine}";
            if (!seenAtLine.Add(dedupKey))
            {
                continue;
            }

            var startColumn = before.Length - before.LastIndexOf('\n') - 1;
            nodes.Add(new CodeGraphNode(
                Id: $"expo-module:{filePath}:{moduleName}:{methodName}:{startLine}",
                Kind: CodeGraphNodeKind.Method,
                Name: methodName,
                QualifiedName: $"{filePath}::{moduleName}.{methodName}",
                FilePath: filePath,
                Language: language,
                StartLine: startLine,
                EndLine: startLine,
                StartColumn: startColumn,
                EndColumn: startColumn + kind.Length + 2 + methodName.Length + 2,
                Docstring: $"Expo Modules {kind}(\"{methodName}\") in {moduleName}",
                Signature: $"{kind}(\"{methodName}\")",
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

        return nodes;
    }

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

    [GeneratedRegex(@"[""']expo-modules-core[""']\s*:")]
    private static partial Regex ExpoCoreDepRegex();

    [GeneratedRegex(@"\b(Function|AsyncFunction|Property|Constants)\s*(?:<[^(]*>)?\s*\(\s*[""']([A-Za-z_][A-Za-z0-9_]*)[""']")]
    private static partial Regex ExpoDeclRegex();

    [GeneratedRegex(@"\bName\s*\(\s*[""']([A-Za-z_][A-Za-z0-9_]*)[""']")]
    private static partial Regex ExpoModuleNameRegex();

    [GeneratedRegex(@"\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*Module\b")]
    private static partial Regex ExpoClassRegex();
}

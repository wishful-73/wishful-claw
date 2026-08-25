using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphSwiftUiResolver — SwiftUI framework resolver (port of the swiftUIResolver
// half of frameworks/swift.ts). Contributes:
//   * resolve(): View (`*View`, PascalCase), ViewModel/Store/Manager, and Model
//     references, preferring framework-conventional directories.
//   * extract(): SwiftUI `struct X: View` component nodes + `@main struct X: App`
//     entry-point class nodes (no reference edges emitted here).
//
// Regex-scans raw source (comments blanked via CodeGraphStripComments). Global
// namespace, all-internal, reflection-free/AOT; fixed patterns via [GeneratedRegex].
// =============================================================================
internal sealed partial class CodeGraphSwiftUiResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] SwiftLanguages = { CodeGraphLanguage.Swift };

    private static readonly string[] ViewDirs = { "/Views/", "/View/", "/Screens/", "/Components/", "/UI/" };
    private static readonly string[] ViewModelDirs = { "/ViewModels/", "/ViewModel/", "/Stores/", "/Managers/", "/Services/" };
    private static readonly string[] ModelDirs = { "/Models/", "/Model/", "/Entities/", "/Domain/" };

    private static readonly string[] ViewKinds = { CodeGraphNodeKind.Struct, CodeGraphNodeKind.Component };
    private static readonly string[] ClassKinds = { CodeGraphNodeKind.Class };
    private static readonly string[] ModelKinds = { CodeGraphNodeKind.Struct, CodeGraphNodeKind.Class };

    private static readonly CodeGraphFrameworkExtraction EmptyExtraction =
        new(Array.Empty<CodeGraphNode>(), Array.Empty<CodeGraphUnresolvedReference>());

    public string Name => "swiftUI";

    public IReadOnlyList<string>? Languages => SwiftLanguages;

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        var allFiles = ctx.GetAllFiles();
        foreach (var file in allFiles)
        {
            if (file.EndsWith(".swift", StringComparison.Ordinal))
            {
                var content = ctx.ReadFile(file);
                if (content is not null && content.Contains("import SwiftUI", StringComparison.Ordinal))
                {
                    return true;
                }
            }
        }

        foreach (var file in allFiles)
        {
            if (file.EndsWith(".xcodeproj", StringComparison.Ordinal) || file.EndsWith(".xcworkspace", StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var name = r.ReferenceName;

        // Pattern 1: View references (SwiftUI views are PascalCase ending in View).
        if (name.EndsWith("View", StringComparison.Ordinal) && name.Length > 0 && name[0] >= 'A' && name[0] <= 'Z')
        {
            var result = ResolveByNameAndKind(name, ViewKinds, ViewDirs, ctx);
            if (result is not null)
            {
                return new CodeGraphResolvedRef(result, 0.85, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 2: ViewModel/ObservableObject references.
        if (name.EndsWith("ViewModel", StringComparison.Ordinal) ||
            name.EndsWith("Store", StringComparison.Ordinal) ||
            name.EndsWith("Manager", StringComparison.Ordinal))
        {
            var result = ResolveByNameAndKind(name, ClassKinds, ViewModelDirs, ctx);
            if (result is not null)
            {
                return new CodeGraphResolvedRef(result, 0.85, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 3: Model references.
        if (PascalNameRegex().IsMatch(name))
        {
            var result = ResolveByNameAndKind(name, ModelKinds, ModelDirs, ctx);
            if (result is not null)
            {
                return new CodeGraphResolvedRef(result, 0.7, CodeGraphResolvedBy.Framework);
            }
        }

        return null;
    }

    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        if (!filePath.EndsWith(".swift", StringComparison.Ordinal))
        {
            return EmptyExtraction;
        }

        var nodes = new List<CodeGraphNode>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Swift);

        // SwiftUI View structs — struct ContentView: View { ... }
        foreach (Match match in ViewStructRegex().Matches(safe))
        {
            var viewName = match.Groups[1].Value;
            var line = CodeGraphSwiftFrameworkHelpers.LineAt(safe, match.Index);
            nodes.Add(CodeGraphSwiftFrameworkHelpers.MakeNode(
                $"view:{filePath}:{viewName}:{line}", CodeGraphNodeKind.Component, viewName,
                $"{filePath}::{viewName}", filePath, CodeGraphLanguage.Swift, line, match.Length, now));
        }

        // @main App entry point — @main struct MyApp: App
        foreach (Match match in AppStructRegex().Matches(safe))
        {
            var appName = match.Groups[1].Value;
            var line = CodeGraphSwiftFrameworkHelpers.LineAt(safe, match.Index);
            nodes.Add(CodeGraphSwiftFrameworkHelpers.MakeNode(
                $"app:{filePath}:{appName}:{line}", CodeGraphNodeKind.Class, appName,
                $"{filePath}::{appName}", filePath, CodeGraphLanguage.Swift, line, match.Length, now));
        }

        return new CodeGraphFrameworkExtraction(nodes, Array.Empty<CodeGraphUnresolvedReference>());
    }

    private static string? ResolveByNameAndKind(string name, string[] kinds, string[] preferredDirs, CodeGraphResolutionContext ctx) =>
        CodeGraphSwiftFrameworkHelpers.ResolveByNameAndKind(name, kinds, preferredDirs, ctx);

    [GeneratedRegex(@"^[A-Z][a-zA-Z]+$")]
    private static partial Regex PascalNameRegex();

    [GeneratedRegex(@"struct\s+(\w+)\s*:\s*(?:\w+\s*,\s*)*View")]
    private static partial Regex ViewStructRegex();

    [GeneratedRegex(@"@main\s+struct\s+(\w+)\s*:\s*App")]
    private static partial Regex AppStructRegex();
}

// Shared helpers for the three Swift framework resolvers (SwiftUI / UIKit / Vapor).
// Kept in one place (co-located with the SwiftUI resolver) so the name-and-kind
// lookup + node/line factories aren't triple-duplicated. Global namespace, internal.
internal static class CodeGraphSwiftFrameworkHelpers
{
    // ≙ swift.ts resolveByNameAndKind: name-index lookup, kind filter, then prefer a
    // framework-conventional directory; fall back to the first kind match.
    internal static string? ResolveByNameAndKind(string name, string[] kinds, string[] preferredDirs, CodeGraphResolutionContext ctx)
    {
        var candidates = ctx.GetNodesByName(name);
        if (candidates.Count == 0)
        {
            return null;
        }

        List<CodeGraphNode>? kindFiltered = null;
        foreach (var n in candidates)
        {
            if (KindMatches(n.Kind, kinds))
            {
                (kindFiltered ??= new List<CodeGraphNode>()).Add(n);
            }
        }

        if (kindFiltered is null)
        {
            return null;
        }

        if (preferredDirs.Length > 0)
        {
            foreach (var n in kindFiltered)
            {
                foreach (var d in preferredDirs)
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

    // safe.slice(0, index).split('\n').length — 1-based line of `index`.
    internal static int LineAt(string s, int index)
    {
        var line = 1;
        var limit = index < s.Length ? index : s.Length;
        for (var i = 0; i < limit; i++)
        {
            if (s[i] == '\n')
            {
                line++;
            }
        }

        return line;
    }

    internal static CodeGraphNode MakeNode(
        string id, string kind, string name, string qualifiedName, string filePath, string language, int line, int endColumn, long now) =>
        new(id, kind, name, qualifiedName, filePath, language, line, line, 0, endColumn,
            null, null, null, false, false, false, false, null, null, null, now);
}

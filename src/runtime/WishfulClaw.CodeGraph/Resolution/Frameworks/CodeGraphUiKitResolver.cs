using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphUiKitResolver — UIKit framework resolver (port of the uikitResolver half
// of frameworks/swift.ts). Contributes:
//   * resolve(): ViewController, UIView subclass, Cell, and Delegate/DataSource
//     references, preferring framework-conventional directories.
//   * extract(): `class X: UIViewController` and `class X: UIView` subclass nodes.
//
// Regex-scans raw source (comments blanked via CodeGraphStripComments). Global
// namespace, all-internal, reflection-free/AOT; fixed patterns via [GeneratedRegex].
// Shares CodeGraphSwiftFrameworkHelpers with the SwiftUI/Vapor resolvers.
// =============================================================================
internal sealed partial class CodeGraphUiKitResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] SwiftLanguages = { CodeGraphLanguage.Swift };

    private static readonly string[] VcDirs = { "/ViewControllers/", "/ViewController/", "/Controllers/", "/Screens/" };
    private static readonly string[] UiViewDirs = { "/Views/", "/View/", "/UI/", "/Components/" };
    private static readonly string[] CellDirs = { "/Cells/", "/Cell/", "/Views/", "/TableViewCells/", "/CollectionViewCells/" };

    private static readonly string[] ClassKinds = { CodeGraphNodeKind.Class };
    private static readonly string[] ProtocolKinds = { CodeGraphNodeKind.Protocol };
    private static readonly string[] NoDirs = Array.Empty<string>();

    private static readonly CodeGraphFrameworkExtraction EmptyExtraction =
        new(Array.Empty<CodeGraphNode>(), Array.Empty<CodeGraphUnresolvedReference>());

    public string Name => "uikit";

    public IReadOnlyList<string>? Languages => SwiftLanguages;

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        foreach (var file in ctx.GetAllFiles())
        {
            if (file.EndsWith(".swift", StringComparison.Ordinal))
            {
                var content = ctx.ReadFile(file);
                if (content is not null && (
                    content.Contains("import UIKit", StringComparison.Ordinal) ||
                    content.Contains("UIViewController", StringComparison.Ordinal) ||
                    content.Contains("UIView", StringComparison.Ordinal)))
                {
                    return true;
                }
            }
        }

        return false;
    }

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var name = r.ReferenceName;

        // Pattern 1: ViewController references.
        if (name.EndsWith("ViewController", StringComparison.Ordinal))
        {
            var result = CodeGraphSwiftFrameworkHelpers.ResolveByNameAndKind(name, ClassKinds, VcDirs, ctx);
            if (result is not null)
            {
                return new CodeGraphResolvedRef(result, 0.85, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 2: UIView subclass references.
        if (name.EndsWith("View", StringComparison.Ordinal) && !name.EndsWith("ViewController", StringComparison.Ordinal))
        {
            var result = CodeGraphSwiftFrameworkHelpers.ResolveByNameAndKind(name, ClassKinds, UiViewDirs, ctx);
            if (result is not null)
            {
                return new CodeGraphResolvedRef(result, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 3: Cell references.
        if (name.EndsWith("Cell", StringComparison.Ordinal))
        {
            var result = CodeGraphSwiftFrameworkHelpers.ResolveByNameAndKind(name, ClassKinds, CellDirs, ctx);
            if (result is not null)
            {
                return new CodeGraphResolvedRef(result, 0.85, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 4: Delegate/DataSource references.
        if (name.EndsWith("Delegate", StringComparison.Ordinal) || name.EndsWith("DataSource", StringComparison.Ordinal))
        {
            var result = CodeGraphSwiftFrameworkHelpers.ResolveByNameAndKind(name, ProtocolKinds, NoDirs, ctx);
            if (result is not null)
            {
                return new CodeGraphResolvedRef(result, 0.8, CodeGraphResolvedBy.Framework);
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

        // UIViewController subclasses.
        foreach (Match match in ViewControllerRegex().Matches(safe))
        {
            var vcName = match.Groups[1].Value;
            var line = CodeGraphSwiftFrameworkHelpers.LineAt(safe, match.Index);
            nodes.Add(CodeGraphSwiftFrameworkHelpers.MakeNode(
                $"viewcontroller:{filePath}:{vcName}:{line}", CodeGraphNodeKind.Class, vcName,
                $"{filePath}::{vcName}", filePath, CodeGraphLanguage.Swift, line, match.Length, now));
        }

        // UIView subclasses (UIView[^C] excludes UIViewController).
        foreach (Match match in UiViewSubclassRegex().Matches(safe))
        {
            var viewName = match.Groups[1].Value;
            var line = CodeGraphSwiftFrameworkHelpers.LineAt(safe, match.Index);
            nodes.Add(CodeGraphSwiftFrameworkHelpers.MakeNode(
                $"uiview:{filePath}:{viewName}:{line}", CodeGraphNodeKind.Class, viewName,
                $"{filePath}::{viewName}", filePath, CodeGraphLanguage.Swift, line, match.Length, now));
        }

        return new CodeGraphFrameworkExtraction(nodes, Array.Empty<CodeGraphUnresolvedReference>());
    }

    [GeneratedRegex(@"class\s+(\w+)\s*:\s*(?:\w+\s*,\s*)*UIViewController")]
    private static partial Regex ViewControllerRegex();

    [GeneratedRegex(@"class\s+(\w+)\s*:\s*(?:\w+\s*,\s*)*UIView[^C]")]
    private static partial Regex UiViewSubclassRegex();
}

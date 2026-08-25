using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphVaporResolver — Vapor (server-side Swift) framework resolver (port of the
// vaporResolver half of frameworks/swift.ts). Contributes:
//   * resolve(): Controller, Fluent Model (PascalCase), and Middleware references.
//   * extract(): builder route nodes — `<builder>.<method>([segs,] use: handler)` —
//     joining grouped-route path prefixes (`routes.grouped("todos")`,
//     `routes.group("todos") { … }`) onto each route's segments, plus a `references`
//     edge from the route to its handler.
//
// Regex-scans raw source (comments blanked via CodeGraphStripComments). Global
// namespace, all-internal, reflection-free/AOT; fixed patterns via [GeneratedRegex].
// Shares CodeGraphSwiftFrameworkHelpers with the SwiftUI/UIKit resolvers.
// =============================================================================
internal sealed partial class CodeGraphVaporResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] SwiftLanguages = { CodeGraphLanguage.Swift };

    private static readonly string[] VaporControllerDirs = { "/Controllers/", "/Controller/", "/Routes/" };
    private static readonly string[] FluentModelDirs = { "/Models/", "/Model/", "/Entities/", "/Database/" };
    private static readonly string[] VaporMiddlewareDirs = { "/Middleware/", "/Middlewares/" };

    private static readonly string[] ClassKinds = { CodeGraphNodeKind.Class };
    private static readonly string[] VaporControllerKinds = { CodeGraphNodeKind.Class, CodeGraphNodeKind.Struct };

    private static readonly CodeGraphFrameworkExtraction EmptyExtraction =
        new(Array.Empty<CodeGraphNode>(), Array.Empty<CodeGraphUnresolvedReference>());

    public string Name => "vapor";

    public IReadOnlyList<string>? Languages => SwiftLanguages;

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        var packageSwift = ctx.ReadFile("Package.swift");
        if (packageSwift is not null && packageSwift.Contains("vapor", StringComparison.Ordinal))
        {
            return true;
        }

        foreach (var file in ctx.GetAllFiles())
        {
            if (file.EndsWith(".swift", StringComparison.Ordinal))
            {
                var content = ctx.ReadFile(file);
                if (content is not null && content.Contains("import Vapor", StringComparison.Ordinal))
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

        // Pattern 1: Controller references.
        if (name.EndsWith("Controller", StringComparison.Ordinal))
        {
            var result = CodeGraphSwiftFrameworkHelpers.ResolveByNameAndKind(name, VaporControllerKinds, VaporControllerDirs, ctx);
            if (result is not null)
            {
                return new CodeGraphResolvedRef(result, 0.85, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 2: Model references (Fluent).
        if (PascalNameRegex().IsMatch(name))
        {
            var result = CodeGraphSwiftFrameworkHelpers.ResolveByNameAndKind(name, ClassKinds, FluentModelDirs, ctx);
            if (result is not null)
            {
                return new CodeGraphResolvedRef(result, 0.75, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 3: Middleware references.
        if (name.EndsWith("Middleware", StringComparison.Ordinal))
        {
            var result = CodeGraphSwiftFrameworkHelpers.ResolveByNameAndKind(name, VaporControllerKinds, VaporMiddlewareDirs, ctx);
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
        var references = new List<CodeGraphUnresolvedReference>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Swift);

        // Build a group-var -> path-prefix map first. Roots (app/routes/router) have no
        // prefix; grouped builders carry the joined segments of their group() call.
        var groupPrefix = new Dictionary<string, string>(StringComparer.Ordinal);

        // let X = Y.grouped("a", "b")
        foreach (Match gm in GroupedRegex().Matches(safe))
        {
            var existing = groupPrefix.TryGetValue(gm.Groups[2].Value, out var e) ? e : string.Empty;
            groupPrefix[gm.Groups[1].Value] = SegJoin(existing, gm.Groups[3].Value);
        }

        // Y.group("a") { X in ... }
        foreach (Match gm in GroupClosureRegex().Matches(safe))
        {
            var existing = groupPrefix.TryGetValue(gm.Groups[1].Value, out var e) ? e : string.Empty;
            groupPrefix[gm.Groups[3].Value] = SegJoin(existing, gm.Groups[2].Value);
        }

        // <builder>.METHOD([path segs,] use: handler).
        foreach (Match match in RouteRegex().Matches(safe))
        {
            var receiver = match.Groups[1].Value;
            var method = match.Groups[2].Value;
            var segsStr = match.Groups[3].Value;
            var handlerExpr = match.Groups[4].Value;
            var line = CodeGraphSwiftFrameworkHelpers.LineAt(safe, match.Index);
            var upper = method.ToUpperInvariant();

            var prefix = groupPrefix.TryGetValue(receiver, out var p) ? p : string.Empty;
            var routePath = prefix + SegJoin(string.Empty, segsStr);
            if (routePath.Length == 0)
            {
                routePath = "/";
            }

            var routeNode = CodeGraphSwiftFrameworkHelpers.MakeNode(
                $"route:{filePath}:{line}:{upper}:{routePath}", CodeGraphNodeKind.Route, $"{upper} {routePath}",
                $"{filePath}::route:{routePath}", filePath, CodeGraphLanguage.Swift, line, match.Length, now);
            nodes.Add(routeNode);

            // Last segment of a dotted handler (self.list / UserController.list -> list).
            var handlerName = LastDotSegment(handlerExpr);
            if (handlerName.Length > 0)
            {
                references.Add(new CodeGraphUnresolvedReference(
                    routeNode.Id, handlerName, CodeGraphEdgeKind.References, line, 0,
                    filePath, CodeGraphLanguage.Swift, null, null));
            }
        }

        return new CodeGraphFrameworkExtraction(nodes, references);
    }

    // segJoin(existing, segsStr): append '/'+segment for each quoted string literal in segsStr.
    private static string SegJoin(string existing, string segsStr)
    {
        var sb = new System.Text.StringBuilder(existing);
        foreach (Match m in QuotedSegRegex().Matches(segsStr))
        {
            sb.Append('/').Append(m.Groups[1].Value);
        }

        return sb.ToString();
    }

    // handlerExpr.split('.').pop() — the substring after the final '.', or the whole string.
    private static string LastDotSegment(string expr)
    {
        var idx = expr.LastIndexOf('.');
        return idx >= 0 ? expr[(idx + 1)..] : expr;
    }

    [GeneratedRegex(@"^[A-Z][a-zA-Z]+$")]
    private static partial Regex PascalNameRegex();

    [GeneratedRegex(@"\blet\s+(\w+)\s*=\s*(\w+)\.grouped\s*\(([^)]*)\)")]
    private static partial Regex GroupedRegex();

    [GeneratedRegex(@"\b(\w+)\.group\s*\(([^)]*)\)\s*\{\s*(\w+)\s+in")]
    private static partial Regex GroupClosureRegex();

    [GeneratedRegex(@"\b(\w+)\.(get|post|put|patch|delete|head|options)\s*\(\s*((?:[^,()]+,\s*)*)use:\s*([A-Za-z_][\w.]*)")]
    private static partial Regex RouteRegex();

    [GeneratedRegex("\"([^\"]*)\"")]
    private static partial Regex QuotedSegRegex();
}

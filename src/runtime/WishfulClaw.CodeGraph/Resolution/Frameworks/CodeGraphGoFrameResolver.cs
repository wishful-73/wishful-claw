using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphGoFrameResolver — GoFrame route-metadata resolver (port of
// resolution/frameworks/goframe.ts; analysis/02 §3.3, issue #747).
//
// GoFrame's "standard router" binds routes reflectively, so there is no literal path
// string at a `.GET("/x", handler)` call site. The structural facts live in a
// `g.Meta` struct tag on the request type:
//
//   type SignInReq struct {
//       g.Meta `path:"/user/sign-in" method:"post" tags:"UserService"`
//       …
//   }
//
// This resolver handles the FIRST half: it reads the `g.Meta` tag into a `route`
// node (`POST /user/sign-in`). The route → handler EDGE is the genuinely reflective
// part — the method name is NOT derivable from the request type — so the only
// reliable join is the request type appearing in the handler method's signature.
// That whole-graph join is DEFERRED to the companion goframeRouteEdges synthesizer,
// which reads the request type back out of the route node's qualifiedName (after the
// GoframeRouteMarker). This resolver therefore emits NO references of its own.
//
// Named CodeGraphGoFrameResolver (Name = "goframe"). GLOBAL namespace, all-internal,
// reflection-free/AOT; [GeneratedRegex] fixed patterns.
// =============================================================================
internal sealed partial class CodeGraphGoFrameResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] GoLanguages = { CodeGraphLanguage.Go };

    private static readonly CodeGraphFrameworkExtraction EmptyExtraction =
        new(Array.Empty<CodeGraphNode>(), Array.Empty<CodeGraphUnresolvedReference>());

    // Marker embedded in a route node's qualifiedName so the synthesizer can read back
    // the request type to join on. The value after it is the package-qualified request
    // type (`cash.ListReq`) — the package disambiguates the many identical bare names
    // (`ListReq`, `GetReq`) a large app defines. Falls back to the bare type when no
    // `package` declaration is found.
    public const string GoframeRouteMarker = "::goframe-route:";

    public string Name => "goframe";

    public IReadOnlyList<string>? Languages => GoLanguages;

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        // GoFrame is `github.com/gogf/gf` (v1) or `github.com/gogf/gf/v2` (v2).
        string? goMod = ctx.ReadFile("go.mod");
        return goMod is not null && goMod.Contains("github.com/gogf/gf", StringComparison.Ordinal);
    }

    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        if (!filePath.EndsWith(".go", StringComparison.Ordinal))
        {
            return EmptyExtraction;
        }

        // Cheap reject: the file must mention g.Meta at all.
        if (!content.Contains("g.Meta", StringComparison.Ordinal))
        {
            return EmptyExtraction;
        }

        var nodes = new List<CodeGraphNode>();
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        string safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Go);
        Match pkgMatch = PackageRegex().Match(safe);
        string? pkg = pkgMatch.Success ? pkgMatch.Groups[1].Value : null;

        foreach (Match match in MetaRegex().Matches(safe))
        {
            string requestType = match.Groups[1].Value;
            string tag = match.Groups[2].Value;

            Match pathMatch = MetaPathRegex().Match(tag);
            if (!pathMatch.Success)
            {
                continue; // response `g.Meta `mime:…`` and other non-route metadata
            }

            string routePath = pathMatch.Groups[1].Value;
            Match methodMatch = MetaMethodRegex().Match(tag);
            // GoFrame defaults to all methods when `method:` is omitted.
            string method = methodMatch.Success ? methodMatch.Groups[1].Value.ToUpperInvariant() : "ANY";
            int line = LineAt(safe, match.Index);

            // The handler's signature qualifies the request type with its package
            // (`req *cash.ListReq`); encode `pkg.Type` so the synthesizer can match it.
            string joinKey = pkg is not null ? $"{pkg}.{requestType}" : requestType;

            nodes.Add(new CodeGraphNode(
                $"route:{filePath}:{line}:{method}:{routePath}",
                CodeGraphNodeKind.Route,
                $"{method} {routePath}",
                // The request type is the synthesizer's join key — encode it after the
                // marker. The path stays human-readable in `name`.
                $"{filePath}{GoframeRouteMarker}{joinKey}",
                filePath,
                CodeGraphLanguage.Go,
                line,
                line,
                0,
                match.Length,
                null, null, null, false, false, false, false, null, null, null, now));
        }

        return new CodeGraphFrameworkExtraction(nodes, Array.Empty<CodeGraphUnresolvedReference>());
    }

    // The route → controller-method edge is reflective (request-type join across
    // files) and is built by the goframeRouteEdges synthesizer after the graph is
    // complete. This resolver creates no references of its own.
    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx) => null;

    // 1-based line of `index` (≙ safe.slice(0, index).split('\n').length).
    private static int LineAt(string s, int index)
    {
        int line = 1;
        int end = index < s.Length ? index : s.Length;
        for (int i = 0; i < end; i++)
        {
            if (s[i] == '\n')
            {
                line++;
            }
        }

        return line;
    }

    // ── Fixed patterns ([GeneratedRegex]) — verbatim from goframe.ts ────────────────

    // A request type carrying a routable `g.Meta` tag. `g.Meta` is, by convention, the
    // first embedded field, so anchoring on `struct { g.Meta `…` }` is precise + cheap.
    [GeneratedRegex(@"\btype\s+([A-Z]\w*)\s+struct\s*\{\s*g\.Meta\s+`([^`]*)`")]
    private static partial Regex MetaRegex();

    [GeneratedRegex(@"\bpath:""([^""]+)""")]
    private static partial Regex MetaPathRegex();

    [GeneratedRegex(@"\bmethod:""([^""]+)""")]
    private static partial Regex MetaMethodRegex();

    [GeneratedRegex(@"^\s*package\s+(\w+)", RegexOptions.Multiline)]
    private static partial Regex PackageRegex();
}

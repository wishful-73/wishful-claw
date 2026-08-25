using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphGoFrameRouteSynthesizer — goframeRouteEdges (goframe-synthesizer.ts:77).
// Phase.Main, gated to Go. Completes the GoFrame framework: CodeGraphGoFrameResolver
// turns each `g.Meta` tag into a `route` node whose qualifiedName encodes the request
// type (after GoframeRouteMarker), but the route -> controller-method hop is reflective
// — GoFrame binds routes with `group.Bind(...)` and the method name is FREE
// (`DeptAddReq` served by `Add`). The only reliable join is the request type appearing
// in a handler method's pointer parameter (`req *system.DeptAddReq`). This whole-graph
// pass reads the request type back out of each route node and links route -> handler.
//
// Each edge is `calls` / `heuristic` / `synthesizedBy:'goframe-route'` — a reflective-
// dispatch bridge. A project with no GoFrame routes is a no-op.
// =============================================================================
internal sealed class CodeGraphGoFrameRouteSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly string[] RequiredGo = { CodeGraphLanguage.Go };

    // FANOUT_CAP (ts:31) — backstop only; real apps are 1 route -> 1 method.
    private const int FanoutCap = 2000;

    // pointerParamTypes (ts:43) — a pointer parameter's type, qualified + bare.
    private static readonly Regex PointerParamRe =
        new(@"\*\s*(?:(\w+)\.)?([A-Z]\w*)\b", RegexOptions.ECMAScript);

    // addonRoot (ts:57) — the `addons/<name>/` module a path lives under.
    private static readonly Regex AddonRootRe =
        new(@"(?:^|/)addons/([^/]+)/", RegexOptions.ECMAScript);

    // selectHandler controller-dir preference (ts:69).
    private static readonly Regex ControllerDirRe = new(@"/controller(s)?/", RegexOptions.ECMAScript);

    public string Name => "goframe-route";

    public IReadOnlyList<string> RequiredLanguages => RequiredGo;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var scanned = 0;
        var marker = CodeGraphGoFrameResolver.GoframeRouteMarker;

        // Route nodes keyed by their package-qualified request type (`cash.ListReq`).
        // `wanted` holds every key a handler signature could match — qualified + bare.
        var routesByReqType = new Dictionary<string, List<CodeGraphNode>>(StringComparer.Ordinal);
        var wanted = new HashSet<string>(StringComparer.Ordinal);
        foreach (var route in ctx.IterateNodesByKind(CodeGraphNodeKind.Route))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (route.Language != CodeGraphLanguage.Go)
            {
                continue;
            }

            var markerIdx = route.QualifiedName.IndexOf(marker, StringComparison.Ordinal);
            if (markerIdx < 0)
            {
                continue;
            }

            var joinKey = route.QualifiedName.Substring(markerIdx + marker.Length);
            if (joinKey.Length == 0)
            {
                continue;
            }

            if (!routesByReqType.TryGetValue(joinKey, out var arr))
            {
                arr = new List<CodeGraphNode>();
                routesByReqType[joinKey] = arr;
            }

            arr.Add(route);
            wanted.Add(joinKey);
            var dot = joinKey.LastIndexOf('.');
            if (dot >= 0)
            {
                wanted.Add(joinKey.Substring(dot + 1)); // bare fallback
            }
        }

        if (routesByReqType.Count == 0)
        {
            return System.Array.Empty<CodeGraphEdge>();
        }

        // Handler candidates: Go methods whose signature takes a wanted request type by
        // pointer, indexed by every matching (qualified + bare) form.
        var handlersByKey = new Dictionary<string, List<CodeGraphNode>>(StringComparer.Ordinal);
        foreach (var method in ctx.IterateNodesByKind(CodeGraphNodeKind.Method))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (method.Language != CodeGraphLanguage.Go || string.IsNullOrEmpty(method.Signature))
            {
                continue;
            }

            foreach (var t in PointerParamTypes(method.Signature))
            {
                if (!wanted.Contains(t))
                {
                    continue;
                }

                if (!handlersByKey.TryGetValue(t, out var arr))
                {
                    arr = new List<CodeGraphNode>();
                    handlersByKey[t] = arr;
                }

                arr.Add(method);
            }
        }

        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var added = 0;
        foreach (var (joinKey, routes) in routesByReqType)
        {
            var lastDot = joinKey.LastIndexOf('.');
            var bare = lastDot >= 0 ? joinKey.Substring(lastDot + 1) : joinKey;
            // Precise package-qualified match first; bare type only as a fallback.
            if (!handlersByKey.TryGetValue(joinKey, out var candidates))
            {
                handlersByKey.TryGetValue(bare, out candidates);
            }

            if (candidates is null || candidates.Count == 0)
            {
                continue;
            }

            var requestType = bare;
            foreach (var route in routes)
            {
                var handler = SelectHandler(candidates, route.FilePath);
                if (handler is null || route.Id == handler.Id)
                {
                    continue;
                }

                var key = route.Id + ">" + handler.Id;
                if (seen.Contains(key) || added >= FanoutCap)
                {
                    continue;
                }

                seen.Add(key);
                edges.Add(new CodeGraphEdge(
                    route.Id,
                    handler.Id,
                    CodeGraphEdgeKind.Calls,
                    CodeGraphSynthesizerSupport.Metadata(
                        ("synthesizedBy", "goframe-route"),
                        ("route", route.Name),
                        ("requestType", requestType),
                        ("registeredAt", handler.FilePath + ":" + handler.StartLine)),
                    route.StartLine,
                    Column: null,
                    CodeGraphProvenance.Heuristic));
                added++;
            }
        }

        return edges;
    }

    // Pointer-parameter types in a Go signature, qualified + bare (ts:41). `*cash.ListReq`
    // -> ["cash.ListReq", "ListReq"]; the qualified form disambiguates identical bare
    // names, the bare form is the same-package fallback.
    private static List<string> PointerParamTypes(string sig)
    {
        var outList = new List<string>();
        foreach (Match m in PointerParamRe.Matches(sig))
        {
            if (m.Groups[1].Success)
            {
                outList.Add(m.Groups[1].Value + "." + m.Groups[2].Value);
            }

            outList.Add(m.Groups[2].Value);
        }

        return outList;
    }

    // The addon/plugin module a path lives under (`addons/hgexample/…` -> `hgexample`),
    // or "" for the core app (ts:56).
    private static string AddonRoot(string p)
    {
        var m = AddonRootRe.Match(p);
        return m.Success ? m.Groups[1].Value : string.Empty;
    }

    // Pick the one handler for a route from same-request-type candidates (ts:67). Usually
    // a single candidate; disambiguate a cloned addon module by controller-dir then own
    // module. Leftover ambiguity -> no edge (silent beats wrong).
    private static CodeGraphNode? SelectHandler(List<CodeGraphNode> candidates, string routeFile)
    {
        if (candidates.Count == 1)
        {
            return candidates[0];
        }

        var cands = new List<CodeGraphNode>();
        foreach (var h in candidates)
        {
            if (ControllerDirRe.IsMatch(h.FilePath))
            {
                cands.Add(h);
            }
        }

        if (cands.Count == 0)
        {
            cands = candidates;
        }

        if (cands.Count == 1)
        {
            return cands[0];
        }

        var ar = AddonRoot(routeFile);
        CodeGraphNode? only = null;
        var count = 0;
        foreach (var h in cands)
        {
            if (AddonRoot(h.FilePath) == ar)
            {
                only = h;
                count++;
            }
        }

        return count == 1 ? only : null;
    }
}

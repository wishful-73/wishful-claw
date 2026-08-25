using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphRtkQuerySynthesizer — rtkQueryEdges (callback-synthesizer.ts:2296).
// Phase.Main, JS family gate (ts:3531 has(...JS_FAMILY)). RTK Query generates one
// `useGetXQuery`/`useUpdateYMutation` hook per endpoint (`createApi({ endpoints: b =>
// ({ getX: b.query(...) }) })`); components call the hook, the fetch logic lives in the
// endpoint's queryFn. The hook<->endpoint link is pure NAMING CONVENTION (no static
// edge): strip `use` + optional `Lazy` variant + the `Query|Mutation` suffix, lowercase
// the head -> the endpoint key. Both are extracted as function nodes (the hook from its
// `export const {…}=api` binding, carrying a sentinel signature; the endpoint from the
// createApi object). Gated on the extraction sentinel so it only fires on genuinely-
// generated hooks, and on a SAME-FILE endpoint (RTK colocates hooks + api).
// =============================================================================
internal sealed class CodeGraphRtkQuerySynthesizer : ICodeGraphEdgeSynthesizer
{
    // RTK_HOOK_DERIVE_RE (ts:2281) — `use<Head>(Query|Mutation)`.
    private static readonly Regex HookDeriveRe = new(
        @"^use([A-Z][A-Za-z0-9]*?)(?:Query|Mutation)$",
        RegexOptions.ECMAScript);

    // MUST match tree-sitter.ts extractRtkHookBindings (ts:2283).
    private const string GeneratedHookSignature = "= RTK Query generated hook";

    // has(...JS_FAMILY) (ts:3480/3531).
    private static readonly string[] Required =
    {
        CodeGraphLanguage.TypeScript, CodeGraphLanguage.JavaScript,
        CodeGraphLanguage.Tsx, CodeGraphLanguage.Jsx
    };

    public string Name => "rtk-query";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var scanned = 0;
        foreach (var hook in ctx.IterateNodesByKind(CodeGraphNodeKind.Function))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            // Only our extracted generated-hook bindings (sentinel) — not a real hook fn.
            if (hook.Signature != GeneratedHookSignature)
            {
                continue;
            }

            var endpointName = EndpointNameFromHook(hook.Name);
            if (endpointName is null)
            {
                continue;
            }

            // The endpoint is a same-file function by the derived name (RTK colocates the
            // api definition and its generated-hook exports in one module).
            CodeGraphNode? target = null;
            foreach (var n in ctx.GetNodesByName(endpointName))
            {
                if (n.Kind == CodeGraphNodeKind.Function && n.FilePath == hook.FilePath)
                {
                    target = n;
                    break;
                }
            }

            if (target is null || target.Id == hook.Id)
            {
                continue;
            }

            var key = hook.Id + ">" + target.Id;
            if (!seen.Add(key))
            {
                continue;
            }

            edges.Add(new CodeGraphEdge(
                hook.Id,
                target.Id,
                CodeGraphEdgeKind.Calls,
                CodeGraphSynthesizerSupport.Metadata(
                    ("synthesizedBy", "rtk-query"),
                    ("via", endpointName),
                    ("registeredAt", hook.FilePath + ":" + hook.StartLine)),
                hook.StartLine,
                Column: null,
                CodeGraphProvenance.Heuristic));
        }

        return edges;
    }

    // rtkEndpointNameFromHook (ts:2287): `useLazyGetRecordsQuery` -> `getRecords`, or
    // null if it doesn't fit the convention.
    private static string? EndpointNameFromHook(string hook)
    {
        var m = HookDeriveRe.Match(hook);
        if (!m.Success)
        {
            return null;
        }

        var mid = m.Groups[1].Value;
        if (mid.StartsWith("Lazy", StringComparison.Ordinal))
        {
            mid = mid.Substring(4); // useLazyGetX -> getX (same endpoint)
        }

        if (mid.Length == 0)
        {
            return null;
        }

        return char.ToLowerInvariant(mid[0]) + mid.Substring(1);
    }
}

// =============================================================================
// CodeGraphGoImplementsSynthesizer — goImplementsEdges (callback-synthesizer.ts:
// 826). Phase.GoPrePass, persisted BEFORE the Main passes: the interface-dispatch
// bridge (CodeGraphInterfaceOverrideSynthesizer, now 'go'-enabled) reads
// `implements` edges from the DB, and Go has none statically (#584).
//
// Go has no `implements` keyword — a struct satisfies an interface structurally when
// its method set covers the interface's. Synthesize the missing `implements` edge
// (struct -> interface) by matching method-NAME sets. Name-only (signatures ignored):
// an over-approximation accepted in line with the other dispatch synthesizers; capped
// per interface. Empty interfaces (`any`) are skipped so they don't match every struct.
// =============================================================================
internal sealed class CodeGraphGoImplementsSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly string[] RequiredGo = { CodeGraphLanguage.Go };

    public string Name => "go-implements";

    public IReadOnlyList<string> RequiredLanguages => RequiredGo;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.GoPrePass;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var scanned = 0;

        // Materialize GO structs only (never the whole struct kind — that array is
        // O(nodes) on struct-heavy repos, #1212), then cache each one's method set.
        var goStructs = new List<CodeGraphNode>();
        foreach (var s in ctx.IterateNodesByKind(CodeGraphNodeKind.Struct))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (s.Language == CodeGraphLanguage.Go)
            {
                goStructs.Add(s);
            }
        }

        var structMethods = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (var s in goStructs)
        {
            structMethods[s.Id] = CodeGraphSynthesizerSupport.MethodNameSet(ctx, s.Id);
        }

        foreach (var iface in ctx.IterateNodesByKind(CodeGraphNodeKind.Interface))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (iface.Language != CodeGraphLanguage.Go)
            {
                continue;
            }

            var want = CodeGraphSynthesizerSupport.MethodNameSet(ctx, iface.Id);
            if (want.Count == 0)
            {
                continue; // empty interface (`any`) — would match everything
            }

            var added = 0;
            foreach (var s in goStructs)
            {
                if (added >= CodeGraphSynthesizerSupport.MaxCallbacksPerChannel)
                {
                    break;
                }

                if (!structMethods.TryGetValue(s.Id, out var have) || have.Count < want.Count)
                {
                    continue;
                }

                var all = true;
                foreach (var m in want)
                {
                    if (!have.Contains(m))
                    {
                        all = false;
                        break;
                    }
                }

                if (!all)
                {
                    continue;
                }

                var key = s.Id + ">" + iface.Id;
                if (!seen.Add(key))
                {
                    continue;
                }

                edges.Add(new CodeGraphEdge(
                    s.Id,
                    iface.Id,
                    CodeGraphEdgeKind.Implements,
                    CodeGraphSynthesizerSupport.Metadata(
                        ("synthesizedBy", "go-implements"),
                        ("via", iface.Name),
                        ("registeredAt", s.FilePath + ":" + s.StartLine)),
                    s.StartLine,
                    Column: null,
                    CodeGraphProvenance.Heuristic));
                added++;
            }
        }

        return edges;
    }
}

// =============================================================================
// CodeGraphSynthesisRunner — reproduces synthesizeCallbackEdges (callback-
// synthesizer.ts:3449) + analysis/02 §6.2. Runs once at the tail of resolution over
// the static CodeGraphEdgeSynthesizerCatalog:
//
//   1. Query GetDistinctFileLanguages ONCE (language gating, #1212).
//   2. GoPrePass synthesizers first, in catalog order — each is synthesized AND
//      PERSISTED before the next runs, because later passes read its edges
//      (goImplements derives struct method sets from goCrossFileMethodContains'
//      `contains` edges; interfaceOverride reads the `implements` edges goImplements
//      writes). Inserted in 2000-row chunks, NOT deduped against each other.
//   3. Main synthesizers, in catalog order — each returns its edges; the union is
//      merged + DEDUPED by `source>target` (catalog order = first-wins), then
//      inserted in 2000-row chunks.
//
// A pass whose RequiredLanguages is non-empty and disjoint from the present language
// set is skipped (its result is provably empty). A throwing pass is contained and
// contributes nothing — synthesis is additive/optional and must never fail the index.
//
// The cooperative-yield watchdog machinery (createYielder) is dropped: this runs off
// the IPC thread on a background Task, so a CancellationToken replaces it (§5.9).
// =============================================================================
internal static class CodeGraphSynthesisRunner
{
    private const int InsertChunkSize = 2000;

    // Returns the number of synthesized edges produced (GoPrePass counts + the merged
    // Main count), matching the TS `merged.length + goImpl.length + goMethodContains.length`.
    internal static int Run(
        CodeGraphStore store,
        CodeGraphResolutionContext ctx,
        IReadOnlyList<ICodeGraphEdgeSynthesizer> synthesizers,
        CancellationToken ct)
    {
        if (synthesizers.Count == 0)
        {
            return 0;
        }

        var langs = store.GetDistinctFileLanguages();
        var total = 0;

        // GoPrePass: catalog order, persist each before the next.
        foreach (var synthesizer in synthesizers)
        {
            if (synthesizer.Phase != CodeGraphSynthPhase.GoPrePass)
            {
                continue;
            }

            ct.ThrowIfCancellationRequested();
            if (!ShouldRun(synthesizer, langs))
            {
                continue;
            }

            var edges = SafeSynthesize(synthesizer, ctx, ct);
            InsertChunked(store, edges, ct);
            total += edges.Count;
        }

        // Main: catalog order, merge + dedupe by source>target, then insert.
        var merged = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var synthesizer in synthesizers)
        {
            if (synthesizer.Phase != CodeGraphSynthPhase.Main)
            {
                continue;
            }

            ct.ThrowIfCancellationRequested();
            if (!ShouldRun(synthesizer, langs))
            {
                continue;
            }

            foreach (var edge in SafeSynthesize(synthesizer, ctx, ct))
            {
                var key = edge.Source + ">" + edge.Target;
                if (seen.Add(key))
                {
                    merged.Add(edge);
                }
            }
        }

        InsertChunked(store, merged, ct);
        total += merged.Count;
        return total;
    }

    // Language gate (ts:3479 has(...)): empty RequiredLanguages = always run; else run
    // iff at least one required language is present in the project.
    private static bool ShouldRun(ICodeGraphEdgeSynthesizer synthesizer, IReadOnlySet<string> langs)
    {
        var required = synthesizer.RequiredLanguages;
        if (required.Count == 0)
        {
            return true;
        }

        foreach (var lang in required)
        {
            if (langs.Contains(lang))
            {
                return true;
            }
        }

        return false;
    }

    // Best-effort per-pass isolation: materialize the pass so a mid-stream throw is
    // contained here (a throwing pass must never fail the index). Cancellation
    // propagates.
    private static List<CodeGraphEdge> SafeSynthesize(
        ICodeGraphEdgeSynthesizer synthesizer,
        CodeGraphResolutionContext ctx,
        CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        try
        {
            foreach (var edge in synthesizer.Synthesize(ctx, ct))
            {
                edges.Add(edge);
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch
        {
            // A synthesizer throwing is swallowed — synthesis is additive/optional.
            return new List<CodeGraphEdge>();
        }

        return edges;
    }

    // Insert in 2000-row batched transactions (ts:3489/3593). InsertEdges already
    // skips edges whose endpoints are absent from the live nodes table.
    private static void InsertChunked(CodeGraphStore store, IReadOnlyList<CodeGraphEdge> edges, CancellationToken ct)
    {
        for (var i = 0; i < edges.Count; i += InsertChunkSize)
        {
            ct.ThrowIfCancellationRequested();
            var count = Math.Min(InsertChunkSize, edges.Count - i);
            var chunk = new List<CodeGraphEdge>(count);
            for (var j = 0; j < count; j++)
            {
                chunk.Add(edges[i + j]);
            }

            store.InsertEdges(chunk);
        }
    }
}

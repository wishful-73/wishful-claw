// =============================================================================
// CodeGraphExpoCrossPlatformSynthesizer — expoCrossPlatformEdges (callback-
// synthesizer.ts:1596). Phase.Main, ALWAYS run (empty RequiredLanguages — TS runs
// it ungated). Expo Modules cross-platform pairing: an Expo Module exposes the
// SAME JS-visible method (`AsyncFunction("getBatteryLevelAsync")`) from BOTH an
// iOS (Swift) and an Android (Kotlin) impl. A JS callsite name-resolves to only
// ONE, so the other platform's impl looked uncalled. Link the iOS and Android
// impls of the same `<module>.<method>` to each other (both directions). Expo
// method nodes are id-prefixed `expo-module:` and qualified `<file>::<module>.
// <method>` by the framework extractor.
// =============================================================================
internal sealed class CodeGraphExpoCrossPlatformSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly string[] Always = System.Array.Empty<string>();

    public string Name => "expo-cross-platform";

    public IReadOnlyList<string> RequiredLanguages => Always;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var byKey = new Dictionary<string, List<CodeGraphNode>>(StringComparer.Ordinal);
        var scanned = 0;
        foreach (var m in ctx.IterateNodesByKind(CodeGraphNodeKind.Method))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!m.Id.StartsWith("expo-module:", StringComparison.Ordinal))
            {
                continue;
            }

            var qn = m.QualifiedName;
            var sep = qn.LastIndexOf("::", StringComparison.Ordinal);
            var key = sep >= 0 ? qn[(sep + 2)..] : qn; // `<module>.<method>`
            if (key.Length == 0)
            {
                continue;
            }

            if (byKey.TryGetValue(key, out var arr))
            {
                arr.Add(m);
            }
            else
            {
                byKey[key] = new List<CodeGraphNode> { m };
            }
        }

        foreach (var group in byKey.Values)
        {
            if (group.Count < 2)
            {
                continue;
            }

            foreach (var a in group)
            {
                foreach (var b in group)
                {
                    if (a.Id == b.Id || a.Language == b.Language)
                    {
                        continue; // cross-platform only
                    }

                    var key = a.Id + ">" + b.Id;
                    if (!seen.Add(key))
                    {
                        continue;
                    }

                    edges.Add(new CodeGraphEdge(
                        a.Id,
                        b.Id,
                        CodeGraphEdgeKind.Calls,
                        CodeGraphSynthesizerSupport.Metadata(
                            ("synthesizedBy", "expo-cross-platform"),
                            ("via", a.Name)),
                        a.StartLine,
                        Column: null,
                        CodeGraphProvenance.Heuristic));
                }
            }
        }

        return edges;
    }
}

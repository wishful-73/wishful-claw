// =============================================================================
// CodeGraphFabricNativeImplSynthesizer — fabricNativeImplEdges (callback-
// synthesizer.ts:1713). Phase.Main, ALWAYS run (empty RequiredLanguages — TS runs
// it ungated). React Native Fabric/Codegen view-component bridge: the Fabric
// extractor emits `component` nodes (id-prefixed `fabric-component:`) named after
// the JS-visible component; the native impl is an ObjC++/Kotlin/Java class whose
// name follows an RN convention (exact, or a `View`/`ViewManager`/`ComponentView`/
// `Manager` suffix). Link the component → the matching native class so trace from
// JSX usage continues into native.
// =============================================================================
internal sealed class CodeGraphFabricNativeImplSynthesizer : ICodeGraphEdgeSynthesizer
{
    // FABRIC_NATIVE_SUFFIXES (ts:1583).
    private static readonly string[] NativeSuffixes = { "", "View", "ViewManager", "ComponentView", "Manager" };

    private static readonly HashSet<string> NativeLangs = new(StringComparer.Ordinal)
    {
        CodeGraphLanguage.ObjC, CodeGraphLanguage.Kotlin, CodeGraphLanguage.Java, CodeGraphLanguage.Cpp
    };

    private static readonly string[] Always = System.Array.Empty<string>();

    public string Name => "fabric-native-impl";

    public IReadOnlyList<string> RequiredLanguages => Always;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        // Filter to Fabric component nodes while streaming (never materialize the kind).
        var components = new List<CodeGraphNode>();
        var scanned = 0;
        foreach (var n in ctx.IterateNodesByKind(CodeGraphNodeKind.Component))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (n.Id.StartsWith("fabric-component:", StringComparison.Ordinal))
            {
                components.Add(n);
            }
        }

        if (components.Count == 0)
        {
            return edges;
        }

        // Pre-index native classes by name for O(1) lookup.
        var nativeClassesByName = new Dictionary<string, List<CodeGraphNode>>(StringComparer.Ordinal);
        foreach (var n in ctx.IterateNodesByKind(CodeGraphNodeKind.Class))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!NativeLangs.Contains(n.Language))
            {
                continue;
            }

            if (nativeClassesByName.TryGetValue(n.Name, out var arr))
            {
                arr.Add(n);
            }
            else
            {
                nativeClassesByName[n.Name] = new List<CodeGraphNode> { n };
            }
        }

        foreach (var component in components)
        {
            foreach (var suffix in NativeSuffixes)
            {
                var candidate = component.Name + suffix;
                if (!nativeClassesByName.TryGetValue(candidate, out var matches) || matches.Count == 0)
                {
                    continue;
                }

                foreach (var native in matches)
                {
                    var key = component.Id + ">" + native.Id;
                    if (!seen.Add(key))
                    {
                        continue;
                    }

                    edges.Add(new CodeGraphEdge(
                        component.Id,
                        native.Id,
                        CodeGraphEdgeKind.Calls,
                        CodeGraphSynthesizerSupport.Metadata(
                            ("synthesizedBy", "fabric-native-impl"),
                            ("viaSuffix", suffix.Length > 0 ? suffix : "(exact)"),
                            ("componentName", component.Name)),
                        Line: null,
                        Column: null,
                        CodeGraphProvenance.Heuristic));
                }
            }
        }

        return edges;
    }
}

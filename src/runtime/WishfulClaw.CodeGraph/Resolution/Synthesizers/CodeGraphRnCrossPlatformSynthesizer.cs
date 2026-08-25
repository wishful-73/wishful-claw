// =============================================================================
// CodeGraphRnCrossPlatformSynthesizer — rnCrossPlatformEdges (callback-
// synthesizer.ts:1645). Phase.Main, ALWAYS run (empty RequiredLanguages — TS runs
// it ungated). Classic React Native NativeModules cross-platform pairing: a native
// module method (`@ReactMethod` on Android, `RCT_EXPORT_METHOD` on iOS) is
// implemented on BOTH platforms, but a JS callsite name-resolves to only ONE. A
// native method WITH a JS caller is a confirmed bridge method; link it to the
// same-named native method in another language (both directions) so a JS call
// reaching one platform reaches the other. Names normalize to the first selector
// keyword (`getFreeDiskStorage:` → `getFreeDiskStorage`).
// =============================================================================
internal sealed class CodeGraphRnCrossPlatformSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly HashSet<string> Native = new(StringComparer.Ordinal)
    {
        CodeGraphLanguage.Java, CodeGraphLanguage.Kotlin, CodeGraphLanguage.ObjC, CodeGraphLanguage.Cpp
    };

    private static readonly HashSet<string> Js = new(StringComparer.Ordinal)
    {
        CodeGraphLanguage.TypeScript, CodeGraphLanguage.Tsx,
        CodeGraphLanguage.JavaScript, CodeGraphLanguage.Jsx
    };

    // RN module infrastructure methods (ts:1654) — called by the RN runtime, not
    // user JS; pairing them would cross-link unrelated modules.
    private static readonly HashSet<string> RnInfra = new(StringComparer.Ordinal)
    {
        "addListener", "removeListeners", "getConstants", "constantsToExport", "getName",
        "invalidate", "initialize", "getDefaultEventTypes", "supportedEvents",
        "requiresMainQueueSetup", "methodQueue"
    };

    private static readonly string[] Always = System.Array.Empty<string>();

    public string Name => "rn-cross-platform";

    public IReadOnlyList<string> RequiredLanguages => Always;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    // First selector keyword — `foo:bar:` → `foo`.
    private static string Norm(string name)
    {
        var i = name.IndexOf(':');
        return i >= 0 ? name[..i] : name;
    }

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        // Index native methods by their JS-visible (normalized) name.
        var byName = new Dictionary<string, List<CodeGraphNode>>(StringComparer.Ordinal);
        var scanned = 0;
        foreach (var m in ctx.IterateNodesByKind(CodeGraphNodeKind.Method))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!Native.Contains(m.Language))
            {
                continue;
            }

            var key = Norm(m.Name);
            if (byName.TryGetValue(key, out var arr))
            {
                arr.Add(m);
            }
            else
            {
                byName[key] = new List<CodeGraphNode> { m };
            }
        }

        foreach (var (groupName, group) in byName)
        {
            if (RnInfra.Contains(groupName))
            {
                continue;
            }

            var langs = new HashSet<string>(StringComparer.Ordinal);
            foreach (var m in group)
            {
                langs.Add(m.Language);
            }

            if (langs.Count < 2)
            {
                continue; // single-platform — nothing to pair
            }

            foreach (var m in group)
            {
                // Is m a bridge method? (a JS-language `calls` edge points at it)
                var incoming = ctx.GetIncomingEdges(m.Id, CodeGraphSynthesizerSupport.CallsEdgeKinds);
                if (incoming.Count == 0)
                {
                    continue;
                }

                var isBridge = false;
                foreach (var e in incoming)
                {
                    var s = ctx.GetNodeById(e.Source);
                    if (s is not null && Js.Contains(s.Language))
                    {
                        isBridge = true;
                        break;
                    }
                }

                if (!isBridge)
                {
                    continue;
                }

                foreach (var sib in group)
                {
                    if (sib.Id == m.Id || sib.Language == m.Language)
                    {
                        continue;
                    }

                    foreach (var (a, b) in new[] { (m, sib), (sib, m) })
                    {
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
                                ("synthesizedBy", "rn-cross-platform"),
                                ("via", Norm(m.Name))),
                            a.StartLine,
                            Column: null,
                            CodeGraphProvenance.Heuristic));
                    }
                }
            }
        }

        return edges;
    }
}

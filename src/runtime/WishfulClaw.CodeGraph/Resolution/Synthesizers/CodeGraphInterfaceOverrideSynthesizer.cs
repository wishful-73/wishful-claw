// =============================================================================
// CodeGraphInterfaceOverrideSynthesizer — interfaceOverrideEdges (callback-
// synthesizer.ts:1028). Phase.Main. Interface / abstract dispatch across the
// nominal-subtyping languages: a call through an injected interface or abstract base
// dispatches at runtime to the implementing class's override — a vtable indirection
// with no static call edge — so a request->service flow stops at the interface
// method. Bridge it: for each class/struct that `implements` an interface (or
// `extends` an abstract base), link each base/interface method -> the concrete's
// same-name method (the override) so trace/callees reach the implementation.
// Over-approximation accepted (reachability-correct); capped per class.
//
// The pass GATE (RequiredLanguages) includes tsx/jsx; the per-node language filter
// IFACE_OVERRIDE_LANGS (ts:810) deliberately does NOT — the two lists differ.
// =============================================================================
internal sealed class CodeGraphInterfaceOverrideSynthesizer : ICodeGraphEdgeSynthesizer
{
    // Run gate (ts:3519 has(...)): the nominal-subtyping languages + the JS family.
    private static readonly string[] Required =
    {
        CodeGraphLanguage.Java, CodeGraphLanguage.Kotlin, CodeGraphLanguage.CSharp,
        CodeGraphLanguage.Swift, CodeGraphLanguage.Scala, CodeGraphLanguage.Go,
        CodeGraphLanguage.Rust, CodeGraphLanguage.ArkTs, CodeGraphLanguage.TypeScript,
        CodeGraphLanguage.JavaScript, CodeGraphLanguage.Tsx, CodeGraphLanguage.Jsx
    };

    // Per-node filter (IFACE_OVERRIDE_LANGS, ts:810): languages whose static
    // implements/extends edges bridge an interface/abstract method to the matching
    // concrete method. NOTE: no tsx/jsx here (unlike the run gate above).
    private static readonly HashSet<string> IfaceOverrideLangs = new(StringComparer.Ordinal)
    {
        CodeGraphLanguage.Java, CodeGraphLanguage.Kotlin, CodeGraphLanguage.CSharp,
        CodeGraphLanguage.TypeScript, CodeGraphLanguage.JavaScript, CodeGraphLanguage.Swift,
        CodeGraphLanguage.Scala, CodeGraphLanguage.Go, CodeGraphLanguage.Rust,
        CodeGraphLanguage.ArkTs
    };

    // Concrete-side kinds (ts:1040): `class` covers Java/Kotlin/C#/TS/Swift-classes/
    // Scala-classes; `struct` covers Swift value types that conform to protocols.
    private static readonly string[] ConcreteKinds = { CodeGraphNodeKind.Class, CodeGraphNodeKind.Struct };

    public string Name => "interface-impl";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var scanned = 0;
        foreach (var kind in ConcreteKinds)
        {
            foreach (var cls in ctx.IterateNodesByKind(kind))
            {
                if ((++scanned & 63) == 0)
                {
                    ct.ThrowIfCancellationRequested();
                }

                var implMethods = new List<CodeGraphNode>();
                foreach (var m in CodeGraphSynthesizerSupport.MethodsOf(ctx, cls.Id))
                {
                    if (IfaceOverrideLangs.Contains(m.Language))
                    {
                        implMethods.Add(m);
                    }
                }

                if (implMethods.Count == 0)
                {
                    continue;
                }

                foreach (var sup in ctx.GetOutgoingEdges(cls.Id, CodeGraphSynthesizerSupport.ImplementsExtendsEdgeKinds))
                {
                    var baseNode = ctx.GetNodeById(sup.Target);
                    if (baseNode is null || !IfaceOverrideLangs.Contains(baseNode.Language) || baseNode.Id == cls.Id)
                    {
                        continue;
                    }

                    // Group impl methods by name to handle OVERLOADS: an interface
                    // `list()` and `list(params)` are distinct nodes and a call may
                    // resolve to either, so link every base overload -> every same-name
                    // impl overload (keying by name alone would drop all but one).
                    var implByName = new Dictionary<string, List<CodeGraphNode>>(StringComparer.Ordinal);
                    foreach (var m in implMethods)
                    {
                        if (implByName.TryGetValue(m.Name, out var arr))
                        {
                            arr.Add(m);
                        }
                        else
                        {
                            implByName[m.Name] = new List<CodeGraphNode> { m };
                        }
                    }

                    var added = 0;
                    foreach (var bm in CodeGraphSynthesizerSupport.MethodsOf(ctx, baseNode.Id))
                    {
                        if (added >= CodeGraphSynthesizerSupport.MaxCallbacksPerChannel)
                        {
                            break;
                        }

                        if (!implByName.TryGetValue(bm.Name, out var overloads))
                        {
                            continue;
                        }

                        foreach (var m in overloads)
                        {
                            if (added >= CodeGraphSynthesizerSupport.MaxCallbacksPerChannel)
                            {
                                break;
                            }

                            if (bm.Id == m.Id)
                            {
                                continue;
                            }

                            var key = bm.Id + ">" + m.Id;
                            if (!seen.Add(key))
                            {
                                continue;
                            }

                            edges.Add(new CodeGraphEdge(
                                bm.Id,
                                m.Id,
                                CodeGraphEdgeKind.Calls,
                                CodeGraphSynthesizerSupport.Metadata(
                                    ("synthesizedBy", "interface-impl"),
                                    ("via", m.Name),
                                    ("registeredAt", m.FilePath + ":" + m.StartLine)),
                                bm.StartLine,
                                Column: null,
                                CodeGraphProvenance.Heuristic));
                            added++;
                        }
                    }
                }
            }
        }

        return edges;
    }
}

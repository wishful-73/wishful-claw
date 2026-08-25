// =============================================================================
// CodeGraphCppOverrideSynthesizer — cppOverrideEdges (callback-synthesizer.ts:752).
// Phase.Main, gated to C++. Phase-4c C++ virtual override: a call through a
// base/interface pointer (`db->Get(...)`, `iter->Next()`) dispatches at runtime to a
// subclass override, but that hop is a vtable indirection — no static call edge — so
// a flow stops at the abstract base method. Bridge it like the interface-override /
// react-render passes: for each C++ class that `extends` a base, link each base method
// -> the subclass method of the same name (the override) so trace/callees from the
// interface method reach the implementation(s). Over-approximation accepted
// (reachability-correct); capped per class and gated to C++ so other languages'
// dispatch is untouched.
//
// Simpler than interface-override: the base method set is a plain name->method map
// (last occurrence wins — no overload grouping), and only `extends` edges bridge
// (C++ inheritance is a class extending a class/base, never an `implements`).
// =============================================================================
internal sealed class CodeGraphCppOverrideSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly string[] RequiredCpp = { CodeGraphLanguage.Cpp };

    // Only `extends` bridges here (ts:752 getOutgoingEdges(cls.id, ['extends'])).
    private static readonly string[] ExtendsEdgeKinds = { CodeGraphEdgeKind.Extends };

    public string Name => "cpp-override";

    public IReadOnlyList<string> RequiredLanguages => RequiredCpp;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var scanned = 0;
        foreach (var cls in ctx.IterateNodesByKind(CodeGraphNodeKind.Class))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            // The C++ side is filtered on the METHODS (not the class kind): a class with
            // no cpp methods contributes nothing, and the base below must be cpp too.
            var subMethods = new List<CodeGraphNode>();
            foreach (var n in CodeGraphSynthesizerSupport.MethodsOf(ctx, cls.Id))
            {
                if (n.Language == CodeGraphLanguage.Cpp)
                {
                    subMethods.Add(n);
                }
            }

            if (subMethods.Count == 0)
            {
                continue;
            }

            foreach (var ext in ctx.GetOutgoingEdges(cls.Id, ExtendsEdgeKinds))
            {
                var baseNode = ctx.GetNodeById(ext.Target);
                if (baseNode is null || baseNode.Language != CodeGraphLanguage.Cpp || baseNode.Id == cls.Id)
                {
                    continue;
                }

                // Base method name -> node (new Map(...): last occurrence wins).
                var baseByName = new Dictionary<string, CodeGraphNode>(StringComparer.Ordinal);
                foreach (var b in CodeGraphSynthesizerSupport.MethodsOf(ctx, baseNode.Id))
                {
                    baseByName[b.Name] = b;
                }

                var added = 0;
                foreach (var m in subMethods)
                {
                    if (added >= CodeGraphSynthesizerSupport.MaxCallbacksPerChannel)
                    {
                        break;
                    }

                    if (!baseByName.TryGetValue(m.Name, out var bm) || bm.Id == m.Id)
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
                            ("synthesizedBy", "cpp-override"),
                            ("via", m.Name),
                            ("registeredAt", m.FilePath + ":" + m.StartLine)),
                        bm.StartLine,
                        Column: null,
                        CodeGraphProvenance.Heuristic));
                    added++;
                }
            }
        }

        return edges;
    }
}

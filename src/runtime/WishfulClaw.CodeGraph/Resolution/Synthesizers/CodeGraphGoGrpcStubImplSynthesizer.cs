using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphGoGrpcStubImplSynthesizer — goGrpcStubImplEdges (callback-synthesizer.ts:
// 1109). Phase.Main, gated to Go. protoc emits an `UnimplementedXxxServer` stub whose
// methods every real service embeds and overrides; a gRPC dispatch reaches the stub
// method, not the hand-written impl, so a request->handler flow breaks at the scaffold.
// Bridge it: match each generated stub struct to the concrete struct whose method-NAME
// set covers the stub's RPC methods, and link stub-method -> concrete same-name method.
//
// Precision gates: the stub must live in a GENERATED file (else a hand-named
// `UnimplementedXxxServer` would bridge), the candidate must NOT be generated (its
// generated siblings — msgClient / UnsafeMsgServer — have coincidentally-matching
// method sets), and gRPC internal markers (`mustEmbed…`, `testEmbeddedByValue`) are
// excluded from the RPC signature. Name-only subset match — distinctive gRPC method
// sets give one-to-one pairing in practice; capped per pair.
// =============================================================================
internal sealed class CodeGraphGoGrpcStubImplSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly string[] RequiredGo = { CodeGraphLanguage.Go };

    // STUB_RE (ts:1114) — a protoc `Unimplemented<Service>Server` scaffold name.
    private static readonly Regex StubRe = new("^Unimplemented.*Server$", RegexOptions.ECMAScript);

    public string Name => "go-grpc-stub-impl";

    public IReadOnlyList<string> RequiredLanguages => RequiredGo;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    // gRPC helper methods present on every Unimplemented*Server — not part of the
    // service contract, so excluded from the RPC-method signature (isInternalMarker,
    // ts:1118).
    private static bool IsInternalMarker(string n) =>
        n.StartsWith("mustEmbed", StringComparison.Ordinal) || n == "testEmbeddedByValue";

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        // Methods directly contained by each Go struct, name-only. Built once.
        var methodNamesByStruct = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        var methodNodesByStruct = new Dictionary<string, List<CodeGraphNode>>(StringComparer.Ordinal);
        var goStructs = new List<CodeGraphNode>();

        var scanned = 0;
        foreach (var s in ctx.IterateNodesByKind(CodeGraphNodeKind.Struct))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (s.Language != CodeGraphLanguage.Go)
            {
                continue;
            }

            goStructs.Add(s);
            var ms = CodeGraphSynthesizerSupport.MethodsOf(ctx, s.Id);
            methodNodesByStruct[s.Id] = ms;
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var m in ms)
            {
                names.Add(m.Name);
            }

            methodNamesByStruct[s.Id] = names;
        }

        foreach (var stub in goStructs)
        {
            if (!StubRe.IsMatch(stub.Name))
            {
                continue;
            }

            // The stub MUST live in a generated file — that's what tells us this is a
            // protoc-emitted scaffold, not a hand-named `UnimplementedXxxServer`.
            if (!CodeGraphGeneratedDetection.IsGeneratedFile(stub.FilePath))
            {
                continue;
            }

            var stubMethods = new List<CodeGraphNode>();
            foreach (var m in methodNodesByStruct[stub.Id])
            {
                if (!IsInternalMarker(m.Name))
                {
                    stubMethods.Add(m);
                }
            }

            if (stubMethods.Count == 0)
            {
                continue;
            }

            foreach (var cand in goStructs)
            {
                if (cand.Id == stub.Id)
                {
                    continue;
                }

                // Skip generated candidates — they're siblings (msgClient, UnsafeMsgServer)
                // whose method sets coincidentally match.
                if (CodeGraphGeneratedDetection.IsGeneratedFile(cand.FilePath))
                {
                    continue;
                }

                if (!methodNamesByStruct.TryGetValue(cand.Id, out var candNames))
                {
                    continue;
                }

                // Subset: every RPC method must exist on the candidate by name.
                var covers = true;
                foreach (var sm in stubMethods)
                {
                    if (!candNames.Contains(sm.Name))
                    {
                        covers = false;
                        break;
                    }
                }

                if (!covers)
                {
                    continue;
                }

                var candMethods = methodNodesByStruct.TryGetValue(cand.Id, out var cm0)
                    ? cm0
                    : new List<CodeGraphNode>();
                var added = 0;
                foreach (var sm in stubMethods)
                {
                    if (added >= CodeGraphSynthesizerSupport.MaxCallbacksPerChannel)
                    {
                        break;
                    }

                    foreach (var cm in candMethods)
                    {
                        if (added >= CodeGraphSynthesizerSupport.MaxCallbacksPerChannel)
                        {
                            break;
                        }

                        if (cm.Name != sm.Name)
                        {
                            continue;
                        }

                        var key = sm.Id + ">" + cm.Id;
                        if (!seen.Add(key))
                        {
                            continue;
                        }

                        edges.Add(new CodeGraphEdge(
                            sm.Id,
                            cm.Id,
                            CodeGraphEdgeKind.Calls,
                            CodeGraphSynthesizerSupport.Metadata(
                                ("synthesizedBy", "go-grpc-stub-impl"),
                                ("via", cm.Name),
                                ("registeredAt", cm.FilePath + ":" + cm.StartLine)),
                            sm.StartLine,
                            Column: null,
                            CodeGraphProvenance.Heuristic));
                        added++;
                    }
                }
            }
        }

        return edges;
    }
}

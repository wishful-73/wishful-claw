// =============================================================================
// CodeGraphKotlinExpectActualSynthesizer — kotlinExpectActualEdges (callback-
// synthesizer.ts:987). Phase.Main, gated to kotlin. Kotlin Multiplatform
// `expect`/`actual` linking: a `common` source set declares `expect fun foo()` /
// `expect class Bar`; each platform source set provides an `actual` impl with the
// IDENTICAL fully-qualified name in a different file. Callers resolve to the
// `expect` declaration, so every `actual` ends up with zero dependents. Synthesize
// a `calls` edge common-declaration → each platform `actual` (abstract→concrete).
//
// `expect`/`actual` land on the node's `decorators` list at extraction. The decl
// side is the same-FQN, compatible-kind node that is NOT itself marked `actual`.
//
// SIMPLIFICATION vs TS: the TS pass uses a SQL `iterateNodesByLanguageWithDecorator
// ('kotlin','actual')` pre-filter (a table-wide scan by language+decorator). The C#
// store exposes no such query, so this iterates the fixed set of node kinds an
// `actual` can decorate and applies the exact `decorators.contains("actual")`
// check — same result set, no reflection.
// =============================================================================
internal sealed class CodeGraphKotlinExpectActualSynthesizer : ICodeGraphEdgeSynthesizer
{
    // KMP_TYPE_KINDS (ts:982) — kinds an expect/actual pair may straddle (e.g.
    // `expect class` fulfilled by `actual typealias`).
    private static readonly HashSet<string> KmpTypeKinds = new(StringComparer.Ordinal)
    {
        CodeGraphNodeKind.Class, CodeGraphNodeKind.Interface, CodeGraphNodeKind.Struct,
        CodeGraphNodeKind.Enum, CodeGraphNodeKind.TypeAlias
    };

    // The node kinds an `actual` declaration can appear on (stand-in for the TS
    // table-wide language+decorator scan).
    private static readonly string[] ActualBearingKinds =
    {
        CodeGraphNodeKind.Function, CodeGraphNodeKind.Method, CodeGraphNodeKind.Class,
        CodeGraphNodeKind.Interface, CodeGraphNodeKind.Struct, CodeGraphNodeKind.Enum,
        CodeGraphNodeKind.TypeAlias, CodeGraphNodeKind.Property, CodeGraphNodeKind.Field,
        CodeGraphNodeKind.Variable, CodeGraphNodeKind.Constant
    };

    private static readonly string[] Required = { CodeGraphLanguage.Kotlin };

    public string Name => "kotlin-expect-actual";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    private static bool KmpKindsCompatible(string a, string b) =>
        a == b || (KmpTypeKinds.Contains(a) && KmpTypeKinds.Contains(b));

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var scanned = 0;
        foreach (var kind in ActualBearingKinds)
        {
            foreach (var act in ctx.IterateNodesByKind(kind))
            {
                if ((++scanned & 63) == 0)
                {
                    ct.ThrowIfCancellationRequested();
                }

                if (act.Language != CodeGraphLanguage.Kotlin ||
                    act.Decorators is null || !act.Decorators.Contains("actual"))
                {
                    continue;
                }

                var added = 0;
                foreach (var cand in ctx.GetNodesByQualifiedName(act.QualifiedName))
                {
                    if (added >= CodeGraphSynthesizerSupport.MaxCallbacksPerChannel)
                    {
                        break;
                    }

                    // The declaration side: same FQN + compatible kind, a different
                    // file, NOT itself an `actual` (that's a sibling platform impl).
                    if (cand.Language != CodeGraphLanguage.Kotlin || cand.Id == act.Id)
                    {
                        continue;
                    }

                    if (!KmpKindsCompatible(cand.Kind, act.Kind) || cand.FilePath == act.FilePath)
                    {
                        continue;
                    }

                    if (cand.Decorators is not null && cand.Decorators.Contains("actual"))
                    {
                        continue;
                    }

                    var key = cand.Id + ">" + act.Id;
                    if (!seen.Add(key))
                    {
                        continue;
                    }

                    edges.Add(new CodeGraphEdge(
                        cand.Id,
                        act.Id,
                        CodeGraphEdgeKind.Calls,
                        CodeGraphSynthesizerSupport.Metadata(
                            ("synthesizedBy", "kotlin-expect-actual"),
                            ("via", act.Name),
                            ("registeredAt", act.FilePath + ":" + act.StartLine)),
                        cand.StartLine,
                        Column: null,
                        CodeGraphProvenance.Heuristic));
                    added++;
                }
            }
        }

        return edges;
    }
}

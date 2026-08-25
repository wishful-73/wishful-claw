// =============================================================================
// ICodeGraphEdgeSynthesizer — the dynamic-edge synthesizer contract (≙ the hard-listed
// passes in synthesizeCallbackEdges + analysis/02 §6.2). A synthesizer emits edges
// for framework/dynamic relationships static parsing leaves out (observer dispatch,
// UI parent->child render, interface overrides, native bridges). Runs once at the
// tail of resolution, after all base `calls` edges are persisted.
//
// AOT plug-in registration is a STATIC compile-time array (CodeGraphEdgeSynthesizerCatalog),
// never reflection. EMPTY at M3a so the resolver compiles with zero synthesizers; M3b
// adds the SynthesisRunner (GetDistinctFileLanguages gating, GoPrePass persist-before-
// next, merge/dedupe by source>target, chunked insert) + the MVP synthesizers
// (goCrossFileMethodContains, goImplements, interfaceOverride, fieldChannel,
// eventEmitter, reactRender, reactJsxChild).
// =============================================================================

// Ordering phase (analysis/02 §6.2 SynthPhase). GoPrePass synthesizers are synthesized
// AND persisted before the Main passes run (later passes read their edges). In-process
// only — never stored — so a plain enum is fine (the SQLite-boundary "no enum" rule
// does not apply here).
internal enum CodeGraphSynthPhase
{
    // Persisted before the next synthesizer runs (goCrossFileMethodContains, goImplements).
    GoPrePass,

    // Merged with all other Main results, deduped, then inserted.
    Main
}

internal interface ICodeGraphEdgeSynthesizer
{
    /// <summary>Synthesizer name — recorded in edge metadata.synthesizedBy.</summary>
    string Name { get; }

    /// <summary>Languages that MUST be present (CodeGraphLanguage.*) for this pass to
    /// run; empty = always run. A pass whose result is provably empty is skipped
    /// (checked against GetDistinctFileLanguages, #1212).</summary>
    IReadOnlyList<string> RequiredLanguages { get; }

    /// <summary>GoPrePass (persist-before-next) or Main.</summary>
    CodeGraphSynthPhase Phase { get; }

    /// <summary>Emit the synthesized edges for this pass. Best-effort; a throwing pass
    /// must never fail the index (synthesis is additive/optional).</summary>
    IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct);
}

// The static, ordered synthesizer catalog (≙ the synthesizeCallbackEdges body order).
// EMPTY at M3a; M3b appends the passes in exact run order (GoPrePass first). Ordering
// is a property of this list.
internal static class CodeGraphEdgeSynthesizerCatalog
{
    // Run order (the runner honours Phase, but list GoPrePass first for clarity):
    // Go pre-passes are synthesized + persisted before the Main passes read them.
    internal static readonly IReadOnlyList<ICodeGraphEdgeSynthesizer> All = new ICodeGraphEdgeSynthesizer[]
    {
        new CodeGraphGoMethodContainsSynthesizer(),
        new CodeGraphGoImplementsSynthesizer(),
        new CodeGraphInterfaceOverrideSynthesizer(),
        new CodeGraphFieldChannelSynthesizer(),
        new CodeGraphEventEmitterSynthesizer(),
        new CodeGraphReactRenderSynthesizer(),
        new CodeGraphReactJsxChildSynthesizer(),
        // M6 batch — state-mgmt / pub-sub / polymorphism / bridges (all Phase.Main)
        new CodeGraphReduxThunkSynthesizer(),
        new CodeGraphRtkQuerySynthesizer(),
        new CodeGraphPiniaStoreSynthesizer(),
        new CodeGraphVuexDispatchSynthesizer(),
        new CodeGraphObjectRegistrySynthesizer(),
        new CodeGraphCeleryDispatchSynthesizer(),
        new CodeGraphMediatrDispatchSynthesizer(),
        new CodeGraphCppOverrideSynthesizer(),
        new CodeGraphClosureCollectionSynthesizer(),
        new CodeGraphGinMiddlewareSynthesizer(),
        new CodeGraphGoGrpcStubImplSynthesizer(),
        new CodeGraphSidekiqDispatchSynthesizer(),
        new CodeGraphLaravelEventSynthesizer(),
        // Vue/Svelte/GoFrame/MyBatis (languages via bootstrap grammars + SFC delegation)
        new CodeGraphGoFrameRouteSynthesizer(),
        new CodeGraphMyBatisJavaXmlSynthesizer(),
        new CodeGraphVueTemplateSynthesizer(),
        new CodeGraphSvelteKitLoadSynthesizer(),
        // M7 niche synthesizers (13) — all Phase.Main, RequiredLanguages-gated, so a
        // no-op on any corpus lacking their target language.
        new CodeGraphFlutterBuildSynthesizer(),
        new CodeGraphArkUiStateBuildSynthesizer(),
        new CodeGraphArkUiEmitterSynthesizer(),
        new CodeGraphArkUiRouterSynthesizer(),
        new CodeGraphPascalFormSynthesizer(),
        new CodeGraphKotlinExpectActualSynthesizer(),
        new CodeGraphNixOptionPathSynthesizer(),
        new CodeGraphErlangBehaviourSynthesizer(),
        new CodeGraphRnEventSynthesizer(),
        new CodeGraphRnCrossPlatformSynthesizer(),
        new CodeGraphFabricNativeImplSynthesizer(),
        new CodeGraphExpoCrossPlatformSynthesizer(),
        new CodeGraphCFnPointerSynthesizer(),
        // Spring application events (Java) — event-type join, Phase.Main.
        new CodeGraphSpringEventSynthesizer()
    };
}

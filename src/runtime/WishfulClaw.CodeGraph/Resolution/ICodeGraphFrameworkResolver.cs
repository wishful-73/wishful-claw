// =============================================================================
// ICodeGraphFrameworkResolver — the framework-specific resolver contract (≙
// FrameworkResolver, resolution/types.ts:196 + analysis/02 §6.2). A detected
// framework contributes route->handler etc. edges no static parse can see. Detect()
// runs once (project-level); Resolve() is strategy 1 in the resolveOne ladder, with
// >= 0.9 an early return.
//
// AOT plug-in registration is a STATIC compile-time array (CodeGraphFrameworkResolverCatalog),
// never reflection/attribute scanning. EMPTY at M3a so the resolver compiles with
// zero frameworks; M3b populates it (react/express/nestjs/django/flask/fastapi/
// spring/rails/aspnet/laravel).
//
// Default interface methods keep a minimal resolver to just Name/Languages/Detect/
// Resolve — ClaimsReference/Extract/PostExtract are opt-in.
// =============================================================================
internal interface ICodeGraphFrameworkResolver
{
    /// <summary>Framework name (surfaced in stats / edge metadata).</summary>
    string Name { get; }

    /// <summary>Languages this framework applies to (CodeGraphLanguage.*), or null = all.</summary>
    IReadOnlyList<string>? Languages { get; }

    /// <summary>Detect whether the project uses this framework — project-level, called
    /// once after the index is populated (detectors consult the indexed file list).</summary>
    bool Detect(CodeGraphResolutionContext ctx);

    /// <summary>Resolve a reference using framework-specific patterns, or null.</summary>
    CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx);

    /// <summary>Opt a reference NAME through the name-exists pre-filter even when no
    /// node is named that (dynamic dispatch onto an attribute/descriptor). Default false.</summary>
    bool ClaimsReference(string name) => false;

    /// <summary>Extract framework-specific nodes + references from a file, or null.</summary>
    CodeGraphFrameworkExtraction? Extract(string filePath, string content) => null;

    /// <summary>Cross-file finalization run once after all extraction (and every sync);
    /// returns nodes with mutated fields the orchestrator persists via UpdateNode. The
    /// node id (and ideally qualifiedName) MUST be preserved. Default: none.</summary>
    IReadOnlyList<CodeGraphNode> PostExtract(CodeGraphResolutionContext ctx) => Array.Empty<CodeGraphNode>();
}

// Result of a framework's per-file Extract (≙ FrameworkExtractionResult, types.ts:186):
// framework nodes (routes/middleware/...) plus the unresolved references that link
// them to handlers, which flow into the normal resolution pipeline.
internal sealed record CodeGraphFrameworkExtraction(
    IReadOnlyList<CodeGraphNode> Nodes,
    IReadOnlyList<CodeGraphUnresolvedReference> References);

// The static, ordered framework-resolver catalog (≙ FRAMEWORK_RESOLVERS,
// frameworks/index.ts:36). EMPTY at M3a; M3b appends the resolver instances. Ordering
// is a property of this list — deterministic + AOT-clean.
internal static class CodeGraphFrameworkResolverCatalog
{
    // M3b MVP set (9). detectFrameworks(ctx) filters this by Detect(); resolveOne then
    // tries each detected framework's Resolve() (>=0.9 confidence early-returns).
    internal static readonly IReadOnlyList<ICodeGraphFrameworkResolver> All = new ICodeGraphFrameworkResolver[]
    {
        new CodeGraphExpressResolver(),
        new CodeGraphNestJsResolver(),
        new CodeGraphReactResolver(),
        new CodeGraphDjangoResolver(),
        new CodeGraphFlaskResolver(),
        new CodeGraphFastApiResolver(),
        new CodeGraphRailsResolver(),
        new CodeGraphSpringResolver(),
        new CodeGraphAspNetResolver(),
        new CodeGraphLaravelResolver(),
        new CodeGraphGoWebResolver(),
        new CodeGraphRustResolver(),
        new CodeGraphDrupalResolver(),
        new CodeGraphPlayResolver(),
        new CodeGraphGoFrameResolver(),
        new CodeGraphVueResolver(),
        new CodeGraphSvelteResolver(),
        new CodeGraphAstroResolver(),
        // M7 niche frameworks (9) — Languages-gated, so no-ops on projects that lack
        // their target language (swift/objc/dart/kotlin/RN/expo/terraform/cobol).
        new CodeGraphSwiftUiResolver(),
        new CodeGraphUiKitResolver(),
        new CodeGraphVaporResolver(),
        new CodeGraphSwiftObjcBridgeResolver(),
        new CodeGraphReactNativeBridgeResolver(),
        new CodeGraphExpoModulesResolver(),
        new CodeGraphFabricViewResolver(),
        new CodeGraphCicsResolver(),
        new CodeGraphTerraformResolver()
    };
}

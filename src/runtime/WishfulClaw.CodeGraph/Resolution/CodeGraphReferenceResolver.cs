using System.Buffers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphReferenceResolver — the reference-resolution ORCHESTRATOR (≙ index.ts
// ReferenceResolver). It binds each unresolved_ref to a target node via a strict
// strategy ladder (ResolveOne), persists the resulting edges, drives the
// unresolved_refs status lifecycle (pending -> delete | failed), and runs the two
// deferred passes. It is provider-/matcher-agnostic: name + import resolution are
// injected (CodeGraphNameMatcher / CodeGraphImportResolver); frameworks are a static
// catalog (EMPTY at M3a).
//
// Concurrency: runs OFF the IPC thread on a background Task; a CancellationToken
// replaces the TS cooperative-yield watchdog machinery (analysis/02 §5.9). The
// CodeGraphStore is single-threaded — do not share this resolver across threads.
// =============================================================================
internal sealed class CodeGraphReferenceResolver
{
    // The extractor's chained-receiver encoding `inner().method` (index.ts CHAIN_SHAPE).
    private static readonly Regex ChainShape = new(@"^(.+)\(\)\.(\w+)$", RegexOptions.ECMAScript);

    // PHP `$this->prop->method()` encoded as `this->prop.method` (no `()` — CHAIN_SHAPE
    // misses it) — index.ts PHP_PROP_SHAPE.
    private static readonly Regex PhpPropShape = new(@"^this->\w+\.\w+$", RegexOptions.ECMAScript);

    // `@using [static] Namespace` directive scan (index.ts getRazorUsings).
    private static readonly Regex RazorUsingRegex = new(
        @"^\s*@using\s+(?:static\s+)?([A-Za-z_][\w.]*)",
        RegexOptions.ECMAScript | RegexOptions.Multiline);

    // Trailing `.cfc` extension (case-insensitive) — index.ts resolveCfmlComponentPath.
    private static readonly Regex CfcExtension = new(@"\.cfc$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly string[] ContainsEdge = { CodeGraphEdgeKind.Contains };
    private static readonly char[] SepChars = { ':', '$' };

    // Languages whose chained static-factory/fluent calls defer to the conformance
    // pass (index.ts CHAIN_LANGUAGES / SCOPED_CHAIN_LANGUAGES).
    private static readonly HashSet<string> ChainLanguages = new(StringComparer.Ordinal)
    {
        CodeGraphLanguage.Java, CodeGraphLanguage.Kotlin, CodeGraphLanguage.CSharp,
        CodeGraphLanguage.Swift, CodeGraphLanguage.Rust, CodeGraphLanguage.Go,
        CodeGraphLanguage.Scala, CodeGraphLanguage.Dart, CodeGraphLanguage.ObjC, CodeGraphLanguage.Pascal
    };

    private static readonly HashSet<string> ScopedChainLanguages = new(StringComparer.Ordinal)
    {
        CodeGraphLanguage.Rust
    };

    private readonly CodeGraphStore store;
    private readonly CodeGraphResolutionContext context;
    private readonly CodeGraphNameMatcher nameMatcher;
    private readonly CodeGraphImportResolver importResolver;
    private readonly IReadOnlyList<ICodeGraphFrameworkResolver> frameworks;

    // All known symbol names, for the O(1) pre-filter + the Python/C/C++ builtin
    // shadow guards. null until WarmCaches (index.ts knownNames).
    private HashSet<string>? knownNames;
    private bool cachesWarmed;

    // Chained static-factory / PHP-property call refs the first pass couldn't resolve
    // (their method may live on a supertype, resolvable only once implements/extends
    // edges exist). Collected in-memory since the batched pass deletes/fails the DB
    // rows. Drained by ResolveChainedCallsViaConformance (#750).
    private readonly List<CodeGraphUnresolvedReference> deferredChainRefs = new();

    // `this.<member>` function-value refs whose member is NOT on the enclosing class
    // itself — possibly inherited. Drained by ResolveDeferredThisMemberRefs (#808).
    private readonly List<CodeGraphUnresolvedReference> deferredThisMemberRefs = new();

    // Per-.razor/.cshtml `@using` namespace set (own directives + folder _Imports.razor
    // cascade), for disambiguating a markup type ref (index.ts razorUsingsCache).
    private readonly Dictionary<string, string[]> razorUsingsCache = new(StringComparer.Ordinal);

    internal CodeGraphReferenceResolver(
        CodeGraphStore store,
        CodeGraphResolutionContext context,
        CodeGraphNameMatcher nameMatcher,
        CodeGraphImportResolver importResolver,
        IReadOnlyList<ICodeGraphFrameworkResolver>? frameworks = null)
    {
        this.store = store ?? throw new ArgumentNullException(nameof(store));
        this.context = context ?? throw new ArgumentNullException(nameof(context));
        this.nameMatcher = nameMatcher ?? throw new ArgumentNullException(nameof(nameMatcher));
        this.importResolver = importResolver ?? throw new ArgumentNullException(nameof(importResolver));
        this.frameworks = frameworks ?? Array.Empty<ICodeGraphFrameworkResolver>();
    }

    // Wire the production resolver over a store (≙ createResolver + initialize): build
    // the import resolver + name matcher + production context, then detect frameworks
    // (the catalog is EMPTY at M3a, so this yields none). Call AFTER extraction.
    internal static CodeGraphReferenceResolver Create(CodeGraphStore store, string projectRoot)
    {
        var importResolver = new CodeGraphImportResolver();
        var nameMatcher = new CodeGraphNameMatcher();
        var context = new CodeGraphStoreResolutionContext(store, projectRoot, importResolver);
        var frameworks = DetectFrameworks(context);
        return new CodeGraphReferenceResolver(store, context, nameMatcher, importResolver, frameworks);
    }

    // Pre-parse framework detection for EXTRACTION (≙ ensureDetectedFrameworks(files),
    // extraction/index.ts:1544): on a first index the files table is empty, so the
    // scanned file list is served via AllFilesOverride; detectors that read config
    // files (package.json, pom.xml, …) go to disk through ctx.ReadFile as usual.
    // The per-file framework Extract() output (route nodes + refs) merges into each
    // file's extraction result (tree-sitter.ts:6632).
    internal static IReadOnlyList<ICodeGraphFrameworkResolver> DetectFrameworksForExtraction(
        CodeGraphStore store,
        string projectRoot,
        IReadOnlyList<string>? scannedFiles = null)
    {
        if (CodeGraphFrameworkResolverCatalog.All.Count == 0)
        {
            return Array.Empty<ICodeGraphFrameworkResolver>();
        }

        var ctx = new CodeGraphStoreResolutionContext(store, projectRoot, new CodeGraphImportResolver())
        {
            AllFilesOverride = scannedFiles
        };
        return DetectFrameworks(ctx);
    }

    // Filter the static framework catalog by Detect() (≙ detectFrameworks). A detector
    // must never fail resolution.
    private static IReadOnlyList<ICodeGraphFrameworkResolver> DetectFrameworks(CodeGraphResolutionContext ctx)
    {
        List<ICodeGraphFrameworkResolver>? detected = null;
        foreach (var fw in CodeGraphFrameworkResolverCatalog.All)
        {
            try
            {
                if (fw.Detect(ctx))
                {
                    (detected ??= new List<ICodeGraphFrameworkResolver>()).Add(fw);
                }
            }
            catch
            {
                // ignore a throwing detector
            }
        }

        return detected ?? (IReadOnlyList<ICodeGraphFrameworkResolver>)Array.Empty<ICodeGraphFrameworkResolver>();
    }

    // The detected framework names (≙ getDetectedFrameworks).
    internal IReadOnlyList<string> GetDetectedFrameworks()
    {
        var names = new List<string>(frameworks.Count);
        foreach (var fw in frameworks)
        {
            names.Add(fw.Name);
        }

        return names;
    }

    // Run each framework's cross-file finalization and persist the mutated nodes
    // (≙ runPostExtract). Idempotent; caches cleared before/after. Returns nodes updated.
    internal int RunPostExtract()
    {
        var updated = 0;
        context.ClearCaches();
        foreach (var fw in frameworks)
        {
            try
            {
                foreach (var node in fw.PostExtract(context))
                {
                    store.UpdateNode(node);
                    updated++;
                }
            }
            catch
            {
                // a framework's postExtract must never fail the index
            }
        }

        if (updated > 0)
        {
            context.ClearCaches();
        }

        return updated;
    }

    // ------------------------------------------------------------------
    // Main pass — resolve + persist in batches, then the deferred passes
    // ------------------------------------------------------------------

    // Read unresolved_refs in batches (always from offset 0 — every processed ref
    // leaves the pending set), resolve each, persist edges, clean up rows by exact row
    // id, and stop on the non-progress guard. Then the [M3b] synthesis hook and the two
    // deferred passes. Runs off the IPC thread; honors `ct` (≙ resolveAndPersistBatched).
    internal CodeGraphResolutionResult ResolveAndPersistBatched(CancellationToken ct, int batchSize = 5000, Action<string>? onPhase = null)
    {
        WarmCaches();

        var byMethod = new Dictionary<string, int>(StringComparer.Ordinal);
        var aggregateTotal = 0;
        var aggregateResolved = 0;
        var aggregateUnresolved = 0;

        // Parallel fan-out (M7-W2, ≙ upstream parallel reference resolution): on a
        // large pending population, per-ref candidate matching runs on worker
        // resolvers over their own READ-ONLY connections; results are applied on THIS
        // thread in exact batch order, so writes stay single-threaded (R6) and the
        // emitted edges match the sequential path. ResolveOne is a pure read (the
        // strategies never write; the two deferral lists are merged back per batch).
        // Threads are capped well below ProcessorCount (R1 — the source-merged worker
        // shares the app's heartbeat process). Kill switch:
        // CODEGRAPH_NO_PARALLEL_RESOLVE=1; engage threshold:
        // CODEGRAPH_PARALLEL_RESOLVE_MIN (default 150k — below that the fan-out
        // costs more than it saves).
        List<CodeGraphReferenceResolver>? workers = null;
        List<CodeGraphStore>? workerStores = null;
        if (Environment.GetEnvironmentVariable("CODEGRAPH_NO_PARALLEL_RESOLVE") != "1" &&
            store.GetUnresolvedReferencesCount() >= ResolveParallelMin())
        {
            (workers, workerStores) = TryCreateResolveWorkers();
        }

        LastRunParallelWorkers = workers?.Count ?? 0;

        try
        {
            // Because we re-read from offset 0 each pass, the pending population MUST shrink
            // every iteration (resolved rows deleted, unresolvable ones marked failed). If it
            // doesn't, a keyed delete/update no-op'd — stop rather than loop forever growing
            // the graph without bound (index.ts:1369 non-progress guard).
            var prevRemaining = int.MaxValue;
            while (true)
            {
                ct.ThrowIfCancellationRequested();

                var batch = store.GetUnresolvedReferencesBatch(0, batchSize);
                if (batch.Count == 0)
                {
                    break;
                }

                var normalized = new CodeGraphUnresolvedReference[batch.Count];
                for (var i = 0; i < batch.Count; i++)
                {
                    normalized[i] = Normalize(batch[i]);
                }

                CodeGraphResolvedRef?[] results;
                if (workers is not null)
                {
                    results = ResolveBatchParallel(normalized, workers, ct);
                }
                else
                {
                    results = new CodeGraphResolvedRef?[normalized.Length];
                    for (var i = 0; i < normalized.Length; i++)
                    {
                        ct.ThrowIfCancellationRequested();
                        results[i] = ResolveOne(normalized[i]);
                    }
                }

                var resolved = new List<(CodeGraphUnresolvedReference Ref, CodeGraphResolvedRef Resolved)>();
                var unresolved = new List<CodeGraphUnresolvedReference>();
                for (var i = 0; i < normalized.Length; i++)
                {
                    var result = results[i];
                    if (result is not null)
                    {
                        resolved.Add((normalized[i], result));
                        byMethod[result.ResolvedBy] = byMethod.GetValueOrDefault(result.ResolvedBy) + 1;
                    }
                    else
                    {
                        unresolved.Add(normalized[i]);
                    }
                }

            var edges = CreateEdges(resolved);
            if (edges.Count > 0)
            {
                store.InsertEdges(edges);
            }

            // Clean up resolved refs by exact row id (a same-key sibling in a LATER batch
            // stays pending for its own attempt, #1269); park unresolvable refs 'failed'
            // so they leave the pending set but stay retryable (#1240).
            CleanupResolved(resolved);
            CleanupFailed(unresolved);

            aggregateTotal += batch.Count;
            aggregateResolved += resolved.Count;
            aggregateUnresolved += unresolved.Count;

            var remaining = store.GetUnresolvedReferencesCount();
            if (remaining >= prevRemaining)
            {
                break;
            }

            prevRemaining = remaining;
        }

        // [M3b] Dynamic-edge synthesis — once all base `calls` edges are persisted, the
        // SynthesisRunner over CodeGraphEdgeSynthesizerCatalog.All emits observer/callback/
        // override edges (GoPrePass synthesized+persisted first so later passes read their
        // edges; Main passes merged/deduped by source>target). Language-gated + best-effort
        // per-pass. Guarded on a non-empty catalog (an EMPTY catalog makes this a no-op).
        if (CodeGraphEdgeSynthesizerCatalog.All.Count > 0)
        {
            // Progress phase boundary (upstream "Linking dynamic dispatch"): on large C
            // codebases this pass dominates post-resolution wall clock, and without a
            // phase signal the caller's bar sits frozen at resolving=100%.
            onPhase?.Invoke("linking");
            var synthesized = CodeGraphSynthesisRunner.Run(store, context, CodeGraphEdgeSynthesizerCatalog.All, ct);
            if (synthesized > 0)
            {
                byMethod["synthesis"] = synthesized;
                ClearCaches();
            }
        }

        // Deferred passes — now that implements/extends edges exist, resolve chained
        // calls + inherited this.<member> refs against supertypes.
        var conformanceEdges = ResolveChainedCallsViaConformance(ct);
        if (conformanceEdges > 0)
        {
            byMethod["conformance-pass"] = conformanceEdges;
        }

        var thisMemberEdges = ResolveDeferredThisMemberRefs(ct);
        if (thisMemberEdges > 0)
        {
            byMethod["this-member-pass"] = thisMemberEdges;
        }

        return new CodeGraphResolutionResult(aggregateTotal, aggregateResolved, aggregateUnresolved, byMethod);
        }
        finally
        {
            if (workerStores is not null)
            {
                foreach (var workerStore in workerStores)
                {
                    try
                    {
                        workerStore.Dispose();
                    }
                    catch
                    {
                        // best-effort read-connection cleanup
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // Parallel batch resolution plumbing (M7-W2)
    // ------------------------------------------------------------------

    private const int DefaultParallelResolveMin = 150_000;

    // Diagnostics probe: worker count the last ResolveAndPersistBatched ran with
    // (0 = sequential). Read by tests so a silent worker-creation failure can't
    // masquerade as a passing equivalence run.
    internal int LastRunParallelWorkers { get; private set; }

    private static int ResolveParallelMin()
    {
        var raw = Environment.GetEnvironmentVariable("CODEGRAPH_PARALLEL_RESOLVE_MIN");
        return int.TryParse(raw, out var parsed) && parsed > 0 ? parsed : DefaultParallelResolveMin;
    }

    // Build the worker resolvers, each over its own READ-ONLY store connection (WAL
    // concurrent readers). Per-worker framework detection + cache warm-up are one-time
    // costs amortized over the whole run. Null on any failure — sequential path runs.
    private (List<CodeGraphReferenceResolver>?, List<CodeGraphStore>?) TryCreateResolveWorkers()
    {
        var count = Math.Clamp(Environment.ProcessorCount - 2, 2, 4);
        var workers = new List<CodeGraphReferenceResolver>(count);
        var stores = new List<CodeGraphStore>(count);
        try
        {
            var dbPath = CodeGraphDataDir.GraphDbPath(context.GetProjectRoot());
            for (var i = 0; i < count; i++)
            {
                var readStore = CodeGraphStoreFactory.OpenReadOnly(dbPath);
                stores.Add(readStore);
                var worker = Create(readStore, context.GetProjectRoot());
                worker.WarmCaches();
                workers.Add(worker);
            }

            return (workers, stores);
        }
        catch
        {
            foreach (var s in stores)
            {
                try
                {
                    s.Dispose();
                }
                catch
                {
                    // ignore
                }
            }

            return (null, null);
        }
    }

    // Contiguous-slice fan-out: worker w computes results for its slice; the caller
    // applies them in batch order on the writer thread. Deferral lists the workers
    // accumulated (chained/this-member refs for the post-passes) merge back here so
    // the MAIN resolver's deferred passes see them, exactly as the sequential path
    // would have collected them.
    private CodeGraphResolvedRef?[] ResolveBatchParallel(
        CodeGraphUnresolvedReference[] refs, List<CodeGraphReferenceResolver> workers, CancellationToken ct)
    {
        var results = new CodeGraphResolvedRef?[refs.Length];
        var k = workers.Count;
        var chunk = (refs.Length + k - 1) / k;
        var tasks = new List<Task>(k);
        for (var w = 0; w < k; w++)
        {
            var worker = workers[w];
            var start = w * chunk;
            var end = Math.Min(refs.Length, start + chunk);
            if (start >= end)
            {
                break;
            }

            tasks.Add(Task.Run(() =>
            {
                for (var i = start; i < end; i++)
                {
                    ct.ThrowIfCancellationRequested();
                    results[i] = worker.ResolveOne(refs[i]);
                }
            }, ct));
        }

        Task.WhenAll(tasks).GetAwaiter().GetResult();

        foreach (var worker in workers)
        {
            if (worker.deferredChainRefs.Count > 0)
            {
                deferredChainRefs.AddRange(worker.deferredChainRefs);
                worker.deferredChainRefs.Clear();
            }

            if (worker.deferredThisMemberRefs.Count > 0)
            {
                deferredThisMemberRefs.AddRange(worker.deferredThisMemberRefs);
                worker.deferredThisMemberRefs.Clear();
            }
        }

        return results;
    }

    // Resolve + persist an EXPLICIT list of refs (not read from the pending set) —
    // the #1240 failed-ref retry's re-resolution path (≙ resolveAndPersistList). The
    // rows may be status='failed'; CleanupResolved deletes any that now resolve by
    // exact row id, and CleanupFailed re-parks the rest (idempotent). One pass, no
    // drain loop: the caller hands a bounded, name-scoped set.
    internal void ResolveAndPersistList(IReadOnlyList<CodeGraphUnresolvedReference> references, CancellationToken ct)
    {
        if (references.Count == 0)
        {
            return;
        }

        WarmCaches();

        var resolved = new List<(CodeGraphUnresolvedReference Ref, CodeGraphResolvedRef Resolved)>();
        var unresolved = new List<CodeGraphUnresolvedReference>();
        foreach (var raw in references)
        {
            ct.ThrowIfCancellationRequested();
            var reference = Normalize(raw);
            var result = ResolveOne(reference);
            if (result is not null)
            {
                resolved.Add((reference, result));
            }
            else
            {
                unresolved.Add(reference);
            }
        }

        var edges = CreateEdges(resolved);
        if (edges.Count > 0)
        {
            store.InsertEdges(edges);
        }

        CleanupResolved(resolved);
        CleanupFailed(unresolved);
    }

    // Denormalize file/language from the source node when the row omitted them (empty
    // string / absent). "unknown" is kept (truthy in the TS `raw.language || ...`).
    private CodeGraphUnresolvedReference Normalize(CodeGraphUnresolvedReference raw)
    {
        var filePath = string.IsNullOrEmpty(raw.FilePath) ? GetFilePathFromNodeId(raw.FromNodeId) : raw.FilePath;
        var language = string.IsNullOrEmpty(raw.Language) ? GetLanguageFromNodeId(raw.FromNodeId) : raw.Language;
        return filePath == raw.FilePath && language == raw.Language
            ? raw
            : raw with { FilePath = filePath, Language = language };
    }

    // ------------------------------------------------------------------
    // Per-ref resolution — the strategy ladder (index.ts:766 resolveOne)
    // ------------------------------------------------------------------
    internal CodeGraphResolvedRef? ResolveOne(CodeGraphUnresolvedReference reference)
    {
        var name = reference.ReferenceName;
        var lang = reference.Language ?? CodeGraphLanguage.Unknown;
        var filePath = reference.FilePath ?? string.Empty;

        // 1. Skip built-in / external references.
        if (IsBuiltInOrExternal(reference))
        {
            return null;
        }

        // CFML inheritance written as a component path (#1152) — dedicated matcher,
        // gated to inheritance refs; no fallthrough on miss.
        if ((lang == CodeGraphLanguage.Cfml || lang == CodeGraphLanguage.CfScript) &&
            (reference.ReferenceKind == CodeGraphEdgeKind.Extends || reference.ReferenceKind == CodeGraphEdgeKind.Implements) &&
            (name.Contains('.') || name.Contains('/')))
        {
            return ResolveCfmlComponentPath(reference);
        }

        // 2. Fast pre-filter: skip when no symbol with this name exists AND it matches
        // no local import (re-export rename chains) AND no framework claims it. ArkTS
        // chained-attribute refs carry a leading dot; Nix path imports name a FILE.
        var existenceName = lang == CodeGraphLanguage.ArkTs && name.StartsWith('.') ? name[1..] : name;
        if (!importResolver.IsNixPathImportRef(reference) &&
            !HasAnyPossibleMatch(existenceName) &&
            !MatchesAnyImport(reference) &&
            !FrameworksClaim(name))
        {
            return null;
        }

        // 3. function_ref (#756): import first (an imported callback is the most precise
        // cross-file signal), then matchFunctionRef. `this.` values resolve only against
        // the enclosing class. Never touches framework/fuzzy strategies.
        if (reference.ReferenceKind == CodeGraphEdgeKind.FunctionRef)
        {
            if (name.StartsWith("this.", StringComparison.Ordinal))
            {
                return GateLanguage(ResolveThisMemberFnRef(reference), reference);
            }

            var viaImport = GateLanguage(importResolver.ResolveViaImport(reference, context), reference);
            if (viaImport is not null)
            {
                var target = store.GetNodeById(viaImport.TargetId);
                if (target is not null && (target.Kind == CodeGraphNodeKind.Function || target.Kind == CodeGraphNodeKind.Method))
                {
                    return viaImport;
                }
            }

            return GateLanguage(nameMatcher.MatchFunctionRef(reference, context), reference);
        }

        // 4. JVM FQN import short-circuit — resolves through the qualifiedName index,
        // unambiguous across packages.
        var jvmImport = importResolver.ResolveJvmImport(reference, context);
        if (jvmImport is not null)
        {
            return jvmImport;
        }

        // Razor/Blazor: a markup/@code type ref disambiguated through the file's @using
        // namespaces.
        if (lang == CodeGraphLanguage.Razor)
        {
            var razorResult = ResolveRazorUsing(reference);
            if (razorResult is not null)
            {
                return razorResult;
            }
        }

        var candidates = new List<CodeGraphResolvedRef>();

        // Strategy 1: framework resolvers. Cross-language `calls`/config bridges are
        // preserved; gateFrameworkLanguage only drops a type/import edge between two
        // KNOWN families. >= 0.9 returns immediately.
        foreach (var framework in frameworks)
        {
            var result = GateFrameworkLanguage(framework.Resolve(reference, context), reference);
            if (result is not null)
            {
                if (result.Confidence >= 0.9)
                {
                    return result;
                }

                candidates.Add(result);
            }
        }

        // Strategy 2: import-based resolution.
        var importResult = GateLanguage(importResolver.ResolveViaImport(reference, context), reference);
        if (importResult is not null)
        {
            if (importResult.Confidence >= 0.9)
            {
                return importResult;
            }

            candidates.Add(importResult);
        }

        // PHP include / COBOL copybook / Nix path import / Terraform: file/dir-scoped by
        // language semantics — resolve via import only, never fall back to name-matching
        // (a wrong file/module edge is worse than none, #660).
        if (importResolver.IsPhpIncludePathRef(reference) ||
            importResolver.IsCobolCopybookRef(reference) ||
            importResolver.IsNixPathImportRef(reference) ||
            lang == CodeGraphLanguage.Terraform)
        {
            return HighestConfidence(candidates);
        }

        // Strategy 3: name matching. Nix has no ambient cross-file namespace, and no
        // other language can symbolically call into a .nix binding — same-file only,
        // both directions.
        var nameResult = GateLanguage(nameMatcher.MatchReference(reference, context), reference);
        if (nameResult is not null)
        {
            var target = store.GetNodeById(nameResult.TargetId);
            if (lang == CodeGraphLanguage.Nix)
            {
                if (target is null || target.FilePath != filePath)
                {
                    nameResult = null;
                }
            }
            else if (target is not null && target.Language == CodeGraphLanguage.Nix)
            {
                nameResult = null;
            }
        }

        if (nameResult is not null)
        {
            candidates.Add(nameResult);
        }

        if (candidates.Count == 0)
        {
            // Defer a chained static-factory/fluent call, or a PHP `$this->prop->method()`,
            // whose method may live on a supertype — resolvable in the conformance pass.
            if (reference.ReferenceKind == CodeGraphEdgeKind.Calls &&
                ChainLanguages.Contains(lang) &&
                ChainShape.IsMatch(name))
            {
                deferredChainRefs.Add(reference);
            }
            else if (reference.ReferenceKind == CodeGraphEdgeKind.Calls &&
                     lang == CodeGraphLanguage.Php &&
                     PhpPropShape.IsMatch(name))
            {
                deferredChainRefs.Add(reference);
            }

            return null;
        }

        return HighestConfidence(candidates);
    }

    private bool FrameworksClaim(string name)
    {
        foreach (var fw in frameworks)
        {
            if (fw.ClaimsReference(name))
            {
                return true;
            }
        }

        return false;
    }

    // Does `reference.ReferenceName` match an import declared in its containing file?
    // (index.ts matchesAnyImport — the re-export-chain pre-filter escape.)
    private bool MatchesAnyImport(CodeGraphUnresolvedReference reference)
    {
        var imports = context.GetImportMappings(reference.FilePath ?? string.Empty, reference.Language ?? CodeGraphLanguage.Unknown);
        if (imports.Count == 0)
        {
            return false;
        }

        foreach (var imp in imports)
        {
            if (imp.LocalName == reference.ReferenceName ||
                reference.ReferenceName.StartsWith(imp.LocalName + ".", StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    private static CodeGraphResolvedRef? HighestConfidence(List<CodeGraphResolvedRef> candidates)
    {
        if (candidates.Count == 0)
        {
            return null;
        }

        var best = candidates[0];
        for (var i = 1; i < candidates.Count; i++)
        {
            if (candidates[i].Confidence > best.Confidence)
            {
                best = candidates[i];
            }
        }

        return best;
    }

    // ------------------------------------------------------------------
    // Deferred pass 2 — chained static-factory / fluent calls via conformance (#750)
    // ------------------------------------------------------------------
    internal int ResolveChainedCallsViaConformance(CancellationToken ct)
    {
        if (deferredChainRefs.Count == 0)
        {
            return 0;
        }

        var deferred = deferredChainRefs.ToArray();
        deferredChainRefs.Clear();

        // Read fresh edges: the main pass built implements/extends after these were
        // deferred, so the matchers' getSupertypes conformance walk can now see them.
        ClearCaches();

        var resolved = new List<(CodeGraphUnresolvedReference, CodeGraphResolvedRef)>();
        foreach (var reference in deferred)
        {
            ct.ThrowIfCancellationRequested();
            var lang = reference.Language ?? CodeGraphLanguage.Unknown;
            CodeGraphResolvedRef? chainMatch;
            if (lang == CodeGraphLanguage.Php && PhpPropShape.IsMatch(reference.ReferenceName))
            {
                chainMatch = nameMatcher.MatchMethodCall(reference, context);
            }
            else if (ScopedChainLanguages.Contains(lang))
            {
                chainMatch = nameMatcher.MatchScopedCallChain(reference, context);
            }
            else
            {
                chainMatch = nameMatcher.MatchDottedCallChain(reference, context);
            }

            var match = GateLanguage(chainMatch, reference);
            if (match is not null)
            {
                resolved.Add((reference, match));
            }
        }

        if (resolved.Count == 0)
        {
            return 0;
        }

        var edges = CreateEdges(resolved);
        if (edges.Count > 0)
        {
            store.InsertEdges(edges);
            ClearCaches();
        }

        return edges.Count;
    }

    // ------------------------------------------------------------------
    // Deferred pass 3 — inherited this.<member> refs (#808), node-anchored supertype BFS
    // ------------------------------------------------------------------
    internal int ResolveDeferredThisMemberRefs(CancellationToken ct)
    {
        if (deferredThisMemberRefs.Count == 0)
        {
            return 0;
        }

        var deferred = deferredThisMemberRefs.ToArray();
        deferredThisMemberRefs.Clear();

        ClearCaches();

        var resolved = new List<(CodeGraphUnresolvedReference, CodeGraphResolvedRef)>();
        foreach (var reference in deferred)
        {
            ct.ThrowIfCancellationRequested();
            var member = reference.ReferenceName["this.".Length..];
            var fromNode = store.GetNodeById(reference.FromNodeId);
            if (fromNode is null || member.Length == 0)
            {
                continue;
            }

            var lang = reference.Language ?? CodeGraphLanguage.Unknown;

            // Class-body-level hooks (Ruby) attribute to the CLASS node itself; else strip
            // the member segment to get the enclosing class name.
            string className;
            if (CodeGraphResolutionKinds.SupertypeBearing.Contains(fromNode.Kind) || fromNode.Kind == CodeGraphNodeKind.Module)
            {
                className = fromNode.Name;
            }
            else
            {
                var sep = fromNode.QualifiedName.LastIndexOf("::", StringComparison.Ordinal);
                if (sep <= 0)
                {
                    continue;
                }

                var classPrefix = fromNode.QualifiedName[..sep];
                var innerSep = classPrefix.LastIndexOf("::", StringComparison.Ordinal);
                className = innerSep >= 0 ? classPrefix[(innerSep + 2)..] : classPrefix;
            }

            // NODE-anchored frontier: the class node in the ref's own file (never a
            // same-named class elsewhere); fall back to same-family nodes of that name.
            var frontier = new List<CodeGraphNode>();
            foreach (var n in context.GetNodesByName(className))
            {
                if (CodeGraphResolutionKinds.SupertypeBearing.Contains(n.Kind) && n.FilePath == reference.FilePath)
                {
                    frontier.Add(n);
                }
            }

            if (frontier.Count == 0)
            {
                foreach (var n in context.GetNodesByName(className))
                {
                    if (CodeGraphResolutionKinds.SupertypeBearing.Contains(n.Kind) && CodeGraphLanguageFamily.SameFamily(n.Language, lang))
                    {
                        frontier.Add(n);
                    }
                }
            }

            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var n in frontier)
            {
                seen.Add(n.Id);
            }

            CodeGraphNode? target = null;
            for (var depth = 0; depth < 5 && frontier.Count > 0 && target is null; depth++)
            {
                var next = new List<CodeGraphNode>();
                foreach (var typeNode in frontier)
                {
                    foreach (var edge in store.GetOutgoingEdges(typeNode.Id, CodeGraphResolutionKinds.SupertypeEdges))
                    {
                        var superNode = store.GetNodeById(edge.Target);
                        if (superNode is null || seen.Contains(superNode.Id))
                        {
                            continue;
                        }

                        seen.Add(superNode.Id);
                        if (!CodeGraphResolutionKinds.SupertypeBearing.Contains(superNode.Kind))
                        {
                            continue;
                        }

                        // Member lookup anchored on the supertype's contains edges.
                        foreach (var containsEdge in store.GetOutgoingEdges(superNode.Id, ContainsEdge))
                        {
                            var m = store.GetNodeById(containsEdge.Target);
                            if (m is not null &&
                                m.Name == member &&
                                (m.Kind == CodeGraphNodeKind.Function || m.Kind == CodeGraphNodeKind.Method) &&
                                CodeGraphLanguageFamily.SameFamily(m.Language, lang))
                            {
                                target = m;
                                break;
                            }
                        }

                        if (target is not null)
                        {
                            break;
                        }

                        next.Add(superNode);
                    }

                    if (target is not null)
                    {
                        break;
                    }
                }

                frontier = next;
            }

            if (target is not null)
            {
                resolved.Add((reference, new CodeGraphResolvedRef(target.Id, 0.85, CodeGraphResolvedBy.FunctionRef)));
            }
        }

        if (resolved.Count == 0)
        {
            return 0;
        }

        var edges = CreateEdges(resolved);
        if (edges.Count > 0)
        {
            store.InsertEdges(edges);
            ClearCaches();
        }

        return edges.Count;
    }

    // ------------------------------------------------------------------
    // Edge construction (index.ts:948 createEdges)
    // ------------------------------------------------------------------
    private List<CodeGraphEdge> CreateEdges(
        List<(CodeGraphUnresolvedReference Ref, CodeGraphResolvedRef Resolved)> resolved)
    {
        var edges = new List<CodeGraphEdge>(resolved.Count);
        foreach (var (reference, result) in resolved)
        {
            var refKind = reference.ReferenceKind;

            // function_ref persists as a `references` edge. A framework may override the
            // edge kind explicitly; otherwise the base kind is the ref's own kind.
            var kind = result.EdgeKind ?? (refKind == CodeGraphEdgeKind.FunctionRef ? CodeGraphEdgeKind.References : refKind);

            // Promote extends -> implements when a non-interface class targets an
            // interface/protocol.
            if (kind == CodeGraphEdgeKind.Extends)
            {
                var target = store.GetNodeById(result.TargetId);
                if (target is not null && (target.Kind == CodeGraphNodeKind.Interface || target.Kind == CodeGraphNodeKind.Protocol))
                {
                    var source = store.GetNodeById(reference.FromNodeId);
                    if (source is not null && source.Kind != CodeGraphNodeKind.Interface && source.Kind != CodeGraphNodeKind.Protocol)
                    {
                        kind = CodeGraphEdgeKind.Implements;
                    }
                }
            }

            // Promote calls -> instantiates when the target is a class/struct (a `Foo()`
            // in Python/Ruby that resolves to a class IS an instantiation).
            if (kind == CodeGraphEdgeKind.Calls)
            {
                var target = store.GetNodeById(result.TargetId);
                if (target is not null && (target.Kind == CodeGraphNodeKind.Class || target.Kind == CodeGraphNodeKind.Struct))
                {
                    kind = CodeGraphEdgeKind.Instantiates;
                }
            }

            var metadata = BuildEdgeMetadata(
                result.Confidence,
                result.ResolvedBy,
                reference.ReferenceName,
                refKind != kind ? refKind : null,
                refKind == CodeGraphEdgeKind.FunctionRef);

            // Provenance is left null (resolution edges carry no tree-sitter/scip origin;
            // TS createEdges omits it — the edges.provenance column defaults NULL).
            edges.Add(new CodeGraphEdge(reference.FromNodeId, result.TargetId, kind, metadata, reference.Line, reference.Column, Provenance: null));
        }

        return edges;
    }

    // Build the edge metadata object { confidence, resolvedBy, refName, refKind?, fnRef? }
    // as a raw JSON string via Utf8JsonWriter (reflection-free, correct escaping). refKind
    // is written only when edge-kind promotion rewrote it; fnRef only for function_ref.
    private static string BuildEdgeMetadata(double confidence, string resolvedBy, string refName, string? refKind, bool fnRef)
    {
        var buffer = new ArrayBufferWriter<byte>(128);
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteNumber("confidence", confidence);
            writer.WriteString("resolvedBy", resolvedBy);
            writer.WriteString("refName", refName);
            if (refKind is not null)
            {
                writer.WriteString("refKind", refKind);
            }

            if (fnRef)
            {
                writer.WriteBoolean("fnRef", true);
            }

            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    // ------------------------------------------------------------------
    // unresolved_refs cleanup — row-id precise (#1269)
    // ------------------------------------------------------------------

    // Delete resolved rows by exact id; only pre-#1240 hand-built refs (no rowId) use
    // the key-tuple fallback.
    private void CleanupResolved(List<(CodeGraphUnresolvedReference Ref, CodeGraphResolvedRef Resolved)> resolved)
    {
        if (resolved.Count == 0)
        {
            return;
        }

        var rowIds = new List<long>();
        var legacy = new List<(string FromNodeId, string ReferenceName, string ReferenceKind)>();
        foreach (var (reference, _) in resolved)
        {
            if (reference.RowId is { } id)
            {
                rowIds.Add(id);
            }
            else
            {
                legacy.Add((reference.FromNodeId, reference.ReferenceName, reference.ReferenceKind));
            }
        }

        if (rowIds.Count > 0)
        {
            store.DeleteReferencesByRowIds(rowIds);
        }

        if (legacy.Count > 0)
        {
            store.DeleteSpecificResolvedReferences(legacy);
        }
    }

    // Park unresolvable rows 'failed' by exact id (with name_tail for the #1240 retry);
    // key-tuple fallback only for hand-built refs.
    private void CleanupFailed(List<CodeGraphUnresolvedReference> unresolved)
    {
        if (unresolved.Count == 0)
        {
            return;
        }

        var byRowId = new List<(long RowId, string ReferenceName)>();
        var legacy = new List<(string FromNodeId, string ReferenceName, string ReferenceKind)>();
        foreach (var reference in unresolved)
        {
            if (reference.RowId is { } id)
            {
                byRowId.Add((id, reference.ReferenceName));
            }
            else
            {
                legacy.Add((reference.FromNodeId, reference.ReferenceName, reference.ReferenceKind));
            }
        }

        if (byRowId.Count > 0)
        {
            store.MarkReferencesFailedByRowIds(byRowId);
        }

        if (legacy.Count > 0)
        {
            store.MarkReferencesFailed(legacy);
        }
    }

    // ------------------------------------------------------------------
    // Caches + node-id helpers
    // ------------------------------------------------------------------
    private void WarmCaches()
    {
        if (cachesWarmed)
        {
            return;
        }

        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var n in store.IterateNodeNames())
        {
            names.Add(n);
        }

        knownNames = names;
        cachesWarmed = true;
    }

    private void ClearCaches()
    {
        context.ClearCaches();
        knownNames = null;
        cachesWarmed = false;
    }

    private string GetFilePathFromNodeId(string nodeId)
    {
        var node = store.GetNodeById(nodeId);
        return node?.FilePath ?? string.Empty;
    }

    private string GetLanguageFromNodeId(string nodeId)
    {
        var node = store.GetNodeById(nodeId);
        return node?.Language ?? CodeGraphLanguage.Unknown;
    }

    // ------------------------------------------------------------------
    // Language-family gates (index.ts gateLanguage / gateFrameworkLanguage)
    // ------------------------------------------------------------------

    // Drop an import/name-strategy resolution that crosses a language family:
    // references/function_ref require the same family; imports must not cross two known ones.
    private CodeGraphResolvedRef? GateLanguage(CodeGraphResolvedRef? result, CodeGraphUnresolvedReference reference)
    {
        if (result is null)
        {
            return null;
        }

        var target = GetLanguageFromNodeId(result.TargetId);
        var refLang = reference.Language;
        if (string.IsNullOrEmpty(target) || string.IsNullOrEmpty(refLang))
        {
            return result;
        }

        if ((reference.ReferenceKind == CodeGraphEdgeKind.References || reference.ReferenceKind == CodeGraphEdgeKind.FunctionRef) &&
            !CodeGraphLanguageFamily.SameFamily(target, refLang))
        {
            return null;
        }

        if (reference.ReferenceKind == CodeGraphEdgeKind.Imports &&
            CodeGraphLanguageFamily.CrossesKnownFamily(target, refLang))
        {
            return null;
        }

        return result;
    }

    // Drop a FRAMEWORK-strategy type/import resolution that crosses two known families
    // (a coincidental name collision); leaves `calls` + config bridges untouched.
    private CodeGraphResolvedRef? GateFrameworkLanguage(CodeGraphResolvedRef? result, CodeGraphUnresolvedReference reference)
    {
        if (result is null)
        {
            return null;
        }

        if (reference.ReferenceKind != CodeGraphEdgeKind.References && reference.ReferenceKind != CodeGraphEdgeKind.Imports)
        {
            return result;
        }

        var target = GetLanguageFromNodeId(result.TargetId);
        var refLang = reference.Language;
        if (!string.IsNullOrEmpty(target) && !string.IsNullOrEmpty(refLang) &&
            CodeGraphLanguageFamily.CrossesKnownFamily(target, refLang))
        {
            return null;
        }

        return result;
    }

    // ------------------------------------------------------------------
    // this.<member> function-ref (index.ts resolveThisMemberFnRef)
    // ------------------------------------------------------------------

    // Resolve a `this.<member>` function-value ref to the ENCLOSING class's own member
    // (function/method, same file). Not on the class itself -> defer for the supertype pass.
    private CodeGraphResolvedRef? ResolveThisMemberFnRef(CodeGraphUnresolvedReference reference)
    {
        var member = reference.ReferenceName["this.".Length..];
        if (member.Length == 0)
        {
            return null;
        }

        var fromNode = store.GetNodeById(reference.FromNodeId);
        if (fromNode is null)
        {
            return null;
        }

        string classPrefix;
        if (CodeGraphResolutionKinds.SupertypeBearing.Contains(fromNode.Kind) || fromNode.Kind == CodeGraphNodeKind.Module)
        {
            classPrefix = fromNode.QualifiedName;
        }
        else
        {
            var sep = fromNode.QualifiedName.LastIndexOf("::", StringComparison.Ordinal);
            if (sep <= 0)
            {
                return null;
            }

            classPrefix = fromNode.QualifiedName[..sep];
        }

        CodeGraphNode? target = null;
        foreach (var n in context.GetNodesByQualifiedName(classPrefix + "::" + member))
        {
            if ((n.Kind == CodeGraphNodeKind.Function || n.Kind == CodeGraphNodeKind.Method) &&
                n.FilePath == reference.FilePath &&
                n.Id != reference.FromNodeId)
            {
                // Keep the earliest declaration (smallest start line).
                if (target is null || n.StartLine < target.StartLine)
                {
                    target = n;
                }
            }
        }

        if (target is null)
        {
            // Possibly INHERITED — retry in the supertype pass once edges exist.
            deferredThisMemberRefs.Add(reference);
            return null;
        }

        return new CodeGraphResolvedRef(target.Id, 0.95, CodeGraphResolvedBy.FunctionRef);
    }

    // ------------------------------------------------------------------
    // Razor @using resolution (index.ts getRazorUsings / resolveRazorUsing)
    // ------------------------------------------------------------------
    private string[] GetRazorUsings(string filePath)
    {
        if (razorUsingsCache.TryGetValue(filePath, out var cached))
        {
            return cached;
        }

        var usings = new HashSet<string>(StringComparer.Ordinal);

        void AddFrom(string? source)
        {
            if (source is null)
            {
                return;
            }

            foreach (Match m in RazorUsingRegex.Matches(source))
            {
                usings.Add(m.Groups[1].Value);
            }
        }

        AddFrom(context.ReadFile(filePath));

        // Walk up to the project root reading each level's _Imports.razor.
        var dir = filePath.Contains('/') ? filePath[..filePath.LastIndexOf('/')] : string.Empty;
        while (true)
        {
            AddFrom(context.ReadFile(dir.Length > 0 ? dir + "/_Imports.razor" : "_Imports.razor"));
            if (dir.Length == 0)
            {
                break;
            }

            var slash = dir.LastIndexOf('/');
            dir = slash >= 0 ? dir[..slash] : string.Empty;
        }

        var arr = new string[usings.Count];
        usings.CopyTo(arr);
        razorUsingsCache[filePath] = arr;
        return arr;
    }

    private CodeGraphResolvedRef? ResolveRazorUsing(CodeGraphUnresolvedReference reference)
    {
        var name = reference.ReferenceName;
        if (name.Contains('.') || name.Contains("::", StringComparison.Ordinal))
        {
            return null;
        }

        var usings = GetRazorUsings(reference.FilePath ?? string.Empty);
        if (usings.Length == 0)
        {
            return null;
        }

        var found = new Dictionary<string, CodeGraphNode>(StringComparer.Ordinal);
        foreach (var ns in usings)
        {
            foreach (var cand in context.GetNodesByQualifiedName(ns + "::" + name))
            {
                found[cand.Id] = cand;
            }
        }

        if (found.Count != 1)
        {
            return null;
        }

        foreach (var target in found.Values)
        {
            return new CodeGraphResolvedRef(target.Id, 0.9, CodeGraphResolvedBy.Import);
        }

        return null;
    }

    // ------------------------------------------------------------------
    // CFML component-path inheritance (index.ts resolveCfmlComponentPath, #1152)
    // ------------------------------------------------------------------
    private CodeGraphResolvedRef? ResolveCfmlComponentPath(CodeGraphUnresolvedReference reference)
    {
        var name = reference.ReferenceName;
        var filePath = reference.FilePath ?? string.Empty;

        // Relative form (`../base`, `./base`, `sub/thing`): resolve against the
        // referencing file's directory; exact (case-insensitive) file match.
        if (name.Contains('/'))
        {
            var rel = CfcExtension.Replace(name, string.Empty);
            var fromDir = filePath.Replace('\\', '/').Split('/');
            var parts = new List<string>();
            for (var i = 0; i < fromDir.Length - 1; i++)
            {
                parts.Add(fromDir[i]);
            }

            foreach (var seg in rel.Split('/'))
            {
                if (seg.Length == 0 || seg == ".")
                {
                    continue;
                }

                if (seg == "..")
                {
                    if (parts.Count == 0)
                    {
                        return null; // escapes the project root
                    }

                    parts.RemoveAt(parts.Count - 1);
                }
                else
                {
                    parts.Add(seg);
                }
            }

            if (parts.Count == 0)
            {
                return null;
            }

            var wantPath = NormalizeCfmlPath(string.Join('/', parts) + ".cfc");
            var className = parts[^1];
            if (className.Length == 0)
            {
                return null;
            }

            foreach (var c in CfmlCandidates(className))
            {
                if (NormalizeCfmlPath(c.FilePath) == wantPath)
                {
                    return new CodeGraphResolvedRef(c.Id, 0.95, CodeGraphResolvedBy.FilePath);
                }
            }

            return null;
        }

        // Dotted form: match by final segment, corroborated right-to-left against the
        // candidate's parent directories.
        var segments = new List<string>();
        foreach (var s in name.Split('.'))
        {
            var trimmed = s.Trim();
            if (trimmed.Length > 0)
            {
                segments.Add(trimmed);
            }
        }

        if (segments.Count < 2)
        {
            return null;
        }

        var dottedClassName = segments[^1];
        var dirSegments = segments.GetRange(0, segments.Count - 1);

        CodeGraphNode? best = null;
        var bestScore = 0;
        var tie = false;
        foreach (var cand in CfmlCandidates(dottedClassName))
        {
            var dirs = cand.FilePath.Replace('\\', '/').Split('/');
            var dirsLen = dirs.Length - 1; // slice(0, -1)
            var score = 0;
            while (score < dirSegments.Count &&
                   score < dirsLen &&
                   string.Equals(dirSegments[dirSegments.Count - 1 - score], dirs[dirsLen - 1 - score], StringComparison.OrdinalIgnoreCase))
            {
                score++;
            }

            if (score > bestScore)
            {
                best = cand;
                bestScore = score;
                tie = false;
            }
            else if (score == bestScore && score > 0)
            {
                tie = true;
            }
        }

        if (best is null || bestScore == 0 || tie)
        {
            return null;
        }

        return new CodeGraphResolvedRef(best.Id, 0.9, CodeGraphResolvedBy.QualifiedName);
    }

    private List<CodeGraphNode> CfmlCandidates(string name)
    {
        var result = new List<CodeGraphNode>();
        foreach (var n in context.GetNodesByName(name))
        {
            if ((n.Kind == CodeGraphNodeKind.Class || n.Kind == CodeGraphNodeKind.Interface) &&
                (n.Language == CodeGraphLanguage.Cfml || n.Language == CodeGraphLanguage.CfScript))
            {
                result.Add(n);
            }
        }

        return result;
    }

    private static string NormalizeCfmlPath(string path) => path.Replace('\\', '/').ToLowerInvariant();

    // ------------------------------------------------------------------
    // Built-in / external filtering (index.ts isBuiltInOrExternal)
    // ------------------------------------------------------------------
    private bool IsBuiltInOrExternal(CodeGraphUnresolvedReference reference)
    {
        var name = reference.ReferenceName;
        var lang = reference.Language ?? CodeGraphLanguage.Unknown;
        var isJsTs = lang == CodeGraphLanguage.TypeScript || lang == CodeGraphLanguage.JavaScript ||
                     lang == CodeGraphLanguage.Tsx || lang == CodeGraphLanguage.Jsx || lang == CodeGraphLanguage.ArkTs;

        if (isJsTs && CodeGraphBuiltIns.JsBuiltIns.Contains(name))
        {
            return true;
        }

        // ArkTS resource intrinsics.
        if (lang == CodeGraphLanguage.ArkTs && (name == "$r" || name == "$rawfile"))
        {
            return true;
        }

        // Common JS/TS library calls.
        if (isJsTs && (name.StartsWith("console.", StringComparison.Ordinal) ||
                       name.StartsWith("Math.", StringComparison.Ordinal) ||
                       name.StartsWith("JSON.", StringComparison.Ordinal)))
        {
            return true;
        }

        if (isJsTs && CodeGraphBuiltIns.ReactHooks.Contains(name))
        {
            return true;
        }

        // Python built-ins (bare calls only).
        if (lang == CodeGraphLanguage.Python && CodeGraphBuiltIns.PythonBuiltIns.Contains(name))
        {
            return true;
        }

        if (lang == CodeGraphLanguage.Python)
        {
            var dotIdx = name.IndexOf('.');
            if (dotIdx > 0)
            {
                var receiver = name[..dotIdx];
                var method = name[(dotIdx + 1)..];
                if (CodeGraphBuiltIns.PythonBuiltInTypes.Contains(receiver))
                {
                    return true;
                }

                // A builtin method on a non-class receiver, UNLESS the capitalized
                // receiver names a known codebase class.
                if (CodeGraphBuiltIns.PythonBuiltInMethods.Contains(method))
                {
                    var capitalized = Capitalize(receiver);
                    if (knownNames is null || !knownNames.Contains(capitalized))
                    {
                        return true;
                    }
                }
            }

            // A bare name colliding with a builtin method is only a builtin when NOTHING
            // in the codebase declares it (a Flask `def index()` is a real target).
            if (CodeGraphBuiltIns.PythonBuiltInMethods.Contains(name) && (knownNames is null || !knownNames.Contains(name)))
            {
                return true;
            }
        }

        // Go stdlib packages + builtins.
        if (lang == CodeGraphLanguage.Go)
        {
            var dotIdx = name.IndexOf('.');
            if (dotIdx > 0)
            {
                var pkg = name[..dotIdx];
                if (CodeGraphBuiltIns.GoStdlibPackages.Contains(pkg))
                {
                    return true;
                }
            }

            if (CodeGraphBuiltIns.GoBuiltIns.Contains(name))
            {
                return true;
            }
        }

        // Pascal/Delphi built-ins and standard library units.
        if (lang == CodeGraphLanguage.Pascal)
        {
            foreach (var prefix in CodeGraphBuiltIns.PascalUnitPrefixes)
            {
                if (name.StartsWith(prefix, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            if (CodeGraphBuiltIns.PascalBuiltIns.Contains(name))
            {
                return true;
            }
        }

        // C/C++ stdlib. `std::` filters unconditionally; other stdlib names are filtered
        // only when no user node shadows them.
        if (lang == CodeGraphLanguage.C || lang == CodeGraphLanguage.Cpp)
        {
            if (name.StartsWith("std::", StringComparison.Ordinal))
            {
                return true;
            }

            if (CodeGraphBuiltIns.CBuiltIns.Contains(name) || CodeGraphBuiltIns.CppBuiltIns.Contains(name))
            {
                return !HasAnyPossibleMatch(name);
            }
        }

        return false;
    }

    // ------------------------------------------------------------------
    // Fast pre-filter (index.ts hasAnyPossibleMatch)
    // ------------------------------------------------------------------
    private bool HasAnyPossibleMatch(string name)
    {
        if (knownNames is null)
        {
            return true; // no pre-filter available
        }

        if (knownNames.Contains(name))
        {
            return true;
        }

        // Dotted `obj.method` / JVM FQN `com.example.Bar`.
        var dotIdx = name.IndexOf('.');
        if (dotIdx > 0)
        {
            var receiver = name[..dotIdx];
            var member = name[(dotIdx + 1)..];
            if (knownNames.Contains(receiver) || knownNames.Contains(member))
            {
                return true;
            }

            if (knownNames.Contains(Capitalize(receiver)))
            {
                return true;
            }

            var lastDot = name.LastIndexOf('.');
            if (lastDot > dotIdx)
            {
                var tail = name[(lastDot + 1)..];
                if (tail.Length > 0 && knownNames.Contains(tail))
                {
                    return true;
                }
            }
        }

        // Scoped `Class::method` / multi-segment `a::b::c`.
        var colonIdx = name.IndexOf("::", StringComparison.Ordinal);
        if (colonIdx > 0)
        {
            var receiver = name[..colonIdx];
            var member = name[(colonIdx + 2)..];
            if (knownNames.Contains(receiver) || knownNames.Contains(member))
            {
                return true;
            }

            var lastColon = name.LastIndexOf("::", StringComparison.Ordinal);
            if (lastColon > colonIdx)
            {
                var tail = name[(lastColon + 2)..];
                if (tail.Length > 0 && knownNames.Contains(tail))
                {
                    return true;
                }
            }
        }

        // Lua/Luau method `lg:log` (single `:`); R `lg$log` ($).
        foreach (var sep in SepChars)
        {
            if (sep == ':' && name.Contains("::", StringComparison.Ordinal))
            {
                continue;
            }

            var sepIdx = name.IndexOf(sep);
            if (sepIdx > 0)
            {
                var receiver = name[..sepIdx];
                var member = name[(sepIdx + 1)..];
                if (knownNames.Contains(member) || knownNames.Contains(receiver))
                {
                    return true;
                }

                if (knownNames.Contains(Capitalize(receiver)))
                {
                    return true;
                }
            }
        }

        // Path-like `snippets/drawer-menu.liquid` — check the filename.
        var slashIdx = name.LastIndexOf('/');
        if (slashIdx > 0)
        {
            var fileName = name[(slashIdx + 1)..];
            if (knownNames.Contains(fileName))
            {
                return true;
            }
        }

        return false;
    }

    private static string Capitalize(string value) =>
        value.Length == 0 ? value : char.ToUpperInvariant(value[0]) + value[1..];
}

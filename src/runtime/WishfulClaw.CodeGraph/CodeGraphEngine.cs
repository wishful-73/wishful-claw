using System.Diagnostics;

// =============================================================================
// CodeGraphEngine — the per-project orchestration FACADE (analysis/05 §2.1-2.4,
// §3.1; port of index.ts `CodeGraph`). Holds one CodeGraphStore and wires the query
// layers over it (traverser, query manager, and — via injected factories — the file
// scanner and context builder). It owns the index/sync pipeline and projects the full
// read surface the codegraph/* RPCs are a thin projection of.
//
// Differences from the TS facade, all deliberate (analysis/05 §6):
//   * Centralized graph DB (Decision 3): ~/.wishful-claw/codegraph/<hash>/graph.db,
//     not in-repo `.codegraph/`. This eliminates the whole #925 stale-inode
//     self-heal class (reopenIfReplaced / recreate), so those are not ported. Open
//     and Init both open-or-create the centralized DB.
//   * The OS file watcher is DROPPED (§6.2): the app already watches files and drives
//     Sync(changedPaths) over the RPC. No watch()/unwatch()/pendingFiles here.
//   * Concurrency is a single in-process CodeGraphIndexLock (SemaphoreSlim) — the
//     daemon is the sole writer IN-PROCESS; cross-process (second app instance /
//     orphaned worker) write passes are excluded by CodeGraphProcessLock (§5.7).
//   * Scanning + context ranking are the two Impl slices: this facade depends on
//     ICodeGraphFileScanner + ICodeGraphContextBuilder and runs against the Noop
//     defaults until they are injected.
//
// Threading: CodeGraphStore is single-threaded; the write pipeline runs under the
// index lock and the caller must not touch this engine from two threads at once.
// =============================================================================
internal sealed class CodeGraphEngine : IDisposable
{
    // The extraction stamp this engine writes and compares against for staleness
    // (≙ extraction/extraction-version.ts EXTRACTION_VERSION). Bump in lockstep with
    // the extraction slice when its output changes; until it defines its own constant
    // this is the single source of truth for the freshness signal.
    internal const int ExtractionVersion = 25;

    // The package version stamped into indexed_with_version.
    internal const string EngineVersion = "0.0.1";

    private readonly CodeGraphStore store;
    private readonly string projectRoot;
    private readonly CodeGraphTraverser traverser;
    private readonly CodeGraphQueryManager queryManager;
    private readonly ICodeGraphFileScanner scanner;
    private readonly ICodeGraphContextBuilder contextBuilder;
    private readonly CodeGraphExtractorRegistry extractors;
    private readonly CodeGraphGrammarRegistry grammars;
    private readonly CodeGraphIndexLock indexLock = new();

    // Lazily constructed; re-created at the start of every full index/sync so a
    // just-populated file list is re-detected for frameworks (≙ resolver.initialize()).
    private CodeGraphReferenceResolver? resolver;
    private bool disposed;

    // Query-only engine over a read-only SQLite connection (the read-pool path,
    // analysis/04 §5.1). Write entrypoints throw.
    private readonly bool readOnly;

    private CodeGraphEngine(
        CodeGraphStore store,
        string projectRoot,
        CodeGraphExtractorRegistry extractors,
        CodeGraphGrammarRegistry grammars,
        ICodeGraphFileScanner scanner,
        CodeGraphContextBuilderFactory contextBuilderFactory,
        bool readOnly = false)
    {
        this.store = store;
        this.projectRoot = projectRoot;
        this.extractors = extractors;
        this.grammars = grammars;
        this.scanner = scanner;
        this.readOnly = readOnly;
        traverser = new CodeGraphTraverser(store);
        queryManager = new CodeGraphQueryManager(store);
        contextBuilder = contextBuilderFactory(store, projectRoot, traverser);
        if (!readOnly)
        {
            SeedProjectNameTokens();
        }
    }

    // ===========================================================================
    // Lifecycle
    // ===========================================================================

    // Open a project's engine, creating the centralized graph DB (and its parent dir)
    // if absent and folding the schema idempotently. The scanner defaults to the real
    // CodeGraphDirectoryScanner (git fast path + FS-walk); the context factory /
    // extractor+grammar registries default to the built-in wiring. Callers may inject
    // a Noop scanner for pure-query use or tests. (index.ts open/openSync)
    public static CodeGraphEngine Open(
        string projectRoot,
        ICodeGraphFileScanner? scanner = null,
        CodeGraphContextBuilderFactory? contextBuilderFactory = null,
        CodeGraphExtractorRegistry? extractors = null,
        CodeGraphGrammarRegistry? grammars = null)
    {
        var root = NormalizeRoot(projectRoot);
        var store = CodeGraphStoreFactory.Open(CodeGraphDataDir.GraphDbPath(root));
        try
        {
            // Stamp the root into the DB: the centralized layout keys dirs by
            // sha256(root), which is irreversible — this is what lets management
            // surfaces (codegraph/list-projects) map a graph DB back to its project.
            store.SetMetadata("project_root", root);
            return new CodeGraphEngine(
                store,
                root,
                extractors ?? CodeGraphExtractorRegistry.CreateDefault(),
                grammars ?? new CodeGraphGrammarRegistry(),
                scanner ?? CodeGraphDirectoryScanner.Instance,
                contextBuilderFactory ?? DefaultContextBuilderFactory);
        }
        catch
        {
            store.Dispose();
            throw;
        }
    }

    // Open a QUERY-ONLY companion engine on its own read-only SQLite connection —
    // the WAL concurrent-reader path (analysis/04 §5.1). Requires an existing graph
    // DB (the writer engine created it and folded the schema). Skips the open-time
    // writes (project_root stamp, name-token seed — the writer did both);
    // IndexAll/Sync/Uninitialize throw. Uses the Noop scanner: reads never scan.
    public static CodeGraphEngine OpenReadOnly(
        string projectRoot,
        CodeGraphContextBuilderFactory? contextBuilderFactory = null)
    {
        var root = NormalizeRoot(projectRoot);
        var store = CodeGraphStoreFactory.OpenReadOnly(CodeGraphDataDir.GraphDbPath(root));
        try
        {
            return new CodeGraphEngine(
                store,
                root,
                CodeGraphExtractorRegistry.CreateDefault(),
                new CodeGraphGrammarRegistry(),
                CodeGraphNoopFileScanner.Instance,
                contextBuilderFactory ?? DefaultContextBuilderFactory,
                readOnly: true);
        }
        catch
        {
            store.Dispose();
            throw;
        }
    }

    // Initialize a project's engine. In the centralized-DB model (Decision 3) there is
    // no separate `.codegraph/` dir to create, so init collapses to the same
    // open-or-create as Open — kept as a distinct entry for parity with the TS
    // init/open split. (index.ts init/initSync)
    public static CodeGraphEngine Init(
        string projectRoot,
        ICodeGraphFileScanner? scanner = null,
        CodeGraphContextBuilderFactory? contextBuilderFactory = null,
        CodeGraphExtractorRegistry? extractors = null,
        CodeGraphGrammarRegistry? grammars = null) =>
        Open(projectRoot, scanner, contextBuilderFactory, extractors, grammars);

    // Whether a graph DB already exists for this project. (index.ts isInitialized)
    public static bool IsInitialized(string projectRoot) =>
        CodeGraphDataDir.IsInitialized(NormalizeRoot(projectRoot));

    // The OS-native absolute project root this engine indexes. (index.ts getProjectRoot)
    public string ProjectRoot => projectRoot;

    // True while a write pass (index/sync) holds the lock. (index.ts isIndexing)
    public bool IsIndexing => indexLock.IsHeld;

    // Test hook: the writer connection's current wal_autocheckpoint interval, so the
    // WAL-deferral suite can assert IndexAll's bulk-index override (0) is restored
    // afterwards — the C# analog of the TS test reaching into the internal DB handle.
    internal int WalAutocheckpointForTest => CodeGraphConnectionFactory.GetWalAutocheckpoint(store.Connection);

    // Release the store connection + the lock. (index.ts close/destroy)
    public void Close() => Dispose();

    public void Dispose()
    {
        if (disposed)
        {
            return;
        }

        disposed = true;
        store.Dispose();
        indexLock.Dispose();
    }

    // Close + delete the project's whole data directory. (index.ts uninitialize)
    public void Uninitialize()
    {
        ThrowIfReadOnly();
        var root = projectRoot;
        Dispose();
        CodeGraphDataDir.Remove(root);
    }

    private void ThrowIfReadOnly()
    {
        if (readOnly)
        {
            throw new InvalidOperationException("This engine is read-only (read-pool companion); writes go through the project's writer engine.");
        }
    }

    // ===========================================================================
    // Indexing / sync
    // ===========================================================================

    // Full index: enumerate → parse+store → resolve references → stamp state/version
    // (analysis/05 §2.3). Serialized by the index lock. Never partial-writes past a
    // cancellation without recording index_state='failed'.
    public async Task<CodeGraphIndexResult> IndexAll(
        IProgress<CodeGraphIndexProgress>? progress = null,
        CancellationToken cancellationToken = default)
    {
        ThrowIfReadOnly();
        using var _ = await indexLock.AcquireAsync(cancellationToken).ConfigureAwait(false);
        // Cross-process guard: a second app instance / orphaned worker must not
        // interleave writes into the same graph.db (M7-W1, §5.7).
        using var processLock = CodeGraphProcessLock.Acquire(CodeGraphDataDir.GraphDbPath(projectRoot));
        var sw = Stopwatch.StartNew();
        var errors = new List<CodeGraphExtractionError>();

        // Defer WAL auto-checkpointing for the whole bulk run (#1231): the default
        // 1000-page interval re-writes hot pages into the main DB over and over —
        // ~95% of all disk I/O during a bulk index, a 19+min → 45s difference on
        // HDD-class storage. The valve bounds WAL growth by backfilling PASSIVEly on
        // a second connection off-thread (never blocking the writer); RunMaintenance
        // does the final fold-up before the interval is restored in the finally.
        // Kill switch: CODEGRAPH_NO_WAL_DEFER=1. Non-WAL journal modes have no WAL to
        // defer — skip. (index.ts indexAll)
        var dbPath = CodeGraphDataDir.GraphDbPath(projectRoot);
        var deferWal = Environment.GetEnvironmentVariable("CODEGRAPH_NO_WAL_DEFER") != "1"
            && CodeGraphConnectionFactory.GetJournalMode(store.Connection) == "wal";
        CodeGraphWalValve? valve = null;
        var priorAutocheckpoint = 1000;
        if (deferWal)
        {
            priorAutocheckpoint = CodeGraphConnectionFactory.GetWalAutocheckpoint(store.Connection);
            CodeGraphConnectionFactory.SetWalAutocheckpoint(store.Connection, 0);
            valve = new CodeGraphWalValve(
                dbPath,
                CodeGraphWalValve.ResolveWalValveMb(Environment.GetEnvironmentVariable("CODEGRAPH_WAL_VALVE_MB")));
            valve.Start();
        }

        var fastInit = false;
        try
        {
            // Mark in-flight BEFORE any writes so a killed run is distinguishable from a
            // completed one; clear the segment vocab (a full index repopulates it).
            TrySetMetadata("index_state", "indexing");
            try
            {
                store.ClearNameSegmentVocab();
            }
            catch
            {
                // vocab is advisory — never fail an index over it.
            }

            var before = store.GetNodeAndEdgeCount();

            // Fast-init (M7-W2, ≙ upstream fast-init): on a COMPLETELY FRESH database
            // only, trade crash-durability for speed during the bulk build —
            // synchronous=OFF (an interrupted first index is simply re-run;
            // index_state above already reads 'indexing') and FTS mirror triggers
            // dropped, with one 'rebuild' pass at the parse→resolution boundary.
            // Both are restored in this method (success AND failure paths).
            // Kill switch: CODEGRAPH_NO_FAST_INIT=1.
            fastInit = Environment.GetEnvironmentVariable("CODEGRAPH_NO_FAST_INIT") != "1" &&
                before.Nodes == 0 && before.Edges == 0;
            if (fastInit)
            {
                try
                {
                    CodeGraphConnectionFactory.SetSynchronous(store.Connection, "OFF");
                    store.BeginFtsBulk();
                }
                catch
                {
                    fastInit = false; // both are pure accelerations — index normally
                }
            }

            // 1. Enumerate (scanning slice; Noop discovers nothing).
            progress?.Report(new CodeGraphIndexProgress("scanning", 0, 0));
            var config = CodeGraphProjectConfig.Load(projectRoot);
            var scanned = scanner.EnumerateFiles(projectRoot, config);
            var discovered = scanned.Count;

            // 2. Read bytes + parse/store each file. The valve's Backpressure pauses the
            //    writer between files if the WAL blows past its hard cap.
            progress?.Report(new CodeGraphIndexProgress("indexing", 0, discovered));

            // Pre-parse framework detection (≙ ensureDetectedFrameworks(files),
            // extraction/index.ts:1544): detectors see the SCANNED file list (the files
            // table is still empty on a first index) and read config files from disk.
            // The detected set feeds per-file framework Extract() during parse.
            var scannedPaths = new List<string>(scanned.Count);
            foreach (var sf in scanned)
            {
                scannedPaths.Add(sf.Path);
            }
            var extractionFrameworks = CodeGraphReferenceResolver.DetectFrameworksForExtraction(
                store, projectRoot, scannedPaths);

            var files = ReadFiles(scanned, errors);
            var indexResult = await CodeGraphIndexer.IndexFilesAsync(
                store,
                files,
                extractors,
                grammars,
                valve is null ? null : valve.Backpressure,
                cancellationToken,
                extractionFrameworks).ConfigureAwait(false);
            errors.AddRange(indexResult.Errors);

            // Re-arm the FTS triggers at the parse→resolution boundary: resolution and
            // the framework passes may insert route/component nodes, which must mirror
            // into nodes_fts per-row again. One 'rebuild' covers the whole bulk phase.
            if (fastInit)
            {
                store.EndFtsBulk();
            }

            // Fold the parse phase's WAL BEFORE the first post-parse reads (resolver
            // re-init + resolution both read on the writer thread): paging a bulk-
            // write-sized WAL there is the #1231 stall. Off-thread + awaited.
            if (valve is not null)
            {
                await valve.FoldNowAsync().ConfigureAwait(false);
            }

            // 3. Resolve references (frameworks re-detected now that files exist).
            if (indexResult.FilesIndexed > 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
                resolver = CodeGraphReferenceResolver.Create(store, projectRoot);
                resolver.RunPostExtract();

                var pending = store.GetUnresolvedReferencesCount();
                progress?.Report(new CodeGraphIndexProgress("resolving", 0, pending));
                resolver.ResolveAndPersistBatched(
                    cancellationToken,
                    onPhase: phase => progress?.Report(new CodeGraphIndexProgress(phase, 0, 0)));
                progress?.Report(new CodeGraphIndexProgress("resolving", pending, pending));

                // Refresh planner stats + fold the WAL after the bulk writes. Quiesce
                // the valve first so its in-flight checkpoint and the maintenance
                // checkpoint don't contend for the checkpointer lock. Off-thread; never
                // load-bearing for correctness.
                if (valve is not null)
                {
                    valve.Stop();
                    await valve.DrainAsync().ConfigureAwait(false);
                }

                await CodeGraphConnectionFactory.RunMaintenanceAsync(dbPath).ConfigureAwait(false);
            }

            // 4. Recompute node/edge deltas against the DB (resolution + synthesizer
            //    edges land after the extraction counts) and stamp the index. The
            //    version stamps advance ONLY on a real index that touched files (a
            //    sync must not advance them); index_state is set unconditionally.
            var after = store.GetNodeAndEdgeCount();
            if (indexResult.FilesIndexed > 0)
            {
                TrySetMetadata("indexed_with_version", EngineVersion);
                TrySetMetadata("indexed_with_extraction_version", ExtractionVersion.ToString(System.Globalization.CultureInfo.InvariantCulture));
            }

            TrySetMetadata("index_files_discovered", discovered.ToString(System.Globalization.CultureInfo.InvariantCulture));
            TrySetMetadata("index_state", "complete");

            progress?.Report(new CodeGraphIndexProgress("complete", discovered, discovered));
            return new CodeGraphIndexResult(
                indexResult.FilesIndexed,
                after.Nodes - before.Nodes,
                after.Edges - before.Edges,
                store.GetUnresolvedReferencesCount(),
                sw.Elapsed.TotalMilliseconds,
                errors);
        }
        catch
        {
            TrySetMetadata("index_state", "failed");
            throw;
        }
        finally
        {
            // Restore the auto-checkpoint interval AFTER the fold-up so the next
            // ordinary write doesn't inherit a giant inline checkpoint. On the error
            // path the WAL may still be large; correctness is unchanged (SQLite
            // replays it on the next open). Stop+drain are idempotent — the success
            // path already quiesced the valve before maintenance.
            if (valve is not null)
            {
                valve.Stop();
                await valve.DrainAsync().ConfigureAwait(false);
            }

            if (deferWal)
            {
                try
                {
                    CodeGraphConnectionFactory.SetWalAutocheckpoint(store.Connection, priorAutocheckpoint);
                }
                catch
                {
                    // connection may be closing — best-effort restore
                }
            }

            // Fast-init restoration. The success path already re-armed the FTS
            // triggers at the parse→resolution boundary (EndFtsBulk is a no-op then);
            // this covers the error path so a later sync's writes keep mirroring into
            // nodes_fts. synchronous returns to NORMAL either way.
            if (fastInit)
            {
                try
                {
                    store.EndFtsBulk();
                }
                catch
                {
                    // rebuild is redundant after a failed index — the re-run redoes it
                }

                try
                {
                    CodeGraphConnectionFactory.SetSynchronous(store.Connection, "NORMAL");
                }
                catch
                {
                    // connection may be closing — best-effort restore
                }
            }
        }
    }

    // Incremental sync (analysis/05 §2.4). `changedPaths` (project-relative posix) is
    // the git/app fast path — re-index exactly those files (or DeleteFile a vanished
    // one); null re-scans the whole tree and diffs by content hash (CodeGraphIndexer
    // skips unchanged files whose content_hash matches). Re-resolution: the batched
    // pending sweep (orphan-sweep, #1187) runs whenever files changed OR pending refs
    // linger from an interrupted pass — so a bare sync is the recovery command; on the
    // scoped fast path it is preceded by the #1240 failed-ref retry (previously-failed
    // refs in unchanged files that the changed files' new symbols can now satisfy). The
    // TS git-scoped narrowing of the main pass (resolveAndPersist over only changed
    // files' rows) is a perf optimization only — the batched pass is a correct superset.
    public async Task<CodeGraphSyncResult> Sync(
        IReadOnlyList<string>? changedPaths = null,
        CancellationToken cancellationToken = default)
    {
        ThrowIfReadOnly();
        using var _ = await indexLock.AcquireAsync(cancellationToken).ConfigureAwait(false);
        // Cross-process guard (M7-W1, §5.7) — same as IndexAll.
        using var processLock = CodeGraphProcessLock.Acquire(CodeGraphDataDir.GraphDbPath(projectRoot));
        var sw = Stopwatch.StartNew();
        var before = store.GetNodeAndEdgeCount();
        var added = 0;
        var modified = 0;
        var removed = 0;

        // Detected frameworks for per-file Extract() on re-indexed files (≙ index.ts:2140
        // threading frameworkNames into the sync extract). Store-backed detection is fine
        // here — the files table is populated; lazy so a no-change sync never pays it.
        var syncFrameworks = new Lazy<IReadOnlyList<ICodeGraphFrameworkResolver>>(
            () => CodeGraphReferenceResolver.DetectFrameworksForExtraction(store, projectRoot));

        // Files this scoped sync actually (re-)wrote — the #1240 retry looks up the
        // symbol names they now carry so previously-failed refs in UNCHANGED files
        // can be revisited. Only meaningful on the changedPaths fast path (a full
        // rescan re-indexes every file, regenerating all refs as pending anyway).
        var touchedPaths = new List<string>();

        if (changedPaths is not null)
        {
            foreach (var path in changedPaths)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var existed = store.GetFile(path) is not null;
                var abs = CodeGraphPathSafety.ValidatePathWithinRoot(projectRoot, path, allowSymlinkEscape: true);
                if (abs is null || !File.Exists(abs))
                {
                    if (existed)
                    {
                        store.DeleteFile(path);
                        removed++;
                    }

                    continue;
                }

                byte[] bytes;
                try
                {
                    bytes = File.ReadAllBytes(abs);
                }
                catch
                {
                    continue;
                }

                var result = CodeGraphIndexer.IndexFile(store, path, bytes, extractors, grammars, syncFrameworks.Value);
                if (result.Nodes.Count > 0)
                {
                    touchedPaths.Add(path);
                    if (existed)
                    {
                        modified++;
                    }
                    else
                    {
                        added++;
                    }
                }
            }
        }
        else
        {
            var config = CodeGraphProjectConfig.Load(projectRoot);
            var scanned = scanner.EnumerateFiles(projectRoot, config);
            var seen = new HashSet<string>(StringComparer.Ordinal);

            foreach (var file in scanned)
            {
                cancellationToken.ThrowIfCancellationRequested();
                seen.Add(file.Path);
                var existed = store.GetFile(file.Path) is not null;

                var bytes = file.Bytes;
                if (bytes is null)
                {
                    var abs = CodeGraphPathSafety.ValidatePathWithinRoot(projectRoot, file.Path, allowSymlinkEscape: true);
                    if (abs is null)
                    {
                        continue;
                    }

                    try
                    {
                        bytes = File.ReadAllBytes(abs);
                    }
                    catch
                    {
                        continue;
                    }
                }

                var result = CodeGraphIndexer.IndexFile(store, file.Path, bytes, extractors, grammars, syncFrameworks.Value);
                if (result.Nodes.Count > 0)
                {
                    if (existed)
                    {
                        modified++;
                    }
                    else
                    {
                        added++;
                    }
                }
            }

            // Removal detection — ONLY when the scan actually returned files. Guards
            // against nuking the whole index under the Noop scanner (or a transiently
            // unavailable scan): an empty enumeration is treated as "nothing to
            // reconcile", not "the repo is empty".
            if (scanned.Count > 0)
            {
                foreach (var record in store.GetFiles())
                {
                    if (!seen.Contains(record.Path))
                    {
                        store.DeleteFile(record.Path);
                        removed++;
                    }
                }
            }
        }

        // Resolve when files changed OR pending orphans exist. The second clause is
        // the #1187 orphan sweep as a standalone: a resolution pass that died mid-run
        // (SIGKILL, Ctrl-C, crash) leaves the rows it never reached PENDING; a bare
        // `codegraph sync` with no file changes must still grind them down, so the
        // sync doubles as the recovery command for a wedged index. On a healthy index
        // with nothing changed this is one COUNT query.
        var filesChanged = added > 0 || modified > 0;
        if (filesChanged || removed > 0 || store.GetUnresolvedReferencesCount() > 0)
        {
            resolver = CodeGraphReferenceResolver.Create(store, projectRoot);
            if (filesChanged)
            {
                resolver.RunPostExtract();
            }

            // #1240 failed-ref retry (scoped syncs only): when a changed file gained a
            // symbol, refs in UNCHANGED files that failed against the old graph — parked
            // status='failed', never revisited by the pending sweep — can now resolve.
            // Look them up by the changed files' symbol names and re-resolve just that
            // set BEFORE the batched pass so any new edges feed synthesis/deferred
            // passes. A full rescan needs none of this (every file re-indexes → all refs
            // return to pending). On a sync where no failed tail matches: one lookup.
            if (changedPaths is not null && filesChanged && touchedPaths.Count > 0)
            {
                var names = store.GetNodeNamesByFiles(touchedPaths);
                var retryable = store.GetRetryableFailedReferences(names);
                if (retryable.Count > 0)
                {
                    resolver.ResolveAndPersistList(retryable, cancellationToken);
                }
            }

            // Batched pass: the changed files' new pending refs + any interrupted-pass
            // orphans, then synthesis and the deferred conformance/this-member passes.
            resolver.ResolveAndPersistBatched(cancellationToken);
        }

        var after = store.GetNodeAndEdgeCount();
        return new CodeGraphSyncResult(
            FilesChanged: added + modified + removed,
            FilesAdded: added,
            FilesRemoved: removed,
            NodesUpdated: Math.Abs(after.Nodes - before.Nodes),
            EdgesUpdated: Math.Abs(after.Edges - before.Edges),
            DurationMs: sw.Elapsed.TotalMilliseconds);
    }

    // ===========================================================================
    // Node / search reads (delegate to the store)
    // ===========================================================================

    public List<CodeGraphSearchResult> SearchNodes(string query, CodeGraphSearchOptions? options = null) =>
        store.SearchNodes(query, options);

    // Graph-derived prompt matching for the front-load hook's MEDIUM tier: which
    // indexed symbols do these prose words NAME? ("state machine des commandes" ->
    // OrderStateMachine). Every result is re-verified against `nodes` before return.
    // (index.ts getSegmentMatches)
    public List<CodeGraphSegmentMatch> GetSegmentMatches(string[] words, int limit = 6) =>
        CodeGraphSegmentMatcher.GetSegmentMatches(store, words, limit);

    // One-shot upgrade heal for callers that open the graph WITHOUT syncing (the
    // prompt hook, whose segment tier reads name_segment_vocab): a database migrated
    // from before the vocab table existed starts empty, and sync — the only other
    // backfill — is never run by such callers (#1142). Returns true when the vocab is
    // usable (already populated, or rebuilt here); false when it can't be (empty
    // graph). The centralized single-writer daemon owns the lock, so unlike the TS
    // there is no cross-process race to guard. (index.ts healSegmentVocabIfEmpty)
    public bool HealSegmentVocabIfEmpty()
    {
        bool empty;
        try
        {
            empty = store.IsNameSegmentVocabEmpty();
        }
        catch
        {
            return false;
        }

        if (!empty)
        {
            return true;
        }

        if (store.GetNodeAndEdgeCount().Nodes == 0)
        {
            return false;
        }

        store.RebuildNameSegmentVocab();
        return true;
    }

    public CodeGraphNode? GetNode(string id) => store.GetNodeById(id);

    public List<CodeGraphNode> GetNodesInFile(string filePath) => store.GetNodesByFile(filePath);

    public List<CodeGraphNode> GetNodesByKind(string kind) => store.GetNodesByKind(kind);

    public List<CodeGraphNode> GetNodesByName(string name) => store.GetNodesByName(name);

    public List<CodeGraphNode> GetNodesByNamePrefix(string prefix, int limit = 20) =>
        store.GetNodesByNamePrefix(prefix, limit);

    public List<CodeGraphEdge> GetOutgoingEdges(string nodeId) => store.GetOutgoingEdges(nodeId);

    public List<CodeGraphEdge> GetIncomingEdges(string nodeId) => store.GetIncomingEdges(nodeId);

    public CodeGraphFileRecord? GetFile(string filePath) => store.GetFile(filePath);

    public List<CodeGraphFileRecord> GetFiles() => store.GetFiles();

    // ===========================================================================
    // Graph queries (delegate to traverser / query manager)
    // ===========================================================================

    public CodeGraphContext GetContext(string nodeId) => queryManager.GetContext(nodeId);

    public CodeGraphSubgraph Traverse(string startId, CodeGraphTraversalOptions? options = null) =>
        traverser.TraverseBFS(startId, options);

    public CodeGraphSubgraph GetCallGraph(string nodeId, int depth = 2) =>
        traverser.GetCallGraph(nodeId, depth);

    public CodeGraphSubgraph GetTypeHierarchy(string nodeId) => traverser.GetTypeHierarchy(nodeId);

    public List<CodeGraphNodeEdgePair> FindUsages(string nodeId) => traverser.FindUsages(nodeId);

    public List<CodeGraphNodeEdgePair> GetCallers(string nodeId, int maxDepth = 1) =>
        traverser.GetCallers(nodeId, maxDepth);

    public List<CodeGraphNodeEdgePair> GetCallees(string nodeId, int maxDepth = 1) =>
        traverser.GetCallees(nodeId, maxDepth);

    public CodeGraphSubgraph GetImpactRadius(string nodeId, int maxDepth = 3) =>
        traverser.GetImpactRadius(nodeId, maxDepth);

    public List<CodeGraphPathStep>? FindPath(string fromId, string toId, IReadOnlyList<string>? edgeKinds = null) =>
        traverser.FindPath(fromId, toId, edgeKinds);

    public List<CodeGraphNode> GetAncestors(string nodeId) => traverser.GetAncestors(nodeId);

    public List<CodeGraphNode> GetChildren(string nodeId) => traverser.GetChildren(nodeId);

    public IReadOnlyList<string> GetFileDependencies(string filePath) =>
        queryManager.GetFileDependencies(filePath);

    public IReadOnlyList<string> GetFileDependents(string filePath) =>
        queryManager.GetFileDependents(filePath);

    public List<List<string>> FindCircularDependencies() => queryManager.FindCircularDependencies();

    public List<CodeGraphNode> FindDeadCode(IReadOnlyList<string>? kinds = null) =>
        queryManager.FindDeadCode(kinds);

    public CodeGraphNodeMetrics GetNodeMetrics(string nodeId) => queryManager.GetNodeMetrics(nodeId);

    // ===========================================================================
    // Context building (delegate to the injected context builder)
    // ===========================================================================

    public Task<string?> GetCode(string nodeId, CancellationToken cancellationToken = default) =>
        contextBuilder.GetCode(nodeId, cancellationToken);

    public Task<CodeGraphSubgraph> FindRelevantContext(
        string query,
        CodeGraphFindRelevantContextOptions? options = null,
        CancellationToken cancellationToken = default) =>
        contextBuilder.FindRelevantContext(query, options, cancellationToken);

    public Task<CodeGraphTaskContext> BuildContext(
        CodeGraphTaskInput input,
        CodeGraphBuildContextOptions? options = null,
        CancellationToken cancellationToken = default) =>
        contextBuilder.BuildContext(input, options, cancellationToken);

    // ===========================================================================
    // Stats / state / heuristics
    // ===========================================================================

    // Graph statistics with the on-disk DB size folded in. (index.ts getStats)
    public CodeGraphStats GetStats() => store.GetStats() with { DbSizeBytes = GraphDbSize() };

    // Orphaned unresolved references still pending — a >0 count after an index/sync
    // signals an interrupted pass (the structured index-status health surface uses it).
    public int GetPendingReferenceCount() => store.GetUnresolvedReferencesCount();

    // The graph DB's active journal mode ("wal" expected). Surfaced by index-status.
    public string GetJournalMode()
    {
        try
        {
            return CodeGraphConnectionFactory.GetJournalMode(store.Connection);
        }
        catch
        {
            return "wal";
        }
    }

    // Most recent index timestamp (epoch ms), or null when nothing is indexed.
    // (index.ts getLastIndexedAt)
    public long? GetLastIndexedAt() => store.GetLastIndexedAt();

    // Completeness of the last full index: 'indexing' | 'complete' | 'partial' |
    // 'failed', or null when the marker predates this engine. (index.ts getIndexState)
    public string? GetIndexState()
    {
        var raw = store.GetMetadata("index_state");
        return raw is "indexing" or "complete" or "partial" or "failed" ? raw : null;
    }

    // Which engine built the current index (stamp behind isIndexStale).
    // (index.ts getIndexBuildInfo)
    public CodeGraphIndexBuildInfo GetIndexBuildInfo()
    {
        var version = store.GetMetadata("indexed_with_version");
        var raw = store.GetMetadata("indexed_with_extraction_version");
        int? extractionVersion = int.TryParse(raw, out var parsed) ? parsed : null;
        return new CodeGraphIndexBuildInfo(version, extractionVersion);
    }

    // True when the on-disk index was built by an engine whose extraction is older
    // than the one now running (a re-index would add data a migration can't backfill).
    // False when there is no index yet or the stamp is current. (index.ts isIndexStale)
    public bool IsIndexStale()
    {
        if (store.GetLastIndexedAt() is null)
        {
            return false;
        }

        var extractionVersion = GetIndexBuildInfo().ExtractionVersion;
        return extractionVersion is null || extractionVersion < ExtractionVersion;
    }

    // Detected frameworks (empty until the framework catalog is populated).
    // (index.ts getDetectedFrameworks)
    public IReadOnlyList<string> GetDetectedFrameworks() =>
        (resolver ??= CodeGraphReferenceResolver.Create(store, projectRoot)).GetDetectedFrameworks();

    // Down-weighted project-name tokens used in search ranking (#720).
    // (index.ts getProjectNameTokens)
    public IReadOnlyCollection<string> GetProjectNameTokens() => store.ProjectNameTokens;

    // The project's densest `route`-node file, or null. (index.ts getTopRouteFile)
    public CodeGraphTopRouteFile? GetTopRouteFile() => store.GetTopRouteFile();

    // URL → handler routing manifest, or null. (index.ts getRoutingManifest)
    public CodeGraphRoutingManifest? GetRoutingManifest(int limit = 40) => store.GetRoutingManifest(limit);

    // ===========================================================================
    // DB management
    // ===========================================================================

    // Clear all graph data (keeps metadata + vocab). (index.ts clear)
    public void Clear() => store.Clear();

    // ===========================================================================
    // Helpers
    // ===========================================================================

    // Resolve scanned files to (posix path, bytes), reading from disk when the scanner
    // did not supply bytes. A read that escapes the root, or fails, is recorded as a
    // warning and skipped so one bad file never fails the run.
    private List<(string Path, byte[] Utf8)> ReadFiles(
        IReadOnlyList<CodeGraphScannedFile> scanned,
        List<CodeGraphExtractionError> errors)
    {
        var files = new List<(string Path, byte[] Utf8)>(scanned.Count);
        foreach (var file in scanned)
        {
            if (file.Bytes is { } supplied)
            {
                files.Add((file.Path, supplied));
                continue;
            }

            var abs = CodeGraphPathSafety.ValidatePathWithinRoot(projectRoot, file.Path, allowSymlinkEscape: true);
            if (abs is null)
            {
                errors.Add(new CodeGraphExtractionError(
                    $"Refusing to read path outside the project root: {file.Path}",
                    "warning",
                    file.Path,
                    null,
                    null,
                    "path_outside_root"));
                continue;
            }

            try
            {
                files.Add((file.Path, File.ReadAllBytes(abs)));
            }
            catch (Exception ex)
            {
                errors.Add(new CodeGraphExtractionError(
                    $"Failed to read {file.Path}: {ex.Message}",
                    "warning",
                    file.Path,
                    null,
                    null,
                    "read_failed"));
            }
        }

        return files;
    }

    // Down-weight the project name in search ranking (#720). Minimal subset of
    // deriveProjectNameTokens: the repo dir basename, normalized to lowercase
    // alphanumerics, kept only when >= 5 chars. The go.mod/package.json name sources
    // are the search slice's to add; best-effort — ranking still works without it.
    private void SeedProjectNameTokens()
    {
        try
        {
            var name = Path.GetFileName(projectRoot.TrimEnd('/', '\\'));
            var token = CodeGraphSearchScoring.NormalizeNameToken(name);
            store.SetProjectNameTokens(token.Length >= 5 ? new[] { token } : Array.Empty<string>());
        }
        catch
        {
            // Best-effort: ranking still works without it.
        }
    }

    private void TrySetMetadata(string key, string value)
    {
        try
        {
            store.SetMetadata(key, value);
        }
        catch
        {
            // Metadata is advisory — never fail an index over it.
        }
    }

    private long GraphDbSize()
    {
        try
        {
            var info = new FileInfo(CodeGraphDataDir.GraphDbPath(projectRoot));
            return info.Exists ? info.Length : 0;
        }
        catch
        {
            return 0;
        }
    }

    private static string NormalizeRoot(string projectRoot) => Path.GetFullPath(projectRoot);

    private static ICodeGraphContextBuilder DefaultContextBuilderFactory(
        CodeGraphStore store,
        string projectRoot,
        CodeGraphTraverser traverser) =>
        new CodeGraphContextBuilder(store, projectRoot, traverser);
}

// ---------------------------------------------------------------------------
// Facade support records (in-process; the module slice source-gen-registers the
// serialized ones when it wires the RPC surface).
// ---------------------------------------------------------------------------

// A progress tick streamed during IndexAll. Phase is one of "scanning" | "indexing" |
// "resolving" | "complete"; File is set on per-file ticks (unused by the coarse
// facade reporting today). Bridged to a WorkerMessagePackEvent by the module slice.
internal sealed record CodeGraphIndexProgress(string Phase, int Current, int Total, string? File = null);

// The engine stamp on the current index (behind isIndexStale). Either field is null
// for an index built before stamping existed.
internal sealed record CodeGraphIndexBuildInfo(string? Version, int? ExtractionVersion);

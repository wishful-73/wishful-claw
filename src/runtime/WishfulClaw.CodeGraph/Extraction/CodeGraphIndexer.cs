using System.Buffers;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

// =============================================================================
// CodeGraphIndexer — the per-file indexing orchestrator (port of the indexing bits
// of extraction/index.ts: indexFile / indexFileWithContent / storeExtractionResult,
// MVP path).
//
// IndexFile: detect language → resolve the extraction config → parse+extract →
// write the file's nodes / edges / unresolved refs and its file record to the store.
// It never throws — a non-source path, an oversize file, an unsupported language, or
// a parse fault yields an empty result (and, where meaningful, a diagnostic error),
// so one unindexable file never fails a whole run.
//
// Change detection is by content hash, never mtime: an already-indexed file whose
// hash is unchanged is a no-op (the parse and every write are skipped). On a
// RE-index, the file's cross-file INCOMING edges are snapshotted before the delete
// and re-resolved onto the new nodes by (kind, name) — issue #899, see StoreResult.
// Deferred from this MVP slice: file-level-only language tracking and the `../`
// path-traversal guard (the caller supplies already-validated paths + bytes).
//
// Batch indexing (IndexFiles/IndexFilesAsync) is an ORDERED parse pipeline: up to
// ParseParallelism pure parses run concurrently on DEDICATED (LongRunning) threads —
// never the shared thread pool, which the host worker's supervisor heartbeat needs
// responsive — while ALL store reads/writes stay on the single sequential caller
// flow, in the original file order.
// =============================================================================
internal static class CodeGraphIndexer
{
    // index.ts:129 — files larger than this are tracked-as-skipped, never parsed.
    public const int MaxFileSize = 1024 * 1024;

    // Concurrent-parse cap. Leaves a core for the host worker's ping loop and never
    // exceeds 8 (parse throughput saturates the SQLite writer well before that).
    internal static readonly int ParseParallelism =
        Math.Max(1, Math.Min(Environment.ProcessorCount - 1, 8));

    // The writer-thread pre-parse decision for one file: everything IndexFile checks
    // before the (pure, parallelizable) parse — gating + the content-hash
    // short-circuit, which reads the store and so must stay on the caller flow.
    private sealed record CodeGraphIndexPlan(
        string FilePath,
        byte[] Utf8,
        string Language,
        ICodeGraphLanguageExtractor? Extractor,
        string ContentHash,
        bool Existed);

    // Index one file from its already-read UTF-8 bytes. Returns the extraction result
    // (empty for a skipped / unchanged / unsupported file).
    public static CodeGraphExtractionResult IndexFile(
        CodeGraphStore store,
        string filePath,
        byte[] utf8,
        CodeGraphExtractorRegistry extractors,
        CodeGraphGrammarRegistry grammars,
        IReadOnlyList<ICodeGraphFrameworkResolver>? frameworks = null)
    {
        Stopwatch sw = Stopwatch.StartNew();
        CodeGraphExtractionResult? immediate = Plan(store, filePath, utf8, extractors, sw, out CodeGraphIndexPlan? plan);
        if (immediate is not null)
        {
            return immediate;
        }

        CodeGraphExtractionResult result = Parse(plan!, grammars, frameworks);
        StoreIfMeaningful(store, plan!, result);
        return result;
    }

    // Pre-parse half of IndexFile. Returns a terminal result for files that never
    // parse (non-source / oversize / unsupported / unchanged-hash); otherwise null
    // plus the plan the parse half needs. Store access (GetFile) happens HERE, so the
    // batch pipeline runs it on the writer flow before scheduling the parse.
    private static CodeGraphExtractionResult? Plan(
        CodeGraphStore store,
        string filePath,
        byte[] utf8,
        CodeGraphExtractorRegistry extractors,
        Stopwatch sw,
        out CodeGraphIndexPlan? plan)
    {
        plan = null;

        // Non-source by extension / special filename — silently skipped, mirroring the
        // directory-scan filter that normally excludes it (grammars.ts isSourceFile).
        if (!CodeGraphLanguageMap.IsSourceFile(filePath))
        {
            return Empty(sw);
        }

        // Oversize — a WARNING diagnostic, no nodes, no store write (index.ts:2108).
        if (utf8.Length > MaxFileSize)
        {
            return WarningResult(
                $"File exceeds max size ({utf8.Length} > {MaxFileSize})",
                "size_exceeded",
                filePath,
                sw);
        }

        // Detect language. Only `.h` needs content (the C/C++/Obj-C heuristic); every
        // other extension is decided by suffix, so the bytes are not decoded.
        string? source = null;
        if (filePath.EndsWith(".h", StringComparison.OrdinalIgnoreCase))
        {
            int headBytes = Math.Min(utf8.Length, 64 * 1024);
            source = Encoding.UTF8.GetString(utf8, 0, headBytes);
        }

        string language = CodeGraphLanguageMap.DetectLanguage(filePath, source);

        // No extraction config for this language (unknown extension, or a language
        // whose config is not shipped in this build) — tracked-as-skipped, the
        // isLanguageSupported === false path (index.ts:2127). Deferred file-level-only
        // languages (yaml/twig/properties) land here too. EXCEPTION: bespoke embedded-
        // format languages (MyBatis XML / Liquid / Delphi DFM) have no tree-sitter
        // config yet are still extracted, so let them through.
        ICodeGraphLanguageExtractor? extractor = extractors.Get(language);
        if (extractor is null && !CodeGraphExtractor.HasEmbeddedExtractor(filePath, language))
        {
            return Empty(sw);
        }

        // Change detection is by content hash, never mtime (index.ts:2169). An
        // unchanged, already-indexed file is a no-op — skip the parse and the writes.
        string contentHash = CodeGraphNodeIdFactory.ContentHash(utf8);
        CodeGraphFileRecord? existing = store.GetFile(filePath);
        if (existing is not null && existing.ContentHash == contentHash)
        {
            return Empty(sw);
        }

        plan = new CodeGraphIndexPlan(filePath, utf8, language, extractor, contentHash, existing is not null);
        return null;
    }

    // Parse half: PURE — CodeGraphExtractor.ExtractFromSource touches no store state
    // (each call builds its own CodeGraphTsParser, which is not thread-safe across
    // calls but is confined to one call here), so it is safe on a worker thread. It
    // never throws; faults come back as diagnostic errors in the result.
    private static CodeGraphExtractionResult Parse(
        CodeGraphIndexPlan plan,
        CodeGraphGrammarRegistry grammars,
        IReadOnlyList<ICodeGraphFrameworkResolver>? frameworks) =>
        CodeGraphExtractor.ExtractFromSource(
            plan.FilePath, plan.Utf8, plan.Language, plan.Extractor, grammars, frameworks);

    // Store half. Store only when there ARE symbols or the parse was clean
    // (index.ts:2144): a parse yielding no nodes AND errors leaves the prior record
    // intact so the file re-indexes next run instead of being recorded as empty.
    private static void StoreIfMeaningful(
        CodeGraphStore store,
        CodeGraphIndexPlan plan,
        CodeGraphExtractionResult result)
    {
        if (result.Nodes.Count > 0 || result.Errors.Count == 0)
        {
            StoreResult(store, plan.FilePath, plan.Language, plan.Utf8.Length, plan.ContentHash, plan.Existed, result);
        }
    }

    // Index a batch of already-read files, aggregating the counts (index.ts indexFiles).
    // A file counts as indexed when it produced symbols; every file's errors surface.
    // Same parallel-parse pipeline as IndexFilesAsync (no backpressure hook); safe to
    // block on here — the parse tasks run on dedicated threads, the awaits have no
    // SynchronizationContext in the worker, and store access stays sequential.
    public static CodeGraphIndexResult IndexFiles(
        CodeGraphStore store,
        IEnumerable<(string Path, byte[] Utf8)> files,
        CodeGraphExtractorRegistry extractors,
        CodeGraphGrammarRegistry grammars,
        IReadOnlyList<ICodeGraphFrameworkResolver>? frameworks = null) =>
        IndexFilesAsync(store, files, extractors, grammars, backpressure: null, CancellationToken.None, frameworks)
            .GetAwaiter()
            .GetResult();

    // Batch indexing with a between-files `backpressure` hook (the WAL valve's writer
    // pause, awaited at a safe between-transactions boundary — index.ts threads the
    // same callback into orchestrator.indexAll).
    //
    // ORDERED PARALLEL-PARSE PIPELINE (analysis/01 §R5 posture, in-process):
    //   * The caller flow (the single writer) walks `files` in order. For each file it
    //     first runs the pre-parse Plan — gating + the content-hash short-circuit —
    //     BEFORE any parse is scheduled, so unchanged files never occupy a parse slot.
    //   * Files that need parsing are scheduled on DEDICATED LongRunning threads (one
    //     fresh CodeGraphTsParser per parse — parsers are not thread-safe), at most
    //     ParseParallelism in flight. The shared .NET thread pool is never used for
    //     the parse work, so the host worker's supervisor heartbeat (SIGKILL after two
    //     missed pings) cannot be starved by a large index.
    //   * Results are consumed strictly IN ORIGINAL FILE ORDER on the caller flow:
    //     store writes, error accounting, and the backpressure pause all happen there,
    //     exactly as the sequential per-file IndexFile path does — so write order,
    //     counts, and diagnostics are byte-identical to sequential indexing.
    public static async Task<CodeGraphIndexResult> IndexFilesAsync(
        CodeGraphStore store,
        IEnumerable<(string Path, byte[] Utf8)> files,
        CodeGraphExtractorRegistry extractors,
        CodeGraphGrammarRegistry grammars,
        Func<Task?>? backpressure,
        CancellationToken cancellationToken = default,
        IReadOnlyList<ICodeGraphFrameworkResolver>? frameworks = null)
    {
        Stopwatch sw = Stopwatch.StartNew();
        int filesIndexed = 0;
        int totalNodes = 0;
        int totalEdges = 0;
        int totalUnresolved = 0;
        var errors = new List<CodeGraphExtractionError>();

        // FIFO of files whose outcome is still owed to the writer, each either a
        // terminal pre-parse result (skip/warning/unchanged) or an in-flight parse.
        var pending = new Queue<(CodeGraphIndexPlan? Plan, CodeGraphExtractionResult? Immediate, Task<CodeGraphExtractionResult>? ParseTask)>();
        int parsesInFlight = 0;

        // Complete the OLDEST pending file: await its parse (if any), store on this
        // flow, fold its counts/errors, then honor the between-files backpressure
        // hook — the per-file tail of the old sequential loop, order preserved.
        async Task DrainOneAsync()
        {
            (CodeGraphIndexPlan? plan, CodeGraphExtractionResult? immediate, Task<CodeGraphExtractionResult>? parseTask) = pending.Dequeue();
            CodeGraphExtractionResult result;
            if (parseTask is not null)
            {
                result = await parseTask.ConfigureAwait(false);
                parsesInFlight--;
                StoreIfMeaningful(store, plan!, result);
            }
            else
            {
                result = immediate!;
            }

            if (result.Errors.Count > 0)
            {
                errors.AddRange(result.Errors);
            }

            if (result.Nodes.Count > 0)
            {
                filesIndexed++;
                totalNodes += result.Nodes.Count;
                totalEdges += result.Edges.Count;
                totalUnresolved += result.UnresolvedReferences.Count;
            }

            // Between transactions (this file's writes just committed): let the valve
            // pause the writer if the WAL is past its hard cap. null == no wait.
            if (backpressure is not null)
            {
                var wait = backpressure();
                if (wait is not null)
                {
                    await wait.ConfigureAwait(false);
                }
            }
        }

        foreach ((string path, byte[] utf8) in files)
        {
            cancellationToken.ThrowIfCancellationRequested();

            // Keep at most ParseParallelism parses in flight: drain the head (the
            // oldest file) until a slot frees. Draining oldest-first is what keeps
            // the store write order identical to the input order.
            while (parsesInFlight >= ParseParallelism)
            {
                await DrainOneAsync().ConfigureAwait(false);
            }

            Stopwatch fileSw = Stopwatch.StartNew();
            CodeGraphExtractionResult? immediate = Plan(store, path, utf8, extractors, fileSw, out CodeGraphIndexPlan? plan);
            if (immediate is not null)
            {
                pending.Enqueue((null, immediate, null));
                continue;
            }

            // Dedicated thread per in-flight parse (LongRunning bypasses the shared
            // pool). ExtractFromSource never throws, so the task never faults; a
            // cancelled run simply stops consuming — leftover parses finish on their
            // own threads and are dropped.
            Task<CodeGraphExtractionResult> parseTask = Task.Factory.StartNew(
                () => Parse(plan!, grammars, frameworks),
                CancellationToken.None,
                TaskCreationOptions.LongRunning,
                TaskScheduler.Default);
            parsesInFlight++;
            pending.Enqueue((plan, null, parseTask));
        }

        while (pending.Count > 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await DrainOneAsync().ConfigureAwait(false);
        }

        return new CodeGraphIndexResult(
            filesIndexed,
            totalNodes,
            totalEdges,
            totalUnresolved,
            sw.Elapsed.TotalMilliseconds,
            errors);
    }

    // storeExtractionResult (index.ts:2154), MVP subset: delete-then-insert this
    // file's own nodes/edges/refs, then (up)write its file record last.
    private static void StoreResult(
        CodeGraphStore store,
        string filePath,
        string language,
        long size,
        string contentHash,
        bool existed,
        CodeGraphExtractionResult result)
    {
        // #899: snapshot cross-file INCOMING edges BEFORE the delete. The cascade
        // below reaps every edge touching this file's nodes; edges whose SOURCE lives
        // here are re-emitted by the fresh extraction, but edges whose source is in a
        // different (unchanged) file would be silently severed — re-indexing a callee
        // file used to drop its callers' `calls`/`references` edges (index.ts:2178).
        // The snapshot carries each target's (kind, name) so the edge can be re-bound
        // to the re-indexed target's NEW id after the insert (node ids embed the start
        // line, so any line shift above the symbol mints new ids).
        List<CodeGraphCrossFileIncomingEdge>? crossFileIncoming = null;

        // Re-index: drop the file's previous nodes first; FK ON DELETE CASCADE reaps
        // their edges/refs (index.ts:2198 — UpsertFile re-writes the file row below).
        if (existed)
        {
            crossFileIncoming = store.GetCrossFileIncomingEdgesWithTarget(filePath);
            store.DeleteNodesByFile(filePath);
        }

        // Only nodes with every required field are stored (the store skips the rest);
        // edges/refs are then filtered to the surviving ids so no dangling endpoint is
        // written (index.ts:2205 / 2216 / 2271).
        var validNodes = new List<CodeGraphNode>(result.Nodes.Count);
        var insertedIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (CodeGraphNode node in result.Nodes)
        {
            if (HasRequiredFields(node))
            {
                validNodes.Add(node);
                insertedIds.Add(node.Id);
            }
        }

        store.InsertNodes(validNodes);

        if (result.Edges.Count > 0)
        {
            var validEdges = new List<CodeGraphEdge>(result.Edges.Count);
            foreach (CodeGraphEdge edge in result.Edges)
            {
                if (insertedIds.Contains(edge.Source) && insertedIds.Contains(edge.Target))
                {
                    validEdges.Add(edge);
                }
            }

            store.InsertEdges(validEdges);
        }

        // #899 re-resolution (index.ts:2223): re-insert the snapshotted cross-file
        // incoming edges, re-targeting each to the new node matching its recorded
        // (kind, name) — stable across line shifts, unlike the line-bearing id. A
        // renamed/removed target has no match and the edge stays dropped (correct);
        // an AMBIGUOUS (kind, name) — two new nodes sharing it — is skipped rather
        // than guessed. InsertEdges re-checks both endpoints against the live nodes
        // table and INSERT OR IGNORE dedups against re-emitted duplicates.
        if (crossFileIncoming is { Count: > 0 })
        {
            var newIdByKindName = new Dictionary<string, string>(validNodes.Count, StringComparer.Ordinal);
            var ambiguous = new HashSet<string>(StringComparer.Ordinal);
            foreach (CodeGraphNode node in validNodes)
            {
                string key = node.Kind + "\0" + node.Name;
                if (!newIdByKindName.TryAdd(key, node.Id) && newIdByKindName[key] != node.Id)
                {
                    ambiguous.Add(key);
                }
            }

            var reinserted = new List<CodeGraphEdge>(crossFileIncoming.Count);
            foreach (CodeGraphCrossFileIncomingEdge snapshot in crossFileIncoming)
            {
                string key = snapshot.TargetKind + "\0" + snapshot.TargetName;
                if (!ambiguous.Contains(key) && newIdByKindName.TryGetValue(key, out string? newTargetId))
                {
                    reinserted.Add(snapshot.Edge with { Target = newTargetId });
                }
            }

            if (reinserted.Count > 0)
            {
                store.InsertEdges(reinserted);
            }
        }

        if (result.UnresolvedReferences.Count > 0)
        {
            var validRefs = new List<CodeGraphUnresolvedReference>(result.UnresolvedReferences.Count);
            foreach (CodeGraphUnresolvedReference reference in result.UnresolvedReferences)
            {
                if (!insertedIds.Contains(reference.FromNodeId))
                {
                    continue;
                }

                // Denormalize the file/language onto the ref (index.ts:2272) so the
                // resolver can scope it without a node join.
                validRefs.Add(reference with
                {
                    FilePath = reference.FilePath ?? filePath,
                    Language = reference.Language ?? language
                });
            }

            store.InsertUnresolvedRefsBatch(validRefs);
        }

        // File record lands last so a crash mid-store leaves no record and the file
        // re-indexes (index.ts:2284). Size is the UTF-8 byte length; modified/indexed
        // are wall-clock ms (the orchestrator is handed bytes, not an on-disk stat).
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        store.UpsertFile(new CodeGraphFileRecord(
            filePath,
            contentHash,
            language,
            size,
            now,
            now,
            result.Nodes.Count,
            SerializeErrors(result.Errors)));
    }

    private static bool HasRequiredFields(CodeGraphNode node) =>
        !string.IsNullOrEmpty(node.Id) &&
        !string.IsNullOrEmpty(node.Kind) &&
        !string.IsNullOrEmpty(node.Name) &&
        !string.IsNullOrEmpty(node.FilePath) &&
        !string.IsNullOrEmpty(node.Language);

    // files.errors is a RAW JSON string (never modeled). Emit the ExtractionError[]
    // with the same camelCase + omit-null shape the source-gen JSON context uses, via
    // a reflection-free Utf8JsonWriter. Null when there are no errors.
    private static string? SerializeErrors(IReadOnlyList<CodeGraphExtractionError> errors)
    {
        if (errors.Count == 0)
        {
            return null;
        }

        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartArray();
            foreach (CodeGraphExtractionError error in errors)
            {
                writer.WriteStartObject();
                writer.WriteString("message", error.Message);
                writer.WriteString("severity", error.Severity);
                if (error.FilePath is not null)
                {
                    writer.WriteString("filePath", error.FilePath);
                }

                if (error.Line is int line)
                {
                    writer.WriteNumber("line", line);
                }

                if (error.Column is int column)
                {
                    writer.WriteNumber("column", column);
                }

                if (error.Code is not null)
                {
                    writer.WriteString("code", error.Code);
                }

                writer.WriteEndObject();
            }

            writer.WriteEndArray();
        }

        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    private static CodeGraphExtractionResult Empty(Stopwatch sw) =>
        new(
            new List<CodeGraphNode>(),
            new List<CodeGraphEdge>(),
            new List<CodeGraphUnresolvedReference>(),
            new List<CodeGraphExtractionError>(),
            sw.Elapsed.TotalMilliseconds);

    private static CodeGraphExtractionResult WarningResult(
        string message,
        string code,
        string filePath,
        Stopwatch sw) =>
        new(
            new List<CodeGraphNode>(),
            new List<CodeGraphEdge>(),
            new List<CodeGraphUnresolvedReference>(),
            new List<CodeGraphExtractionError> { new(message, "warning", filePath, null, null, code) },
            sw.Elapsed.TotalMilliseconds);
}

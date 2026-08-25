using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;

// =============================================================================
// CodeGraphToolHandler — the codegraph/* dispatcher (analysis/04 §6.0/§6.3;
// reference/02). Holds a process-local per-project engine cache
// (ConcurrentDictionary<projectRoot, CodeGraphEngine>, opened lazily via
// CodeGraphEngine.Open) and the handlers backing the 8 tool-shaped RPCs
// (explore/search/node/callers/callees/impact/files/status) plus the structured
// index/sync methods. Input is a raw JsonElement read field-by-field with JsonHelpers
// — there is NO input DTO (AOT-safe, reflection-free).
//
// THE error convention (reference/02 §1.3 / analysis/04 §3.3): success/failure is
// modeled IN the result DTO. WorkerResponse.Error RESOLVES on the JS side — it does
// not reject — so these handlers never throw across the boundary:
//   * not_indexed / no default project -> SUCCESS-shaped guidance (Success:true,
//     IsError:false, ErrorKind:"not_indexed"). An early isError teaches the agent to
//     abandon the whole toolset for the session.
//   * path_refusal (sensitive root) -> HARD (Success:false, IsError:true), no retry.
//   * internal throw -> HARD with "retry once, else continue without codegraph".
//
// Concurrency: a CodeGraphStore is single-threaded, so all access to the WRITER
// engine is serialized on a per-project SemaphoreSlim gate. Tool-shaped READS run on
// a small pool of read-only companion engines (analysis/04 §5.1): WAL gives each its
// own snapshot-consistent connection, so queries neither serialize behind each other
// nor behind an in-flight index/sync. A completed write bumps the pool generation —
// stale readers (whose per-engine LRU caches predate the write) are disposed on
// return instead of re-pooled. The structured Data.cs reads still use the gate.
// =============================================================================
internal static partial class CodeGraphToolHandler
{
    // Per-project engine handles, keyed by the canonicalized absolute project root.
    // Lazy<> so a racing GetOrAdd never opens (and leaks) two SQLite connections.
    private static readonly ConcurrentDictionary<string, Lazy<EngineHandle>> Engines =
        new(StringComparer.Ordinal);

    private sealed class EngineHandle
    {
        // WAL readers don't block the writer or each other; small and fixed keeps
        // the FD/mmap cost bounded per project.
        private const int ReadPoolSize = 3;

        private readonly SemaphoreSlim readSlots = new(ReadPoolSize, ReadPoolSize);
        private readonly ConcurrentBag<(CodeGraphEngine Engine, int Generation)> readers = new();
        private int generation;
        private volatile bool readersClosed;

        public required CodeGraphEngine Engine { get; init; }

        public required string Root { get; init; }

        // Serializes all WRITER-engine access for this project (single-threaded store).
        public SemaphoreSlim Gate { get; } = new(1, 1);

        // Bump after every completed write pass (index/sync): pooled readers hold
        // per-engine LRU caches a write invalidates. The SQLite snapshot itself needs
        // no bump — a WAL reader always sees the latest committed state per query.
        public void InvalidateReaders() => Interlocked.Increment(ref generation);

        // Run a read on a pooled read-only engine. False when a read engine cannot be
        // opened (caller falls back to the exclusive writer gate); exceptions thrown
        // by `body` propagate.
        public bool TryWithReader<T>(Func<CodeGraphEngine, T> body, out T result)
        {
            readSlots.Wait();
            try
            {
                var gen = Volatile.Read(ref generation);
                CodeGraphEngine? reader = null;
                while (readers.TryTake(out var pooled))
                {
                    if (pooled.Generation == gen)
                    {
                        reader = pooled.Engine;
                        break;
                    }

                    pooled.Engine.Dispose();
                }

                if (reader is null)
                {
                    try
                    {
                        reader = CodeGraphEngine.OpenReadOnly(Root);
                    }
                    catch
                    {
                        result = default!;
                        return false;
                    }
                }

                try
                {
                    result = body(reader);
                    return true;
                }
                finally
                {
                    if (!readersClosed && Volatile.Read(ref generation) == gen)
                    {
                        readers.Add((reader, gen));
                        if (readersClosed)
                        {
                            DrainReaders(); // lost the race with CloseReaders — re-drain
                        }
                    }
                    else
                    {
                        reader.Dispose();
                    }
                }
            }
            finally
            {
                readSlots.Release();
            }
        }

        // Dispose every pooled reader and stop pooling (engine drop / test reset).
        public void CloseReaders()
        {
            readersClosed = true;
            Interlocked.Increment(ref generation);
            DrainReaders();
        }

        private void DrainReaders()
        {
            while (readers.TryTake(out var pooled))
            {
                pooled.Engine.Dispose();
            }
        }
    }

    // Open-or-reuse the engine for a project root (analysis/04 §6.3 multi-project cache).
    internal static CodeGraphEngine EnsureEngine(string projectRoot) => EnsureHandle(projectRoot).Engine;

    private static EngineHandle EnsureHandle(string projectRoot)
    {
        var key = Path.GetFullPath(projectRoot);
        return Engines
            .GetOrAdd(key, k => new Lazy<EngineHandle>(() => new EngineHandle { Engine = CodeGraphEngine.Open(k), Root = k }))
            .Value;
    }

    // Dispose + drop one project's cached engine (management remove path) so its DB
    // files can be deleted; also forgets its auto-index single-flight entry.
    internal static void DropEngine(string projectRoot)
    {
        var key = Path.GetFullPath(projectRoot);
        AutoIndexTasks.TryRemove(key, out _);
        if (!Engines.TryRemove(key, out var entry) || !entry.IsValueCreated)
        {
            return;
        }
        var handle = entry.Value;
        handle.CloseReaders();
        handle.Gate.Wait();
        try
        {
            handle.Engine.Dispose();
        }
        finally
        {
            handle.Gate.Release();
        }
    }

    // Dispose + drop every cached engine. Test hook (the cache is process-global, so a
    // suite that redirects CODEGRAPH_HOME must reset between fixtures).
    internal static void ResetForTests()
    {
        foreach (var entry in Engines.Values)
        {
            if (!entry.IsValueCreated)
            {
                continue;
            }

            try
            {
                entry.Value.CloseReaders();
                entry.Value.Engine.Dispose();
            }
            catch
            {
                // best-effort cleanup.
            }
        }

        Engines.Clear();
    }

    // ===========================================================================
    // Tool-shaped handlers (return CodeGraphToolResult). Called directly by tests and
    // wrapped by the *Rpc methods for the module.
    // ===========================================================================

    // codegraph_explore — the primary tool: NL question OR symbol/file bag -> markdown
    // (per-file source + call paths + blast radius), one capped call.
    internal static CodeGraphToolResult Explore(JsonElement args) => RunTool("explore", args, (engine, _) =>
    {
        var query = JsonHelpers.GetString(args, "query");
        if (string.IsNullOrWhiteSpace(query))
        {
            return InvalidArgsTool("`query` is required for codegraph_explore.");
        }

        // Size-tiered output budget (≙ getExploreOutputBudget, tools.ts:192 / #185):
        // total cap, default file count, and per-file cap all scale with the indexed
        // file count. A stats failure falls back to the largest tier (pre-#185
        // behavior), which also always stays under the agent runtime's inline
        // tool-result ceiling. Enforced here by dropping whole code blocks — halve
        // maxFiles until the rendered markdown fits, then note what was omitted.
        CodeGraphExploreOutputBudget budget;
        int? statsFileCount = null;
        try
        {
            statsFileCount = engine.GetStats().FileCount;
            budget = CodeGraphExploreBudget.GetOutputBudget(statsFileCount.Value);
        }
        catch
        {
            budget = CodeGraphExploreBudget.GetOutputBudget(int.MaxValue);
        }

        var maxFiles = Math.Clamp(JsonHelpers.GetInt(args, "maxFiles", budget.DefaultMaxFiles), 1, 20);
        var requestedFiles = maxFiles;
        string text;
        while (true)
        {
            var context = engine.BuildContext(
                    CodeGraphTaskInput.Of(query),
                    new CodeGraphBuildContextOptions
                    {
                        MaxCodeBlocks = maxFiles,
                        MaxNodes = Math.Max(20, maxFiles * 2),
                        MaxCodeBlockSize = budget.MaxCharsPerFile,
                        Format = "markdown"
                    })
                .GetAwaiter()
                .GetResult();

            text = CodeGraphContextFormatter.FormatAsMarkdown(context);
            if (text.Length <= budget.MaxOutputChars || maxFiles <= 1)
            {
                break;
            }
            maxFiles = Math.Max(1, maxFiles / 2);
        }

        if (text.Length > budget.MaxOutputChars)
        {
            // Even a single block overflows (one huge file): cut at a line boundary,
            // with the upstream final-ceiling truncation note (tools.ts:3681).
            var cut = text.LastIndexOf('\n', budget.MaxOutputChars);
            text = text[..(cut > 0 ? cut : budget.MaxOutputChars)] +
                "\n\n... (output truncated to budget; the source above is complete and verbatim — treat it " +
                "as already Read. For any area not covered, run another codegraph_explore with the specific " +
                "names — do NOT Read these files.)";
        }
        else if (maxFiles < requestedFiles)
        {
            // Whole file sections were dropped to fit — the upstream trimmed-for-size
            // completeness note (tools.ts:3640).
            text += "\n\n> Some file sections were trimmed for size. For a specific symbol you still need, " +
                "run another `codegraph_explore` (or `codegraph_node`) with its exact name — line-numbered " +
                "source, cheaper and more complete than Read.";
        }

        // Staleness banner (M7-W3, ≙ upstream's staleness banner minus the watcher
        // machinery): when a write pass is in flight or the stamped extraction
        // version lags, say so up front — silently stale results erode trust in the
        // whole toolset. Advisory only; never blocks the answer.
        try
        {
            var indexState = engine.GetIndexState();
            if (indexState == "indexing" || engine.IsIndexing)
            {
                text = "> **Index catching up** — a sync/index pass is in flight; results may lag the newest edits. " +
                    "Re-run this explore in a moment if something looks missing.\n\n" + text;
            }
            else if (engine.IsIndexStale())
            {
                text = "> **Index stale** — this project was indexed by an older extraction version; " +
                    "re-index from the CodeGraph page for full fidelity.\n\n" + text;
            }
        }
        catch
        {
            // staleness probe is advisory — never fail the tool over it
        }

        // Explore-budget reminder (tools.ts:3648), gated by tier — tiny projects skip
        // it (one rich call is the whole story) and it needs the stats to be honest.
        if (budget.IncludeBudgetNote && statsFileCount is { } fileCount)
        {
            var callBudget = CodeGraphExploreBudget.GetCallBudget(fileCount);
            text += "\n\n> **Explore budget: " + callBudget + " calls for this project (" +
                fileCount.ToString("N0", System.Globalization.CultureInfo.InvariantCulture) +
                " files indexed).** Each call covers ~6 files; if your question spans more, spend your " +
                "remaining calls on the uncovered area BEFORE falling back to Read — another explore is " +
                $"cheaper and more complete than reading those files. Synthesize once you've used {callBudget}.";
        }

        return new CodeGraphToolResult(true, text, false);
    });

    // codegraph_search — symbol lookup by name; locations only, no code.
    internal static CodeGraphToolResult Search(JsonElement args) => RunTool("search", args, (engine, _) =>
    {
        var query = JsonHelpers.GetString(args, "query");
        if (string.IsNullOrWhiteSpace(query))
        {
            return InvalidArgsTool("`query` is required for codegraph_search.");
        }

        var limit = Math.Clamp(JsonHelpers.GetInt(args, "limit", 10), 1, 100);
        var kind = JsonHelpers.GetString(args, "kind");
        var options = new CodeGraphSearchOptions { Limit = limit };
        if (!string.IsNullOrWhiteSpace(kind))
        {
            options.Kinds = new[] { kind };
        }

        var results = engine.SearchNodes(query, options);
        if (results.Count == 0)
        {
            return new CodeGraphToolResult(true, $"No symbols matched \"{query}\".", false);
        }

        var sb = new StringBuilder();
        sb.AppendLine($"{results.Count} match(es) for \"{query}\":");
        sb.AppendLine();
        foreach (var r in results.Take(limit))
        {
            sb.AppendLine($"- {r.Node.Name} ({r.Node.Kind}) — {r.Node.FilePath}:{r.Node.StartLine}");
        }

        return new CodeGraphToolResult(true, sb.ToString().TrimEnd(), false);
    });

    // codegraph_status — index health as agent-facing markdown (GetStats/GetIndexState).
    internal static CodeGraphToolResult Status(JsonElement args) => RunTool("status", args, (engine, root) =>
    {
        var stats = engine.GetStats();
        var state = engine.GetIndexState() ?? "unknown";
        var lastIndexed = engine.GetLastIndexedAt();
        var stale = engine.IsIndexStale();
        var version = engine.GetIndexBuildInfo().Version;

        var sb = new StringBuilder();
        sb.AppendLine("## CodeGraph Status");
        sb.AppendLine();
        sb.AppendLine($"- Project: `{root}`");
        sb.AppendLine($"- Index state: {state}");
        sb.AppendLine($"- Files: {stats.FileCount}");
        sb.AppendLine($"- Nodes: {stats.NodeCount}");
        sb.AppendLine($"- Edges: {stats.EdgeCount}");
        sb.AppendLine($"- DB size: {FormatBytes(stats.DbSizeBytes)}");
        sb.AppendLine("- Backend: microsoft.data.sqlite (wal)");
        if (lastIndexed is { } ts)
        {
            sb.AppendLine($"- Last indexed: {DateTimeOffset.FromUnixTimeMilliseconds(ts):u}");
        }

        sb.AppendLine($"- Stale: {(stale ? "yes (re-index recommended)" : "no")}");
        if (version is { Length: > 0 } v)
        {
            sb.AppendLine($"- Indexed with: {v}");
        }

        return new CodeGraphToolResult(true, sb.ToString().TrimEnd(), false);
    });

    // codegraph_node — read a symbol (signature/body/trail) or a file (numbered source).
    internal static CodeGraphToolResult Node(JsonElement args) => RunTool("node", args, (engine, _) =>
    {
        var symbol = JsonHelpers.GetString(args, "symbol");
        var file = JsonHelpers.GetString(args, "file");
        if (string.IsNullOrWhiteSpace(symbol) && string.IsNullOrWhiteSpace(file))
        {
            return new CodeGraphToolResult(
                true, "Provide `symbol` to read a symbol, or `file` to read a file.", false);
        }

        return !string.IsNullOrWhiteSpace(symbol)
            ? NodeSymbolMode(engine, symbol!, file, args)
            : NodeFileMode(engine, file!, args);
    });

    // codegraph_callers / codegraph_callees.
    internal static CodeGraphToolResult Callers(JsonElement args) =>
        CallGraphTool(args, "callers", (engine, id) => engine.GetCallers(id));

    internal static CodeGraphToolResult Callees(JsonElement args) =>
        CallGraphTool(args, "callees", (engine, id) => engine.GetCallees(id));

    // codegraph_impact — blast radius of changing <symbol>.
    internal static CodeGraphToolResult Impact(JsonElement args) => RunTool("impact", args, (engine, _) =>
    {
        var symbol = JsonHelpers.GetString(args, "symbol");
        if (string.IsNullOrWhiteSpace(symbol))
        {
            return InvalidArgsTool("`symbol` is required for codegraph_impact.");
        }

        var file = JsonHelpers.GetString(args, "file");
        var depth = Math.Clamp(JsonHelpers.GetInt(args, "depth", 2), 1, 6);
        var defs = ResolveSymbolNodes(engine, symbol!, file, null);
        if (defs.Count == 0)
        {
            return new CodeGraphToolResult(true, $"No symbol named \"{symbol}\" found.", false);
        }

        var sb = new StringBuilder();
        foreach (var def in defs)
        {
            var sub = engine.GetImpactRadius(def.Id, depth);
            var affected = sub.Nodes.Values.Where(n => n.Id != def.Id).ToList();
            sb.AppendLine(
                $"Impact of {def.Name} ({def.FilePath}:{def.StartLine}): {affected.Count} symbol(s) within depth {depth}.");
            foreach (var n in affected.Take(50))
            {
                sb.AppendLine($"- {n.Name} ({n.Kind}) — {n.FilePath}:{n.StartLine}");
            }

            sb.AppendLine();
        }

        return new CodeGraphToolResult(true, sb.ToString().TrimEnd(), false);
    });

    // codegraph_files — indexed file tree with per-file language/symbol counts.
    internal static CodeGraphToolResult Files(JsonElement args) => RunTool("files", args, (engine, _) =>
    {
        var files = engine.GetFiles();
        var pathFilter = JsonHelpers.GetString(args, "path");
        if (!string.IsNullOrWhiteSpace(pathFilter))
        {
            var prefix = CodeGraphPathSafety.NormalizePath(pathFilter).TrimEnd('/');
            files = files.Where(x => x.Path.StartsWith(prefix, StringComparison.Ordinal)).ToList();
        }

        if (files.Count == 0)
        {
            return new CodeGraphToolResult(true, "No indexed files.", false);
        }

        var includeMeta = JsonHelpers.GetBool(args, "includeMetadata", true);
        var format = JsonHelpers.GetString(args, "format") ?? "tree";

        var sb = new StringBuilder();
        sb.AppendLine($"{files.Count} indexed file(s):");
        sb.AppendLine();

        if (string.Equals(format, "grouped", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var group in files.GroupBy(x => x.Language).OrderBy(g => g.Key, StringComparer.Ordinal))
            {
                sb.AppendLine($"### {group.Key} ({group.Count()})");
                foreach (var f in group.OrderBy(x => x.Path, StringComparer.Ordinal))
                {
                    sb.AppendLine($"- {f.Path}{(includeMeta ? $"  ({f.NodeCount} symbols)" : string.Empty)}");
                }

                sb.AppendLine();
            }
        }
        else
        {
            foreach (var f in files.OrderBy(x => x.Path, StringComparer.Ordinal))
            {
                var meta = includeMeta ? $"  ({f.Language}, {f.NodeCount} symbols)" : string.Empty;
                sb.AppendLine($"- {f.Path}{meta}");
            }
        }

        return new CodeGraphToolResult(true, sb.ToString().TrimEnd(), false);
    });

    // ===========================================================================
    // Structured index / sync (streams progress when an IWorkerRequestContext is passed).
    // ===========================================================================

    internal static async Task<CodeGraphIndexResponse> Index(
        JsonElement args, IWorkerRequestContext? ctx, CancellationToken cancellationToken)
    {
        var indexId = JsonHelpers.GetString(args, "indexId") is { Length: > 0 } id
            ? id
            : Guid.NewGuid().ToString("N");
        var root = ResolveWorkingFolder(args);
        if (string.IsNullOrEmpty(root))
        {
            return IndexFail(indexId, "`workingFolder` is required.", CodeGraphErrorKind.InvalidArgs);
        }

        if (IsRefusedRoot(root))
        {
            return IndexFail(indexId, $"Refused to index a sensitive path: {root}", CodeGraphErrorKind.PathRefusal);
        }

        EngineHandle handle;
        try
        {
            handle = EnsureHandle(root);
        }
        catch (Exception ex)
        {
            return IndexFail(indexId, ex.Message, CodeGraphErrorKind.Internal);
        }

        await handle.Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            IProgress<CodeGraphIndexProgress>? progress = ctx is null ? null : new EventProgress(ctx, indexId);
            var result = await handle.Engine.IndexAll(progress, cancellationToken).ConfigureAwait(false);
            var stats = handle.Engine.GetStats();
            var state = handle.Engine.GetIndexState() ?? "complete";
            var version = handle.Engine.GetIndexBuildInfo().Version;

            if (ctx is not null)
            {
                await ctx.EmitEventIgnoringCancellationAsync(
                    "codegraph/index-complete",
                    new CodeGraphIndexComplete(
                        indexId, state, result.FilesIndexed, stats.NodeCount, stats.EdgeCount, (long)result.DurationMs),
                    CodeGraphJsonContext.Default.CodeGraphIndexComplete).ConfigureAwait(false);
            }

            return new CodeGraphIndexResponse(
                Success: true,
                IndexId: indexId,
                State: state,
                FilesIndexed: result.FilesIndexed,
                NodeCount: stats.NodeCount,
                EdgeCount: stats.EdgeCount,
                UnresolvedCount: result.UnresolvedCount,
                DurationMs: (long)result.DurationMs,
                IndexedWithVersion: version);
        }
        catch (OperationCanceledException)
        {
            await EmitCompleteSafe(ctx, indexId, "cancelled", null).ConfigureAwait(false);
            return IndexFail(indexId, "Index cancelled.", CodeGraphErrorKind.Internal) with { State = "cancelled" };
        }
        catch (Exception ex)
        {
            await EmitCompleteSafe(ctx, indexId, "failed", ex.Message).ConfigureAwait(false);
            return IndexFail(indexId, ex.Message, CodeGraphErrorKind.Internal);
        }
        finally
        {
            handle.Gate.Release();
            handle.InvalidateReaders(); // pooled readers' caches predate this index pass
        }
    }

    internal static async Task<CodeGraphSyncResponse> Sync(
        JsonElement args, IWorkerRequestContext? ctx, CancellationToken cancellationToken)
    {
        var indexId = JsonHelpers.GetString(args, "indexId") is { Length: > 0 } id
            ? id
            : Guid.NewGuid().ToString("N");
        var root = ResolveWorkingFolder(args);
        if (string.IsNullOrEmpty(root))
        {
            return new CodeGraphSyncResponse(false, 0, 0, 0, 0, 0, 0, "`workingFolder` is required.", CodeGraphErrorKind.InvalidArgs);
        }

        if (IsRefusedRoot(root))
        {
            return new CodeGraphSyncResponse(false, 0, 0, 0, 0, 0, 0, $"Refused to sync a sensitive path: {root}", CodeGraphErrorKind.PathRefusal);
        }

        if (!CodeGraphEngine.IsInitialized(root))
        {
            // not_indexed is success-shaped: the app should call codegraph/index first.
            return new CodeGraphSyncResponse(true, 0, 0, 0, 0, 0, 0, "Project is not indexed; call codegraph/index first.", CodeGraphErrorKind.NotIndexed);
        }

        // changedPaths is PATCH-SENSITIVE (reference/02 §1.4): absent -> engine self-
        // detects (null); present (even empty) -> the git-scoped fast path / orphan sweep.
        IReadOnlyList<string>? changed = null;
        if (args.ValueKind == JsonValueKind.Object &&
            args.TryGetProperty("changedPaths", out var cp) &&
            cp.ValueKind != JsonValueKind.Null)
        {
            changed = JsonHelpers.GetStringArray(args, "changedPaths");
        }

        EngineHandle handle;
        try
        {
            handle = EnsureHandle(root);
        }
        catch (Exception ex)
        {
            return new CodeGraphSyncResponse(false, 0, 0, 0, 0, 0, 0, ex.Message, CodeGraphErrorKind.Internal);
        }

        await handle.Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (ctx is not null)
            {
                await ctx.EmitEventAsync(
                    "codegraph/index-progress",
                    new CodeGraphIndexProgressEvent(indexId, "sync", 0, changed?.Count ?? 0, 0, 0, null),
                    CodeGraphJsonContext.Default.CodeGraphIndexProgressEvent).ConfigureAwait(false);
            }

            var r = await handle.Engine.Sync(changed, cancellationToken).ConfigureAwait(false);

            if (ctx is not null)
            {
                await ctx.EmitEventIgnoringCancellationAsync(
                    "codegraph/index-complete",
                    new CodeGraphIndexComplete(indexId, "complete", r.FilesChanged, 0, 0, (long)r.DurationMs),
                    CodeGraphJsonContext.Default.CodeGraphIndexComplete).ConfigureAwait(false);
            }

            return new CodeGraphSyncResponse(
                true, r.FilesChanged, r.FilesAdded, r.FilesRemoved, r.NodesUpdated, r.EdgesUpdated, (long)r.DurationMs);
        }
        catch (Exception ex)
        {
            return new CodeGraphSyncResponse(false, 0, 0, 0, 0, 0, 0, ex.Message, CodeGraphErrorKind.Internal);
        }
        finally
        {
            handle.Gate.Release();
            handle.InvalidateReaders(); // pooled readers' caches predate this sync pass
        }
    }

    // ===========================================================================
    // RPC wrappers (thin adapters: handler result -> WorkerResponse.Json). Referenced
    // by CodeGraphModule.Register. Each registers the host-supplied dataRoot (if any)
    // before dispatch so engine opens land in the project-local dir.
    // ===========================================================================

    internal static WorkerResponse ExploreRpc(JsonElement args)
    {
        RegisterDataRoot(args);
        return Tool(Explore(args));
    }

    internal static WorkerResponse SearchRpc(JsonElement args)
    {
        RegisterDataRoot(args);
        return Tool(Search(args));
    }

    internal static WorkerResponse StatusRpc(JsonElement args)
    {
        RegisterDataRoot(args);
        return Tool(Status(args));
    }

    internal static WorkerResponse NodeRpc(JsonElement args)
    {
        RegisterDataRoot(args);
        return Tool(Node(args));
    }

    internal static WorkerResponse CallersRpc(JsonElement args)
    {
        RegisterDataRoot(args);
        return Tool(Callers(args));
    }

    internal static WorkerResponse CalleesRpc(JsonElement args)
    {
        RegisterDataRoot(args);
        return Tool(Callees(args));
    }

    internal static WorkerResponse ImpactRpc(JsonElement args)
    {
        RegisterDataRoot(args);
        return Tool(Impact(args));
    }

    internal static WorkerResponse FilesRpc(JsonElement args)
    {
        RegisterDataRoot(args);
        return Tool(Files(args));
    }

    internal static async Task<WorkerResponse> IndexRpc(JsonElement args, IWorkerRequestContext ctx)
    {
        RegisterDataRoot(args);
        var response = await Index(args, ctx, ctx.CancellationToken).ConfigureAwait(false);
        return WorkerResponse.Json(response, CodeGraphJsonContext.Default.CodeGraphIndexResponse);
    }

    internal static async Task<WorkerResponse> SyncRpc(JsonElement args, IWorkerRequestContext ctx)
    {
        RegisterDataRoot(args);
        var response = await Sync(args, ctx, ctx.CancellationToken).ConfigureAwait(false);
        return WorkerResponse.Json(response, CodeGraphJsonContext.Default.CodeGraphSyncResponse);
    }

    // codegraph/tools-list — the agent-visible surface. Threads the caller's optional
    // workingFolder (or projectPath) through so the project-aware shaping applies
    // (tiny-repo gating + the explore call-budget suffix, analysis/04 §3.2), and
    // degrades gracefully: no resolvable project -> the require-projectPath surface
    // (#993); a project without an index (or a failed stats read) -> the plain
    // default/allowlist surface. Never auto-indexes — listing tools must stay cheap.
    internal static CodeGraphToolsListResult ToolsList(JsonElement args)
    {
        RegisterDataRoot(args);
        var root = ResolveWorkingFolder(args);
        if (string.IsNullOrEmpty(root))
        {
            return CodeGraphToolDefs.ListFor(hasDefaultProject: false, indexedFileCount: null);
        }

        int? fileCount = null;
        if (!IsRefusedRoot(root) && CodeGraphEngine.IsInitialized(root))
        {
            try
            {
                var handle = EnsureHandle(root);
                handle.Gate.Wait();
                try
                {
                    fileCount = handle.Engine.GetStats().FileCount;
                }
                finally
                {
                    handle.Gate.Release();
                }
            }
            catch
            {
                // Stats unavailable — serve the un-shaped surface (upstream getTools
                // catch branch).
            }
        }

        return CodeGraphToolDefs.ListFor(hasDefaultProject: true, indexedFileCount: fileCount);
    }

    internal static WorkerResponse ToolsListRpc(JsonElement args) =>
        WorkerResponse.Json(ToolsList(args), CodeGraphJsonContext.Default.CodeGraphToolsListResult);

    internal static WorkerResponse InstructionsRpc(JsonElement args)
    {
        RegisterDataRoot(args);
        var root = ResolveWorkingFolder(args);
        var indexed = !string.IsNullOrEmpty(root) && CodeGraphEngine.IsInitialized(root);
        var text = indexed ? CodeGraphInstructions.Indexed : CodeGraphInstructions.NoRoot;
        return WorkerResponse.Json(
            new CodeGraphInstructionsResult(true, text, indexed),
            CodeGraphJsonContext.Default.CodeGraphInstructionsResult);
    }

    // ===========================================================================
    // Shared plumbing
    // ===========================================================================

    // The gate + envelope wrapper for every tool-shaped handler: allowlist-check,
    // resolve/refuse/route, serialize DB access, and convert any throw into the
    // success-resolving internal envelope (never a rejected promise). `toolName` is
    // the short tool name (explore/search/…).
    private static CodeGraphToolResult RunTool(
        string toolName, JsonElement args, Func<CodeGraphEngine, string, CodeGraphToolResult> body)
    {
        // Execute-time CODEGRAPH_MCP_TOOLS enforcement (≙ tools.ts:1371, defense in
        // depth): a trimmed surface rejects ablated tools even if a client cached a
        // wider tools-list. SUCCESS-shaped guidance (never isError — an early hard
        // error teaches the agent to abandon the whole toolset for the session).
        if (!CodeGraphToolDefs.IsToolAllowed(toolName))
        {
            return new CodeGraphToolResult(
                true,
                $"Tool codegraph_{toolName} is disabled via CODEGRAPH_MCP_TOOLS. " +
                "Use the tools reported by codegraph/tools-list instead.",
                false,
                CodeGraphErrorKind.InvalidArgs);
        }

        var root = ResolveWorkingFolder(args);
        if (string.IsNullOrEmpty(root))
        {
            return NotIndexedTool();
        }

        if (IsRefusedRoot(root))
        {
            return PathRefusalTool(root);
        }

        if (!CodeGraphEngine.IsInitialized(root))
        {
            // Index on first use (reference/04 §5): the agent has no index tool, so a
            // query against a never-indexed project kicks off the index here. Small
            // repos complete within the wait and the tool runs immediately; large ones
            // return success-shaped "in progress" guidance and the agent retries.
            var pending = AutoIndexFirstUse(root);
            if (pending is not null)
            {
                return pending;
            }
        }

        EngineHandle handle;
        try
        {
            handle = EnsureHandle(root);
        }
        catch (Exception ex)
        {
            return InternalTool(ex.Message);
        }

        // Read-pool fast path: every tool-shaped handler is a pure read, so run it on
        // a pooled read-only engine — no serialization behind other queries or an
        // in-flight index/sync. Falls back to the exclusive writer gate when a read
        // engine can't open (correctness first).
        try
        {
            if (handle.TryWithReader(reader => body(reader, root), out var viaReader))
            {
                return viaReader;
            }
        }
        catch (Exception ex)
        {
            return InternalTool(ex.Message);
        }

        handle.Gate.Wait();
        try
        {
            return body(handle.Engine, root);
        }
        catch (Exception ex)
        {
            return InternalTool(ex.Message);
        }
        finally
        {
            handle.Gate.Release();
        }
    }

    // Single-flight first-use indexing per project root. Completed tasks stay cached
    // (harmless — IsInitialized short-circuits later calls); failed tasks are evicted
    // so a retry can re-attempt.
    private static readonly ConcurrentDictionary<string, Task> AutoIndexTasks =
        new(StringComparer.Ordinal);

    private const int AutoIndexWaitMs = 90_000;

    private static CodeGraphToolResult? AutoIndexFirstUse(string root)
    {
        var key = Path.GetFullPath(root);
        var task = AutoIndexTasks.GetOrAdd(key, static k => Task.Run(async () =>
        {
            var handle = EnsureHandle(k);
            await handle.Gate.WaitAsync().ConfigureAwait(false);
            try
            {
                await handle.Engine.IndexAll(null, CancellationToken.None).ConfigureAwait(false);
            }
            finally
            {
                handle.Gate.Release();
                handle.InvalidateReaders(); // pooled readers' caches predate first-use index
            }
        }));

        try
        {
            if (task.Wait(AutoIndexWaitMs))
            {
                return null; // indexed — proceed to run the tool
            }
        }
        catch (AggregateException ex)
        {
            AutoIndexTasks.TryRemove(key, out _);
            return InternalTool(
                $"Indexing {key} failed: {ex.InnerException?.Message ?? ex.Message}. Call the tool again to retry.");
        }

        return new CodeGraphToolResult(
            true,
            $"CodeGraph is indexing {key} for the first time — this runs in the background. " +
            "Call the tool again in a moment to query the indexed graph.",
            false,
            CodeGraphErrorKind.NotIndexed);
    }

    private static CodeGraphToolResult CallGraphTool(
        JsonElement args, string label, Func<CodeGraphEngine, string, List<CodeGraphNodeEdgePair>> query) =>
        RunTool(label, args, (engine, _) =>
        {
            var symbol = JsonHelpers.GetString(args, "symbol");
            if (string.IsNullOrWhiteSpace(symbol))
            {
                return InvalidArgsTool($"`symbol` is required for codegraph_{label}.");
            }

            var file = JsonHelpers.GetString(args, "file");
            var limit = Math.Clamp(JsonHelpers.GetInt(args, "limit", 20), 1, 200);
            var defs = ResolveSymbolNodes(engine, symbol!, file, null);
            if (defs.Count == 0)
            {
                return new CodeGraphToolResult(true, $"No symbol named \"{symbol}\" found.", false);
            }

            var sb = new StringBuilder();
            foreach (var def in defs)
            {
                var pairs = query(engine, def.Id);
                sb.AppendLine($"{label} of {def.Name} ({def.FilePath}:{def.StartLine}): {pairs.Count}");
                foreach (var p in pairs.Take(limit))
                {
                    sb.AppendLine($"- {p.Node.Name} ({p.Node.Kind}) — {p.Node.FilePath}:{p.Node.StartLine}");
                }

                sb.AppendLine();
            }

            return new CodeGraphToolResult(true, sb.ToString().TrimEnd(), false);
        });

    private static CodeGraphToolResult NodeSymbolMode(
        CodeGraphEngine engine, string symbol, string? file, JsonElement args)
    {
        var line = JsonHelpers.GetIntNullable(args, "line");
        var kind = JsonHelpers.GetString(args, "kind");
        var matches = ResolveSymbolNodes(engine, symbol, file, line, kind);
        if (matches.Count == 0)
        {
            return new CodeGraphToolResult(true, $"No symbol named \"{symbol}\" found.", false);
        }

        if (matches.Count > 1 && line is null && string.IsNullOrWhiteSpace(file))
        {
            var ambiguous = new StringBuilder();
            ambiguous.AppendLine($"{matches.Count} definitions named \"{symbol}\" (pass `file`, `line`, or `kind` to disambiguate):");
            ambiguous.AppendLine();
            foreach (var n in matches)
            {
                ambiguous.AppendLine(FormatNode(n));
            }

            return new CodeGraphToolResult(true, ambiguous.ToString().TrimEnd(), false);
        }

        var node = matches[0];
        var includeCode = JsonHelpers.GetBool(args, "includeCode", false);
        var sb = new StringBuilder();
        sb.AppendLine($"{node.Name} ({node.Kind}) — {node.FilePath}:{node.StartLine}");
        if (node.Signature is { Length: > 0 } sig)
        {
            sb.AppendLine($"`{sig}`");
        }

        var callers = engine.GetCallers(node.Id);
        var callees = engine.GetCallees(node.Id);
        if (callers.Count > 0)
        {
            sb.AppendLine($"Callers: {string.Join(", ", callers.Take(15).Select(p => p.Node.Name))}");
        }

        if (callees.Count > 0)
        {
            sb.AppendLine($"Callees: {string.Join(", ", callees.Take(15).Select(p => p.Node.Name))}");
        }

        if (includeCode)
        {
            var code = engine.GetCode(node.Id).GetAwaiter().GetResult();
            if (!string.IsNullOrEmpty(code))
            {
                sb.AppendLine();
                sb.AppendLine("```" + node.Language);
                sb.AppendLine(code);
                sb.AppendLine("```");
            }
        }

        return new CodeGraphToolResult(true, sb.ToString().TrimEnd(), false);
    }

    private static CodeGraphToolResult NodeFileMode(CodeGraphEngine engine, string file, JsonElement args)
    {
        var rel = CodeGraphPathSafety.NormalizePath(file);
        var abs = CodeGraphPathSafety.ValidatePathWithinRoot(engine.ProjectRoot, rel);
        if (abs is null || !File.Exists(abs))
        {
            return new CodeGraphToolResult(true, $"File not found in the index: {file}", false);
        }

        string[] lines;
        try
        {
            lines = File.ReadAllLines(abs);
        }
        catch (Exception ex)
        {
            return InternalTool($"Failed to read {file}: {ex.Message}");
        }

        var offset = Math.Max(1, JsonHelpers.GetInt(args, "offset", 1));
        var limit = Math.Clamp(JsonHelpers.GetInt(args, "limit", 2000), 1, 2000);
        var start = offset - 1;
        var end = Math.Min(lines.Length, start + limit);

        var sb = new StringBuilder();
        sb.AppendLine($"**`{rel}`**");
        for (var i = start; i < end; i++)
        {
            sb.AppendLine($"{i + 1}\t{lines[i]}");
        }

        var dependents = engine.GetFileDependents(rel);
        if (dependents.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine($"Dependents ({dependents.Count}): {string.Join(", ", dependents.Take(10))}");
        }

        return new CodeGraphToolResult(true, sb.ToString().TrimEnd(), false);
    }

    // workingFolder (or the MCP-tool alias projectPath). null when neither is present
    // -> the "no default project" not_indexed path.
    private static string? ResolveWorkingFolder(JsonElement args)
    {
        var wf = JsonHelpers.GetString(args, "workingFolder");
        if (string.IsNullOrWhiteSpace(wf))
        {
            wf = JsonHelpers.GetString(args, "projectPath");
        }

        return string.IsNullOrWhiteSpace(wf) ? null : wf.Trim();
    }

    // WishfulClaw: the host (main-process IPC) may pass an explicit per-project data
    // dir (`dataRoot`, e.g. {workingFolder}/.wishful-claw/codegraph). Registering it
    // BEFORE any engine open / IsInitialized check routes the graph DB project-locally
    // (see CodeGraphDataRootRegistry). Absent arg = centralized default.
    private static void RegisterDataRoot(JsonElement args)
    {
        var root = ResolveWorkingFolder(args);
        if (string.IsNullOrEmpty(root) || args.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        if (args.TryGetProperty("dataRoot", out var dr) && dr.ValueKind == JsonValueKind.String)
        {
            CodeGraphDataRootRegistry.Register(root, dr.GetString());
        }
    }

    // Symbol -> candidate defs, narrowed by an optional file substring then an optional
    // exact start line. Filters are only applied when they leave at least one match.
    private static List<CodeGraphNode> ResolveSymbolNodes(
        CodeGraphEngine engine, string symbol, string? file, int? line, string? kind = null)
    {
        var nodes = engine.GetNodesByName(symbol);
        if (!string.IsNullOrWhiteSpace(kind))
        {
            nodes = nodes
                .Where(n => string.Equals(n.Kind, kind, StringComparison.OrdinalIgnoreCase))
                .ToList();
        }
        if (!string.IsNullOrWhiteSpace(file))
        {
            var f = CodeGraphPathSafety.NormalizePath(file);
            var filtered = nodes
                .Where(n => string.Equals(n.FilePath, f, StringComparison.Ordinal) || n.FilePath.EndsWith(f, StringComparison.Ordinal))
                .ToList();
            if (filtered.Count > 0)
            {
                nodes = filtered;
            }
        }

        if (line is { } ln)
        {
            var byLine = nodes.Where(n => n.StartLine == ln).ToList();
            if (byLine.Count > 0)
            {
                nodes = byLine;
            }
        }

        return nodes;
    }

    private static string FormatNode(CodeGraphNode n) => $"- {n.Name} ({n.Kind}) — {n.FilePath}:{n.StartLine}";

    private static string FormatBytes(long bytes)
    {
        if (bytes < 1024)
        {
            return $"{bytes} B";
        }

        if (bytes < 1024 * 1024)
        {
            return $"{bytes / 1024.0:0.0} KB";
        }

        return $"{bytes / (1024.0 * 1024.0):0.0} MB";
    }

    // ---- Result envelopes (reference/02 §4.3) --------------------------------

    private static CodeGraphToolResult NotIndexedTool() => new(
        true,
        "CodeGraph has no index for this project yet. Index it first (the app's Index action, or the "
            + "codegraph/index method), then retry. Meanwhile, use Read/Grep to inspect files.",
        false,
        CodeGraphErrorKind.NotIndexed);

    private static CodeGraphToolResult PathRefusalTool(string path) => new(
        false,
        $"Refused to operate on a sensitive path: {path}. CodeGraph will not index home/root/system directories.",
        true,
        CodeGraphErrorKind.PathRefusal);

    private static CodeGraphToolResult InvalidArgsTool(string message) =>
        new(true, message, false, CodeGraphErrorKind.InvalidArgs);

    private static CodeGraphToolResult InternalTool(string message) => new(
        false,
        $"CodeGraph hit an internal error: {message}. Retry once; if it persists, continue without codegraph (use Read/Grep).",
        true,
        CodeGraphErrorKind.Internal);

    private static CodeGraphIndexResponse IndexFail(string indexId, string error, string kind) =>
        new(false, indexId, "failed", 0, 0, 0, 0, 0, null, error, kind);

    private static WorkerResponse Tool(CodeGraphToolResult result) =>
        WorkerResponse.Json(result, CodeGraphJsonContext.Default.CodeGraphToolResult);

    private static async Task EmitCompleteSafe(IWorkerRequestContext? ctx, string indexId, string state, string? error)
    {
        if (ctx is null)
        {
            return;
        }

        try
        {
            await ctx.EmitEventIgnoringCancellationAsync(
                "codegraph/index-complete",
                new CodeGraphIndexComplete(indexId, state, 0, 0, 0, 0, error),
                CodeGraphJsonContext.Default.CodeGraphIndexComplete).ConfigureAwait(false);
        }
        catch
        {
            // terminal frame is best-effort.
        }
    }

    // Refused/sensitive roots (reference/02 §4.1, analysis/05 §2.9): the filesystem
    // root, the user's home directory, and well-known system dirs. A guard, so it is
    // deliberately conservative.
    private static bool IsRefusedRoot(string path)
    {
        string full;
        try
        {
            full = Path.GetFullPath(path);
        }
        catch
        {
            return false;
        }

        var normalized = full.Replace('\\', '/').TrimEnd('/');
        if (normalized.Length == 0)
        {
            return true; // "/" collapsed to empty.
        }

        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;

        // A filesystem root: on POSIX GetPathRoot is "/" (trims to empty — the genuine
        // "/" is already caught above); on Windows it is e.g. "C:\" -> "C:". Only refuse
        // when the whole path IS that root, never a subpath of it.
        var pathRoot = Path.GetPathRoot(full);
        if (!string.IsNullOrEmpty(pathRoot))
        {
            var normRoot = pathRoot.Replace('\\', '/').TrimEnd('/');
            if (normRoot.Length > 0 && string.Equals(normalized, normRoot, comparison))
            {
                return true;
            }
        }

        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (string.IsNullOrEmpty(home))
        {
            home = Environment.GetEnvironmentVariable("HOME");
        }

        if (!string.IsNullOrEmpty(home))
        {
            var normHome = Path.GetFullPath(home).Replace('\\', '/').TrimEnd('/');
            if (string.Equals(normalized, normHome, comparison))
            {
                return true;
            }
        }

        foreach (var sensitive in SensitiveDirs)
        {
            if (string.Equals(normalized, sensitive, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    private static readonly string[] SensitiveDirs =
    {
        "/etc", "/private/etc", "/var", "/usr", "/bin", "/sbin", "/sys", "/proc", "/boot", "/dev", "/root"
    };

    // Bridges the facade's IProgress<CodeGraphIndexProgress> to streamed
    // codegraph/index-progress events. Best-effort (fire-and-forget) — the per-
    // connection write lock serializes the frames.
    private sealed class EventProgress : IProgress<CodeGraphIndexProgress>
    {
        private readonly IWorkerRequestContext ctx;
        private readonly string indexId;

        public EventProgress(IWorkerRequestContext ctx, string indexId)
        {
            this.ctx = ctx;
            this.indexId = indexId;
        }

        public void Report(CodeGraphIndexProgress value) =>
            FireAndForget(ctx.EmitEventAsync(
                "codegraph/index-progress",
                new CodeGraphIndexProgressEvent(indexId, MapPhase(value.Phase), value.Current, value.Total, 0, 0, value.File),
                CodeGraphJsonContext.Default.CodeGraphIndexProgressEvent));

        // scanning|indexing|resolving|complete (facade) -> scan|extract|resolve|complete
        // (reference/02 §3.1 phase vocabulary).
        private static string MapPhase(string phase) => phase switch
        {
            "scanning" => "scan",
            "indexing" => "extract",
            "resolving" => "resolve",
            "complete" => "complete",
            _ => phase
        };

        private static void FireAndForget(ValueTask task)
        {
            if (task.IsCompletedSuccessfully)
            {
                return;
            }

            _ = Observe(task);

            static async Task Observe(ValueTask t)
            {
                try
                {
                    await t.ConfigureAwait(false);
                }
                catch
                {
                    // progress is advisory.
                }
            }
        }
    }
}

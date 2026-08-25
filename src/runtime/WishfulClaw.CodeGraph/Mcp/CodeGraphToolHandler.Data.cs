using System.Text.Json;

// =============================================================================
// CodeGraphToolHandler — structured (JSON DTO, NOT tool-shaped) read handlers that
// back the app's visualization UI (plan/codex-graph/07): index-status, stats,
// query-neighbors, files-tree. Unlike the agent-facing tool handlers these return
// structured data (counts, buckets, node/edge/file arrays) the renderer charts and
// graph canvas consume directly, instead of markdown text.
//
// Same error convention as the tool handlers (reference/02 §1.3): every DTO carries
// Success/Error/ErrorKind and the JS promise RESOLVES — never rejects. not_indexed is
// success-shaped (empty data + guidance); path_refusal/internal are hard (Success:false).
// These reads deliberately do NOT auto-index (unlike RunTool) — the dashboard indexes
// explicitly via the app's Index action, so a status/stats read stays instant.
// =============================================================================
internal static partial class CodeGraphToolHandler
{
    private const string SqliteBackend = "microsoft.data.sqlite";

    // Resolve args -> a serialized engine handle, or an error kind + message for the
    // envelope. Never throws; never auto-indexes.
    private readonly record struct ReadTarget(EngineHandle? Handle, string? ErrorKind, string? Message);

    private static ReadTarget ResolveRead(JsonElement args)
    {
        var root = ResolveWorkingFolder(args);
        if (string.IsNullOrEmpty(root))
        {
            return new ReadTarget(null, CodeGraphErrorKind.NotIndexed, "No project specified.");
        }

        if (IsRefusedRoot(root))
        {
            return new ReadTarget(null, CodeGraphErrorKind.PathRefusal, $"Refused to operate on a sensitive path: {root}");
        }

        if (!CodeGraphEngine.IsInitialized(root))
        {
            return new ReadTarget(null, CodeGraphErrorKind.NotIndexed, "Project is not indexed; index it first.");
        }

        try
        {
            return new ReadTarget(EnsureHandle(root), null, null);
        }
        catch (Exception ex)
        {
            return new ReadTarget(null, CodeGraphErrorKind.Internal, ex.Message);
        }
    }

    // not_indexed is success-shaped (the app shows an "index this project" prompt);
    // path_refusal / internal are hard failures.
    private static bool IsSuccessShaped(string? errorKind) => errorKind == CodeGraphErrorKind.NotIndexed;

    // ---- codegraph/index-status -------------------------------------------------

    internal static CodeGraphIndexStatus IndexStatus(JsonElement args)
    {
        var target = ResolveRead(args);
        if (target.Handle is null)
        {
            // not_indexed (incl. "no project") -> indexed:false, success-shaped.
            // path_refusal / internal -> hard, indexed:false.
            return new CodeGraphIndexStatus(
                Success: IsSuccessShaped(target.ErrorKind),
                Indexed: false,
                State: null,
                Indexing: false,
                LastIndexedAt: null,
                FileCount: 0,
                NodeCount: 0,
                EdgeCount: 0,
                PendingReferenceCount: 0,
                DbSizeBytes: 0,
                Backend: SqliteBackend,
                JournalMode: "wal",
                Stale: false,
                IndexedWithVersion: null,
                Error: IsSuccessShaped(target.ErrorKind) ? null : target.Message,
                ErrorKind: target.ErrorKind);
        }

        target.Handle.Gate.Wait();
        try
        {
            var engine = target.Handle.Engine;
            var stats = engine.GetStats();
            var state = engine.GetIndexState();
            return new CodeGraphIndexStatus(
                Success: true,
                Indexed: true,
                State: state,
                Indexing: state == "indexing" || IsAutoIndexing(engine.ProjectRoot),
                LastIndexedAt: engine.GetLastIndexedAt(),
                FileCount: stats.FileCount,
                NodeCount: stats.NodeCount,
                EdgeCount: stats.EdgeCount,
                PendingReferenceCount: engine.GetPendingReferenceCount(),
                DbSizeBytes: stats.DbSizeBytes,
                Backend: SqliteBackend,
                JournalMode: engine.GetJournalMode(),
                Stale: engine.IsIndexStale(),
                IndexedWithVersion: engine.GetIndexBuildInfo().Version);
        }
        catch (Exception ex)
        {
            return new CodeGraphIndexStatus(
                false, false, null, false, null, 0, 0, 0, 0, 0, SqliteBackend, "wal", false, null, ex.Message, CodeGraphErrorKind.Internal);
        }
        finally
        {
            target.Handle.Gate.Release();
        }
    }

    private static bool IsAutoIndexing(string projectRoot) =>
        AutoIndexTasks.TryGetValue(Path.GetFullPath(projectRoot), out var task) && !task.IsCompleted;

    // ---- codegraph/stats --------------------------------------------------------

    internal static CodeGraphStatsResult Stats(JsonElement args)
    {
        var target = ResolveRead(args);
        if (target.Handle is null)
        {
            return new CodeGraphStatsResult(
                IsSuccessShaped(target.ErrorKind), 0, 0, 0,
                Array.Empty<CodeGraphCountBucket>(), Array.Empty<CodeGraphCountBucket>(), Array.Empty<CodeGraphCountBucket>(),
                0, 0, IsSuccessShaped(target.ErrorKind) ? null : target.Message, target.ErrorKind);
        }

        target.Handle.Gate.Wait();
        try
        {
            var stats = target.Handle.Engine.GetStats();
            return new CodeGraphStatsResult(
                Success: true,
                NodeCount: stats.NodeCount,
                EdgeCount: stats.EdgeCount,
                FileCount: stats.FileCount,
                NodesByKind: ToBuckets(stats.NodesByKind),
                EdgesByKind: ToBuckets(stats.EdgesByKind),
                FilesByLanguage: ToBuckets(stats.FilesByLanguage),
                DbSizeBytes: stats.DbSizeBytes,
                LastUpdated: stats.LastUpdated);
        }
        catch (Exception ex)
        {
            return new CodeGraphStatsResult(
                false, 0, 0, 0,
                Array.Empty<CodeGraphCountBucket>(), Array.Empty<CodeGraphCountBucket>(), Array.Empty<CodeGraphCountBucket>(),
                0, 0, ex.Message, CodeGraphErrorKind.Internal);
        }
        finally
        {
            target.Handle.Gate.Release();
        }
    }

    // Dictionary -> array of {key,count}, descending by count (charts want ranked bars;
    // no Map crosses the wire — reference/02 §2.3).
    private static IReadOnlyList<CodeGraphCountBucket> ToBuckets(IReadOnlyDictionary<string, int> counts) =>
        counts
            .Select(kv => new CodeGraphCountBucket(kv.Key, kv.Value))
            .OrderByDescending(b => b.Count)
            .ThenBy(b => b.Key, StringComparer.Ordinal)
            .ToList();

    // ---- codegraph/analytics -----------------------------------------------------
    // Circular file-dependency cycles + dead-code candidates for the viz page
    // (M7-W3). Both lists are capped — the panels rank the worst offenders, they
    // don't enumerate exhaustively — with the uncapped totals alongside. Runs on
    // demand (the DFS + per-node incoming-edge scans are too heavy for auto-load
    // on 15k-file repos).

    private const int MaxAnalyticsCycles = 50;
    private const int MaxAnalyticsDeadCode = 200;

    internal static CodeGraphAnalyticsResult Analytics(JsonElement args)
    {
        var target = ResolveRead(args);
        if (target.Handle is null)
        {
            return new CodeGraphAnalyticsResult(
                IsSuccessShaped(target.ErrorKind),
                Array.Empty<CodeGraphCycleView>(), 0,
                Array.Empty<CodeGraphDeadSymbolView>(), 0,
                IsSuccessShaped(target.ErrorKind) ? null : target.Message, target.ErrorKind);
        }

        target.Handle.Gate.Wait();
        try
        {
            var engine = target.Handle.Engine;

            var allCycles = engine.FindCircularDependencies();
            var cycles = new List<CodeGraphCycleView>(Math.Min(allCycles.Count, MaxAnalyticsCycles));
            foreach (var cycle in allCycles)
            {
                if (cycles.Count >= MaxAnalyticsCycles)
                {
                    break;
                }

                cycles.Add(new CodeGraphCycleView(cycle));
            }

            var allDead = engine.FindDeadCode();
            // Stable panel order: path, then line — independent of kind-loop order.
            allDead.Sort((a, b) =>
            {
                var byPath = string.CompareOrdinal(a.FilePath, b.FilePath);
                return byPath != 0 ? byPath : a.StartLine.CompareTo(b.StartLine);
            });
            var dead = new List<CodeGraphDeadSymbolView>(Math.Min(allDead.Count, MaxAnalyticsDeadCode));
            foreach (var node in allDead)
            {
                if (dead.Count >= MaxAnalyticsDeadCode)
                {
                    break;
                }

                dead.Add(new CodeGraphDeadSymbolView(node.Id, node.Name, node.Kind, node.FilePath, node.StartLine));
            }

            return new CodeGraphAnalyticsResult(true, cycles, allCycles.Count, dead, allDead.Count);
        }
        catch (Exception ex)
        {
            return new CodeGraphAnalyticsResult(
                false,
                Array.Empty<CodeGraphCycleView>(), 0,
                Array.Empty<CodeGraphDeadSymbolView>(), 0,
                ex.Message, CodeGraphErrorKind.Internal);
        }
        finally
        {
            target.Handle.Gate.Release();
        }
    }

    // ---- codegraph/query-neighbors ---------------------------------------------

    internal static CodeGraphSubgraphResult QueryNeighbors(JsonElement args)
    {
        var target = ResolveRead(args);
        if (target.Handle is null)
        {
            return new CodeGraphSubgraphResult(
                IsSuccessShaped(target.ErrorKind),
                Array.Empty<CodeGraphNodeView>(), Array.Empty<CodeGraphEdgeView>(), Array.Empty<string>(),
                null, IsSuccessShaped(target.ErrorKind) ? null : target.Message, target.ErrorKind);
        }

        target.Handle.Gate.Wait();
        try
        {
            var engine = target.Handle.Engine;

            // Start node: explicit nodeId, else resolve a symbol name (optionally
            // narrowed by file/line). No start -> success-shaped empty subgraph.
            var startId = JsonHelpers.GetString(args, "nodeId");
            if (string.IsNullOrWhiteSpace(startId))
            {
                var symbol = JsonHelpers.GetString(args, "symbol");
                if (!string.IsNullOrWhiteSpace(symbol))
                {
                    var defs = ResolveSymbolNodes(
                        engine, symbol!, JsonHelpers.GetString(args, "file"), JsonHelpers.GetIntNullable(args, "line"));
                    startId = defs.Count > 0 ? defs[0].Id : null;
                }
            }

            if (string.IsNullOrWhiteSpace(startId))
            {
                return new CodeGraphSubgraphResult(
                    true, Array.Empty<CodeGraphNodeView>(), Array.Empty<CodeGraphEdgeView>(), Array.Empty<string>(), null);
            }

            var depth = Math.Clamp(JsonHelpers.GetInt(args, "depth", 1), 1, 4);
            var limit = Math.Clamp(JsonHelpers.GetInt(args, "limit", 100), 1, 500);
            var edgeKinds = JsonHelpers.GetStringArray(args, "edgeKinds");

            var options = new CodeGraphTraversalOptions
            {
                MaxDepth = depth,
                Limit = limit,
                Direction = CodeGraphTraversalDirection.Both,
                IncludeStart = true,
                EdgeKinds = edgeKinds is { Length: > 0 } ? edgeKinds : null
            };

            var sub = engine.Traverse(startId!, options);
            return new CodeGraphSubgraphResult(
                Success: true,
                Nodes: sub.Nodes.Values.Select(CodeGraphNodeView.From).ToList(),
                Edges: sub.Edges.Select(CodeGraphEdgeView.From).ToList(),
                Roots: sub.Roots.ToList(),
                Confidence: sub.Confidence);
        }
        catch (Exception ex)
        {
            return new CodeGraphSubgraphResult(
                false, Array.Empty<CodeGraphNodeView>(), Array.Empty<CodeGraphEdgeView>(), Array.Empty<string>(),
                null, ex.Message, CodeGraphErrorKind.Internal);
        }
        finally
        {
            target.Handle.Gate.Release();
        }
    }

    // ---- codegraph/files-tree ---------------------------------------------------

    internal static CodeGraphFilesResult FilesTree(JsonElement args)
    {
        var target = ResolveRead(args);
        if (target.Handle is null)
        {
            return new CodeGraphFilesResult(
                IsSuccessShaped(target.ErrorKind), Array.Empty<CodeGraphFileNode>(),
                IsSuccessShaped(target.ErrorKind) ? null : target.Message, target.ErrorKind);
        }

        target.Handle.Gate.Wait();
        try
        {
            IEnumerable<CodeGraphFileRecord> files = target.Handle.Engine.GetFiles();

            var pathFilter = JsonHelpers.GetString(args, "path");
            if (!string.IsNullOrWhiteSpace(pathFilter))
            {
                var prefix = CodeGraphPathSafety.NormalizePath(pathFilter).TrimEnd('/');
                files = files.Where(x => x.Path.StartsWith(prefix, StringComparison.Ordinal));
            }

            var list = files
                .OrderBy(x => x.Path, StringComparer.Ordinal)
                .Select(f => new CodeGraphFileNode(f.Path, f.Language, f.NodeCount, f.Size, f.IndexedAt))
                .ToList();

            return new CodeGraphFilesResult(true, list);
        }
        catch (Exception ex)
        {
            return new CodeGraphFilesResult(false, Array.Empty<CodeGraphFileNode>(), ex.Message, CodeGraphErrorKind.Internal);
        }
        finally
        {
            target.Handle.Gate.Release();
        }
    }

    // ---- codegraph/file-symbols -------------------------------------------------
    // Structured symbol list for one indexed file — the file tree's "click a file ->
    // its symbols" drill-down, and the graph-canvas seed (click a symbol -> neighbors).

    internal static CodeGraphNodeListResult FileSymbols(JsonElement args)
    {
        var target = ResolveRead(args);
        if (target.Handle is null)
        {
            return new CodeGraphNodeListResult(
                IsSuccessShaped(target.ErrorKind), Array.Empty<CodeGraphNodeView>(),
                IsSuccessShaped(target.ErrorKind) ? null : target.Message, target.ErrorKind);
        }

        var file = JsonHelpers.GetString(args, "file");
        if (string.IsNullOrWhiteSpace(file))
        {
            return new CodeGraphNodeListResult(
                false, Array.Empty<CodeGraphNodeView>(), "`file` is required.", CodeGraphErrorKind.InvalidArgs);
        }

        target.Handle.Gate.Wait();
        try
        {
            var rel = CodeGraphPathSafety.NormalizePath(file!);
            var nodes = target.Handle.Engine.GetNodesInFile(rel);
            return new CodeGraphNodeListResult(
                true, nodes.OrderBy(n => n.StartLine).Select(CodeGraphNodeView.From).ToList());
        }
        catch (Exception ex)
        {
            return new CodeGraphNodeListResult(false, Array.Empty<CodeGraphNodeView>(), ex.Message, CodeGraphErrorKind.Internal);
        }
        finally
        {
            target.Handle.Gate.Release();
        }
    }

    // ---- RPC adapters (module registration) ------------------------------------

    internal static WorkerResponse IndexStatusRpc(JsonElement args) =>
        WorkerResponse.Json(IndexStatus(args), CodeGraphJsonContext.Default.CodeGraphIndexStatus);

    internal static WorkerResponse StatsRpc(JsonElement args) =>
        WorkerResponse.Json(Stats(args), CodeGraphJsonContext.Default.CodeGraphStatsResult);

    internal static WorkerResponse AnalyticsRpc(JsonElement args) =>
        WorkerResponse.Json(Analytics(args), CodeGraphJsonContext.Default.CodeGraphAnalyticsResult);

    internal static WorkerResponse QueryNeighborsRpc(JsonElement args) =>
        WorkerResponse.Json(QueryNeighbors(args), CodeGraphJsonContext.Default.CodeGraphSubgraphResult);

    internal static WorkerResponse FilesTreeRpc(JsonElement args) =>
        WorkerResponse.Json(FilesTree(args), CodeGraphJsonContext.Default.CodeGraphFilesResult);

    internal static WorkerResponse FileSymbolsRpc(JsonElement args) =>
        WorkerResponse.Json(FileSymbols(args), CodeGraphJsonContext.Default.CodeGraphNodeListResult);
}

// ---------------------------------------------------------------------------
// Structured-read result DTOs (plan/codex-graph/07 §2). Serialized via
// CodeGraphJsonContext (source-gen, camelCase, null-omitted). Every DTO carries the
// Success/Error/ErrorKind envelope (reference/02 §4.1).
// ---------------------------------------------------------------------------

// codegraph/index-status — structured freshness/health snapshot for the app UI
// (distinct from the agent-facing markdown codegraph/status). indexed:false is
// success-shaped, not an error.
internal sealed record CodeGraphIndexStatus(
    bool Success,
    bool Indexed,
    string? State,
    bool Indexing,
    long? LastIndexedAt,
    int FileCount,
    int NodeCount,
    int EdgeCount,
    int PendingReferenceCount,
    long DbSizeBytes,
    string Backend,
    string JournalMode,
    bool Stale,
    string? IndexedWithVersion,
    string? Error = null,
    string? ErrorKind = null);

// A ranked {key,count} bucket — one bar in a distribution chart.
internal sealed record CodeGraphCountBucket(string Key, int Count);

// codegraph/stats — node/edge/file totals + the three ranked distributions the
// dashboard charts (nodesByKind / edgesByKind / filesByLanguage).
internal sealed record CodeGraphStatsResult(
    bool Success,
    int NodeCount,
    int EdgeCount,
    int FileCount,
    IReadOnlyList<CodeGraphCountBucket> NodesByKind,
    IReadOnlyList<CodeGraphCountBucket> EdgesByKind,
    IReadOnlyList<CodeGraphCountBucket> FilesByLanguage,
    long DbSizeBytes,
    long LastUpdated,
    string? Error = null,
    string? ErrorKind = null);

// codegraph/query-neighbors — local subgraph around a node/symbol for the graph
// canvas. Nodes/Edges are serialized as arrays (never the internal Map).
internal sealed record CodeGraphSubgraphResult(
    bool Success,
    IReadOnlyList<CodeGraphNodeView> Nodes,
    IReadOnlyList<CodeGraphEdgeView> Edges,
    IReadOnlyList<string> Roots,
    string? Confidence = null,
    string? Error = null,
    string? ErrorKind = null);

// One indexed file for the interactive file tree.
internal sealed record CodeGraphFileNode(
    string Path,
    string Language,
    int NodeCount,
    long Size,
    long? IndexedAt);

// codegraph/files-tree — the flat indexed-file list (the renderer folds it into a
// collapsible tree). Distinct from the agent-facing markdown codegraph/files.
internal sealed record CodeGraphFilesResult(
    bool Success,
    IReadOnlyList<CodeGraphFileNode> Files,
    string? Error = null,
    string? ErrorKind = null);

// codegraph/file-symbols — the structured symbols of one file (file-tree drill-down +
// graph-canvas seed). Nodes serialize as a line-ordered array.
internal sealed record CodeGraphNodeListResult(
    bool Success,
    IReadOnlyList<CodeGraphNodeView> Nodes,
    string? Error = null,
    string? ErrorKind = null);

// codegraph/analytics — on-demand graph health panels (M7-W3). Cycles are file-path
// rings from the file-dependency DFS; dead-code rows are non-exported symbols with no
// non-contains incoming edge. Lists capped (50 / 200) with uncapped totals alongside.
internal sealed record CodeGraphAnalyticsResult(
    bool Success,
    IReadOnlyList<CodeGraphCycleView> CircularDependencies,
    int CircularTotal,
    IReadOnlyList<CodeGraphDeadSymbolView> DeadCode,
    int DeadCodeTotal,
    string? Error = null,
    string? ErrorKind = null);

internal sealed record CodeGraphCycleView(IReadOnlyList<string> Files);

internal sealed record CodeGraphDeadSymbolView(
    string Id,
    string Name,
    string Kind,
    string FilePath,
    int StartLine);

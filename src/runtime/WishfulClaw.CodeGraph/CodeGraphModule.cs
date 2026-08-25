// The single IWorkerModule for the CodeGraph sidecar (reference/06 §3, §9: one module,
// Name="codegraph", every method prefixed "codegraph/"). Global namespace, CodeGraph*
// prefix. M0 wired two stub methods; M5 expands this into the real query/index/tool
// surface, each method delegating to a static CodeGraphToolHandler handler (the DbModule
// shape). Every method string must be globally unique (a duplicate throws at startup).
//
// Error convention (reference/06 §3.3): WorkerResponse.Error RESOLVES (does not reject)
// on the JS side, so success/failure is modelled inside the result DTO
// (Success/IsError/ErrorKind), never via a thrown promise.
internal sealed class CodeGraphModule : IWorkerModule
{
    public string Name => "codegraph";

    public void Register(IWorkerModuleContext context)
    {
        // Kept from M0: the raw FTS5/SQLite round-trip probe (no input).
        context.Register("codegraph/db-smoke", _ =>
            WorkerResponse.Json(
                CodeGraphDbSmoke.Run(),
                CodeGraphJsonContext.Default.CodeGraphDbSmokeResult));

        // Lifecycle / index — the IWorkerRequestContext overload so index/sync can stream
        // codegraph/index-progress + codegraph/index-complete while they run.
        context.Register("codegraph/index", CodeGraphToolHandler.IndexRpc);
        context.Register("codegraph/sync", CodeGraphToolHandler.SyncRpc);

        // Tool-shaped queries (CodeGraphToolResult text the agent consumes verbatim).
        context.Register("codegraph/status", CodeGraphToolHandler.StatusRpc);
        context.Register("codegraph/explore", CodeGraphToolHandler.ExploreRpc);
        context.Register("codegraph/search", CodeGraphToolHandler.SearchRpc);
        context.Register("codegraph/node", CodeGraphToolHandler.NodeRpc);
        context.Register("codegraph/callers", CodeGraphToolHandler.CallersRpc);
        context.Register("codegraph/callees", CodeGraphToolHandler.CalleesRpc);
        context.Register("codegraph/impact", CodeGraphToolHandler.ImpactRpc);
        context.Register("codegraph/files", CodeGraphToolHandler.FilesRpc);

        // Structured (JSON DTO) reads for the app visualization UI (plan/codex-graph/07):
        // health snapshot, distribution stats, local subgraph, and the file tree. Distinct
        // from the agent-facing markdown status/files — these feed charts + the graph canvas.
        context.Register("codegraph/index-status", CodeGraphToolHandler.IndexStatusRpc);
        context.Register("codegraph/stats", CodeGraphToolHandler.StatsRpc);
        context.Register("codegraph/analytics", CodeGraphToolHandler.AnalyticsRpc);
        context.Register("codegraph/prompt-context", CodeGraphToolHandler.PromptContextRpc);
        context.Register("codegraph/query-neighbors", CodeGraphToolHandler.QueryNeighborsRpc);
        context.Register("codegraph/files-tree", CodeGraphToolHandler.FilesTreeRpc);
        context.Register("codegraph/file-symbols", CodeGraphToolHandler.FileSymbolsRpc);

        // Tool surface — static definitions (default = codegraph_explore) + the playbook.
        // Management surface for the plugin settings UI.
        context.Register("codegraph/list-projects", CodeGraphAdminTools.ListProjectsRpc);
        context.Register("codegraph/remove-project", CodeGraphAdminTools.RemoveProjectRpc);

        context.Register("codegraph/tools-list", CodeGraphToolHandler.ToolsListRpc);
        context.Register("codegraph/instructions", CodeGraphToolHandler.InstructionsRpc);
    }
}

using WishfulClaw.Agent;
using WishfulClaw.Agent.Tools;
using WishfulClaw.Agent.Tools.FileTools;
using WishfulClaw.Agent.Tools.MemoryTools;
using WishfulClaw.Agent.Tools.Providers;
using WishfulClaw.Agent.Tools.SearchTools;
using WishfulClaw.Agent.Tools.ShellTools;
using WishfulClaw.Core.Tools;
using WishfulClaw.Workspace.Memory;

namespace WishfulClaw.ProviderHeaderRegressionTests;

/// <summary>
/// Builds the production-shaped tool registry the visibility suites share.
///
/// This used to also expose two export switches (<c>--dump-snapshot</c> / <c>--derive-admission</c>)
/// backing the R-3.3 golden digest and the declaration sweep. Both were one-off tools for that
/// refactor and have been dropped with the golden; the registry construction is what the remaining
/// suites still need, so they all assert against the same tool set rather than each building
/// their own.
/// </summary>
internal static class VisibilitySnapshotDump
{
    /// <summary>
    /// Mirrors the provider list in <c>ToolModule.Register</c> plus its direct executors, so the
    /// snapshot covers every name the registry can hand out rather than only the provider surface.
    ///
    /// The executors are constructed, never executed, so nothing touches the filesystem. The two
    /// exceptions are handled at the call site: <c>memory_search</c> gets a stub <c>IMemorySearch</c>
    /// instead of <c>MemoryFtsService</c> (which would open the user's index.db), and <c>TaskTool</c>
    /// skips <c>SubAgentRegistry.LoadFromDisk()</c> (it only feeds the description, and the snapshot
    /// records names).
    /// </summary>
    internal static ToolRegistry BuildProductionRegistry()
    {
        IToolProvider[] providers =
        [
            new AskUserToolProvider(),
            new BrowserToolProvider(),
            new ChannelPluginToolProvider(),
            new CodeGraphToolProvider(),
            new CodeCompatibleToolProvider(),
            new CronToolProvider(),
            new DesktopToolProvider(),
            new GlobalDispatchReplyToolProvider(),
            new GlobalTaskToolsProvider(),
            new GoalToolProvider(),
            new ImageGenerateToolProvider(),
            new NotebookToolProvider(),
            new PlanToolProvider(),
            new PluginToolProvider(),
            new ProjectToolsProvider(),
            new SkillManagementToolProvider(),
            new SkillToolProvider(),
            new SshToolProvider(),
            new TaskToolProvider(),
            new TeamToolProvider(),
            new UseCapabilityToolProvider(),
            new WebToolProvider(),
            new WidgetToolProvider(),
        ];

        var registry = new ToolRegistry();
        foreach (var provider in providers.OrderBy(p => p.GetType().Name, StringComparer.Ordinal))
        {
            registry.PushCategory(provider.Category);
            provider.RegisterTools(registry);
            registry.PopCategory();
        }

        RegisterDirectExecutors(registry);
        return registry;
    }

    /// <summary>
    /// Same list and same categories as <c>ToolModule.RegisterDirectExecutors</c>.
    /// </summary>
    private static void RegisterDirectExecutors(ToolRegistry registry)
    {
        registry.Register(new FileReadTool(), "file");
        registry.Register(new FileWriteTool(), "file");
        registry.Register(new FileEditTool(), "file");
        registry.Register(new FileListTool(), "file");

        registry.Register(new GlobTool(), "search");
        registry.Register(new GrepTool(), "search");

        registry.Register(new ShellExecuteTool(), "shell");

        registry.Register(new TaskTool(), "task");
        registry.Register(new SubAgentStatusTool(), "task");
        registry.Register(new SubAgentDetailTool(), "task");

        registry.Register(new MemoryHotReadTool(), "memory");
        registry.Register(new MemoryHotWriteTool(), "memory");
        registry.Register(new MemoryAppendTool(), "memory");
        registry.Register(new MemoryUpdateTool(), "memory");
        registry.Register(new MemorySearchTool(new EmptyMemorySearch()), "memory");
    }

    private sealed class EmptyMemorySearch : IMemorySearch
    {
        public Task<IReadOnlyList<MemorySearchResult>> SearchAsync(
            string query,
            string? scope = null,
            int limit = 10,
            bool includeDeprecated = false,
            long? from = null,
            long? to = null,
            CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<MemorySearchResult>>(Array.Empty<MemorySearchResult>());
    }
}

using System.Text;
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
/// Snapshot dump used to prove a refactor of the admission logic changes nothing.
///
/// Invoked as <c>dotnet &lt;test dll&gt; --dump-snapshot &lt;path&gt;</c> from the main entry point
/// rather than as a second <c>Main</c>, because one assembly can only have one entry point.
/// Run before and after the change and diff the two outputs: under the B-scope rule
/// ("mechanism only") the diff must be empty.
/// </summary>
internal static class VisibilitySnapshotDump
{
    public const string Switch = "--dump-snapshot";

    /// <summary>Export switch for the per-tool admission vectors that back the declaration sweep.</summary>
    public const string DeriveSwitch = "--derive-admission";

    public static int Run(string path)
    {
        var registry = BuildProductionRegistry();
        var digest = VisibilitySnapshot.Build(registry);
        VisibilitySnapshot.AssertNonTrivial(digest);

        File.WriteAllText(path, digest);
        Console.WriteLine($"Snapshot written to {path} ({digest.Length} chars).");
        return 0;
    }

    /// <summary>
    /// Canonical contexts whose admission answer a per-tool declaration has to reproduce.
    ///
    /// Only three roles are probed: after the collapse, <c>automation</c> reads as cowork and
    /// <c>pet</c>/<c>translation</c>/<c>providerturn</c> read as chat, so their bits follow from the
    /// scope+mode pair already covered here instead of needing a column of their own.
    /// </summary>
    private static readonly (string Label, AgentRunContext Context, bool ChannelSession)[] AdmissionContexts =
    [
        ("project:chat", new AgentRunContext("project", "chat", "sessionagent"), false),
        ("global:chat", new AgentRunContext("global", "chat", "sessionagent"), false),
        ("global:channel", new AgentRunContext("global", "chat", "sessionagent"), true),
        ("project:cowork", new AgentRunContext("project", "cowork", "sessionagent"), false),
        ("project:chat@subagent", new AgentRunContext("project", "chat", "subagent"), false),
        ("project:cowork@subagent", new AgentRunContext("project", "cowork", "subagent"), false),
        ("project:cowork@goalsubagent", new AgentRunContext("project", "cowork", "goalsubagent"), false),
    ];

    /// <summary>
    /// Prints <c>name|1010101</c> per tool: today's admission answer for each of <see
    /// cref="AdmissionContexts"/>, straight from the enforcement entry point, so the vectors can be
    /// turned into <c>VisibleScopes</c>/<c>ExcludedScopes</c> declarations without re-deriving any rule.
    /// </summary>
    public static int RunDerive(string path)
    {
        var registry = BuildProductionRegistry();
        var builder = new StringBuilder();
        builder.Append("tool|").Append(string.Join("|", AdmissionContexts.Select(c => c.Label))).Append('\n');

        foreach (var name in registry.GetToolNames().OrderBy(n => n, StringComparer.Ordinal))
        {
            var bits = new StringBuilder();
            foreach (var (_, context, channelSession) in AdmissionContexts)
            {
                bits.Append(AgentRunContextPolicy.IsToolAllowed(context, name, registry, channelSession) ? '1' : '0');
            }

            builder.Append(name).Append('|').Append(bits).Append('\n');
        }

        File.WriteAllText(path, builder.ToString());
        Console.WriteLine($"Admission vectors for {registry.GetToolNames().Count} tools written to {path}.");
        return 0;
    }

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
            CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<MemorySearchResult>>(Array.Empty<MemorySearchResult>());
    }
}

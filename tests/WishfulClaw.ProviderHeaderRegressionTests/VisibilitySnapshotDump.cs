using WishfulClaw.Agent;
using WishfulClaw.Agent.Tools.Providers;
using WishfulClaw.Core.Tools;

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
    /// Mirrors the provider list in <c>ToolModule.Register</c>. The direct executors are omitted on
    /// purpose — they touch the filesystem and the database, and this snapshot is about the
    /// provider-declared surface.
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
        return registry;
    }
}

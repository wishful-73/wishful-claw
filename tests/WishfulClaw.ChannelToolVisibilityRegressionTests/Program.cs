using System.Text.Json;
using WishfulClaw.Agent;
using WishfulClaw.Agent.Tools.Providers;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.ChannelToolVisibilityRegressionTests;

/// <summary>
/// Pins the channel-session tool visibility contract: a channel session is a global session that
/// additionally carries chat-plugin tools and loses the interactive ones. The bug this guards was a
/// single filter layer disagreeing — <c>Resolve</c> forced scope to "global" while
/// <c>ResolveAvailableMode</c> still returned the literal "channel", so every tool whose
/// availableModes said "global" (project tools, plugin messaging) silently vanished.
/// </summary>
internal static class Program
{
    private const string ChannelParametersJson =
        """{"sessionMode":"channel","channelSession":true,"pluginId":"feishu","externalChatId":"oc_test"}""";

    private static readonly string[] ProjectTools =
    [
        "list_projects", "get_project_details", "create_session", "send_session_message"
    ];

    private static readonly string[] GlobalTaskTools =
    [
        "create_global_task", "list_global_tasks", "update_global_task",
        "list_global_dispatches", "update_dispatch", "send_work_request"
    ];

    private static readonly string[] PluginTools =
    [
        "PluginSendMessage", "PluginReplyMessage", "PluginGetGroupMessages",
        "PluginListGroups", "PluginSummarizeGroup", "PluginGetCurrentChatMessages"
    ];

    /// <summary>
    /// Representatives of the categories the channel preset must keep out: cron, desktop, team and
    /// skill-management. None of them is reachable by a chat reply, so seeing one here means the
    /// preset was widened rather than the mode being normalized.
    /// </summary>
    private static readonly string[] OverExposureTools =
    [
        "CronAdd", "CronCreate", "CronUpdate",
        "DesktopScreenshot", "DesktopClick", "DesktopType",
        "TeamCreate", "TeamStatus", "TeamDelete",
        "list_installed_skills"
    ];

    private static readonly string[] ChannelExcludedTools =
    [
        "visualize_show_widget", "AskUserQuestion", "ExitPlanMode"
    ];

    private static int _checks;

    public static int Main()
    {
        try
        {
            var registry = BuildProductionRegistry();
            var channelParameters = Parse(ChannelParametersJson);
            var runContext = AgentRunContextPolicy.Resolve(channelParameters);

            AssertChannelNormalization(channelParameters, runContext);

            var channelMode = AgentRunContextPolicy.ResolveAvailableMode(channelParameters, runContext);
            var presetVisible = ToolNames(registry.GetToolDefinitions(ToolPreset.BuiltIn["channel"], channelMode));

            AssertProjectToolsVisible(presetVisible);
            AssertPluginToolsVisible(presetVisible);
            AssertGlobalTaskToolsProxyOnly(registry, presetVisible);
            AssertNoOverExposure(presetVisible);
            AssertDesktopModeResolutionUnchanged();
            AssertDesktopProjectSessionNotLoosened(registry);
            AssertCapabilityProxySurvives(presetVisible);

            var agentVisible = ToolNames(AgentRunContextPolicy.FilterToolDefinitions(
                registry.GetToolDefinitions(ToolPreset.BuiltIn["channel"], channelMode),
                registry,
                runContext,
                channelSession: true));
            AssertAgentVisibleSet(registry, runContext, agentVisible);

            Console.WriteLine($"Channel tool visibility regression checks passed ({_checks} assertions).");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Channel tool visibility regression test failed: {ex}");
            return 1;
        }
    }

    // ── Group 1: the normalization itself ──

    private static void AssertChannelNormalization(JsonElement parameters, AgentRunContext runContext)
    {
        AssertEqual("global", runContext.Scope, "a channel session resolves to the global scope");
        AssertEqual("chat", runContext.CollaborationMode, "the global scope forces chat collaboration");
        AssertEqual(
            "global",
            AgentRunContextPolicy.ResolveAvailableMode(parameters, runContext),
            "the available-mode agrees with the scope instead of leaking the literal \"channel\"");
        Assert(
            AgentRunContextPolicy.IsChannelSession(parameters),
            "channel detection survives normalization — it drives the channel-only/excluded tool sets");
    }

    // ── Groups 2, 3, 5: layer 1 (preset + available-mode) ──

    private static void AssertProjectToolsVisible(HashSet<string> presetVisible)
    {
        AssertContainsAll(presetVisible, ProjectTools, "project tools are directly visible to a channel session");
    }

    private static void AssertPluginToolsVisible(HashSet<string> presetVisible)
    {
        AssertContainsAll(presetVisible, PluginTools, "plugin messaging tools stay visible in the global mode");
    }

    private static void AssertNoOverExposure(HashSet<string> presetVisible)
    {
        AssertContainsNone(presetVisible, OverExposureTools, "cron/desktop/team/skill-management stay out of a channel session");
    }

    // ── Group 4: global-task tools are proxy-only ──

    private static void AssertGlobalTaskToolsProxyOnly(ToolRegistry registry, HashSet<string> presetVisible)
    {
        // Layer 1 keeps them out because "global-task" is not a channel preset category. Layer 2 lets
        // them through, which is what makes the use_capability proxy able to call them.
        AssertContainsNone(presetVisible, GlobalTaskTools, "global-task tools are not directly visible to a channel session");
        foreach (var name in GlobalTaskTools)
        {
            Assert(
                registry.IsAvailableInMode(name, "global"),
                $"{name} is available in the global mode, so the capability proxy can still reach it");
        }
    }

    private static void AssertCapabilityProxySurvives(HashSet<string> presetVisible)
    {
        // Without the proxy the assertion above would be hollow: global-task tools are reachable only
        // through it, so its own visibility is part of the contract.
        Assert(presetVisible.Contains("use_capability"), "use_capability is visible so proxied global-task tools remain callable");
    }

    // ── Groups 6, 7, 8: desktop and other modes must not regress ──

    private static void AssertDesktopModeResolutionUnchanged()
    {
        // Asserted through ResolveAvailableMode rather than through GetToolDefinitions(preset, mode):
        // that call never passes through the resolver, so it has no power to detect a regression here.
        AssertEqual("global", ResolveMode("""{"sessionMode":"global","scope":"global"}"""), "an explicit desktop global session keeps the global mode");
        AssertEqual("global", ResolveMode("""{"scope":"global"}"""), "a desktop global session with no sessionMode keeps the global mode");
        AssertEqual("normal", ResolveMode("""{"sessionMode":"agent","scope":"project","projectId":"p1"}"""), "a desktop project agent session keeps the normal mode");
        AssertEqual("normal", ResolveMode("""{"scope":"project","projectId":"p1"}"""), "a desktop project session with no sessionMode keeps the normal mode");

        // The channel normalization must sit after these branches, not in front of them.
        AssertEqual("goal", ResolveMode("""{"sessionMode":"goal"}"""), "goal mode is untouched");
        AssertEqual("normal", ResolveMode("""{"sessionMode":"agent"}"""), "agent mode still normalizes to normal");
        AssertEqual("normal", ResolveMode("""{"sessionMode":"chat"}"""), "chat mode still normalizes to normal");
        AssertEqual("global", ResolveMode("""{"sessionMode":"global"}"""), "global mode is untouched");

        // Lowercase on purpose: Normalize() lowercases before the resolver returns the literal, and
        // ToolRegistry.GetToolDefinitions matches availableModes case-sensitively. A future change to
        // either side trips this assertion before it silently drops sub-agent tools.
        AssertEqual("subagent", ResolveMode("""{"sessionMode":"subAgent"}"""), "subAgent mode returns the normalized lowercase form");
    }

    private static void AssertDesktopProjectSessionNotLoosened(ToolRegistry registry)
    {
        Assert(!registry.IsAvailableInMode("list_projects", "normal"), "a desktop project session does not gain the project tools");
    }

    // ── Groups 9, 10: layers 2 and 3, and the set the agent actually receives ──

    private static void AssertAgentVisibleSet(ToolRegistry registry, AgentRunContext runContext, HashSet<string> agentVisible)
    {
        AssertContainsAll(agentVisible, ProjectTools, "the agent receives the project tools");
        AssertContainsAll(agentVisible, PluginTools, "the agent receives the plugin messaging tools");
        AssertContainsNone(agentVisible, GlobalTaskTools, "the agent does not receive the global-task tools directly");
        AssertContainsNone(agentVisible, OverExposureTools, "the agent does not receive cron/desktop/team/skill-management tools");
        AssertContainsNone(agentVisible, ChannelExcludedTools, "interactive tools stay excluded from a channel session");
        Assert(agentVisible.Contains("use_capability"), "the agent keeps the capability proxy");

        var allowed = ProjectTools.Concat(GlobalTaskTools).Concat(PluginTools).ToList();
        foreach (var name in allowed)
        {
            Assert(
                AgentRunContextPolicy.IsToolAllowed(runContext, name, registry.GetCategory(name), channelSession: true),
                $"layer 3 allows {name} in a channel session");
        }
        foreach (var name in ChannelExcludedTools)
        {
            Assert(
                !AgentRunContextPolicy.IsToolAllowed(runContext, name, registry.GetCategory(name), channelSession: true),
                $"layer 3 still excludes {name} from a channel session");
        }

        // The channel-only batch must not leak into an ordinary desktop session, which is the other
        // half of "a channel session differs only by an extra batch of tools".
        foreach (var name in PluginTools)
        {
            Assert(
                !AgentRunContextPolicy.IsToolAllowed(runContext, name, registry.GetCategory(name), channelSession: false),
                $"{name} stays channel-only and does not leak into a desktop session");
        }
    }

    // ── Registry construction ──

    /// <summary>
    /// Mirrors the provider list in <c>ToolModule.Register</c> so the preset filter sees production
    /// categories and availableModes. The direct executors (file/search/shell/memory/task) are left
    /// out on purpose: they touch the filesystem and the database, and none of them participates in
    /// the channel visibility contract. Unlike production this does not swallow registration errors —
    /// a provider that starts throwing must fail the test rather than quietly shrink the tool set.
    /// </summary>
    private static ToolRegistry BuildProductionRegistry()
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

    // ── Helpers ──

    private static string ResolveMode(string parametersJson)
    {
        var parameters = Parse(parametersJson);
        return AgentRunContextPolicy.ResolveAvailableMode(parameters, AgentRunContextPolicy.Resolve(parameters));
    }

    private static HashSet<string> ToolNames(IReadOnlyList<ToolDefinition> definitions) =>
        definitions.Select(definition => definition.Name).ToHashSet(StringComparer.Ordinal);

    private static JsonElement Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static void AssertContainsAll(HashSet<string> actual, IEnumerable<string> expected, string message)
    {
        foreach (var name in expected)
            Assert(actual.Contains(name), $"{message}; missing '{name}'");
    }

    private static void AssertContainsNone(HashSet<string> actual, IEnumerable<string> unexpected, string message)
    {
        foreach (var name in unexpected)
            Assert(!actual.Contains(name), $"{message}; found '{name}'");
    }

    private static void Assert(bool condition, string message)
    {
        _checks++;
        if (!condition)
            throw new InvalidOperationException($"Assertion failed: {message}");
    }

    private static void AssertEqual(string expected, string actual, string message)
    {
        _checks++;
        if (!string.Equals(expected, actual, StringComparison.Ordinal))
            throw new InvalidOperationException($"Assertion failed: {message}; expected='{expected}', actual='{actual}'");
    }
}

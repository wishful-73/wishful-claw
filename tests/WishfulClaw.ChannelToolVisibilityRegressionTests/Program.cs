using System.Text.Json;
using WishfulClaw.Agent;
using WishfulClaw.Agent.Tools;
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
internal static partial class Program
{
    private const string ChannelParametersJson =
        """{"sessionMode":"channel","channelSession":true,"pluginId":"feishu","externalChatId":"oc_test"}""";

    private static readonly string[] ProjectTools =
    [
        "list_projects", "get_project_details", "create_session", "create_project", "send_session_message"
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
    /// Representatives of the categories a channel session must not receive as direct tool
    /// definitions: desktop, team and skill-management. None of them is reachable by a chat reply, so
    /// seeing one in <c>direct</c> means the visibility rules were widened rather than the mode being
    /// normalized. The cron tools used to be listed here as well; since S-87 they are deliberately
    /// granted to the global side (a channel is a global session), and they still stay out of
    /// <c>direct</c> because they carry no IsCore flag — see <see cref="CronTools"/>.
    /// </summary>
    private static readonly string[] OverExposureTools =
    [
        "DesktopScreenshot", "DesktopClick", "DesktopType",
        "TeamCreate", "TeamStatus", "TeamDelete",
        "list_installed_skills"
    ];

    /// <summary>
    /// S-87: the cron family is granted to the global side (<c>global:*@*</c>) and to work runs
    /// (<c>*:cowork@*</c>). A channel session is a global session, so it reaches them through the
    /// <c>use_capability</c> proxy — intended, not a leak ("渠道就是特殊的全局对话"). CronRuns is the
    /// read-only execution log added by the same change; unlike its siblings it reads the local
    /// database directly instead of going through the main-process reverse request.
    /// </summary>
    private static readonly string[] CronTools =
    [
        "CronAdd", "CronCreate", "CronUpdate", "CronRemove", "CronDelete", "CronList", "CronRuns"
    ];

    /// <summary>
    /// The interactive surface: tools whose only outcome is a person reacting. A channel's reply
    /// surface is plain text, so a question dialog, a rendered widget, or a plan waiting for approval
    /// would hang the run. Since R-3.M the whole plan family is here rather than <c>ExitPlanMode</c>
    /// alone — a channel run has no plan review to wait for, so the family moves together.
    /// </summary>
    private static readonly string[] ChannelExcludedTools =
    [
        "visualize_show_widget", "AskUserQuestion",
        "EnterPlanMode", "SubmitPlanReview", "ExitPlanMode", "UpdatePlanStep"
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

            // iter-30 deleted the channel preset. What a channel session may reach is now decided by the
            // run-context scope declaration alone, and the executor's IsCore flag decides which of those
            // become direct tool definitions — the rest stays reachable through the use_capability proxy.
            // The contract therefore has two surfaces, and both are asserted below: `direct` is what the
            // model is handed, IsToolAllowed is what the proxy may call. Checking only one would miss a
            // regression on the other, and layer-by-layer assertions against a preset that no longer
            // exists would pass while proving nothing.
            var direct = ToolNames(AgentRunContextPolicy.ResolveDirectInjection(
                registry, channelMode, runContext, channelSession: true));

            AssertProjectToolsReachable(runContext, registry);
            AssertPluginToolsReachable(runContext, registry);
            AssertGlobalTaskToolsProxyOnly(registry, direct);
            AssertCronToolsReachableViaProxy(registry, runContext, direct);
            AssertNoOverExposure(direct);
            AssertCapabilityProxySurvives(direct);

            AssertDesktopModeResolutionUnchanged();
            AssertDesktopProjectSessionNotLoosened(registry);

            AssertAgentVisibleSet(runContext, registry, direct);

            AssertCreateProjectGrant(runContext, registry);
            AssertProjectCreationPolicy();
            AssertSandboxProjectsParent();
            AssertProjectsParentDefault();

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

    // ── Groups 2, 3, 5: what a channel session may reach ──

    private static void AssertProjectToolsReachable(AgentRunContext runContext, ToolRegistry registry)
    {
        foreach (var name in ProjectTools)
        {
            Assert(Allowed(runContext, registry, name),
                $"a channel session cannot reach the project tool {name}");
        }
    }

    private static void AssertPluginToolsReachable(AgentRunContext runContext, ToolRegistry registry)
    {
        foreach (var name in PluginTools)
        {
            Assert(Allowed(runContext, registry, name),
                $"a channel session cannot reach the plugin messaging tool {name}");
        }
    }

    private static void AssertNoOverExposure(HashSet<string> direct)
    {
        AssertContainsNone(direct, OverExposureTools, "cron/desktop/team/skill-management are never handed to a channel session");
    }

    // ── Group 4: global-task tools are proxy-only ──

    private static void AssertGlobalTaskToolsProxyOnly(ToolRegistry registry, HashSet<string> direct)
    {
        // They carry no IsCore flag, so they are never injected directly — and staying mode-available is
        // what lets the use_capability proxy reach them.
        AssertContainsNone(direct, GlobalTaskTools, "global-task tools are not injected into a channel session");
        foreach (var name in GlobalTaskTools)
        {
            Assert(
                registry.IsAvailableInMode(name, "global"),
                $"{name} is available in the global mode, so the capability proxy can still reach it");
        }
    }

    private static void AssertCronToolsReachableViaProxy(ToolRegistry registry, AgentRunContext channelContext, HashSet<string> direct)
    {
        // Cron tools carry no IsCore flag, so widening their visibleScopes (S-87) reaches the
        // use_capability proxy rather than the direct definitions — the same shape as the
        // global-task batch above. Asserting both halves keeps a future IsCore flip from silently
        // pushing seven tools into every channel prompt.
        AssertContainsNone(direct, CronTools, "cron tools stay out of the direct injection set");

        foreach (var name in CronTools)
        {
            Assert(Allowed(channelContext, registry, name),
                $"a global/channel session reaches {name} through the capability proxy");
        }

        // The grant is "the global side, plus work runs" — a project chat is on neither side.
        var projectChat = AgentRunContextPolicy.Resolve(
            Parse("""{"scope":"project","projectId":"p1","collaborationMode":"chat"}"""));
        AssertEqual("project", projectChat.Scope, "the cron exclusion probe resolves to the project scope");
        AssertEqual("chat", projectChat.CollaborationMode, "the cron exclusion probe resolves to the chat collaboration mode");
        foreach (var name in CronTools)
        {
            Assert(
                !AgentRunContextPolicy.IsToolAllowed(projectChat, name, registry, channelSession: false),
                $"a project chat session does not gain {name}");
        }

        // ...while the '*:cowork@*' half of the grant keeps them on project work runs.
        var projectCowork = AgentRunContextPolicy.Resolve(
            Parse("""{"scope":"project","projectId":"p1","collaborationMode":"cowork"}"""));
        foreach (var name in CronTools)
        {
            Assert(
                AgentRunContextPolicy.IsToolAllowed(projectCowork, name, registry, channelSession: false),
                $"a project cowork session keeps {name}");
        }
    }

    private static void AssertCapabilityProxySurvives(HashSet<string> direct)
    {
        // Without the proxy the assertion above would be hollow: global-task tools are reachable only
        // through it, so its own visibility is part of the contract.
        Assert(direct.Contains("use_capability"), "use_capability is injected so proxied global-task tools remain callable");
    }

    // ── Groups 6, 7, 8: desktop and other modes must not regress ──

    private static void AssertDesktopModeResolutionUnchanged()
    {
        // Asserted through ResolveAvailableMode rather than through a definitions lookup by mode:
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

    private static void AssertAgentVisibleSet(AgentRunContext runContext, ToolRegistry registry, HashSet<string> direct)
    {
        // Reachability of the project/plugin batch is asserted in AssertProjectToolsReachable; this
        // method pins the boundaries a widening would break first.
        AssertContainsNone(direct, GlobalTaskTools, "the agent does not receive the global-task tools directly");
        AssertContainsNone(direct, OverExposureTools, "the agent does not receive cron/desktop/team/skill-management tools");
        AssertContainsNone(direct, ChannelExcludedTools, "interactive tools stay excluded from a channel session");
        Assert(direct.Contains("use_capability"), "the agent keeps the capability proxy");

        var allowed = ProjectTools.Concat(GlobalTaskTools).Concat(PluginTools).ToList();
        foreach (var name in allowed)
        {
            Assert(Allowed(runContext, registry, name),
                $"the visibility rules allow {name} in a channel session");
        }
        foreach (var name in ChannelExcludedTools)
        {
            Assert(!Allowed(runContext, registry, name),
                $"the visibility rules still exclude {name} from a channel session");
        }

        // The channel-only batch must not leak into an ordinary desktop session, which is the other
        // half of "a channel session differs only by an extra batch of tools".
        foreach (var name in PluginTools)
        {
            Assert(
                !AgentRunContextPolicy.IsToolAllowed(runContext, name, registry, channelSession: false),
                $"{name} stays channel-only and does not leak into a desktop session");
        }
    }

    // ── Registry construction ──

    /// <summary>
    /// Mirrors the provider list in <c>ToolModule.Register</c> so the scope rules see production
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

    /// <summary>
    /// The single visibility entry point, pinned with <c>channelSession: true</c> so a call site cannot
    /// accidentally ask the desktop question instead.
    /// </summary>
    private static bool Allowed(AgentRunContext runContext, ToolRegistry registry, string name) =>
        AgentRunContextPolicy.IsToolAllowed(runContext, name, registry, channelSession: true);

    private static HashSet<string> ToolNames(IReadOnlyList<ToolDefinition> definitions) =>
        definitions.Select(definition => definition.Name).ToHashSet(StringComparer.Ordinal);

    private static JsonElement Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
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

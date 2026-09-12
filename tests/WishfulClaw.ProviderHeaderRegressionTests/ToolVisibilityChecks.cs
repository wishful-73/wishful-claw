using System.Text.Json;
using WishfulClaw.Agent;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.ProviderHeaderRegressionTests;

/// <summary>
/// R-3 regression checks for the one visibility entry point.
///
/// A run context renders to the canonical <c>&lt;scope&gt;:&lt;mode&gt;[@&lt;role&gt;]</c> string and the
/// two declarations a tool carries answer everything: <c>ExcludedScopes</c> vetoes first,
/// <c>VisibleScopes</c> narrows, no declaration means visible. There is deliberately no assertion here
/// about a named tool or a central list — the lists are gone, and a test that reached for one would
/// reintroduce the second opinion this step removed.
///
/// The context strings asserted here are the R-3.C scenarios, so this file is also the executable
/// copy of that table.
/// </summary>
internal static class ToolVisibilityChecks
{
    public static void Run()
    {
        RunContextStringSuite();
        RunDefaultVisibleSuite();
        RunDeclarationNarrowsSuite();
        RunRoleOmittedMeansSessionAgentSuite();
        RunWildcardSuite();
        RunVetoBeatsGrantSuite();
        RunSharedShapesSuite();
        RunUnknownScopeRendersSuite();
        RunResolveNormalisesSuite();
    }

    /// <summary>
    /// R-3.C: each scenario renders the string the table says it should. The channel case is called
    /// out separately because its mode comes from a flag, not from CollaborationMode.
    /// </summary>
    private static void RunContextStringSuite()
    {
        AssertContext(new("project", "chat", "sessionagent"), false, "project:chat",
            "1 project chat");
        AssertContext(new("project", "cowork", "sessionagent"), false, "project:cowork",
            "2 project cowork");
        AssertContext(new("global", "chat", "sessionagent"), false, "global:chat",
            "3 global chat (PM assistant)");
        AssertContext(new("global", "chat", "sessionagent"), true, "global:channel",
            "4 channel session renders as a global channel, not a fourth scope");
        AssertContext(new("project", "chat", "subagent"), false, "project:chat@subagent",
            "5a project chat sub-agent");
        AssertContext(new("project", "cowork", "subagent"), false, "project:cowork@subagent",
            "5b project cowork sub-agent");
        AssertContext(new("project", "cowork", "automation"), false, "project:cowork@automation",
            "6a session-bound automation inherits its host session");

        // The renderer is not where a role becomes a mode — it prints what it is handed. What Resolve
        // hands it for an automation run is covered by RunResolveNormalisesSuite.
        AssertContext(new("global", "chat", "automation"), false, "global:chat@automation",
            "6a global-session automation inherits its host session");
        AssertContext(new("unknown", "chat", "automation"), false, "unknown@automation",
            "6b host-less automation drops the mode (there is no session) and adds the automation role");
        AssertContext(new("project", "cowork", "goalrunner"), false, "project:cowork@goalrunner",
            "7 goal runner follows its host");
        AssertContext(new("project", "cowork", "goalsubagent"), false, "project:cowork@goalsubagent",
            "8 goal sub-agent follows its host");
        AssertContext(new("global", "chat", "pet"), false, "global:chat@pet",
            "9 desktop pet");
        AssertContext(new("project", "chat", "providerturn"), false, "project:chat@providerturn",
            "10 provider single turn");
        AssertContext(new("project", "chat", "translation"), false, "project:chat@translation",
            "11 translation");
    }

    /// <summary>
    /// The property that makes the default safe to keep: a tool nobody declared stays visible in every
    /// run, including the unattended roles. This is what lets MCP and skill tools register at runtime
    /// without a declaration written anywhere.
    /// </summary>
    private static void RunDefaultVisibleSuite()
    {
        var contexts = new[]
        {
            new AgentRunContext("project", "chat", "sessionagent"),
            new AgentRunContext("project", "cowork", "subagent"),
            new AgentRunContext("global", "chat", "sessionagent"),
            new AgentRunContext("unknown", "chat", "automation"),
            new AgentRunContext("project", "cowork", "pet"),
        };

        foreach (var context in contexts)
        {
            Assert(ToolVisibilityPolicy.IsVisible(context, false, null),
                $"undeclared tool is visible in {ToolVisibilityPolicy.RenderContext(context, false)}");
            Assert(ToolVisibilityPolicy.IsVisible(context, false, []),
                $"empty declaration is treated as undeclared in {ToolVisibilityPolicy.RenderContext(context, false)}");
        }
    }

    private static void RunDeclarationNarrowsSuite()
    {
        var coworkOnly = new[] { "project:cowork" };

        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "sessionagent"), false, coworkOnly),
            "declared project:cowork is visible in project:cowork");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "chat", "sessionagent"), false, coworkOnly),
            "declared project:cowork is not visible in project:chat");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("global", "chat", "sessionagent"), false, coworkOnly),
            "declared project:cowork is not visible in global:chat");
    }

    /// <summary>
    /// A pattern with no <c>@role</c> must not be read as "any role". If it were, declaring a tool
    /// for the session would automatically hand it to the sub-agents the session spawns.
    /// </summary>
    private static void RunRoleOmittedMeansSessionAgentSuite()
    {
        var sessionOnly = new[] { "project:cowork" };

        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "sessionagent"), false, sessionOnly),
            "role-less pattern matches the session itself");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "subagent"), false, sessionOnly),
            "role-less pattern does not leak to a sub-agent");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "goalsubagent"), false, sessionOnly),
            "role-less pattern does not leak to a goal sub-agent");

        var explicitSubAgent = new[] { "project:cowork@subagent" };
        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "subagent"), false, explicitSubAgent),
            "role-qualified pattern matches that role");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "sessionagent"), false, explicitSubAgent),
            "role-qualified pattern excludes the session itself");
    }

    private static void RunWildcardSuite()
    {
        var anySubAgent = new[] { "*:*@subagent" };

        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "subagent"), false, anySubAgent),
            "*:*@subagent matches project:cowork@subagent");
        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "chat", "subagent"), false, anySubAgent),
            "*:*@subagent matches project:chat@subagent");
        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("global", "chat", "subagent"), false, anySubAgent),
            "*:*@subagent matches global:chat@subagent");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "sessionagent"), false, anySubAgent),
            "*:*@subagent does not match the session itself");

        var chatAnyScope = new[] { "*:chat" };
        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "chat", "sessionagent"), false, chatAnyScope),
            "*:chat matches project:chat");
        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("global", "chat", "sessionagent"), false, chatAnyScope),
            "*:chat matches global:chat");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "sessionagent"), false, chatAnyScope),
            "*:chat does not match project:cowork");

        // The bare "*" is the documented all-contexts token: it has to reach sub-agents too, or a tool
        // declaring itself harmless everywhere would quietly mean "anywhere except a sub-agent".
        Assert(ToolVisibilityPolicy.IsVisible(
                new AgentRunContext("project", "cowork", "goalsubagent"), false, ToolVisibilityScopes.Everywhere),
            "bare * grants a goal sub-agent, not only the session");
    }

    /// <summary>
    /// The veto is the stronger of the two declarations: a tool that grants itself every context can
    /// still refuse the ones where nobody can answer it.
    /// </summary>
    private static void RunVetoBeatsGrantSuite()
    {
        var foregroundToolInAnyRun = ToolVisibilityScopes.Everywhere;

        Assert(ToolVisibilityPolicy.IsVisible(
                new AgentRunContext("project", "cowork", "sessionagent"), false,
                foregroundToolInAnyRun, ToolVisibilityScopes.UnattendedRoles),
            "the session keeps a tool it shares with its sub-agents");
        Assert(!ToolVisibilityPolicy.IsVisible(
                new AgentRunContext("project", "cowork", "subagent"), false,
                foregroundToolInAnyRun, ToolVisibilityScopes.UnattendedRoles),
            "*@subagent veto beats a bare * grant");
        Assert(!ToolVisibilityPolicy.IsVisible(
                new AgentRunContext("global", "chat", "goalsubagent"), false,
                foregroundToolInAnyRun, ToolVisibilityScopes.UnattendedRoles),
            "the veto is scope-and-mode agnostic: it reaches a global goal sub-agent too");
        Assert(!ToolVisibilityPolicy.IsVisible(
                new AgentRunContext("project", "cowork", "automation"), false,
                foregroundToolInAnyRun, ToolVisibilityScopes.UnattendedRoles),
            "a background schedule is vetoed as well — nobody is watching the page it would change");

        // A veto alone is a complete answer for a tool that declares nothing else, so it stays
        // default-visible everywhere except the contexts it names.
        Assert(ToolVisibilityPolicy.IsVisible(
                new AgentRunContext("project", "cowork", "goalrunner"), false,
                visibleScopes: null, excludedScopes: ToolVisibilityScopes.UnattendedRoles),
            "veto-only declaration leaves the default-visible rule in place");
        Assert(!ToolVisibilityPolicy.IsVisible(
                new AgentRunContext("project", "cowork", "subagent"), false,
                visibleScopes: null, excludedScopes: ToolVisibilityScopes.UnattendedRoles),
            "veto-only declaration still fires");
    }

    /// <summary>
    /// The shared shapes have to mean what their names claim, because that is the only reason a
    /// provider writes one instead of naming its contexts.
    /// </summary>
    private static void RunSharedShapesSuite()
    {
        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "subagent"), false,
                ToolVisibilityScopes.WorkRunsOnly),
            "a work-run tool is available to a sub-agent of a work run");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "chat", "sessionagent"), false,
                ToolVisibilityScopes.WorkRunsOnly),
            "a work-run tool stays out of a chat");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("global", "chat", "sessionagent"), true,
                ToolVisibilityScopes.WorkRunsOnly),
            "a work-run tool stays out of a channel session");

        foreach (var (context, channelSession, label) in new[]
        {
            (new AgentRunContext("project", "chat", "sessionagent"), false, "project chat"),
            (new AgentRunContext("project", "cowork", "sessionagent"), false, "project cowork"),
            (new AgentRunContext("global", "chat", "automation"), false, "global automation run"),
        })
        {
            Assert(ToolVisibilityPolicy.IsVisible(context, channelSession, ToolVisibilityScopes.HumanAttended),
                $"a human-attended tool stays visible in a {label}");
        }

        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("global", "chat", "sessionagent"), true,
                ToolVisibilityScopes.HumanAttended),
            "a dialog-style tool is invisible in a channel, which can only render plain text");

        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("global", "chat", "automation"), false,
                ToolVisibilityScopes.GlobalSideAndWorkRuns),
            "the global side's own tools reach a global automation run");
        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "sessionagent"), false,
                ToolVisibilityScopes.GlobalSideAndWorkRuns),
            "a work run may use them because it was asked for the work");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "chat", "sessionagent"), false,
                ToolVisibilityScopes.GlobalSideAndWorkRuns),
            "a project chat does not get them: it has a project to work in");

        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("global", "chat", "automation"), true,
                ToolVisibilityScopes.ChannelOnly),
            "a scheduled reply into a channel is still a channel run at any role");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "sessionagent"), false,
                ToolVisibilityScopes.ChannelOnly),
            "channel-only tools are invisible where there is no channel to post into");
    }

    private static void RunUnknownScopeRendersSuite()
    {
        // The mode argument is deliberately "chat" here and "cowork" below: for an ownerless run the
        // renderer drops the segment entirely, so whatever a caller left in it cannot leak into the string.
        var unknownAutomation = new AgentRunContext("unknown", "chat", "automation");
        Assert(ToolVisibilityPolicy.RenderContext(unknownAutomation, false) == "unknown@automation",
            "unknown scope renders as unknown@automation");

        var unknownBare = new AgentRunContext("unknown", "cowork", "sessionagent");
        Assert(ToolVisibilityPolicy.RenderContext(unknownBare, false) == "unknown",
            "unknown scope without a special role renders as bare unknown");

        // A declaration that names the unknown scope still matches it — the reserved value is a
        // first-class citizen on the declaration side, not a string that can never be hit.
        Assert(ToolVisibilityPolicy.IsVisible(unknownAutomation, false, ["unknown:*@automation"]),
            "declaration can target the unknown scope");
    }

    /// <summary>
    /// The two normalisations the collapse moved out of the admission tables and into the context
    /// itself: an unattended work run reads as cowork, and only an inbound channel message reads as a
    /// channel session.
    /// </summary>
    private static void RunResolveNormalisesSuite()
    {
        var globalAutomation = Resolve(
            """{"sessionMode":"global","scope":"global","runtimeRole":"automation"}""");
        Assert(globalAutomation.CollaborationMode == "cowork",
            "a background automation run is a work run, not a chat");
        Assert(ToolVisibilityPolicy.RenderContext(globalAutomation, false) == "global:cowork@automation",
            "so it reaches the tools a work run has, in the global scope");

        var projectAutomation = Resolve(
            """{"sessionMode":"agent","scope":"project","projectId":"p1","collaborationMode":"cowork","runtimeRole":"automation"}""");
        Assert(projectAutomation.CollaborationMode == "cowork",
            "a session-bound automation run keeps its host's mode");

        var pet = Resolve(
            """{"sessionMode":"global","scope":"global","runtimeRole":"pet"}""");
        Assert(pet.CollaborationMode == "chat",
            "the pet asks for a chat and keeps it — no per-role table re-decides that");

        // A scheduled task that merely delivers into a chat is a work run. Reading pluginId as
        // "channel" stripped every write tool from it.
        var deliveringAutomation = Resolve(
            """{"sessionMode":"agent","scope":"project","projectId":"p1","collaborationMode":"cowork","runtimeRole":"automation","pluginId":"feishu","externalChatId":"oc_1"}""");
        Assert(!AgentRunContextPolicy.IsChannelSession(
                Parse("""{"sessionMode":"agent","runtimeRole":"automation","pluginId":"feishu","externalChatId":"oc_1"}""")),
            "a pluginId alone does not make a channel session");
        Assert(deliveringAutomation.CollaborationMode == "cowork",
            "and such a run keeps its work tools");

        Assert(AgentRunContextPolicy.IsChannelSession(
                Parse("""{"sessionMode":"channel","pluginId":"feishu","externalChatId":"oc_1"}""")),
            "an inbound channel message renders as a channel session");
    }

    private static AgentRunContext Resolve(string json) =>
        AgentRunContextPolicy.Resolve(Parse(json));

    private static JsonElement Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static void AssertContext(AgentRunContext context, bool channelSession, string expected, string scenario)
    {
        var actual = ToolVisibilityPolicy.RenderContext(context, channelSession);
        Assert(actual == expected, $"{scenario}: expected '{expected}' but rendered '{actual}'");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException($"Assertion failed: {message}");
        }
    }
}

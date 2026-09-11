using WishfulClaw.Agent;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.ProviderHeaderRegressionTests;

/// <summary>
/// R-3.2 regression checks: the single visibility entry point must render every run context into
/// the canonical <c>&lt;scope&gt;:&lt;mode&gt;[@&lt;role&gt;]</c> string, and match declaration
/// patterns against it with the agreed rules (blacklist &gt; declaration &gt; default visible).
///
/// The context strings asserted here are the 13 scenarios of the R-3.C mapping, so this file is
/// also the executable copy of that table.
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
        RunBlacklistWinsSuite();
        RunUnknownScopeRendersSuite();
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
    /// The property that makes this change safe to land: an undeclared tool stays visible, including
    /// under roles that are otherwise restricted.
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
            Assert(ToolVisibilityPolicy.IsVisible(context, false, "Anything", "file", null),
                $"undeclared tool is visible in {ToolVisibilityPolicy.RenderContext(context, false)}");
            Assert(ToolVisibilityPolicy.IsVisible(context, false, "Anything", "file", []),
                $"empty declaration is treated as undeclared in {ToolVisibilityPolicy.RenderContext(context, false)}");
        }
    }

    private static void RunDeclarationNarrowsSuite()
    {
        var coworkOnly = new[] { "project:cowork" };

        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "sessionagent"), false, "T", "c", coworkOnly),
            "declared project:cowork is visible in project:cowork");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "chat", "sessionagent"), false, "T", "c", coworkOnly),
            "declared project:cowork is not visible in project:chat");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("global", "chat", "sessionagent"), false, "T", "c", coworkOnly),
            "declared project:cowork is not visible in global:chat");
    }

    /// <summary>
    /// A pattern with no <c>@role</c> must not be read as "any role". If it were, declaring a tool
    /// for the session would automatically hand it to the sub-agents the session spawns.
    /// </summary>
    private static void RunRoleOmittedMeansSessionAgentSuite()
    {
        var sessionOnly = new[] { "project:cowork" };

        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "sessionagent"), false, "T", "c", sessionOnly),
            "role-less pattern matches the session itself");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "subagent"), false, "T", "c", sessionOnly),
            "role-less pattern does not leak to a sub-agent");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "goalsubagent"), false, "T", "c", sessionOnly),
            "role-less pattern does not leak to a goal sub-agent");

        var explicitSubAgent = new[] { "project:cowork@subagent" };
        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "subagent"), false, "T", "c", explicitSubAgent),
            "role-qualified pattern matches that role");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "sessionagent"), false, "T", "c", explicitSubAgent),
            "role-qualified pattern excludes the session itself");
    }

    private static void RunWildcardSuite()
    {
        var anySubAgent = new[] { "*:*@subagent" };

        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "subagent"), false, "T", "c", anySubAgent),
            "*:*@subagent matches project:cowork@subagent");
        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "chat", "subagent"), false, "T", "c", anySubAgent),
            "*:*@subagent matches project:chat@subagent");
        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("global", "chat", "subagent"), false, "T", "c", anySubAgent),
            "*:*@subagent matches global:chat@subagent");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "sessionagent"), false, "T", "c", anySubAgent),
            "*:*@subagent does not match the session itself");

        var chatAnyScope = new[] { "*:chat" };
        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "chat", "sessionagent"), false, "T", "c", chatAnyScope),
            "*:chat matches project:chat");
        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("global", "chat", "sessionagent"), false, "T", "c", chatAnyScope),
            "*:chat matches global:chat");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "cowork", "sessionagent"), false, "T", "c", chatAnyScope),
            "*:chat does not match project:cowork");
    }

    private static void RunBlacklistWinsSuite()
    {
        // Declaring "visible everywhere" must not defeat the exclusion list.
        var everywhere = new[] { "*:*" };

        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("global", "chat", "sessionagent"), true, "AskUserQuestion", "ask-user", everywhere),
            "channel excludes AskUserQuestion even when the tool declares *:*");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("global", "chat", "sessionagent"), true, "ExitPlanMode", "plan", everywhere),
            "channel excludes ExitPlanMode even when the tool declares *:*");
        Assert(!ToolVisibilityPolicy.IsVisible(new AgentRunContext("global", "chat", "sessionagent"), true, "visualize_show_widget", "widget", everywhere),
            "channel excludes visualize_show_widget even when the tool declares *:*");

        // The same tools stay visible outside a channel session — the exclusion is about the run, not the tool.
        Assert(ToolVisibilityPolicy.IsVisible(new AgentRunContext("project", "chat", "sessionagent"), false, "AskUserQuestion", "ask-user", everywhere),
            "AskUserQuestion remains visible outside a channel session");

        Assert(!ToolVisibilityPolicy.IsVisible(
                new AgentRunContext("project", "cowork", "subagent"),
                false,
                "BrowserNavigate",
                "browser",
                everywhere),
            "project sub-agents cannot drive the foreground browser");
        Assert(!ToolVisibilityPolicy.IsVisible(
                new AgentRunContext("project", "cowork", "goalsubagent"),
                false,
                "BrowserNavigate",
                "browser",
                everywhere),
            "goal sub-agents share the foreground-browser exclusion");
        Assert(ToolVisibilityPolicy.IsVisible(
                new AgentRunContext("project", "cowork", "sessionagent"),
                false,
                "BrowserNavigate",
                "browser",
                everywhere),
            "the project cowork host keeps its browser capability");
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
        Assert(ToolVisibilityPolicy.IsVisible(unknownAutomation, false, "T", "c", ["unknown:*@automation"]),
            "declaration can target the unknown scope");
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

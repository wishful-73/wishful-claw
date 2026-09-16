using WishfulClaw.Agent;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.ProviderHeaderRegressionTests;

/// <summary>
/// The proxy entry point is load-bearing for the whole tool-narrowing model: every non-core tool
/// is reached through <c>use_capability</c>, so if the capability category is ever dropped from the
/// core set (or a scope veto hides it), the tools do not become "less exposed" — they become
/// unreachable. This suite pins the entry point: in every swept run context, the direct tool list
/// must contain <c>use_capability</c>, and its executor must declare <c>IsCore = true</c> and be
/// visible in every scope.
/// </summary>
internal static class ToolProxyEntryChecks
{
    public static void Run()
    {
        var registry = VisibilitySnapshotDump.BuildProductionRegistry();
        var proxy = registry.GetToolDefinitions().Single(definition => definition.Name == "use_capability");

        Assert(proxy.IsCore, "use_capability declares IsCore — the proxy entry is a core tool");
        Assert(proxy.VisibleScopes is { Length: 1 } && proxy.VisibleScopes[0] == "*",
            "use_capability is visible in every run context through the shared scope");

        foreach (var scenario in VisibilitySnapshot.ResolveScenarios())
        {
            var direct = AgentRunContextPolicy.ResolveDirectInjection(
                registry, scenario.AvailableMode, scenario.Context, scenario.ChannelSession);
            Assert(direct.Any(definition => definition.Name == "use_capability"),
                $"{scenario.Name} loses the proxy entry point — every run context must keep the " +
                "capability category or all non-core tools go unreachable");
        }

        Console.WriteLine("Tool proxy entry checks passed.");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException($"Assertion failed: {message}");
        }
    }
}

using WishfulClaw.Agent;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.ProviderHeaderRegressionTests;

/// <summary>
/// The proxy entry point is load-bearing for the whole tool-narrowing model: every non-core tool
/// is reached through <c>use_capability</c>, so if a preset ever drops the capability category
/// (or a future default flips IsCore off), the tools do not become "less exposed" — they become
/// unreachable. This suite pins the entry point: for every built-in preset × run context, the
/// direct tool list must contain <c>use_capability</c>, and its executor must declare
/// <c>IsCore = true</c> and be visible in every scope.
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

        foreach (var presetId in ToolPreset.BuiltIn.Keys)
        {
            var preset = ToolPreset.BuiltIn[presetId];
            foreach (var scenario in VisibilitySnapshot.ResolveScenarios())
            {
                var direct = AgentRunContextPolicy.ResolveDirectInjection(
                    registry, preset, scenario.AvailableMode, scenario.Context, scenario.ChannelSession);
                Assert(direct.Any(definition => definition.Name == "use_capability"),
                    $"preset {presetId} × {scenario.Name} loses the proxy entry point — " +
                    "every preset must keep the capability category or all non-core tools go unreachable");
            }
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

using WishfulClaw.Agent;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.ProviderHeaderRegressionTests;

/// <summary>
/// S-7 regression: the browser is a proxied capability rather than a core tool, and a run nobody is
/// watching may not touch the one shared page.
///
/// Two carriers had to be pinned apart, because they answer different questions and only one of them
/// consults a preset: the injected tool set comes out of <see cref="ToolRegistry"/>'s preset filter,
/// while <c>use_capability</c> walks the registry by category and never sees a preset. Narrowing one
/// can therefore leave the other open, so each is swept over the whole preset × context grid here.
/// </summary>
internal static class BrowserSurfaceAccessChecks
{
    private const string BrowserCategory = "browser";

    /// <summary>
    /// Roles with nobody in front of a window: the two delegated sub-agent roles, and the background
    /// schedule. The last one is the whole point of the veto — a task that was told to run <i>inside</i>
    /// a session arrives as that session's own role and keeps browsing, so this list is exactly the
    /// headless half.
    /// </summary>
    private static readonly string[] UnattendedScenarioSuffixes = ["@subagent", "@goalsubagent", "@automation"];

    public static void Run()
    {
        var registry = VisibilitySnapshotDump.BuildProductionRegistry();
        var browserTools = registry.GetToolNames()
            .Where(name => string.Equals(registry.GetCategory(name), BrowserCategory, StringComparison.OrdinalIgnoreCase))
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

        Assert(browserTools.Length == 9, $"all 9 browser tools are registered under category browser (found {browserTools.Length})");

        RunNeverInjectedDirectlySuite(registry, browserTools);
        RunProxySideSuite(registry, browserTools);
    }

    /// <summary>
    /// The ruling's first half: browsing is not one of the tools handed to the model.
    /// </summary>
    private static void RunNeverInjectedDirectlySuite(ToolRegistry registry, string[] browserTools)
    {
        var cells = 0;

        foreach (var presetId in ToolPreset.BuiltIn.Keys)
        {
            var preset = ToolPreset.BuiltIn[presetId];

            foreach (var scenario in VisibilitySnapshot.ResolveScenarios())
            {
                var injected = AgentRunContextPolicy.FilterToolDefinitions(
                    registry.GetToolDefinitions(preset, scenario.AvailableMode),
                    registry,
                    scenario.Context,
                    scenario.ChannelSession);

                var leaked = injected
                    .Select(definition => definition.Name)
                    .Where(name => browserTools.Contains(name, StringComparer.Ordinal))
                    .ToArray();

                cells++;
                Assert(leaked.Length == 0,
                    $"preset {presetId} × {scenario.Name} still injects {string.Join(",", leaked)} directly");
            }
        }

        Assert(cells == 105, $"the direct-injection sweep covered {cells} cells, expected the full 7×15 grid");
    }

    /// <summary>
    /// The ruling's second half: reachable through the proxy is still reachable, and vetoed there too
    /// for the runs nobody is watching. The counts mirror the tools' own grants — the six read-only
    /// ones everywhere, the three that click and type only in a work run.
    /// </summary>
    private static void RunProxySideSuite(ToolRegistry registry, string[] browserTools)
    {
        foreach (var scenario in VisibilitySnapshot.ResolveScenarios())
        {
            var proxied = browserTools
                .Where(name => AgentRuntimeUseCapabilityExecutor.IsProxyBuiltinVisible(
                    registry,
                    scenario.Context,
                    scenario.AvailableMode,
                    scenario.ChannelSession,
                    name,
                    BrowserCategory))
                .ToArray();

            if (UnattendedScenarioSuffixes.Any(suffix => scenario.Name.EndsWith(suffix, StringComparison.Ordinal)))
            {
                Assert(proxied.Length == 0,
                    $"an unattended run can still reach browsing through the proxy: {scenario.Name} sees {string.Join(",", proxied)}");
                continue;
            }

            var workRun = scenario.Context.CollaborationMode == "cowork";
            var expected = workRun ? 9 : 6;
            Assert(proxied.Length == expected,
                $"{scenario.Name} sees {proxied.Length} browser tools through use_capability, expected {expected}");
            Assert(proxied.Contains("BrowserNavigate", StringComparer.Ordinal)
                    && proxied.Contains("BrowserGetContent", StringComparer.Ordinal),
                $"{scenario.Name} cannot find page reading through use_capability: {string.Join(",", proxied)}");
        }
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException($"Assertion failed: {message}");
        }
    }
}

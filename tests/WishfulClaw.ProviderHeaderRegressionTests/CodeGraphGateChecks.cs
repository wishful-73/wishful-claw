using System;
using System.Collections.Generic;
using System.Linq;
using WishfulClaw.Agent;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.ProviderHeaderRegressionTests;

/// <summary>
/// CodeGraph 是第一个「条件核心」工具：类别进了直连名单，工具也声明了 IsCore，但运行级开关
/// 不开就不出现。这套断言钉住开关两侧的行为，以及开关必须同时管住直连与 use_capability 代理
/// 两条路 —— 只堵一条正是这个需求当初被搁置的原因（直连侧不读功能开关，核心化就会在插件关着
/// 的时候把用不了的工具塞进工具表）。
///
/// 用生产注册表跑，而不是合成一个小 registry：IsCore 与类别名单这两处声明都要是真的。
/// </summary>
internal static class CodeGraphGateChecks
{
    private const string ExploreTool = "codegraph_explore";

    public static void Run()
    {
        var registry = VisibilitySnapshotDump.BuildProductionRegistry();
        var scenarios = VisibilitySnapshot.ResolveScenarios();

        // 同一个 run context，唯一差别是开关。
        var off = scenarios.Single(item => item.Name == "project:cowork");
        var on = scenarios.Single(item => item.Name == "project:cowork@codegraph");

        var offDirect = DirectNames(registry, off);
        var onDirect = DirectNames(registry, on);

        Assert(!offDirect.Contains(ExploreTool),
            "switch off must keep codegraph_explore out of the direct tool list");
        Assert(onDirect.Contains(ExploreTool),
            "switch on must put codegraph_explore in the direct tool list");

        // 开关的影响面必须正好是 codegraph 那一个工具。少了这条，一次"顺手"的改动
        // 把别的工具也带进来，上面两条依然全绿。
        Assert(offDirect.SequenceEqual(onDirect.Where(name => name != ExploreTool)),
            "the run switch must change exactly one tool");

        // 代理侧走同一个谓词；只堵直连会让 agent 绕道 use_capability 把工具调起来。
        Assert(!IsProxyVisible(registry, off),
            "switch off must also hide codegraph_explore from the proxy");
        Assert(IsProxyVisible(registry, on),
            "switch on must also expose codegraph_explore through the proxy");

        // 声明层：类别在核心名单里，工具自己声明 IsCore。
        Assert(ToolCategoryCatalog.Core.Contains("codegraph", StringComparer.OrdinalIgnoreCase),
            "codegraph must be listed as a core category");
        Assert(
            registry.GetToolDefinitions().Single(definition => definition.Name == ExploreTool).IsCore,
            "codegraph_explore must declare IsCore");
        Assert(
            !AgentRuntimeUseCapabilityExecutor.GetProxiedCategoryNames()
                .Contains("codegraph", StringComparer.OrdinalIgnoreCase),
            "a core category must not be advertised as a proxy category");
    }

    private static List<string> DirectNames(ToolRegistry registry, VisibilitySnapshot.Scenario scenario)
        => AgentRunContextPolicy
            .ResolveDirectInjection(registry, scenario.AvailableMode, scenario.Context, scenario.ChannelSession)
            .Select(definition => definition.Name)
            .ToList();

    private static bool IsProxyVisible(ToolRegistry registry, VisibilitySnapshot.Scenario scenario)
        => AgentRuntimeUseCapabilityExecutor.IsProxyBuiltinVisible(
            registry,
            scenario.Context,
            scenario.AvailableMode,
            scenario.ChannelSession,
            ExploreTool);

    private static void Assert(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException($"Assertion failed: {message}");
        }
    }
}

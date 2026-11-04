using System.Diagnostics;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// S-309：工具调用的兜底超时（「放弃等待」，不是「取消执行」）。
///
/// 缺陷背景：agent 调用工具之后没有任何一层「到点必回」。十六小时冻结那次，
/// 界面停在最后一张工具卡上，没有报错、没有超时、也没有中断 —— 用户完全无法
/// 分辨「卡死了」和「在思考」。工具各自实现里的超时无法兜住这一层：谁漏了，
/// 或者卡在实现之外的环节（进程句柄、管道读写、IPC），外层就永远等下去。
///
/// 设计上的三条硬约束（见 docs/plans/iter-v3-6/requirements/S-309.md §4.2.2）：
/// 1. 收口在**调用方**，不在工具实现里 —— 工具会一直加，放在这里新工具自动继承。
/// 2. 工具自带的超时优先：取 <c>max(工具声明的 timeout 参数, 档位默认)</c>。
///    长任务不必为了绕开兜底去改代码，外层又兜住了「工具压根没声明」。
/// 3. 超时后**过期结果必须丢弃**，否则模型会收到同一次调用的两条结果。
///
/// 边界：本类只负责「调用方不再傻等」。卡住的执行体本身由 S-308 的口径处理，
/// 不在这里回收 —— 硬要顺手回收会把取消句柄的问题拖进来。
/// </summary>
internal static class ToolCallTimeout
{
    /// <summary>读 / 查 / 列 / 搜索类。</summary>
    internal static readonly TimeSpan ReadOnlyLimit = TimeSpan.FromSeconds(60);

    /// <summary>
    /// shell / 终端。
    ///
    /// 基准必须取工具自己的默认超时（<see cref="Tools.ShellTools.ShellExecuteTool.DefaultTimeoutMs"/>），
    /// 不能再写死一个独立的数字：模型自主调用时通常**不传** <c>timeout</c> 入参，
    /// 而 <see cref="MaxWithDeclared"/> 只能读到入参 JSON —— 那里是空的，于是会回落到
    /// 本类的分档值。最初的 180 s 就是这么来的，且注释写的是「Shell 默认就声明了 600 s」，
    /// 与实现自相矛盾。实测后果：本迭代的门禁命令 <c>dotnet build</c> / <c>npm run build</c>
    /// 一过 3 分钟就被判超时，工具还在跑、结果被丢弃，模型收到「已放弃」后可能重跑一遍。
    ///
    /// 加上调用处的 <see cref="GraceMs"/>（见 <see cref="Resolve"/> 的 shell 分支）的用意：
    /// 工具自己在 600 s 到点会 Kill 进程树并返回 exitCode 124，让**工具先报自己的超时原因**；
    /// 外层只比它晚一步，负责收尾「工具压根没返回」那种情形（例如卡在读流那两行）。
    /// </summary>
    internal static readonly TimeSpan ShellLimit =
        TimeSpan.FromMilliseconds(Tools.ShellTools.ShellExecuteTool.DefaultTimeoutMs);

    /// <summary>
    /// 外层兜底比工具自带超时晚多久。只用于「工具有自己的超时机制」的档位。
    /// </summary>
    internal const int GraceMs = 30_000;


    /// <summary>等人（提问 / 审批 / 计划评审）。</summary>
    internal static readonly TimeSpan HumanWaitLimit = TimeSpan.FromSeconds(300);

    /// <summary>
    /// 未分档工具的兜底。文档给的「构建 / 安装 / 下载 1200 s」不按命令文本去猜
    /// （猜错的代价是误杀正常长任务或漏掉真卡死），改由工具自己声明的
    /// <c>timeout</c> 参数表达，外层取 max —— 见 <see cref="Resolve"/>。
    /// </summary>
    internal const int DefaultLimitSeconds = 600;

    private static readonly HashSet<string> ReadOnlyTools = new(StringComparer.Ordinal)
    {
        "Read", "Glob", "Grep", "LS", "WebFetch", "WebSearch", "SessionHistory",
        "SubAgentStatus", "SubAgentDetail", "CronRuns", "PluginGetCurrentChatMessages"
    };

    private static readonly HashSet<string> ShellTools = new(StringComparer.Ordinal)
    {
        "Bash", "Shell", "ShellExec", "PowerShell", "Terminal"
    };

    internal enum Kind
    {
        /// <summary>超时即失败。</summary>
        Failure,

        /// <summary>用户暂离 —— 不是失败，agent 该去干别的。</summary>
        UserAway,

        /// <summary>未获批准，安全默认拒绝（绝不许绕路）。</summary>
        NotApproved,

        /// <summary>计划未确认 —— 不自动通过。</summary>
        PendingConfirmation
    }

    internal readonly record struct Decision(TimeSpan? Limit, Kind Kind)
    {
        /// <summary>null = 豁免（目前只有 background 子 agent）。</summary>
        public bool IsExempt => Limit is null;
    }

    /// <summary>
    /// 解析一次工具调用的兜底上限。返回 null 上限 = 豁免。
    /// </summary>
    internal static Decision Resolve(AgentRuntimeNativeToolCall toolCall)
    {
        var name = toolCall.Name;

        // background 子 agent 的设计目标就是活得比父 run 长，给它套上限等于废掉它。
        if (SubAgentExecutor.IsTaskTool(name) &&
            JsonHelpers.GetBool(toolCall.Input, "background", false))
        {
            return new Decision(null, Kind.Failure);
        }

        if (AgentRuntimeAskUserExecutor.IsAskUserTool(name))
        {
            return new Decision(HumanWaitLimit, Kind.UserAway);
        }

        if (AgentRuntimeSandboxElevationExecutor.IsSandboxElevationTool(name))
        {
            return new Decision(HumanWaitLimit, Kind.NotApproved);
        }

        // 计划评审会停下来等用户点头，属于「等人」而不是「执行慢」。
        // 四个 Plan 工具里只有 SubmitPlanReview 会等；EnterPlanMode / UpdatePlanStep /
        // ExitPlanMode 都是本地文件操作，走默认档就够。
        if (string.Equals(name, "SubmitPlanReview", StringComparison.Ordinal))
        {
            return new Decision(HumanWaitLimit, Kind.PendingConfirmation);
        }

        if (ShellTools.Contains(name))
        {
            // 基准已经是工具自己的默认超时（见 ShellLimit），所以模型不传入参时
            // 也落在 600 s 而不是被误杀；模型显式传入更长的值则跟着它走。
            return new Decision(MaxWithDeclared(toolCall.Input, ShellLimit, GraceMs), Kind.Failure);
        }

        if (ReadOnlyTools.Contains(name))
        {
            return new Decision(MaxWithDeclared(toolCall.Input, ReadOnlyLimit), Kind.Failure);
        }

        return new Decision(MaxWithDeclared(toolCall.Input, TimeSpan.FromSeconds(DefaultLimitSeconds)), Kind.Failure);
    }

    /// <summary>
    /// 工具在自己的入参里声明了 <c>timeout</c>（毫秒）时以它为准 —— 这是
    /// §4.2.2 第 1 条「工具自带超时优先」的落地方式。
    ///
    /// <paramref name="graceMs"/> 只给「工具自己有超时机制」的档位（shell）用：
    /// 外层要晚于工具一步，让工具先报自己的原因。其余档位的工具没有自带超时，
    /// 早一步断开反而更好，不传即为 0。
    /// </summary>
    private static TimeSpan MaxWithDeclared(JsonElement input, TimeSpan tierLimit, int graceMs = 0)
    {
        var declaredMs = JsonHelpers.GetInt(input, "timeout", 0);

        var effective = tierLimit;
        if (declaredMs > 0)
        {
            var declared = TimeSpan.FromMilliseconds(declaredMs);
            if (declared > effective) effective = declared;
        }

        return graceMs > 0 ? effective + TimeSpan.FromMilliseconds(graceMs) : effective;
    }

    /// <summary>
    /// 竞速等待。<paramref name="limit"/> 到点仍未返回就不等了，标志位告诉调用方
    /// 「放弃等待」。
    ///
    /// 关键点：放弃之后要**观察**那个还在跑的 task（<c>OnlyOnFaulted</c> 续接吞掉异常），
    /// 否则它日后抛错会变成 UnobservedTaskException；它的返回值也不会回灌给任何人 ——
    /// 调用方已经带着超时结果走了。
    /// </summary>
    internal static async Task<(T? Value, bool TimedOut, TimeSpan Elapsed)> RaceAsync<T>(
        Task<T> work, TimeSpan limit, CancellationToken cancellationToken)
    {
        if (work.IsCompleted)
        {
            return (await work.ConfigureAwait(false), false, TimeSpan.Zero);
        }

        using var timerCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var timer = Task.Delay(limit, timerCts.Token);
        var startedAt = Stopwatch.GetTimestamp();

        var winner = await Task.WhenAny(work, timer).ConfigureAwait(false);
        if (winner == work)
        {
            timerCts.Cancel();   // 收掉计时器，别留悬挂等待
            return (await work.ConfigureAwait(false), false, Elapsed(startedAt));
        }

        // 用户取消优先于超时：取消是「用户主动停」，超时是「我们不等了」，两者语义不同。
        cancellationToken.ThrowIfCancellationRequested();

        ObserveLater(work);
        return (default, true, limit);
    }

    private static TimeSpan Elapsed(long startedAt) =>
        Stopwatch.GetElapsedTime(startedAt);

    private static void ObserveLater(Task work)
    {
        _ = work.ContinueWith(
            static t => _ = t.Exception,
            CancellationToken.None,
            TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
    }

    /// <summary>
    /// 超时回给模型的文本。必须是**明确的失败**，不能是空结果 —— 空结果会让模型
    /// 以为「工具返回了空」，然后接着瞎编。
    /// </summary>
    internal static string Message(Kind kind, string toolName, TimeSpan limit) => kind switch
    {
        Kind.UserAway =>
            $"[USER AWAY] No answer to {toolName} within {Seconds(limit)}. The user is likely away. " +
            "Continue with the parts that do not depend on this answer; you may ask the same question " +
            "again later (at most twice, at least 5 minutes apart). Do not redo work already completed.",

        Kind.NotApproved =>
            $"[NOT APPROVED] {toolName} did not receive approval within {Seconds(limit)}; treated as " +
            "NOT approved (safe default). The call did NOT execute and no effect was applied. Do not look " +
            "for another tool, parameter or path to achieve the same result — ask the user instead.",

        Kind.PendingConfirmation =>
            $"[PENDING CONFIRMATION] {toolName} was not reviewed within {Seconds(limit)}. This is NOT an " +
            "approval. Do not start executing the plan. Continue with work that does not depend on it.",

        _ =>
            $"[TOOL TIMEOUT] {toolName} did not return within {Seconds(limit)}. The call was abandoned; " +
            "its result, if it arrives later, is discarded. Do not assume it had any effect. Continue " +
            "with other work, or retry with a smaller scope."
    };

    /// <summary>UI 上那句「超时，已等 N s」用的简短说明。</summary>
    internal static string ShortReason(Kind kind, TimeSpan limit) => kind switch
    {
        Kind.UserAway => $"用户暂离，已等 {Seconds(limit)}",
        Kind.NotApproved => $"未获批准，已等 {Seconds(limit)}",
        Kind.PendingConfirmation => $"待确认，已等 {Seconds(limit)}",
        _ => $"超时，已等 {Seconds(limit)}"
    };

    private static string Seconds(TimeSpan limit) =>
        limit.TotalSeconds >= 60 && limit.TotalSeconds % 60 == 0
            ? $"{limit.TotalMinutes:0} min"
            : $"{limit.TotalSeconds:0} s";
}

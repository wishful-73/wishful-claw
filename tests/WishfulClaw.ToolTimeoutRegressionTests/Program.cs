using System.Diagnostics;
using System.Text.Json;
using WishfulClaw.Agent;

namespace WishfulClaw.ToolTimeoutRegressionTests;

/// <summary>
/// S-309：工具调用兜底超时。
///
/// 这里钉的是三件以后最容易被改坏的事：
/// 1. 分档数值（有人把 60 s 调成 600 s、或者把「等人」档改成失败，测试当场红）
/// 2. 「工具自带超时优先」—— 取 max(声明, 档位)，不是取声明、也不是取档位
/// 3. 竞速语义 —— 到点必须回来、用户取消不能伪装成超时、过期结果不回灌
/// </summary>
internal static class Program
{
    private static int _checks;
    private static readonly List<string> Failures = [];

    public static async Task<int> Main()
    {
        TiersArePinned();
        DeclaredTimeoutWins();
        HumanWaitHasItsOwnSemantics();
        BackgroundSubAgentIsExempt();
        MessagesAreDistinct();
        await RaceAbandonsAtLimitAsync();
        await RaceReturnsValueWhenFastAsync();
        await RaceTreatsUserCancelAsCancelAsync();
        await RaceSwallowsLateResultAsync();

        Console.WriteLine($"Tool timeout regression checks: {_checks} passed, {Failures.Count} failed");
        foreach (var failure in Failures)
        {
            Console.Error.WriteLine($"FAIL: {failure}");
        }

        return Failures.Count == 0 ? 0 : 1;
    }

    // ── 分档 ───────────────────────────────────────────────────────────────

    private static void TiersArePinned()
    {
        var bash = ToolCallTimeout.Resolve(Call("Bash"));
        Same("shell 档上限 180 s", 180d, bash.Limit!.Value.TotalSeconds);
        Same("shell 档语义是失败", ToolCallTimeout.Kind.Failure, bash.Kind);

        var read = ToolCallTimeout.Resolve(Call("Read"));
        Same("只读档上限 60 s", 60d, read.Limit!.Value.TotalSeconds);

        var write = ToolCallTimeout.Resolve(Call("Write"));
        Same("未分档工具兜底 600 s", 600d, write.Limit!.Value.TotalSeconds);

        var terminal = ToolCallTimeout.Resolve(Call("Terminal"));
        Same("Terminal 归 shell 档", 180d, terminal.Limit!.Value.TotalSeconds);
    }

    private static void DeclaredTimeoutWins()
    {
        var longer = ToolCallTimeout.Resolve(Call("Bash", """{"timeout":1200000}"""));
        Same("工具声明更长时以声明为准（max）", 1200000d / 1000d, longer.Limit!.Value.TotalSeconds);

        var shorter = ToolCallTimeout.Resolve(Call("Read", """{"timeout":5000}"""));
        Same("工具声明更短时不降低档位（max）", 60d, shorter.Limit!.Value.TotalSeconds);
    }

    private static void HumanWaitHasItsOwnSemantics()
    {
        var ask = ToolCallTimeout.Resolve(Call("AskUserQuestion"));
        Same("提问档 300 s", 300d, ask.Limit!.Value.TotalSeconds);
        Same("提问超时是「用户暂离」不是失败", ToolCallTimeout.Kind.UserAway, ask.Kind);

        var sandbox = ToolCallTimeout.Resolve(Call("RequestSandboxElevation"));
        Same("审批档 300 s", 300d, sandbox.Limit!.Value.TotalSeconds);
        Same("审批超时是「未获批准」", ToolCallTimeout.Kind.NotApproved, sandbox.Kind);

        var review = ToolCallTimeout.Resolve(Call("SubmitPlanReview"));
        Same("计划评审 300 s", 300d, review.Limit!.Value.TotalSeconds);
        Same("计划评审超时「待确认」不自动通过", ToolCallTimeout.Kind.PendingConfirmation, review.Kind);

        // 只有 SubmitPlanReview 会等人；其余三个 Plan 工具是本地文件操作。
        var step = ToolCallTimeout.Resolve(Call("UpdatePlanStep"));
        Same("UpdatePlanStep 不归等人档", 600d, step.Limit!.Value.TotalSeconds);
    }

    private static void BackgroundSubAgentIsExempt()
    {
        var background = ToolCallTimeout.Resolve(Call("Task", """{"background":true}"""));
        Check("background 子 agent 豁免（活得比父 run 长）", background.IsExempt);

        var foreground = ToolCallTimeout.Resolve(Call("Task", """{"prompt":"x"}"""));
        Check("前台子 agent 不豁免", !foreground.IsExempt);
    }

    // ── 文案 ───────────────────────────────────────────────────────────────

    private static void MessagesAreDistinct()
    {
        var limit = TimeSpan.FromSeconds(300);
        var away = ToolCallTimeout.Message(ToolCallTimeout.Kind.UserAway, "AskUserQuestion", limit);
        var denied = ToolCallTimeout.Message(ToolCallTimeout.Kind.NotApproved, "Write", limit);
        var pending = ToolCallTimeout.Message(ToolCallTimeout.Kind.PendingConfirmation, "SubmitPlanReview", limit);
        var timeout = ToolCallTimeout.Message(ToolCallTimeout.Kind.Failure, "Bash", TimeSpan.FromSeconds(180));

        Check("暂离文案带 USER AWAY", away.Contains("[USER AWAY]", StringComparison.Ordinal));
        Check("暂离文案允许再问、禁止重做", away.Contains("ask the same question", StringComparison.Ordinal));
        Check("未批准文案带 NOT APPROVED", denied.Contains("[NOT APPROVED]", StringComparison.Ordinal));
        Check("未批准文案禁止绕路", denied.Contains("Do not look", StringComparison.Ordinal));
        Check("待确认文案明确不是批准", pending.Contains("NOT an approval", StringComparison.Ordinal));
        Check("超时文案带 TOOL TIMEOUT", timeout.Contains("[TOOL TIMEOUT]", StringComparison.Ordinal));
        Check("超时文案说明丢弃过期结果", timeout.Contains("discarded", StringComparison.Ordinal));

        // 四种语义不能长一个样，否则 UI 与日志都分不出「用户走了」和「真卡死」。
        Check("四种语义文案互不相同",
            new HashSet<string>(StringComparer.Ordinal) { away, denied, pending, timeout }.Count == 4);
    }

    // ── 竞速 ───────────────────────────────────────────────────────────────

    private static async Task RaceAbandonsAtLimitAsync()
    {
        var never = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        var limit = TimeSpan.FromMilliseconds(150);

        var stopwatch = Stopwatch.StartNew();
        var (value, timedOut, elapsed) = await ToolCallTimeout.RaceAsync(never.Task, limit, CancellationToken.None);
        stopwatch.Stop();

        Check("到点必须放弃等待", timedOut);
        Check("放弃后拿到的是空结果，不是卡住的调用", value == 0);
        Check("放弃耗时不明显超过上限", stopwatch.Elapsed < TimeSpan.FromSeconds(3),
            $"{stopwatch.ElapsedMilliseconds} ms");
        Check("回报的耗时就是上限", Math.Abs(elapsed.TotalMilliseconds - limit.TotalMilliseconds) < 1,
            $"{elapsed.TotalMilliseconds} ms");
    }

    private static async Task RaceReturnsValueWhenFastAsync()
    {
        var quick = Task.FromResult(7);
        var (value, timedOut, _) = await ToolCallTimeout.RaceAsync(
            quick, TimeSpan.FromSeconds(30), CancellationToken.None);
        Check("先完成则用它的结果", !timedOut && value == 7);
    }

    private static async Task RaceTreatsUserCancelAsCancelAsync()
    {
        using var cts = new CancellationTokenSource();
        var never = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        var race = ToolCallTimeout.RaceAsync(never.Task, TimeSpan.FromSeconds(30), cts.Token);
        await cts.CancelAsync();

        var cancelled = false;
        try
        {
            await race;
        }
        catch (OperationCanceledException)
        {
            cancelled = true;
        }

        // 「用户主动停」与「我们不等了」是两件事，UI 与日志要能区分 —— 不能混成超时。
        Check("用户取消必须抛取消，不能伪装成超时", cancelled);
    }

    private static async Task RaceSwallowsLateResultAsync()
    {
        var late = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        var (_, timedOut, _) = await ToolCallTimeout.RaceAsync(
            late.Task, TimeSpan.FromMilliseconds(50), CancellationToken.None);
        Check("晚到场景先确认已超时", timedOut);

        // 晚到的结果与异常都不该再回到调用方，也不该变成未观察异常把进程带崩。
        var unobserved = 0;
        EventHandler<UnobservedTaskExceptionEventArgs> handler = (_, e) =>
        {
            Interlocked.Increment(ref unobserved);
            e.SetObserved();
        };
        TaskScheduler.UnobservedTaskException += handler;
        try
        {
            late.SetException(new InvalidOperationException("late failure"));
            await Task.Delay(100);
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();
            await Task.Delay(100);
        }
        finally
        {
            TaskScheduler.UnobservedTaskException -= handler;
        }

        Check("放弃后的异常被观察掉，不炸进程", unobserved == 0, $"{unobserved} unobserved");
    }

    // ── 辅助 ───────────────────────────────────────────────────────────────

    private static AgentRuntimeNativeToolCall Call(string name, string json = "{}") =>
        new("call-1", name, JsonDocument.Parse(json).RootElement.Clone());

    private static void Same<T>(string label, T expected, T actual) =>
        Check(label, EqualityComparer<T>.Default.Equals(expected, actual),
            $"expected {expected}, actual {actual}");

    private static void Check(string label, bool ok, string? detail = null)
    {
        _checks++;
        if (!ok)
        {
            Failures.Add(detail is null ? label : $"{label} — {detail}");
        }
    }
}

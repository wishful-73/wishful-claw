using System.Diagnostics;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// 429 backoff handling for the goal loop: fast retry, minute polling, timeout.
/// Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
public static partial class GoalOrchestrator
{
    // ─── 429 Backoff ───

    private enum BackoffOutcome { Resolved, Timeout }

    private static async Task<BackoffOutcome> Handle429BackoffAsync(
        GoalContext goal,
        GoalPlanItem plan,
        int planIndex,
        PlanExecutionResult result,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        CancellationToken ct)
    {
        var attempt = 0;
        var totalWaitedSeconds = 0L;

        while (true)
        {
            await ReachSafePointAsync(goal, context, ct);

            var (delaySeconds, phase) = GoalBackoffStrategy.CalculateBackoff(
                attempt, result.RetryAfterHint);

            if (phase == "timeout")
            {
                await EmitGoalEventAsync(goal, GoalEventType.BackoffTimedOut,
                    GoalBackoffStrategy.GetStatusMessage(attempt, phase, totalWaitedSeconds), context);
                GoalPlanTracker.AppendLog(goal.WorkingFolder, goal.GoalId, plan.PlanId, $"429 backoff: {GoalBackoffStrategy.GetStatusMessage(attempt, phase, totalWaitedSeconds)}");
                return BackoffOutcome.Timeout;
            }

            await EmitGoalEventAsync(goal, GoalEventType.BackoffStarted,
                GoalBackoffStrategy.GetStatusMessage(attempt, phase, totalWaitedSeconds), context);

            // Sliced wait: a Pause flips RunState mid-wait and takes effect at
            // the ReachSafePoint below, instead of after the full delay (the
            // minute-polling phase waits up to 10 minutes per attempt).
            var waitStopwatch = Stopwatch.StartNew();
            await DelayInterruptibleAsync(goal, delaySeconds, ct);
            waitStopwatch.Stop();
            totalWaitedSeconds += (long)waitStopwatch.Elapsed.TotalSeconds;
            await ReachSafePointAsync(goal, context, ct);

            // Probe with a minimal LLM ping — never re-execute the plan here.
            // The old approach ran the whole plan as the "test request",
            // duplicating every side effect; the real retry happens in the
            // caller's loop, which resumes from the first incomplete task.
            if (await ProbeRateLimitResolvedAsync(goal, parameters, parentState, context, ct))
            {
                await EmitGoalEventAsync(goal, GoalEventType.BackoffResolved,
                    $"Rate limit resolved after {totalWaitedSeconds / 60} min", context);
                return BackoffOutcome.Resolved;
            }

            attempt++;
            await EmitGoalEventAsync(goal, GoalEventType.BackoffProgress,
                GoalBackoffStrategy.GetStatusMessage(attempt, phase, totalWaitedSeconds), context);
        }
    }

    /// <summary>
    /// Wait in 1-second slices so a Pause request interrupts the backoff wait
    /// within ~1s instead of after the full delay (up to 10 minutes during
    /// minute polling). Cancellation still throws immediately.
    /// </summary>
    private static async Task DelayInterruptibleAsync(GoalContext goal, int totalSeconds, CancellationToken ct)
    {
        var remaining = TimeSpan.FromSeconds(totalSeconds);
        while (remaining > TimeSpan.Zero)
        {
            ct.ThrowIfCancellationRequested();
            if (goal.RunState == GoalRunStateValues.Paused) return;

            var slice = remaining > TimeSpan.FromSeconds(1)
                ? TimeSpan.FromSeconds(1)
                : remaining;
            await Task.Delay(slice, ct);
            remaining -= slice;
        }
    }

    /// <summary>
    /// Minimal rate-limit probe: a tiny sub-agent LLM call. Returns true when
    /// the provider no longer returns a structured HTTP 429 error. Any other
    /// failure (network blip, parse issue) counts as "resolved" so the caller
    /// retries the real task and surfaces the actual error there.
    /// </summary>
    private static async Task<bool> ProbeRateLimitResolvedAsync(
        GoalContext goal,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        CancellationToken ct)
    {
        try
        {
            var input = CreateTaskInput(
                "Reply with the single word: ok",
                "Rate limit probe",
                "custom",
                "You are a health-check probe. Reply with exactly: ok");
            var toolCallId = $"goal-429-probe-{Guid.NewGuid():N}";
            var result = await SubAgentExecutor.ExecuteAsync(
                input, parameters, parentState, context, toolCallId);
            return !IsRateLimitText(result.Content?.Trim());
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            return !IsRateLimitText(ex.Message);
        }
    }
}

using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Agent;

/// <summary>
/// Terminal lifecycle: pause, abort (sync/async/from-tool) and the shared goal action results.
/// Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
public static partial class GoalOrchestrator
{
    /// <summary>
    /// Pause a running Goal without replacing its owned orchestration loop.
    /// An idle goal (loop already exited, e.g. after a failed-but-active run)
    /// is paused directly — the user asked for paused, so honor it instead of
    /// returning a silent "no running loop" error.
    /// </summary>
    public static GoalActionResult Pause(string goalId)
    {
        if (!ActiveGoals.TryGetValue(goalId, out var goal))
            return GoalActionNotFound("pause", goalId);

        lock (goal.LifecycleSync)
        {
            if (!IsCurrentGoalContext(goal))
                return GoalActionNotFound("pause", goalId);

            if (GoalStatusValues.IsTerminal(goal.Status))
                return GoalActionTerminal("pause", goal);

            if (goal.RunState == GoalRunStateValues.Paused)
                return GoalAction(goal, true, "already_paused");

            // Loop still running: pause takes effect at the next safe point.
            if (goal.RunState == GoalRunStateValues.Running && goal.RunTask is { IsCompleted: false })
            {
                goal.RunState = GoalRunStateValues.Paused;
                return GoalAction(goal, true, "paused");
            }

            // Idle loop (previous run ended without completing): flip the
            // business status to paused so Resume can pick it up cleanly.
            goal.Status = GoalStatusValues.Paused;
            goal.RunState = GoalRunStateValues.Paused;
            PersistGoalStatus(goal);
            return GoalAction(goal, true, "paused");
        }
    }

    /// <summary>
    /// Best-effort persist of an idle-loop status change (pause path).
    /// </summary>
    private static void PersistGoalStatus(GoalContext goal)
    {
        try
        {
            SyncGoalToDb(goal, BuildResumeParameters(goal), $"Goal paused ({goal.Status})");
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"Failed to persist paused status: {ex.Message}");
        }
    }

    /// <summary>
    /// Request cancellation for an active Goal without waiting for loop cleanup.
    /// </summary>
    public static GoalActionResult Abort(string goalId)
    {
        return RequestAbort(goalId, out _);
    }

    /// <summary>
    /// Request cancellation and wait for the owned orchestration loop to exit.
    /// </summary>
    public static async Task<GoalActionResult> AbortAsync(
        string goalId,
        IWorkerRequestContext context)
    {
        var goal = GetContext(goalId);
        var result = RequestAbort(goalId, out var runTask);
        if (!result.Success)
            return result;

        if (runTask == null)
        {
            if (goal != null)
            {
                await EmitGoalEventAsync(
                    goal,
                    GoalEventType.GoalAborted,
                    "Goal aborted",
                    context);
            }
            return result;
        }

        try
        {
            await runTask;
        }
        catch
        {
            // The owned loop converts cancellation/failure into Goal status before cleanup.
        }

        return result with
        {
            Action = "aborted",
            Status = GoalStatusValues.Aborted,
            RunState = GoalRunStateValues.Idle
        };
    }

    public static async Task<GoalActionResult> AbortFromToolAsync(
        string goalId,
        IWorkerRequestContext context)
    {
        var goal = GetContext(goalId);
        var result = RequestAbort(goalId, out var runTask);
        if (result.Success && runTask == null && goal != null)
        {
            await EmitGoalEventAsync(
                goal,
                GoalEventType.GoalAborted,
                "Goal aborted",
                context);
        }
        return result;
    }

    public static async Task<GoalActionResult> SetTerminalStatusFromToolAsync(
        string goalId,
        string status,
        IWorkerRequestContext context)
    {
        if (status == GoalStatusValues.Aborted)
            return await AbortFromToolAsync(goalId, context);

        if (status is not GoalStatusValues.Complete and not GoalStatusValues.Aborted)
        {
            return new GoalActionResult(
                false,
                "invalid_status",
                status,
                GoalRunStateValues.Idle,
                goalId,
                "Only complete or aborted are terminal statuses.");
        }

        if (!ActiveGoals.TryGetValue(goalId, out var goal))
            return GoalActionNotFound("update", goalId);

        Task? runTask;
        var message = status == GoalStatusValues.Complete
            ? "Goal completed by update_goal"
            : "Goal failed by update_goal";
        lock (goal.LifecycleSync)
        {
            if (!IsCurrentGoalContext(goal))
                return GoalActionNotFound("update", goalId);

            if (GoalStatusValues.IsTerminal(goal.Status))
                return GoalActionTerminal("update", goal);

            runTask = goal.RunTask;
            goal.Status = status;
            if (runTask != null)
            {
                goal.CancellationTokenSource.Cancel();
                goal.RuntimeState?.Cancel("goal terminal status updated");
                return GoalAction(goal, true, "finalizing");
            }

            FinalizeIdleTerminal(goal, status, message);
        }

        await EmitGoalEventAsync(
            goal,
            status == GoalStatusValues.Complete
                ? GoalEventType.GoalCompleted
                : GoalEventType.GoalFailed,
            message,
            context);
        return GoalAction(goal, true, status);
    }

    private static GoalActionResult RequestAbort(string goalId, out Task? runTask)
    {
        runTask = null;
        if (!ActiveGoals.TryGetValue(goalId, out var goal))
            return GoalActionNotFound("abort", goalId);

        lock (goal.LifecycleSync)
        {
            if (!IsCurrentGoalContext(goal))
                return GoalActionNotFound("abort", goalId);

            if (GoalStatusValues.IsTerminal(goal.Status))
                return GoalActionTerminal("abort", goal);

            runTask = goal.RunTask;
            goal.Status = GoalStatusValues.Aborted;
            goal.CancellationTokenSource.Cancel();
            goal.RuntimeState?.Cancel("goal aborted");

            // Propagate aborted status down to goal_plans and goal_tasks (best-effort)
            GoalOrchestratorMaterialize.AbortSubtree(goal, BuildResumeParameters(goal));

            if (runTask == null)
            {
                FinalizeIdleTerminal(goal, GoalStatusValues.Aborted, "Goal aborted");
                return GoalAction(goal, true, "aborted");
            }

            return GoalAction(goal, true, "aborting");
        }
    }

    private static GoalActionResult GoalAction(
        GoalContext goal,
        bool success,
        string action,
        string? error = null)
        => new(success, action, goal.Status, goal.RunState, goal.GoalId, error);

    private static GoalActionResult GoalActionNotFound(string action, string? goalId)
        => new(false, "not_found", "unknown", "unknown", goalId, $"Goal not found for {action}.");

    private static GoalActionResult GoalActionTerminal(string action, GoalContext goal)
        => GoalAction(goal, false, "terminal", $"Terminal goals cannot be {action}d.");
}

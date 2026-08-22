using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Lifecycle ownership and state transitions for GoalOrchestrator.
/// </summary>
public static partial class GoalOrchestrator
{
    /// <summary>
    /// Start a new Goal execution asynchronously.
    /// Returns immediately; the orchestration loop runs in the background.
    /// goalId is provided by the caller (from DB / PendingGoal) to ensure
    /// ActiveGoals key matches the persisted goalId.
    /// </summary>
    public static Task<string> StartAsync(
        string goalText,
        string sessionId,
        string? workingFolder,
        string goalId,
        JsonElement parameters,
        IWorkerRequestContext context)
    {
        var goal = new GoalContext
        {
            GoalId = goalId,
            SessionId = sessionId,
            GoalText = goalText,
            WorkingFolder = workingFolder,
            Status = GoalStatusValues.Active,
            RunState = GoalRunStateValues.Idle,
            StartedAt = DateTime.UtcNow
        };

        if (parameters.ValueKind == JsonValueKind.Object)
            goal.OriginalParameters = parameters.Clone();

        if (!ActiveGoals.TryAdd(goalId, goal))
        {
            if (ActiveGoals.TryGetValue(goalId, out var existingGoal))
            {
                StartOrResumeRun(existingGoal, parameters, context);
            }
            return Task.FromResult(goalId);
        }

        // Start the owned loop FIRST so RunState is already Running when the
        // "Goal created" event goes out — emitting before StartOrResumeRun made
        // the first event carry runState=idle and left the frontend showing
        // idle until decomposition finished (~10s).
        StartOrResumeRun(goal, parameters, context);

        _ = EmitGoalEventAsync(goal, GoalEventType.GoalStarted,
            $"Goal created: {goalText}. Decomposing into plans...", context);
        return Task.FromResult(goalId);
    }

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
    /// Resume an existing paused loop without requiring a worker request context.
    /// Idle goals must use the overload that supplies a request context.
    /// </summary>
    public static GoalActionResult Resume(string goalId)
    {
        if (!ActiveGoals.TryGetValue(goalId, out var goal))
            return GoalActionNotFound("resume", goalId);

        lock (goal.LifecycleSync)
        {
            if (!IsCurrentGoalContext(goal))
                return GoalActionNotFound("resume", goalId);

            if (GoalStatusValues.IsTerminal(goal.Status))
                return GoalActionTerminal("resume", goal);

            if (goal.RunState == GoalRunStateValues.Paused
                && goal.RunTask is { IsCompleted: false })
            {
                goal.RunState = GoalRunStateValues.Running;
                return GoalAction(goal, true, "resumed");
            }

            if (goal.RunState == GoalRunStateValues.Running
                && goal.RunTask is { IsCompleted: false })
            {
                return GoalAction(goal, true, "already_running");
            }

            return GoalAction(goal, false, "idle", "Starting an idle goal requires a worker request context.");
        }
    }

    /// <summary>
    /// Atomically resume an in-memory goal or restore it from DB before starting.
    /// A paused goal only wakes its existing loop; an idle goal creates one owned loop.
    /// </summary>
    public static GoalActionResult Resume(
        string goalId,
        string? sessionId,
        IWorkerRequestContext context)
    {
        return Resume(goalId, sessionId, null, context);
    }

    /// <summary>
    /// Resume with an optional provider override supplied by the frontend.
    /// providerOverride is used when the goal has no saved parameters and no
    /// active session run to inherit from (e.g. DB-restored goal after restart).
    /// </summary>
    public static GoalActionResult Resume(
        string goalId,
        string? sessionId,
        JsonElement? providerOverride,
        IWorkerRequestContext context)
    {
        if (!ActiveGoals.TryGetValue(goalId, out var goal))
        {
            if (string.IsNullOrEmpty(sessionId))
                return GoalActionNotFound("resume", goalId);

            var row = DbGoalTools.GetByGoalId(goalId, sessionId);
            if (row == null)
                return GoalActionNotFound("resume", goalId);

            if (GoalStatusValues.IsTerminal(row.Status))
            {
                return new GoalActionResult(
                    false,
                    "terminal",
                    row.Status,
                    GoalRunStateValues.Idle,
                    goalId,
                    "Terminal goals cannot be resumed.");
            }

            var restoredGoal = RestoreGoalContext(row);
            ActiveGoals.TryAdd(goalId, restoredGoal);
            if (!ActiveGoals.TryGetValue(goalId, out goal))
                return GoalActionNotFound("resume", goalId);
        }

        var parameters = BuildResumeParameters(goal, providerOverride);
        return StartOrResumeRun(goal, parameters, context);
    }

    /// <summary>
    /// Restore an active goal from DB as idle after process restart.
    /// The orchestration loop starts only after an explicit Resume call.
    /// </summary>
    public static Task<bool> ResumeFromDb(string goalId, string sessionId)
    {
        if (ActiveGoals.ContainsKey(goalId))
            return Task.FromResult(true);

        var row = DbGoalTools.GetByGoalId(goalId, sessionId);
        if (row == null || GoalStatusValues.IsTerminal(row.Status))
        {
            return Task.FromResult(false);
        }

        var goal = RestoreGoalContext(row);
        var restored = ActiveGoals.TryAdd(goalId, goal) || ActiveGoals.ContainsKey(goalId);
        if (restored)
        {
            WorkerLog.Info($"ResumeFromDb: restored goal {goalId} session={sessionId} status={goal.Status} planCount={goal.Plans.Count} runState=idle");
        }
        return Task.FromResult(restored);
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

    private static GoalContext RestoreGoalContext(GoalRow row)
    {
        List<GoalPlanItem> plans = new();
        if (!string.IsNullOrEmpty(row.PlansJson))
        {
            try
            {
                plans = JsonSerializer.Deserialize(
                    row.PlansJson,
                    AgentRuntimeJsonContext.Default.ListGoalPlanItem) ?? new();
                foreach (var plan in plans)
                {
                    if (string.IsNullOrEmpty(plan.PlanId))
                        plan.PlanId = GoalIds.NewPlanId();
                }
            }
            catch (Exception ex)
            {
                WorkerLog.Warn($"ResumeFromDb: failed to deserialize plans: {ex.Message}");
            }
        }

        return new GoalContext
        {
            GoalId = row.GoalId,
            SessionId = row.SessionId,
            GoalText = row.Objective,
            WorkingFolder = row.WorkingFolder,
            // Deliberate: "paused" is not preserved across restart. A restored
            // goal comes back as active-idle so it is visible/resumable via the
            // normal Resume path; the user re-issues Pause if still wanted.
            Status = row.Status == GoalStatusValues.Paused ? GoalStatusValues.Active : row.Status,
            RunState = GoalRunStateValues.Idle,
            Plans = plans,
            CurrentPlanIndex = plans.Count > 0 ? row.CurrentPlanIndex : -1,
            StartedAt = DateTime.UtcNow
        };
    }

    private static JsonElement BuildResumeParameters(
        GoalContext goal,
        JsonElement? providerOverride = null)
    {
        // 1. 前端传入的 provider 覆盖（最高优先级） — 合并到 workingFolder 参数
        if (providerOverride.HasValue
            && providerOverride.Value.ValueKind == JsonValueKind.Object)
        {
            return WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                if (!string.IsNullOrEmpty(goal.WorkingFolder))
                    w.WriteString("workingFolder", goal.WorkingFolder);
                w.WritePropertyName("provider");
                providerOverride.Value.WriteTo(w);
                w.WriteEndObject();
            });
        }

        // 2. 优先使用创建时保存的原始参数（含 provider 配置）
        if (goal.OriginalParameters.HasValue
            && goal.OriginalParameters.Value.ValueKind == JsonValueKind.Object)
        {
            return goal.OriginalParameters.Value.Clone();
        }

        // 3. 回退到当前活跃 Agent 运行中该会话的 provider 配置
        if (AgentRuntimeTools.TryGetSessionParameters(goal.SessionId, out var sessionParams)
            && sessionParams.ValueKind == JsonValueKind.Object)
        {
            return sessionParams.Clone();
        }

        // 4. 最后兜底：只传 workingFolder（子 Agent 可能因缺少 provider 而失败）
        return string.IsNullOrEmpty(goal.WorkingFolder)
            ? new JsonElement()
            : WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                w.WriteString("workingFolder", goal.WorkingFolder);
                w.WriteEndObject();
            });
    }

    private static bool IsCurrentGoalContext(GoalContext goal)
        => ActiveGoals.TryGetValue(goal.GoalId, out var activeGoal)
            && ReferenceEquals(activeGoal, goal);

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

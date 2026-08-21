using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using WishfulClaw.Agent;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Worker.Modules;

public sealed class GoalModule : IWorkerModule
{
    public string Name => "goal";

    public void Register(IWorkerModuleContext context)
    {
        context.Register("goal/pause", PauseGoal);
        context.Register("goal/resume", ResumeGoal);
        context.Register("goal/abort", AbortGoal);
        context.Register("goal/status", GetGoalStatus);
        context.Register("goal/confirm", ConfirmGoal);
    }

    /// <summary>
    /// 服务启动时自动恢复 DB 中 active/paused 的 goals。
    /// </summary>
    public async Task InitializeAsync()
    {
        try
        {
            var interruptedPendingCount = DbGoalTools.AbortInterruptedPendingGoals();
            if (interruptedPendingCount > 0)
            {
                WorkerLog.Info($"[GoalModule] Archived {interruptedPendingCount} interrupted pending goals.");
            }

            var activeGoals = DbGoalTools.ListActiveGoals();
            if (activeGoals.Count == 0) return;

            WorkerLog.Info($"[GoalModule] Restoring {activeGoals.Count} active goals from DB...");
            foreach (var row in activeGoals)
            {
                if (string.IsNullOrEmpty(row.SessionId) || string.IsNullOrEmpty(row.GoalId))
                    continue;

                await GoalOrchestrator.ResumeFromDb(row.GoalId, row.SessionId);
                WorkerLog.Info($"[GoalModule] Restored goal {row.GoalId} session={row.SessionId} status={row.Status}");
            }
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"[GoalModule] InitializeAsync failed: {ex.Message}");
        }
    }
    private static async Task<WorkerResponse> PauseGoal(JsonElement parameters, IWorkerRequestContext context)
    {
        var goalId = parameters.TryGetProperty("goalId", out var id) ? id.GetString() : null;
        var sessionId = parameters.TryGetProperty("sessionId", out var sid) ? sid.GetString() : null;
        var result = string.IsNullOrEmpty(goalId)
            ? MissingGoalId("pause")
            : GoalOrchestrator.Pause(goalId);
        if (!string.IsNullOrEmpty(sessionId))
            await GoalOrchestrator.EmitRunStateChangedAsync(sessionId, result, context);
        return WorkerResponse.Json(result, WishfulClawJsonContext.Default.GoalActionResult);
    }

    private static async Task<WorkerResponse> ResumeGoal(JsonElement parameters, IWorkerRequestContext context)
    {
        var goalId = parameters.TryGetProperty("goalId", out var id) ? id.GetString() : null;
        var sessionId = parameters.TryGetProperty("sessionId", out var sid) ? sid.GetString() : null;
        JsonElement? provider = parameters.TryGetProperty("provider", out var p) && p.ValueKind == JsonValueKind.Object
            ? p
            : null;
        var result = string.IsNullOrEmpty(goalId)
            ? MissingGoalId("resume")
            : GoalOrchestrator.Resume(goalId, sessionId, provider, context);
        if (!string.IsNullOrEmpty(sessionId))
            await GoalOrchestrator.EmitRunStateChangedAsync(sessionId, result, context);
        return WorkerResponse.Json(
            result,
            WishfulClawJsonContext.Default.GoalActionResult);
    }

    private static async Task<WorkerResponse> AbortGoal(
        JsonElement parameters,
        IWorkerRequestContext context)
    {
        var goalId = parameters.TryGetProperty("goalId", out var id) ? id.GetString() : null;
        var sessionId = parameters.TryGetProperty("sessionId", out var sid) ? sid.GetString() : null;
        if (string.IsNullOrEmpty(goalId))
        {
            return WorkerResponse.Json(
                MissingGoalId("abort"),
                WishfulClawJsonContext.Default.GoalActionResult);
        }

        var pending = GoalOrchestrator.GetPendingGoal(goalId);
        if (pending != null)
        {
            var resolvedSessionId = sessionId ?? pending.SessionId;
            var row = DbGoalTools.SetStatusByGoalId(
                goalId,
                resolvedSessionId,
                GoalStatusValues.Pending,
                GoalStatusValues.Aborted,
                "Goal was cancelled before confirmation");
            if (row == null)
            {
                return WorkerResponse.Json(
                    new GoalActionResult(
                        false,
                        "state_changed",
                        GoalStatusValues.Pending,
                        GoalRunStateValues.Idle,
                        goalId,
                        "Pending goal changed before cancellation."),
                    WishfulClawJsonContext.Default.GoalActionResult);
            }

            GoalOrchestrator.RemovePendingGoal(goalId);
            var action = new GoalActionResult(
                true,
                "aborted",
                GoalStatusValues.Aborted,
                GoalRunStateValues.Idle,
                goalId);
            await GoalOrchestrator.EmitRunStateChangedAsync(resolvedSessionId, action, context);
            return WorkerResponse.Json(
                action,
                WishfulClawJsonContext.Default.GoalActionResult);
        }

        var result = await GoalOrchestrator.AbortAsync(goalId, context);
        if (!string.IsNullOrEmpty(sessionId))
            await GoalOrchestrator.EmitRunStateChangedAsync(sessionId, result, context);
        return WorkerResponse.Json(result, WishfulClawJsonContext.Default.GoalActionResult);
    }

    private static async Task<WorkerResponse> ConfirmGoal(JsonElement parameters, IWorkerRequestContext context)
    {
        var goalId = parameters.TryGetProperty("goalId", out var id) ? id.GetString() : null;
        var sessionId = parameters.TryGetProperty("sessionId", out var sid) ? sid.GetString() : null;

        if (string.IsNullOrEmpty(goalId) || string.IsNullOrEmpty(sessionId))
            return WorkerResponse.Json(new SimpleSuccessResult(false, Error: "goalId and sessionId are required"), WishfulClawJsonContext.Default.SimpleSuccessResult);

        var pending = GoalOrchestrator.GetPendingGoal(goalId);
        if (pending == null)
            return WorkerResponse.Json(new SimpleSuccessResult(false, Error: "No pending goal found with this goalId"), WishfulClawJsonContext.Default.SimpleSuccessResult);

        var row = DbGoalTools.SetStatusByGoalId(
            goalId,
            sessionId,
            GoalStatusValues.Pending,
            GoalStatusValues.Active,
            "Goal confirmed and started");
        if (row == null)
            return WorkerResponse.Json(new SimpleSuccessResult(false, Error: "Pending goal changed before confirmation"), WishfulClawJsonContext.Default.SimpleSuccessResult);

        var workingFolder = JsonHelpers.GetString(pending.Parameters, "workingFolder");

        var ok = await GoalOrchestrator.ConfirmGoalAsync(
            goalId, sessionId, workingFolder, pending.Parameters, context);
        if (!ok)
        {
            DbGoalTools.SetStatusByGoalId(
                goalId,
                sessionId,
                GoalStatusValues.Active,
                GoalStatusValues.Aborted,
                "Goal confirmation could not start the orchestrator");
        }
        else
        {
            var action = new GoalActionResult(
                true,
                "started",
                GoalStatusValues.Active,
                GoalRunStateValues.Running,
                goalId);
            await GoalOrchestrator.EmitRunStateChangedAsync(sessionId, action, context);
        }

        return WorkerResponse.Json(new SimpleSuccessResult(ok), WishfulClawJsonContext.Default.SimpleSuccessResult);
    }

    private static WorkerResponse GetGoalStatus(JsonElement parameters)
    {
        var goalId = parameters.TryGetProperty("goalId", out var id) ? id.GetString() : null;
        if (string.IsNullOrEmpty(goalId))
            return WorkerResponse.Json(new GoalStatusResponse(false), WishfulClawJsonContext.Default.GoalStatusResponse);

        var ctx = GoalOrchestrator.GetContext(goalId);
        return WorkerResponse.Json(new GoalStatusResponse(
            ctx?.Status == GoalStatusValues.Active,
            ctx?.Status ?? "unknown",
            ctx?.RunState ?? "unknown",
            goalId,
            ctx?.CurrentPlanIndex ?? -1,
            ctx?.Plans.Count ?? 0,
            ctx?.Plans.Count(p => p.Status == GoalPlanStatusValues.Complete) ?? 0), WishfulClawJsonContext.Default.GoalStatusResponse);
    }

    private static GoalActionResult MissingGoalId(string action)
        => new(false, "not_found", "unknown", "unknown", Error: $"goalId is required for {action}.");
}

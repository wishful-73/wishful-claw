using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Mirrors each plan execution round into the goal_plan_tasks table
/// (structural record for the Goal history panel). Best-effort: failures
/// are logged and never break the orchestration loop — the working-folder
/// markdown trail written by GoalPlanTracker remains the primary record.
/// </summary>
public static class GoalPlanRecorder
{
    /// <summary>
    /// Insert an "executing" row for a new round. Returns the row id, or -1 on failure.
    /// </summary>
    public static long StartRound(
        JsonElement parameters,
        GoalContext goal,
        GoalPlanItem plan,
        int round,
        List<string>? steps = null)
    {
        try
        {
            return DbGoalPlanTaskRoundTools.InsertPlanTask(
                parameters,
                goal.SessionId,
                goal.GoalId,
                plan.PlanId,
                plan.OriginalPlanId,
                plan.Title,
                round,
                plan.Description,
                steps);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"GoalPlanRecorder.StartRound failed: {ex.Message}");
            return -1;
        }
        // NOTE: the "adjusted" flag is derived on the frontend from
    }

    /// <summary>
    /// Mark a round as completed/failed with summary + evaluation reasoning.
    /// </summary>
    public static void FinishRound(
        JsonElement parameters,
        long taskId,
        string status,
        string? summary,
        string? evaluationReasoning,
        bool? evaluationSatisfied)
    {
        if (taskId <= 0) return;
        try
        {
            DbGoalPlanTaskRoundTools.FinishPlanTask(parameters, taskId, status, summary, evaluationReasoning, evaluationSatisfied);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"GoalPlanRecorder.FinishRound failed: {ex.Message}");
        }
    }
}

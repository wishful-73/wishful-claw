using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Best-effort DB materialization for the three-tier goal hierarchy
/// (goal_plans / goal_plan_tasks / goal_execution_runs). Failures are
/// logged only — they never break the orchestration loop.
/// </summary>
public static class GoalOrchestratorMaterialize
{
    /// <summary>
    /// Insert all plans into goal_plans with status=pending (idempotent).
    /// </summary>
    public static void MaterializePlans(GoalContext goal, JsonElement parameters)
    {
        try
        {
            var planEntities = goal.Plans.Select((p, idx) => new GoalPlanEntity
            {
                PlanId = p.PlanId,
                GoalId = goal.GoalId,
                SessionId = goal.SessionId,
                Ordinal = idx,
                OriginalPlanId = p.OriginalPlanId,
                Title = p.Title,
                Description = p.Description,
                Status = GoalPlanStatusValues.Pending,
            }).ToList();
            DbGoalPlanTools.MaterializePlans(parameters, goal.GoalId, goal.SessionId, planEntities);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"MaterializePlans failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Update a plan's status in goal_plans.
    /// </summary>
    public static void UpdatePlanStatus(GoalContext goal, GoalPlanItem plan, string status, string? resultSummary)
    {
        try
        {
            DbGoalPlanTools.UpdatePlanStatus(plan.PlanId, goal.GoalId, goal.SessionId, status, resultSummary);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"UpdatePlanStatus({status}) failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Insert an execution attempt row into goal_execution_runs.
    /// Returns the attempt id, or null on failure.
    /// </summary>
    public static string? StartExecutionAttempt(GoalContext goal, GoalPlanItem plan, int attemptNo)
    {
        try
        {
            return DbGoalExecutionRunTools.InsertRun(goal.GoalId, plan.PlanId, null, attemptNo);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"InsertRun failed: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Finish an execution attempt row with a terminal status.
    /// </summary>
    public static void FinishExecutionAttempt(GoalContext goal, GoalPlanItem plan, string? attemptId,
        string status, string? summary, string? error)
    {
        if (string.IsNullOrEmpty(attemptId)) return;
        try
        {
            DbGoalExecutionRunTools.FinishRun(attemptId, status, summary, error);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"FinishRun failed: {ex.Message}");
        }
    }
}

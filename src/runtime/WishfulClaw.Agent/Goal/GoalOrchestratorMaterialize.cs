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
    /// Materialize tasks for a plan into goal_tasks with status=pending (idempotent).
    /// </summary>
    public static void MaterializeTasks(GoalContext goal, GoalPlanItem plan, JsonElement parameters,
        List<(string taskId, string title, string description)> tasks)
    {
        try
        {
            var taskEntities = tasks.Select((t, idx) => new GoalTaskEntity
            {
                TaskId = t.taskId,
                GoalId = goal.GoalId,
                PlanId = plan.PlanId,
                SessionId = goal.SessionId,
                Ordinal = idx,
                Title = t.title,
                Description = t.description,
                Status = GoalPlanStatusValues.Pending,
            }).ToList();
            DbGoalTaskTools.MaterializeTasks(parameters, goal.GoalId, plan.PlanId, goal.SessionId, taskEntities);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"MaterializeTasks failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Update a task's status in goal_tasks.
    /// </summary>
    public static void UpdateTaskStatus(GoalContext goal, GoalPlanItem plan, string taskId,
        string status, string? resultSummary)
    {
        try
        {
            DbGoalTaskTools.UpdateTaskStatus(taskId, goal.GoalId, plan.PlanId, goal.SessionId, status, resultSummary);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"UpdateTaskStatus({status}) failed: {ex.Message}");
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

    /// <summary>
    /// Abort all non-terminal plans and tasks for a goal (best-effort).
    /// Called when the Goal itself is aborted — propagates the aborted
    /// status down to goal_plans and goal_tasks.
    /// </summary>
    public static void AbortSubtree(GoalContext goal, JsonElement parameters)
    {
        try
        {
            var db = DbClient.GetClient(parameters);
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            // Abort all non-terminal plans
            db.Execute(
                "UPDATE goal_plans SET status = 'aborted', updated_at = @now, completed_at = @now " +
                "WHERE goal_id = @gid AND session_id = @sid AND status NOT IN ('complete', 'aborted')",
                new Microsoft.Data.Sqlite.SqliteParameter("@now", now),
                new Microsoft.Data.Sqlite.SqliteParameter("@gid", goal.GoalId),
                new Microsoft.Data.Sqlite.SqliteParameter("@sid", goal.SessionId));

            // Abort all non-terminal tasks
            db.Execute(
                "UPDATE goal_tasks SET status = 'aborted', updated_at = @now, completed_at = @now " +
                "WHERE goal_id = @gid AND session_id = @sid AND status NOT IN ('complete', 'aborted')",
                new Microsoft.Data.Sqlite.SqliteParameter("@now", now),
                new Microsoft.Data.Sqlite.SqliteParameter("@gid", goal.GoalId),
                new Microsoft.Data.Sqlite.SqliteParameter("@sid", goal.SessionId));

            // Mark any executing attempts as interrupted
            db.Execute(
                "UPDATE goal_execution_runs SET status = 'interrupted', finished_at = @now " +
                "WHERE goal_id = @gid AND status = 'executing'",
                new Microsoft.Data.Sqlite.SqliteParameter("@now", now),
                new Microsoft.Data.Sqlite.SqliteParameter("@gid", goal.GoalId));
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"AbortSubtree failed: {ex.Message}");
        }
    }
}

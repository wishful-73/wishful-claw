using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Best-effort DB materialization for the three-tier goal hierarchy
/// (goal_plans / goal_plan_tasks / goal_execution_runs). Failures are
/// logged only — they never break the orchestration loop. A failure
/// counter escalates to an exception after repeated consecutive
/// failures so "best-effort" cannot silently swallow a broken DB link.
/// </summary>
public static class GoalOrchestratorMaterialize
{
    /// <summary>
    /// Consecutive failed materialization calls before we stop swallowing
    /// errors and let the exception reach the orchestration loop (which
    /// marks the goal failed instead of silently losing state).
    /// </summary>
    private const int MaxConsecutiveFailures = 5;

    private static int _consecutiveFailures;

    private static void ReportFailure(string operation, Exception ex)
    {
        _consecutiveFailures++;
        WorkerLog.Warn($"[{operation}] materialize failed ({_consecutiveFailures}/{MaxConsecutiveFailures}): {ex.Message}");
        if (_consecutiveFailures >= MaxConsecutiveFailures)
        {
            var message = $"Goal DB materialization failed {_consecutiveFailures} times in a row ({operation}): {ex.Message}";
            _consecutiveFailures = 0;
            throw new InvalidOperationException(message, ex);
        }
    }

    private static void ReportSuccess()
    {
        _consecutiveFailures = 0;
    }

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
            ReportSuccess();
        }
        catch (Exception ex)
        {
            ReportFailure(nameof(MaterializePlans), ex);
        }
    }

    /// <summary>
    /// Mark the old goal_plans row as superseded when an adjust step replaces
    /// the plan identity. Without this the old row stays active forever and
    /// the panel shows a stale "executing" plan.
    /// </summary>
    public static void MarkPlanSuperseded(GoalContext goal, string oldPlanId, string? resultSummary)
    {
        try
        {
            DbGoalPlanTools.UpdatePlanStatus(oldPlanId, goal.GoalId, goal.SessionId,
                GoalPlanStatusValues.Superseded, resultSummary);
            ReportSuccess();
        }
        catch (Exception ex)
        {
            ReportFailure(nameof(MarkPlanSuperseded), ex);
        }
    }

    /// <summary>
    /// Insert the goal_plans row for a plan created by an adjust step.
    /// The old row was already marked superseded by the caller; without
    /// this insert the new planId has no DB row and every subsequent
    /// status update would silently miss.
    /// </summary>
    public static void InsertAdjustedPlan(GoalContext goal, GoalPlanItem plan, int planIndex)
    {
        try
        {
            var entity = new GoalPlanEntity
            {
                PlanId = plan.PlanId,
                GoalId = goal.GoalId,
                SessionId = goal.SessionId,
                Ordinal = planIndex,
                OriginalPlanId = plan.OriginalPlanId,
                Title = plan.Title,
                Description = plan.Description,
                Status = GoalPlanStatusValues.Active,
                RetryCount = plan.RetryCount,
            };
            DbGoalPlanTools.InsertPlan(entity);
            ReportSuccess();
        }
        catch (Exception ex)
        {
            ReportFailure(nameof(InsertAdjustedPlan), ex);
        }
    }

    /// <summary>
    /// Re-parent already-materialized goal_tasks rows from the old planId
    /// to the adjusted planId so task status updates keep hitting real rows.
    /// </summary>
    public static void ReparentTasksToPlan(GoalContext goal, string oldPlanId, string newPlanId)
    {
        try
        {
            DbGoalTaskTools.ReparentTasks(goal.GoalId, goal.SessionId, oldPlanId, newPlanId);
            ReportSuccess();
        }
        catch (Exception ex)
        {
            ReportFailure(nameof(ReparentTasksToPlan), ex);
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
            ReportSuccess();
        }
        catch (Exception ex)
        {
            ReportFailure(nameof(UpdatePlanStatus), ex);
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
            ReportSuccess();
        }
        catch (Exception ex)
        {
            ReportFailure(nameof(MaterializeTasks), ex);
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
            ReportSuccess();
        }
        catch (Exception ex)
        {
            ReportFailure(nameof(UpdateTaskStatus), ex);
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
            var attemptId = DbGoalExecutionRunTools.InsertRun(goal.GoalId, plan.PlanId, null, attemptNo);
            ReportSuccess();
            return attemptId;
        }
        catch (Exception ex)
        {
            ReportFailure(nameof(StartExecutionAttempt), ex);
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
            ReportSuccess();
        }
        catch (Exception ex)
        {
            ReportFailure(nameof(FinishExecutionAttempt), ex);
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

            // Abort all non-terminal plans (superseded/interrupted rows are terminal too)
            db.Execute(
                "UPDATE goal_plans SET status = @aborted, updated_at = @now, completed_at = @now " +
                "WHERE goal_id = @gid AND session_id = @sid AND status NOT IN (@complete, @aborted, @superseded, @interrupted)",
                new Microsoft.Data.Sqlite.SqliteParameter("@aborted", GoalPlanStatusValues.Aborted),
                new Microsoft.Data.Sqlite.SqliteParameter("@now", now),
                new Microsoft.Data.Sqlite.SqliteParameter("@gid", goal.GoalId),
                new Microsoft.Data.Sqlite.SqliteParameter("@sid", goal.SessionId),
                new Microsoft.Data.Sqlite.SqliteParameter("@complete", GoalPlanStatusValues.Complete),
                new Microsoft.Data.Sqlite.SqliteParameter("@aborted", GoalPlanStatusValues.Aborted),
                new Microsoft.Data.Sqlite.SqliteParameter("@superseded", GoalPlanStatusValues.Superseded),
                new Microsoft.Data.Sqlite.SqliteParameter("@interrupted", GoalPlanStatusValues.Interrupted));

            // Abort all non-terminal tasks
            db.Execute(
                "UPDATE goal_tasks SET status = @aborted, updated_at = @now, completed_at = @now " +
                "WHERE goal_id = @gid AND session_id = @sid AND status NOT IN (@complete, @aborted, @interrupted)",
                new Microsoft.Data.Sqlite.SqliteParameter("@aborted", GoalPlanStatusValues.Aborted),
                new Microsoft.Data.Sqlite.SqliteParameter("@now", now),
                new Microsoft.Data.Sqlite.SqliteParameter("@gid", goal.GoalId),
                new Microsoft.Data.Sqlite.SqliteParameter("@sid", goal.SessionId),
                new Microsoft.Data.Sqlite.SqliteParameter("@complete", GoalPlanStatusValues.Complete),
                new Microsoft.Data.Sqlite.SqliteParameter("@aborted", GoalPlanStatusValues.Aborted),
                new Microsoft.Data.Sqlite.SqliteParameter("@interrupted", GoalPlanStatusValues.Interrupted));

            // Mark any executing attempts as interrupted
            db.Execute(
                "UPDATE goal_execution_runs SET status = @interrupted, finished_at = @now " +
                "WHERE goal_id = @gid AND status = @executing",
                new Microsoft.Data.Sqlite.SqliteParameter("@interrupted", GoalExecutionAttemptStatusValues.Interrupted),
                new Microsoft.Data.Sqlite.SqliteParameter("@now", now),
                new Microsoft.Data.Sqlite.SqliteParameter("@gid", goal.GoalId),
                new Microsoft.Data.Sqlite.SqliteParameter("@executing", GoalExecutionAttemptStatusValues.Executing));

            ReportSuccess();
        }
        catch (Exception ex)
        {
            ReportFailure(nameof(AbortSubtree), ex);
        }
    }
}

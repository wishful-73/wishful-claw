/*
 * Wishful Claw 自研：Goal 编排每轮执行记录（goal_plan_tasks）读写工具。
 * 一行 = 一个计划的一轮执行（round = retry + 1）。
 * 与 goal_execution_runs（attempt-level）互补：
 *   - goal_plan_tasks 是 plan-level 每轮的整体结果。
 *   - goal_execution_runs 是更细粒度的单次执行尝试。
 */

using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// 对 goal_plan_tasks 表的读写工具。所有方法都通过 DbClient 获取连接。
/// </summary>
public static partial class DbGoalPlanTaskRoundTools
{
    // ─── Worker 端点：列表查询 ───

    public static WorkerResponse ListPlanTasks(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var sessionId = GetString(parameters, "sessionId") ?? throw new InvalidOperationException("sessionId is required");
            var goalId = GetString(parameters, "goalId") ?? throw new InvalidOperationException("goalId is required");

            var rows = ListPlanTasksInternal(db, goalId, sessionId);
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListGoalPlanTaskRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalPlanTaskRoundTools.ListPlanTasks failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    // ─── Worker 端点：单条查询 ───

    public static WorkerResponse GetPlanTask(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var sessionId = GetString(parameters, "sessionId") ?? throw new InvalidOperationException("sessionId is required");
            var goalId = GetString(parameters, "goalId") ?? throw new InvalidOperationException("goalId is required");
            var taskId = parameters.TryGetProperty("taskId", out var tid) && tid.ValueKind == JsonValueKind.Number
                ? tid.GetInt64()
                : throw new InvalidOperationException("taskId is required");

            var entity = db.QueryFirstOrDefault(
                "SELECT * FROM goal_plan_tasks WHERE id = @id AND session_id = @sid AND goal_id = @gid LIMIT 1",
                EntityMappers.MapGoalPlanTask,
                new SqliteParameter("@id", taskId),
                new SqliteParameter("@sid", sessionId),
                new SqliteParameter("@gid", goalId));

            if (entity == null)
                return WorkerResponse.Json(new GoalPlanTaskFindResult(false, [], "Task not found"),
                    InfrastructureJsonContext.Default.GoalPlanTaskFindResult);

            return WorkerResponse.Json(GoalPlanTaskRow.FromEntity(entity),
                InfrastructureJsonContext.Default.GoalPlanTaskRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalPlanTaskRoundTools.GetPlanTask failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    // ─── Worker 端点：按 plan 过滤 ───

    public static WorkerResponse ListPlanTasksByPlan(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var sessionId = GetString(parameters, "sessionId") ?? throw new InvalidOperationException("sessionId is required");
            var goalId = GetString(parameters, "goalId") ?? throw new InvalidOperationException("goalId is required");
            var planId = GetString(parameters, "planId") ?? throw new InvalidOperationException("planId is required");

            var rows = ListPlanTasksByPlanInternal(db, goalId, planId, sessionId);
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListGoalPlanTaskRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalPlanTaskRoundTools.ListPlanTasksByPlan failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    // ─── Agent 编排层内部调用（非端点） ───

    /// <summary>
    /// Insert a new executing round. Called by the orchestrator before a sub-agent run.
    /// 幂等：如果同 goal/session/round/chain-root 已存在未完成的 executing 行，则复用并刷新 started_at。
    /// </summary>
    public static long InsertPlanTask(
        JsonElement parameters,
        string sessionId,
        string goalId,
        string planId,
        string? originalPlanId,
        string? planTitle,
        int round,
        string? description,
        List<string>? steps)
    {
        DbClient.EnsureInitialized(parameters);
        var db = DbClient.GetClient(parameters);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        string? stepsJson = null;
        if (steps is { Count: > 0 })
        {
            using var buffer = new MemoryStream();
            using (var writer = new Utf8JsonWriter(buffer))
            {
                writer.WriteStartArray();
                foreach (var step in steps)
                    writer.WriteStringValue(step);
                writer.WriteEndArray();
            }
            stepsJson = System.Text.Encoding.UTF8.GetString(buffer.ToArray());
        }

        // Reuse an unfinished row for the same round (chain-root plan match) so a
        // paused/interrupted goal that resumes does not create a duplicate
        // "executing" entry for the same round. started_at is refreshed to now
        // because the round is being re-executed from scratch.
        var chainRoot = originalPlanId ?? planId;
        var existingId = db.QueryScalar<long?>(
            "SELECT id FROM goal_plan_tasks " +
            "WHERE session_id = @sid AND goal_id = @gid AND round = @round " +
            "AND status = 'executing' AND finished_at IS NULL " +
            "AND COALESCE(original_plan_id, plan_id) = @root " +
            "ORDER BY id DESC LIMIT 1",
            new SqliteParameter("@sid", sessionId),
            new SqliteParameter("@gid", goalId),
            new SqliteParameter("@round", round),
            new SqliteParameter("@root", chainRoot));
        if (existingId is > 0)
        {
            db.Execute(
                "UPDATE goal_plan_tasks SET started_at = @started, description = @desc, steps_json = @steps WHERE id = @id",
                new SqliteParameter("@started", now),
                new SqliteParameter("@desc", (object?)description ?? DBNull.Value),
                new SqliteParameter("@steps", (object?)stepsJson ?? DBNull.Value),
                new SqliteParameter("@id", existingId.Value));
            return existingId.Value;
        }

        db.Execute(
            "INSERT INTO goal_plan_tasks " +
            "(session_id, goal_id, plan_id, original_plan_id, plan_title, round, status, description, steps_json, started_at) " +
            "VALUES (@sid, @gid, @pid, @opid, @title, @round, 'executing', @desc, @steps, @started)",
            new SqliteParameter("@sid", sessionId),
            new SqliteParameter("@gid", goalId),
            new SqliteParameter("@pid", planId),
            new SqliteParameter("@opid", (object?)originalPlanId ?? DBNull.Value),
            new SqliteParameter("@title", (object?)planTitle ?? DBNull.Value),
            new SqliteParameter("@round", round),
            new SqliteParameter("@desc", (object?)description ?? DBNull.Value),
            new SqliteParameter("@steps", (object?)stepsJson ?? DBNull.Value),
            new SqliteParameter("@started", now));

        return db.QueryScalar<long>("SELECT last_insert_rowid()");
    }

    /// <summary>
    /// Mark the current round as completed/failed with execution summary + evaluation.
    /// </summary>
    public static void FinishPlanTask(
        JsonElement parameters,
        long taskId,
        string status,
        string? summary,
        string? evaluationReasoning,
        bool? evaluationSatisfied)
    {
        DbClient.EnsureInitialized(parameters);
        var db = DbClient.GetClient(parameters);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        db.Execute(
            "UPDATE goal_plan_tasks SET status = @status, summary = @summary, " +
            "evaluation_reasoning = @reasoning, evaluation_satisfied = @satisfied, finished_at = @finished " +
            "WHERE id = @id",
            new SqliteParameter("@status", status),
            new SqliteParameter("@summary", (object?)summary ?? DBNull.Value),
            new SqliteParameter("@reasoning", (object?)evaluationReasoning ?? DBNull.Value),
            new SqliteParameter("@satisfied", evaluationSatisfied is null ? DBNull.Value : (evaluationSatisfied.Value ? 1 : 0)),
            new SqliteParameter("@finished", now),
            new SqliteParameter("@id", taskId));
    }

    /// <summary>
    /// 查询某 Goal 的全部 Plan Task 轮次（按 round 升序）。
    /// </summary>
    public static List<GoalPlanTaskRow> ListPlanTasks(string goalId, string sessionId)
    {
        DbClient.EnsureInitialized();
        var db = DbClient.GetClient();
        return ListPlanTasksInternal(db, goalId, sessionId);
    }

    /// <summary>
    /// 查询某 Plan 的全部轮次。
    /// </summary>
    public static List<GoalPlanTaskRow> ListPlanTasksByPlan(string goalId, string planId, string sessionId)
    {
        DbClient.EnsureInitialized();
        var db = DbClient.GetClient();
        return ListPlanTasksByPlanInternal(db, goalId, planId, sessionId);
    }

    /// <summary>
    /// 查询某 Plan 的最近一轮。
    /// </summary>
    public static GoalPlanTaskRow? GetLatestPlanTask(string goalId, string planId, string sessionId)
    {
        DbClient.EnsureInitialized();
        var db = DbClient.GetClient();

        var entity = db.QueryFirstOrDefault(
            "SELECT * FROM goal_plan_tasks WHERE goal_id = @gid AND plan_id = @pid AND session_id = @sid ORDER BY round DESC, id DESC LIMIT 1",
            EntityMappers.MapGoalPlanTask,
            new SqliteParameter("@gid", goalId),
            new SqliteParameter("@pid", planId),
            new SqliteParameter("@sid", sessionId));

        return entity == null ? null : GoalPlanTaskRow.FromEntity(entity);
    }

    private static List<GoalPlanTaskRow> ListPlanTasksInternal(DbService db, string goalId, string sessionId)
    {
        var entities = db.Query(
            "SELECT * FROM goal_plan_tasks WHERE session_id = @sid AND goal_id = @gid ORDER BY round ASC, id ASC",
            EntityMappers.MapGoalPlanTask,
            new SqliteParameter("@sid", sessionId),
            new SqliteParameter("@gid", goalId));

        return entities.Select(GoalPlanTaskRow.FromEntity).ToList();
    }

    private static List<GoalPlanTaskRow> ListPlanTasksByPlanInternal(DbService db, string goalId, string planId, string sessionId)
    {
        var entities = db.Query(
            "SELECT * FROM goal_plan_tasks WHERE session_id = @sid AND goal_id = @gid AND plan_id = @pid ORDER BY round ASC, id ASC",
            EntityMappers.MapGoalPlanTask,
            new SqliteParameter("@sid", sessionId),
            new SqliteParameter("@gid", goalId),
            new SqliteParameter("@pid", planId));

        return entities.Select(GoalPlanTaskRow.FromEntity).ToList();
    }

    private static string? GetString(JsonElement parameters, string name)
    {
        if (parameters.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String)
            return value.GetString();
        return null;
    }
}

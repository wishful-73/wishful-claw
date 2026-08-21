/*
 * Wishful Claw 自研：Goal 编排层 Task 定义（goal_tasks）读写工具。
 * 一行 = 一个任务定义（不是执行尝试）。Task 定义与 goal_plan_tasks 的每轮执行记录分离。
 */

using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// 对 goal_tasks 表的读写工具。所有方法都通过 DbClient 获取连接。
/// Materialize 幂等：已存在的 task_id 跳过。
/// </summary>
public static partial class DbGoalTaskTools
{
    // ─── Worker 端点：查询 ───

    public static WorkerResponse ListTasks(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var sessionId = GetString(parameters, "sessionId") ?? throw new InvalidOperationException("sessionId is required");
            var goalId = GetString(parameters, "goalId") ?? throw new InvalidOperationException("goalId is required");
            var planId = GetString(parameters, "planId") ?? throw new InvalidOperationException("planId is required");

            var entities = db.Query(
                "SELECT * FROM goal_tasks WHERE session_id = @sid AND goal_id = @gid AND plan_id = @pid ORDER BY ordinal ASC",
                EntityMappers.MapGoalTask,
                new SqliteParameter("@sid", sessionId),
                new SqliteParameter("@gid", goalId),
                new SqliteParameter("@pid", planId));

            var rows = entities.Select(GoalTaskRow.FromEntity).ToList();
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListGoalTaskRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalTaskTools.ListTasks failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse GetTask(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var sessionId = GetString(parameters, "sessionId") ?? throw new InvalidOperationException("sessionId is required");
            var goalId = GetString(parameters, "goalId") ?? throw new InvalidOperationException("goalId is required");
            var planId = GetString(parameters, "planId") ?? throw new InvalidOperationException("planId is required");
            var taskId = GetString(parameters, "taskId") ?? throw new InvalidOperationException("taskId is required");

            var entity = db.QueryFirstOrDefault(
                "SELECT * FROM goal_tasks WHERE task_id = @tid AND goal_id = @gid AND plan_id = @pid AND session_id = @sid LIMIT 1",
                EntityMappers.MapGoalTask,
                new SqliteParameter("@tid", taskId),
                new SqliteParameter("@gid", goalId),
                new SqliteParameter("@pid", planId),
                new SqliteParameter("@sid", sessionId));

            if (entity == null)
                return WorkerResponse.Json(new GoalTaskFindResult(false, null, "Task not found"),
                    InfrastructureJsonContext.Default.GoalTaskFindResult);

            return WorkerResponse.Json(GoalTaskRow.FromEntity(entity),
                InfrastructureJsonContext.Default.GoalTaskRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalTaskTools.GetTask failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse UpdateTaskStatus(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var sessionId = GetString(parameters, "sessionId") ?? throw new InvalidOperationException("sessionId is required");
            var goalId = GetString(parameters, "goalId") ?? throw new InvalidOperationException("goalId is required");
            var planId = GetString(parameters, "planId") ?? throw new InvalidOperationException("planId is required");
            var taskId = GetString(parameters, "taskId") ?? throw new InvalidOperationException("taskId is required");
            var status = GetString(parameters, "status") ?? throw new InvalidOperationException("status is required");
            var resultSummary = GetString(parameters, "resultSummary");

            var entity = UpdateTaskStatusInternal(db, taskId, goalId, planId, sessionId, status, resultSummary);
            if (entity == null)
                return WorkerResponse.Json(new GoalTaskMutationResult(false, null, "Task not found"),
                    InfrastructureJsonContext.Default.GoalTaskMutationResult);

            return WorkerResponse.Json(GoalTaskRow.FromEntity(entity),
                InfrastructureJsonContext.Default.GoalTaskRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalTaskTools.UpdateTaskStatus failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    // ─── Agent 编排层内部调用（非端点） ───

    /// <summary>
    /// Materialize: 一次性写入全部 Task，初始 status=pending。幂等：已存在的 task_id 跳过。
    /// </summary>
    public static void MaterializeTasks(JsonElement parameters, string goalId, string planId, string sessionId, List<GoalTaskEntity> tasks)
    {
        if (tasks == null || tasks.Count == 0)
            return;

        DbClient.EnsureInitialized(parameters);
        var db = DbClient.GetClient(parameters);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        db.ExecuteInTransaction((connection, transaction) =>
        {
            foreach (var task in tasks)
            {
                task.GoalId = goalId;
                task.PlanId = planId;
                task.SessionId = sessionId;
                task.CreatedAt = now;
                task.UpdatedAt = now;

                var exists = db.QueryScalar<int>(
                    connection,
                    transaction,
                    "SELECT COUNT(*) FROM goal_tasks WHERE task_id = @tid AND session_id = @sid",
                    new SqliteParameter("@tid", task.TaskId),
                    new SqliteParameter("@sid", sessionId));

                if (exists > 0)
                    continue;

                db.Execute(
                    connection,
                    transaction,
                    "INSERT INTO goal_tasks " +
                    "(task_id, goal_id, plan_id, session_id, ordinal, title, description, content_json, " +
                    "status, retry_count, result_summary, created_at, updated_at, started_at, completed_at) " +
                    "VALUES (@tid, @gid, @pid, @sid, @ord, @title, @desc, @cj, " +
                    "'pending', @rc, @rs, @ca, @ua, @sa, @ca2)",
                    new SqliteParameter("@tid", task.TaskId),
                    new SqliteParameter("@gid", goalId),
                    new SqliteParameter("@pid", planId),
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@ord", task.Ordinal),
                    new SqliteParameter("@title", task.Title),
                    new SqliteParameter("@desc", task.Description),
                    new SqliteParameter("@cj", (object?)task.ContentJson ?? DBNull.Value),
                    new SqliteParameter("@rc", task.RetryCount),
                    new SqliteParameter("@rs", (object?)task.ResultSummary ?? DBNull.Value),
                    new SqliteParameter("@ca", now),
                    new SqliteParameter("@ua", now),
                    new SqliteParameter("@sa", DBNull.Value),
                    new SqliteParameter("@ca2", DBNull.Value));
            }
        });
    }

    /// <summary>
    /// 查询某 Plan 的全部 Tasks（按 ordinal 排序）。
    /// </summary>
    public static List<GoalTaskRow> ListTasks(string goalId, string planId, string sessionId)
    {
        DbClient.EnsureInitialized();
        var db = DbClient.GetClient();

        var entities = db.Query(
            "SELECT * FROM goal_tasks WHERE goal_id = @gid AND plan_id = @pid AND session_id = @sid ORDER BY ordinal ASC",
            EntityMappers.MapGoalTask,
            new SqliteParameter("@gid", goalId),
            new SqliteParameter("@pid", planId),
            new SqliteParameter("@sid", sessionId));

        return entities.Select(GoalTaskRow.FromEntity).ToList();
    }

    /// <summary>
    /// 按 taskId 精确查询单个 Task。
    /// </summary>
    public static GoalTaskRow? GetTask(string taskId, string goalId, string planId, string sessionId)
    {
        DbClient.EnsureInitialized();
        var db = DbClient.GetClient();

        var entity = db.QueryFirstOrDefault(
            "SELECT * FROM goal_tasks WHERE task_id = @tid AND goal_id = @gid AND plan_id = @pid AND session_id = @sid LIMIT 1",
            EntityMappers.MapGoalTask,
            new SqliteParameter("@tid", taskId),
            new SqliteParameter("@gid", goalId),
            new SqliteParameter("@pid", planId),
            new SqliteParameter("@sid", sessionId));

        return entity == null ? null : GoalTaskRow.FromEntity(entity);
    }

    /// <summary>
    /// 更新 Task 状态。返回更新后的 Task 行，或 null 表示未找到。
    /// </summary>
    public static GoalTaskRow? UpdateTaskStatus(string taskId, string goalId, string planId, string sessionId, string status, string? resultSummary)
    {
        DbClient.EnsureInitialized();
        var db = DbClient.GetClient();
        var entity = UpdateTaskStatusInternal(db, taskId, goalId, planId, sessionId, status, resultSummary);
        return entity == null ? null : GoalTaskRow.FromEntity(entity);
    }

    private static GoalTaskEntity? UpdateTaskStatusInternal(
        DbService db, string taskId, string goalId, string planId, string sessionId, string status, string? resultSummary)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        db.ExecuteInTransaction((connection, transaction) =>
        {
            var changed = db.Execute(
                connection,
                transaction,
                "UPDATE goal_tasks SET status = @status, result_summary = @rs, updated_at = @ua, " +
                "started_at = CASE WHEN status = 'active' AND started_at IS NULL THEN @now ELSE started_at END, " +
                "completed_at = CASE WHEN status IN ('complete', 'aborted') AND completed_at IS NULL THEN @now ELSE completed_at END " +
                "WHERE task_id = @tid AND goal_id = @gid AND plan_id = @pid AND session_id = @sid",
                new SqliteParameter("@status", status),
                new SqliteParameter("@rs", (object?)resultSummary ?? DBNull.Value),
                new SqliteParameter("@ua", now),
                new SqliteParameter("@now", now),
                new SqliteParameter("@tid", taskId),
                new SqliteParameter("@gid", goalId),
                new SqliteParameter("@pid", planId),
                new SqliteParameter("@sid", sessionId));

            if (changed != 1)
                throw new InvalidOperationException("Task not found or changed during update");
        });

        var entity = db.QueryFirstOrDefault(
            "SELECT * FROM goal_tasks WHERE task_id = @tid AND goal_id = @gid AND plan_id = @pid AND session_id = @sid LIMIT 1",
            EntityMappers.MapGoalTask,
            new SqliteParameter("@tid", taskId),
            new SqliteParameter("@gid", goalId),
            new SqliteParameter("@pid", planId),
            new SqliteParameter("@sid", sessionId));

        return entity;
    }

    private static string? GetString(JsonElement parameters, string name)
    {
        return parameters.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }
}

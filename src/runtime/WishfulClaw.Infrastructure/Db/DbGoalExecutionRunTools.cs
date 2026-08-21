/*
 * Wishful Claw 自研：Goal 编排层执行尝试记录（goal_execution_runs）读写工具。
 * 一行 = 一次执行尝试（attempt）。与 goal_plan_tasks 的每轮执行记录互补：
 *   - goal_plan_tasks 记录每个 Plan 每一轮的整体执行结果（plan-level round）。
 *   - goal_execution_runs 记录更细粒度的单次执行尝试（attempt-level）。
 * 一个 Task 可能有多个 attempt（重试、子代理多次调用等）。
 */

using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// 对 goal_execution_runs 表的读写工具。所有方法都通过 DbClient 获取连接。
/// </summary>
public static partial class DbGoalExecutionRunTools
{
    // ─── Worker 端点：插入 ───

    public static WorkerResponse InsertRun(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var goalId = GetString(parameters, "goalId") ?? throw new InvalidOperationException("goalId is required");
            var planId = GetString(parameters, "planId");
            var taskId = GetString(parameters, "taskId");
            var attemptNo = parameters.TryGetProperty("attemptNo", out var an) && an.ValueKind == JsonValueKind.Number
                ? an.GetInt32()
                : 1;

            var attemptId = InsertRun(goalId, planId, taskId, attemptNo);
            return WorkerResponse.Json(new ExecutionRunInsertResult(attemptId),
                InfrastructureJsonContext.Default.ExecutionRunInsertResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalExecutionRunTools.InsertRun failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    // ─── Worker 端点：完成 ───

    public static WorkerResponse FinishRun(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var attemptId = GetString(parameters, "attemptId") ?? throw new InvalidOperationException("attemptId is required");
            var status = GetString(parameters, "status") ?? throw new InvalidOperationException("status is required");
            var summary = GetString(parameters, "summary");
            var error = GetString(parameters, "error");

            FinishRun(attemptId, status, summary, error);
            return WorkerResponse.Json(new ExecutionRunMutationResult(true, null, null),
                InfrastructureJsonContext.Default.ExecutionRunMutationResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalExecutionRunTools.FinishRun failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    // ─── Worker 端点：查询单条 ───

    public static WorkerResponse GetRun(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var attemptId = GetString(parameters, "attemptId") ?? throw new InvalidOperationException("attemptId is required");

            var entity = GetRunInternal(attemptId);
            if (entity == null)
                return WorkerResponse.Json(new ExecutionRunFindResult(false, null, "Run not found"),
                    InfrastructureJsonContext.Default.ExecutionRunFindResult);

            return WorkerResponse.Json(ExecutionRunRow.FromEntity(entity),
                InfrastructureJsonContext.Default.ExecutionRunRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalExecutionRunTools.GetRun failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    // ─── Worker 端点：列表 ───

    public static WorkerResponse ListRuns(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var goalId = GetString(parameters, "goalId") ?? throw new InvalidOperationException("goalId is required");
            var planId = GetString(parameters, "planId");
            var taskId = GetString(parameters, "taskId");
            var limit = parameters.TryGetProperty("limit", out var lim) && lim.ValueKind == JsonValueKind.Number
                ? lim.GetInt32()
                : 100;

            var rows = ListRunsInternal(db, goalId, planId, taskId, limit);
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListExecutionRunRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalExecutionRunTools.ListRuns failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    // ─── Agent 编排层内部调用（非端点） ───

    /// <summary>
    /// 创建执行尝试记录。返回 attempt_id。
    /// attempt_id 格式："run-{goalId}-{planId|_}-{taskId|_}-{attemptNo}-{ts}"，保证唯一。
    /// </summary>
    public static string InsertRun(string goalId, string? planId, string? taskId, int attemptNo)
    {
        DbClient.EnsureInitialized();
        var db = DbClient.GetClient();

        var attemptId = BuildAttemptId(goalId, planId, taskId, attemptNo);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        db.Execute(
            "INSERT INTO goal_execution_runs " +
            "(attempt_id, goal_id, plan_id, task_id, attempt_no, status, started_at) " +
            "VALUES (@aid, @gid, @pid, @tid, @ano, 'executing', @sa)",
            new SqliteParameter("@aid", attemptId),
            new SqliteParameter("@gid", goalId),
            new SqliteParameter("@pid", (object?)planId ?? DBNull.Value),
            new SqliteParameter("@tid", (object?)taskId ?? DBNull.Value),
            new SqliteParameter("@ano", attemptNo),
            new SqliteParameter("@sa", now));

        return attemptId;
    }

    /// <summary>
    /// 完成执行尝试。
    /// </summary>
    public static void FinishRun(string attemptId, string status, string? summary, string? error)
    {
        DbClient.EnsureInitialized();
        var db = DbClient.GetClient();

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        db.Execute(
            "UPDATE goal_execution_runs SET status = @status, summary = @summary, error = @error, finished_at = @fa " +
            "WHERE attempt_id = @aid",
            new SqliteParameter("@status", status),
            new SqliteParameter("@summary", (object?)summary ?? DBNull.Value),
            new SqliteParameter("@error", (object?)error ?? DBNull.Value),
            new SqliteParameter("@fa", now),
            new SqliteParameter("@aid", attemptId));
    }

    /// <summary>
    /// 查询某 Task 的所有执行尝试（按 attempt_no 升序）。
    /// </summary>
    public static List<ExecutionRunRow> ListRunsByTask(string goalId, string? planId, string? taskId, int limit = 100)
    {
        DbClient.EnsureInitialized();
        var db = DbClient.GetClient();
        return ListRunsInternal(db, goalId, planId, taskId, limit);
    }

    /// <summary>
    /// 查询某 Task 的最近一次执行尝试。
    /// </summary>
    public static ExecutionRunRow? GetLatestRun(string goalId, string? planId, string? taskId)
    {
        DbClient.EnsureInitialized();
        var db = DbClient.GetClient();

        string sql;
        SqliteParameter[] p;
        if (planId is not null && taskId is not null)
        {
            sql = "SELECT * FROM goal_execution_runs WHERE goal_id = @gid AND plan_id = @pid AND task_id = @tid ORDER BY attempt_no DESC LIMIT 1";
            p = [new SqliteParameter("@gid", goalId), new SqliteParameter("@pid", planId), new SqliteParameter("@tid", taskId)];
        }
        else if (planId is not null)
        {
            sql = "SELECT * FROM goal_execution_runs WHERE goal_id = @gid AND plan_id = @pid ORDER BY attempt_no DESC LIMIT 1";
            p = [new SqliteParameter("@gid", goalId), new SqliteParameter("@pid", planId)];
        }
        else
        {
            sql = "SELECT * FROM goal_execution_runs WHERE goal_id = @gid ORDER BY attempt_no DESC LIMIT 1";
            p = [new SqliteParameter("@gid", goalId)];
        }

        var entity = db.QueryFirstOrDefault(sql, EntityMappers.MapGoalExecutionRun, p);
        return entity == null ? null : ExecutionRunRow.FromEntity(entity);
    }

    private static GoalExecutionRunEntity? GetRunInternal(string attemptId)
    {
        DbClient.EnsureInitialized();
        var db = DbClient.GetClient();

        return db.QueryFirstOrDefault(
            "SELECT * FROM goal_execution_runs WHERE attempt_id = @aid LIMIT 1",
            EntityMappers.MapGoalExecutionRun,
            new SqliteParameter("@aid", attemptId));
    }

    private static List<ExecutionRunRow> ListRunsInternal(
        DbService db, string goalId, string? planId, string? taskId, int limit)
    {
        string sql;
        SqliteParameter[] p;
        if (planId is not null && taskId is not null)
        {
            sql = "SELECT * FROM goal_execution_runs WHERE goal_id = @gid AND plan_id = @pid AND task_id = @tid ORDER BY attempt_no ASC LIMIT @limit";
            p = [new SqliteParameter("@gid", goalId), new SqliteParameter("@pid", planId), new SqliteParameter("@tid", taskId), new SqliteParameter("@limit", limit)];
        }
        else if (planId is not null)
        {
            sql = "SELECT * FROM goal_execution_runs WHERE goal_id = @gid AND plan_id = @pid ORDER BY attempt_no ASC LIMIT @limit";
            p = [new SqliteParameter("@gid", goalId), new SqliteParameter("@pid", planId), new SqliteParameter("@limit", limit)];
        }
        else
        {
            sql = "SELECT * FROM goal_execution_runs WHERE goal_id = @gid ORDER BY attempt_no ASC LIMIT @limit";
            p = [new SqliteParameter("@gid", goalId), new SqliteParameter("@limit", limit)];
        }

        var entities = db.Query(sql, EntityMappers.MapGoalExecutionRun, p);
        return entities.Select(ExecutionRunRow.FromEntity).ToList();
    }

    private static string BuildAttemptId(string goalId, string? planId, string? taskId, int attemptNo)
    {
        var planPart = planId ?? "_";
        var taskPart = taskId ?? "_";
        var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        // 追加一个短随机后缀，防止同一毫秒内多次调用产生冲突
        var suffix = (uint)(ts ^ Environment.TickCount ^ Random.Shared.Next());
        return $"run-{goalId}-{planPart}-{taskPart}-{attemptNo}-{ts}-{suffix:x8}";
    }

    private static string? GetString(JsonElement parameters, string name)
    {
        return parameters.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }
}

/// <summary>
/// 执行尝试 Entity。
/// </summary>
public class GoalExecutionRunEntity
{
    public string AttemptId { get; set; } = string.Empty;
    public string GoalId { get; set; } = string.Empty;
    public string? PlanId { get; set; }
    public string? TaskId { get; set; }
    public int AttemptNo { get; set; } = 1;
    public string Status { get; set; } = GoalExecutionAttemptStatusValues.Executing;
    public string? Summary { get; set; }
    public string? Error { get; set; }
    public long StartedAt { get; set; }
    public long? FinishedAt { get; set; }
}

/// <summary>
/// 执行尝试 Row DTO。
/// </summary>
public sealed record ExecutionRunRow(
    string AttemptId, string GoalId, string? PlanId, string? TaskId,
    int AttemptNo, string Status, string? Summary, string? Error,
    long StartedAt, long? FinishedAt)
{
    public static ExecutionRunRow FromEntity(GoalExecutionRunEntity e) => new(
        e.AttemptId, e.GoalId, e.PlanId, e.TaskId,
        e.AttemptNo, e.Status, e.Summary, e.Error,
        e.StartedAt, e.FinishedAt);
}

public sealed record ExecutionRunInsertResult(string AttemptId);
public sealed record ExecutionRunFindResult(bool Success, ExecutionRunRow? Run, string? Error);
public sealed record ExecutionRunMutationResult(bool Success, ExecutionRunRow? Run, string? Error);

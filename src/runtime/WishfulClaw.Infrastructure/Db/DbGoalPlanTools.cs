/*
 * Wishful Claw 自研：Goal 编排层 Plan 定义（goal_plans）读写工具。
 * 一行 = 一个计划定义（不是执行尝试）。Plan 定义与 goal_plan_tasks 的每轮执行记录分离。
 */

using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// 对 goal_plans 表的读写工具。所有方法都通过 DbClient 获取连接。
/// Materialize 幂等：已存在的 plan_id 跳过。
/// </summary>
public static partial class DbGoalPlanTools
{
    // ─── Worker 端点：查询 ───

    public static WorkerResponse ListPlans(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var sessionId = GetString(parameters, "sessionId") ?? throw new InvalidOperationException("sessionId is required");
            var goalId = GetString(parameters, "goalId") ?? throw new InvalidOperationException("goalId is required");

            var entities = db.Query(
                "SELECT * FROM goal_plans WHERE session_id = @sid AND goal_id = @gid ORDER BY ordinal ASC",
                EntityMappers.MapGoalPlan,
                new SqliteParameter("@sid", sessionId),
                new SqliteParameter("@gid", goalId));

            var rows = entities.Select(GoalPlanRow.FromEntity).ToList();
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListGoalPlanRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalPlanTools.ListPlans failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse GetPlan(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var sessionId = GetString(parameters, "sessionId") ?? throw new InvalidOperationException("sessionId is required");
            var goalId = GetString(parameters, "goalId") ?? throw new InvalidOperationException("goalId is required");
            var planId = GetString(parameters, "planId") ?? throw new InvalidOperationException("planId is required");

            var entity = db.QueryFirstOrDefault(
                "SELECT * FROM goal_plans WHERE plan_id = @pid AND goal_id = @gid AND session_id = @sid LIMIT 1",
                EntityMappers.MapGoalPlan,
                new SqliteParameter("@pid", planId),
                new SqliteParameter("@gid", goalId),
                new SqliteParameter("@sid", sessionId));

            if (entity == null)
                return WorkerResponse.Json(new GoalPlanFindResult(false, null, "Plan not found"),
                    InfrastructureJsonContext.Default.GoalPlanFindResult);

            return WorkerResponse.Json(GoalPlanRow.FromEntity(entity),
                InfrastructureJsonContext.Default.GoalPlanRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalPlanTools.GetPlan failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse UpdatePlanStatus(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var sessionId = GetString(parameters, "sessionId") ?? throw new InvalidOperationException("sessionId is required");
            var goalId = GetString(parameters, "goalId") ?? throw new InvalidOperationException("goalId is required");
            var planId = GetString(parameters, "planId") ?? throw new InvalidOperationException("planId is required");
            var status = GetString(parameters, "status") ?? throw new InvalidOperationException("status is required");
            var resultSummary = GetString(parameters, "resultSummary");

            var entity = UpdatePlanStatusInternal(db, planId, goalId, sessionId, status, resultSummary);
            if (entity == null)
                return WorkerResponse.Json(new GoalPlanMutationResult(false, null, "Plan not found"),
                    InfrastructureJsonContext.Default.GoalPlanMutationResult);

            return WorkerResponse.Json(GoalPlanRow.FromEntity(entity),
                InfrastructureJsonContext.Default.GoalPlanRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalPlanTools.UpdatePlanStatus failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse UpdatePlanRetry(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var sessionId = GetString(parameters, "sessionId") ?? throw new InvalidOperationException("sessionId is required");
            var goalId = GetString(parameters, "goalId") ?? throw new InvalidOperationException("goalId is required");
            var planId = GetString(parameters, "planId") ?? throw new InvalidOperationException("planId is required");
            var retryCount = parameters.TryGetProperty("retryCount", out var rc) && rc.ValueKind == JsonValueKind.Number
                ? rc.GetInt32()
                : 0;
            var resultSummary = GetString(parameters, "resultSummary");

            UpdatePlanRetryInternal(db, planId, goalId, sessionId, retryCount, resultSummary);
            return WorkerResponse.Json(new GoalPlanMutationResult(true, null, null),
                InfrastructureJsonContext.Default.GoalPlanMutationResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalPlanTools.UpdatePlanRetry failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    // ─── Agent 编排层内部调用（非端点） ───

    /// <summary>
    /// Materialize: 一次性写入全部 Plan，初始 status=pending。幂等：已存在的 plan_id 跳过。
    /// </summary>
    public static void MaterializePlans(JsonElement parameters, string goalId, string sessionId, List<GoalPlanEntity> plans)
    {
        if (plans == null || plans.Count == 0)
            return;

        DbClient.EnsureInitialized(parameters);
        var db = DbClient.GetClient(parameters);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        db.ExecuteInTransaction((connection, transaction) =>
        {
            foreach (var plan in plans)
            {
                plan.GoalId = goalId;
                plan.SessionId = sessionId;
                plan.CreatedAt = now;
                plan.UpdatedAt = now;

                var exists = db.QueryScalar<int>(
                    connection,
                    transaction,
                    "SELECT COUNT(*) FROM goal_plans WHERE plan_id = @pid AND session_id = @sid",
                    new SqliteParameter("@pid", plan.PlanId),
                    new SqliteParameter("@sid", sessionId));

                if (exists > 0)
                    continue;

                db.Execute(
                    connection,
                    transaction,
                    "INSERT INTO goal_plans " +
                    "(plan_id, goal_id, session_id, ordinal, original_plan_id, title, description, content_json, " +
                    "status, retry_count, result_summary, created_at, updated_at, started_at, completed_at) " +
                    "VALUES (@pid, @gid, @sid, @ord, @opid, @title, @desc, @cj, " +
                    "'pending', @rc, @rs, @ca, @ua, @sa, @ca2)",
                    new SqliteParameter("@pid", plan.PlanId),
                    new SqliteParameter("@gid", goalId),
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@ord", plan.Ordinal),
                    new SqliteParameter("@opid", (object?)plan.OriginalPlanId ?? DBNull.Value),
                    new SqliteParameter("@title", plan.Title),
                    new SqliteParameter("@desc", plan.Description),
                    new SqliteParameter("@cj", (object?)plan.ContentJson ?? DBNull.Value),
                    new SqliteParameter("@rc", plan.RetryCount),
                    new SqliteParameter("@rs", (object?)plan.ResultSummary ?? DBNull.Value),
                    new SqliteParameter("@ca", now),
                    new SqliteParameter("@ua", now),
                    new SqliteParameter("@sa", DBNull.Value),
                    new SqliteParameter("@ca2", DBNull.Value));
            }
        });
    }

    /// <summary>
    /// 查询某 Goal 的全部 Plans（按 ordinal 排序）。
    /// </summary>
    public static List<GoalPlanRow> ListPlans(string goalId, string sessionId)
    {
        DbClient.EnsureInitialized();
        var db = DbClient.GetClient();

        var entities = db.Query(
            "SELECT * FROM goal_plans WHERE goal_id = @gid AND session_id = @sid ORDER BY ordinal ASC",
            EntityMappers.MapGoalPlan,
            new SqliteParameter("@gid", goalId),
            new SqliteParameter("@sid", sessionId));

        return entities.Select(GoalPlanRow.FromEntity).ToList();
    }

    /// <summary>
    /// 按 planId 精确查询单个 Plan。
    /// </summary>
    public static GoalPlanRow? GetPlan(string planId, string goalId, string sessionId)
    {
        DbClient.EnsureInitialized();
        var db = DbClient.GetClient();

        var entity = db.QueryFirstOrDefault(
            "SELECT * FROM goal_plans WHERE plan_id = @pid AND goal_id = @gid AND session_id = @sid LIMIT 1",
            EntityMappers.MapGoalPlan,
            new SqliteParameter("@pid", planId),
            new SqliteParameter("@gid", goalId),
            new SqliteParameter("@sid", sessionId));

        return entity == null ? null : GoalPlanRow.FromEntity(entity);
    }

    /// <summary>
    /// 更新 Plan 状态（pending→active→complete/aborted）。
    /// 返回更新后的 Plan 行，或 null 表示未找到。
    /// </summary>
    public static GoalPlanRow? UpdatePlanStatus(string planId, string goalId, string sessionId, string status, string? resultSummary)
    {
        DbClient.EnsureInitialized();
        var db = DbClient.GetClient();
        var entity = UpdatePlanStatusInternal(db, planId, goalId, sessionId, status, resultSummary);
        return entity == null ? null : GoalPlanRow.FromEntity(entity);
    }

    private static GoalPlanEntity? UpdatePlanStatusInternal(
        DbService db, string planId, string goalId, string sessionId, string status, string? resultSummary)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        db.ExecuteInTransaction((connection, transaction) =>
        {
            var changed = db.Execute(
                connection,
                transaction,
                "UPDATE goal_plans SET status = @status, result_summary = @rs, updated_at = @ua, " +
                "started_at = CASE WHEN status = 'active' AND started_at IS NULL THEN @now ELSE started_at END, " +
                "completed_at = CASE WHEN status IN ('complete', 'aborted') AND completed_at IS NULL THEN @now ELSE completed_at END " +
                "WHERE plan_id = @pid AND goal_id = @gid AND session_id = @sid",
                new SqliteParameter("@status", status),
                new SqliteParameter("@rs", (object?)resultSummary ?? DBNull.Value),
                new SqliteParameter("@ua", now),
                new SqliteParameter("@now", now),
                new SqliteParameter("@pid", planId),
                new SqliteParameter("@gid", goalId),
                new SqliteParameter("@sid", sessionId));

            if (changed != 1)
                throw new InvalidOperationException("Plan not found or changed during update");
        });

        var entity = db.QueryFirstOrDefault(
            "SELECT * FROM goal_plans WHERE plan_id = @pid AND goal_id = @gid AND session_id = @sid LIMIT 1",
            EntityMappers.MapGoalPlan,
            new SqliteParameter("@pid", planId),
            new SqliteParameter("@gid", goalId),
            new SqliteParameter("@sid", sessionId));

        return entity;
    }

    /// <summary>
    /// 更新 Plan 的 retry_count 和 result_summary。
    /// </summary>
    public static void UpdatePlanRetry(string planId, string goalId, string sessionId, int retryCount, string? resultSummary)
    {
        DbClient.EnsureInitialized();
        var db = DbClient.GetClient();
        UpdatePlanRetryInternal(db, planId, goalId, sessionId, retryCount, resultSummary);
    }

    private static void UpdatePlanRetryInternal(
        DbService db, string planId, string goalId, string sessionId, int retryCount, string? resultSummary)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        db.Execute(
            "UPDATE goal_plans SET retry_count = @rc, result_summary = @rs, updated_at = @ua " +
            "WHERE plan_id = @pid AND goal_id = @gid AND session_id = @sid",
            new SqliteParameter("@rc", retryCount),
            new SqliteParameter("@rs", (object?)resultSummary ?? DBNull.Value),
            new SqliteParameter("@ua", now),
            new SqliteParameter("@pid", planId),
            new SqliteParameter("@gid", goalId),
            new SqliteParameter("@sid", sessionId));
    }

    private static string? GetString(JsonElement parameters, string name)
    {
        return parameters.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }
}

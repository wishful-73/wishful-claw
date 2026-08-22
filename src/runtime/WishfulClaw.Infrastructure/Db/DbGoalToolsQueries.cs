using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

public static partial class DbGoalTools
{
    public static WorkerResponse List(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var hasProjectFilter = parameters.TryGetProperty("projectId", out var projectValue);
            var projectId = hasProjectFilter && projectValue.ValueKind == JsonValueKind.String
                ? projectValue.GetString()
                : null;
            List<GoalEntity> entities;
            if (!hasProjectFilter)
            {
                entities = db.Query(HistoryListSql, EntityMappers.MapGoal);
            }
            else if (projectId == null)
            {
                entities = db.Query(
                    "SELECT * FROM goals WHERE project_id IS NULL " + HistoryOrderSql,
                    EntityMappers.MapGoal);
            }
            else
            {
                entities = db.Query(
                    "SELECT * FROM goals WHERE project_id = @projectId " + HistoryOrderSql,
                    EntityMappers.MapGoal,
                    new SqliteParameter("@projectId", projectId));
            }

            return WorkerResponse.Json(
                entities.Select(GoalRow.FromEntity).ToList(),
                InfrastructureJsonContext.Default.ListGoalRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalTools.List failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse ListPage(JsonElement parameters)
    {
        try
        {
            var result = QueryGoalPage(parameters);
            return WorkerResponse.Json(result, InfrastructureJsonContext.Default.GoalPageResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalTools.ListPage failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static GoalPageResult QueryGoalPage(JsonElement parameters)
    {
        DbClient.EnsureInitialized(parameters);
        var db = DbClient.GetClient(parameters);
        var limit = Math.Clamp(GetInt(parameters, "limit", 30), 1, 100);
        var where = new List<string>();
        var queryParameters = new List<SqliteParameter>();

        if (parameters.TryGetProperty("projectId", out var projectValue))
        {
            if (projectValue.ValueKind == JsonValueKind.Null)
            {
                where.Add("project_id IS NULL");
            }
            else if (projectValue.ValueKind == JsonValueKind.String)
            {
                where.Add("project_id = @projectId");
                queryParameters.Add(new SqliteParameter("@projectId", projectValue.GetString()));
            }
        }

        var sessionId = GetString(parameters, "sessionId");
        if (!string.IsNullOrEmpty(sessionId))
        {
            where.Add("session_id = @sessionId");
            queryParameters.Add(new SqliteParameter("@sessionId", sessionId));
        }

        var cursorRank = parameters.TryGetProperty("cursorCurrentRank", out var rankValue)
            && rankValue.ValueKind == JsonValueKind.Number
            ? rankValue.GetInt32()
            : (int?)null;
        var cursorUpdatedAt = GetLongOrNull(parameters, "cursorUpdatedAt");
        var cursorGoalId = GetString(parameters, "cursorGoalId");
        if (cursorRank.HasValue && cursorUpdatedAt.HasValue && !string.IsNullOrEmpty(cursorGoalId))
        {
            where.Add("(" + CurrentRankSql + " > @cursorRank OR (" + CurrentRankSql +
                " = @cursorRank AND (updated_at < @cursorUpdatedAt OR " +
                "(updated_at = @cursorUpdatedAt AND goal_id < @cursorGoalId))))");
            queryParameters.Add(new SqliteParameter("@cursorRank", cursorRank.Value));
            queryParameters.Add(new SqliteParameter("@cursorUpdatedAt", cursorUpdatedAt.Value));
            queryParameters.Add(new SqliteParameter("@cursorGoalId", cursorGoalId));
        }

        queryParameters.Add(new SqliteParameter("@limit", limit + 1));
        var sql = "SELECT * FROM goals" +
            (where.Count > 0 ? " WHERE " + string.Join(" AND ", where) : string.Empty) +
            " ORDER BY " + CurrentRankSql + " ASC, updated_at DESC, goal_id DESC LIMIT @limit";
        var entities = db.Query(sql, EntityMappers.MapGoal, [.. queryParameters]);
        var hasMore = entities.Count > limit;
        var rows = entities.Take(limit).Select(GoalRow.FromEntity).ToList();
        var last = rows.LastOrDefault();
        return new GoalPageResult(
            rows,
            hasMore,
            hasMore && last != null ? CurrentRank(last.Status) : null,
            hasMore ? last?.UpdatedAt : null,
            hasMore ? last?.GoalId : null);
    }

    public static WorkerResponse ListEventsPage(JsonElement parameters)
    {
        try
        {
            var result = QueryGoalEventPage(parameters);
            return WorkerResponse.Json(result, InfrastructureJsonContext.Default.GoalEventPageResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalTools.ListEventsPage failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static GoalEventPageResult QueryGoalEventPage(JsonElement parameters)
    {
        DbClient.EnsureInitialized(parameters);
        var db = DbClient.GetClient(parameters);
        var sessionId = GetString(parameters, "sessionId")
            ?? throw new InvalidOperationException("sessionId is required");
        var goalId = GetString(parameters, "goalId");
        var limit = Math.Clamp(GetInt(parameters, "limit", 50), 1, 200);
        var where = new List<string> { "session_id = @sessionId" };
        var queryParameters = new List<SqliteParameter>
        {
            new("@sessionId", sessionId)
        };
        if (!string.IsNullOrEmpty(goalId))
        {
            where.Add("goal_id = @goalId");
            queryParameters.Add(new SqliteParameter("@goalId", goalId));
        }

        var cursorCreatedAt = GetLongOrNull(parameters, "cursorCreatedAt");
        var cursorEventId = GetLongOrNull(parameters, "cursorEventId");
        if (cursorCreatedAt.HasValue && cursorEventId.HasValue)
        {
            where.Add("(created_at < @cursorCreatedAt OR " +
                "(created_at = @cursorCreatedAt AND id < @cursorEventId))");
            queryParameters.Add(new SqliteParameter("@cursorCreatedAt", cursorCreatedAt.Value));
            queryParameters.Add(new SqliteParameter("@cursorEventId", cursorEventId.Value));
        }

        queryParameters.Add(new SqliteParameter("@limit", limit + 1));
        var sql = "SELECT * FROM goal_events WHERE " + string.Join(" AND ", where) +
            " ORDER BY created_at DESC, id DESC LIMIT @limit";
        var entities = db.Query(sql, EntityMappers.MapGoalEvent, [.. queryParameters]);
        var hasMore = entities.Count > limit;
        var rows = entities.Take(limit).Select(GoalEventRow.FromEntity).ToList();
        var last = rows.LastOrDefault();
        return new GoalEventPageResult(
            rows,
            hasMore,
            hasMore ? last?.CreatedAt : null,
            hasMore ? last?.Id : null);
    }

    public static WorkerResponse Get(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var sessionId = GetString(parameters, "sessionId");
            if (string.IsNullOrEmpty(sessionId))
            {
                return WorkerResponse.Json(
                    new GoalFindResult(false, null, "sessionId is required"),
                    InfrastructureJsonContext.Default.GoalFindResult);
            }

            var row = GetBySessionId(sessionId);
            return row != null
                ? WorkerResponse.Json(row, InfrastructureJsonContext.Default.GoalRow)
                : WorkerResponse.Json(
                    new GoalFindResult(false, null, null),
                    InfrastructureJsonContext.Default.GoalFindResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalTools.Get failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse ListActive(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            return WorkerResponse.Json(
                ListActiveGoals(),
                InfrastructureJsonContext.Default.ListGoalRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalTools.ListActive failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse GetLedger(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var goalId = GetString(parameters, "goalId")
                ?? throw new InvalidOperationException("goalId is required");
            var sessionId = GetString(parameters, "sessionId")
                ?? throw new InvalidOperationException("sessionId is required");
            var goal = GetByGoalId(goalId, sessionId);
            if (goal == null)
            {
                return WorkerResponse.Json(
                    new GoalLedgerFindResult(false, null, "Goal not found"),
                    InfrastructureJsonContext.Default.GoalLedgerFindResult);
            }

            var latestPlan = DbGoalPlanTools.ListPlans(goalId, sessionId)
                .OrderByDescending(plan => plan.UpdatedAt)
                .ThenByDescending(plan => plan.Ordinal)
                .FirstOrDefault();
            var latestExecution = DbGoalExecutionRunTools.GetLatestRun(goalId, null, null);
            var incompleteExecutions = DbGoalExecutionRunTools.ListIncompleteRuns(goalId);
            return WorkerResponse.Json(
                new GoalLedgerFindResult(
                    true,
                    new GoalLedgerSnapshot(goal, latestPlan, latestExecution, incompleteExecutions),
                    null),
                InfrastructureJsonContext.Default.GoalLedgerFindResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalTools.GetLedger failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static GoalRow? GetBySessionId(string sessionId)
    {
        var entity = DbClient.GetClient().QueryFirstOrDefault(
            "SELECT * FROM goals WHERE session_id = @sid " +
            "AND status IN ('pending', 'active') " +
            "ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1",
            EntityMappers.MapGoal,
            new SqliteParameter("@sid", sessionId));
        return entity == null ? null : GoalRow.FromEntity(entity);
    }

    public static GoalRow? GetByGoalId(string goalId, string sessionId)
    {
        var entity = DbClient.GetClient().QueryFirstOrDefault(
            "SELECT * FROM goals WHERE goal_id = @gid AND session_id = @sid LIMIT 1",
            EntityMappers.MapGoal,
            new SqliteParameter("@gid", goalId),
            new SqliteParameter("@sid", sessionId));
        return entity == null ? null : GoalRow.FromEntity(entity);
    }

    public static List<GoalRow> ListActiveGoals()
    {
        return DbClient.GetClient()
            .Query(
                "SELECT * FROM goals WHERE status = 'active' ORDER BY updated_at DESC",
                EntityMappers.MapGoal)
            .Select(GoalRow.FromEntity)
            .ToList();
    }

    private const string CurrentRankSql =
        "CASE WHEN status IN ('pending', 'active') THEN 0 ELSE 1 END";
    private const string HistoryOrderSql =
        "ORDER BY " + CurrentRankSql + " ASC, updated_at DESC, goal_id DESC";
    private const string HistoryListSql = "SELECT * FROM goals " + HistoryOrderSql;

    private static int CurrentRank(string status)
        => status is GoalStatusValues.Pending or GoalStatusValues.Active ? 0 : 1;
}

/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

public static partial class DbGoalTools
{
    public static WorkerResponse Create(JsonElement parameters)
    {
        try
        {
            var row = CreateCurrentGoal(parameters);
            return WorkerResponse.Json(row, InfrastructureJsonContext.Default.GoalRow);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGoalTools.Create failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Set(JsonElement parameters)
    {
        try
        {
            var row = CreateCurrentGoal(parameters);
            return WorkerResponse.Json(row, InfrastructureJsonContext.Default.GoalRow);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGoalTools.Set failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static GoalRow CreateCurrentGoal(JsonElement parameters)
        => InsertGoal(parameters, "created", "Goal created");

    public static WorkerResponse Update(JsonElement parameters)
    {
        try
        {
            var row = UpdateByGoalId(parameters);
            if (row == null)
                return WorkerResponse.Json(new GoalMutationResult(false, 0, "Goal not found"), InfrastructureJsonContext.Default.GoalMutationResult);

            return WorkerResponse.Json(row, InfrastructureJsonContext.Default.GoalRow);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGoalTools.Update failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static GoalRow? UpdateByGoalId(JsonElement parameters)
    {
        DbClient.EnsureInitialized(parameters);
        var db = DbClient.GetClient(parameters);
        var sessionId = GetString(parameters, "sessionId") ?? throw new InvalidOperationException("sessionId is required");
        var goalId = GetString(parameters, "goalId") ?? throw new InvalidOperationException("goalId is required");
        var entity = db.ExecuteInTransaction((connection, transaction) =>
        {
            var current = db.QueryFirstOrDefault(
                connection,
                transaction,
                "SELECT * FROM goals WHERE goal_id = @gid AND session_id = @sid LIMIT 1",
                EntityMappers.MapGoal,
                new SqliteParameter("@gid", goalId),
                new SqliteParameter("@sid", sessionId));
            if (current == null)
                return null;

            var previousStatus = current.Status;
            ApplyGoalPatch(current, parameters);
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            current.UpdatedAt = now;
            var changed = db.Execute(
                connection,
                transaction,
                "UPDATE goals SET objective = @obj, status = @status, token_budget = @tb, plans_json = @pj, " +
                "plan_count = @pc, completed_plan_count = @cpc, current_plan_index = @cpi, " +
                "working_folder = @wf, updated_at = @ua WHERE goal_id = @gid AND session_id = @sid",
                new SqliteParameter("@obj", current.Objective),
                new SqliteParameter("@status", current.Status),
                new SqliteParameter("@tb", (object?)current.TokenBudget ?? DBNull.Value),
                new SqliteParameter("@pj", (object?)current.PlansJson ?? DBNull.Value),
                new SqliteParameter("@pc", current.PlanCount),
                new SqliteParameter("@cpc", current.CompletedPlanCount),
                new SqliteParameter("@cpi", current.CurrentPlanIndex),
                new SqliteParameter("@wf", (object?)current.WorkingFolder ?? DBNull.Value),
                new SqliteParameter("@ua", current.UpdatedAt),
                new SqliteParameter("@gid", goalId),
                new SqliteParameter("@sid", sessionId));
            if (changed != 1)
                throw new InvalidOperationException("Goal changed during update");

            if (!string.Equals(previousStatus, current.Status, StringComparison.Ordinal))
            {
                var (eventType, message) = GoalStatusEvent(
                    previousStatus,
                    current.Status,
                    GetString(parameters, "statusEventMessage"));
                InsertEvent(
                    db,
                    connection,
                    transaction,
                    sessionId,
                    goalId,
                    eventType,
                    message,
                    null,
                    now);
            }
            return current;
        });

        return entity == null ? null : GoalRow.FromEntity(entity);
    }

    public static WorkerResponse AccountUsage(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var sessionId = GetString(parameters, "sessionId") ?? throw new InvalidOperationException("sessionId is required");
            var goalId = GetString(parameters, "goalId") ?? GetString(parameters, "expectedGoalId")
                ?? throw new InvalidOperationException("goalId is required");
            var tokenDelta = GetLong(parameters, "tokenDelta", 0);
            var timeDeltaSeconds = GetLong(parameters, "timeDeltaSeconds", 0);
            var entity = db.ExecuteInTransaction((connection, transaction) =>
            {
                var current = db.QueryFirstOrDefault(
                    connection,
                    transaction,
                    "SELECT * FROM goals WHERE goal_id = @gid AND session_id = @sid LIMIT 1",
                    EntityMappers.MapGoal,
                    new SqliteParameter("@gid", goalId),
                    new SqliteParameter("@sid", sessionId));
                if (current == null)
                    return null;

                current.TokensUsed += tokenDelta;
                current.TimeUsedSeconds += timeDeltaSeconds;
                current.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var changed = db.Execute(
                    connection,
                    transaction,
                    "UPDATE goals SET tokens_used = @tu, time_used_seconds = @tus, updated_at = @ua " +
                    "WHERE goal_id = @gid AND session_id = @sid",
                    new SqliteParameter("@tu", current.TokensUsed),
                    new SqliteParameter("@tus", current.TimeUsedSeconds),
                    new SqliteParameter("@ua", current.UpdatedAt),
                    new SqliteParameter("@gid", goalId),
                    new SqliteParameter("@sid", sessionId));
                if (changed != 1)
                    return null;

                InsertEvent(
                    db,
                    connection,
                    transaction,
                    sessionId,
                    goalId,
                    "usage_accounted",
                    $"Usage: +{tokenDelta} tokens, +{timeDeltaSeconds}s",
                    null,
                    current.UpdatedAt);
                return current;
            });

            if (entity == null)
                return WorkerResponse.Json(new GoalMutationResult(false, 0, "Goal not found"), InfrastructureJsonContext.Default.GoalMutationResult);

            return WorkerResponse.Json(GoalRow.FromEntity(entity), InfrastructureJsonContext.Default.GoalRow);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGoalTools.AccountUsage failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse ListEvents(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var sessionId = GetString(parameters, "sessionId") ?? throw new InvalidOperationException("sessionId is required");
            var limit = GetInt(parameters, "limit", 40);
            var goalId = GetString(parameters, "goalId");

            string sql = goalId is not null && !string.IsNullOrEmpty(goalId)
                ? "SELECT * FROM goal_events WHERE session_id = @sid AND goal_id = @gid ORDER BY created_at DESC LIMIT @limit"
                : "SELECT * FROM goal_events WHERE session_id = @sid ORDER BY created_at DESC LIMIT @limit";

            var paramList = new List<SqliteParameter> { new("@sid", sessionId), new("@limit", limit) };
            if (goalId is not null && !string.IsNullOrEmpty(goalId))
                paramList.Add(new SqliteParameter("@gid", goalId));

            var entities = db.Query(sql, EntityMappers.MapGoalEvent, [.. paramList]);
            var rows = entities.Select(GoalEventRow.FromEntity).ToList();
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListGoalEventRow);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGoalTools.ListEvents failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse AddEvent(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var sessionId = GetString(parameters, "sessionId") ?? throw new InvalidOperationException("sessionId is required");
            var eventType = GetString(parameters, "eventType") ?? "created";
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            db.Execute(
                "INSERT INTO goal_events (session_id, goal_id, event_type, message, metadata_json, created_at) " +
                "VALUES (@sid, @gid, @et, @msg, @mj, @ca)",
                new SqliteParameter("@sid", sessionId),
                new SqliteParameter("@gid", (object?)GetString(parameters, "goalId") ?? DBNull.Value),
                new SqliteParameter("@et", eventType),
                new SqliteParameter("@msg", (object?)GetString(parameters, "message") ?? DBNull.Value),
                new SqliteParameter("@mj", (object?)GetString(parameters, "metadataJson") ?? DBNull.Value),
                new SqliteParameter("@ca", now));

            var row = new GoalEventRow { SessionId = sessionId, GoalId = GetString(parameters, "goalId"),
                EventType = eventType, Message = GetString(parameters, "message"),
                MetadataJson = GetString(parameters, "metadataJson"), CreatedAt = now };
            return WorkerResponse.Json(row, InfrastructureJsonContext.Default.GoalEventRow);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGoalTools.AddEvent failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    private static GoalRow InsertGoal(
        JsonElement parameters,
        string eventType,
        string eventMessage)
    {
        DbClient.EnsureInitialized(parameters);
        var db = DbClient.GetClient(parameters);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var goalId = GetString(parameters, "goalId") ?? Guid.NewGuid().ToString("N");
        var sessionId = GetString(parameters, "sessionId") ?? throw new InvalidOperationException("sessionId is required");
        var objective = GetString(parameters, "objective") ?? throw new InvalidOperationException("objective is required");
        var status = GetString(parameters, "status") ?? GoalStatusValues.Active;
        var plansJson = GetJsonText(parameters, "plansJson");
        var projectId = db.QueryScalar<string?>(
            "SELECT project_id FROM sessions WHERE id = @sessionId LIMIT 1",
            new SqliteParameter("@sessionId", sessionId));
        var entity = new GoalEntity
        {
            GoalId = goalId,
            SessionId = sessionId,
            ProjectId = projectId,
            Objective = objective,
            Status = status,
            TokenBudget = GetLongOrNull(parameters, "tokenBudget"),
            PlansJson = plansJson,
            PlanCount = GetInt(parameters, "planCount", 0),
            CompletedPlanCount = GetInt(parameters, "completedPlanCount", 0),
            CurrentPlanIndex = GetInt(parameters, "currentPlanIndex", -1),
            WorkingFolder = GetString(parameters, "workingFolder"),
            CreatedAt = now,
            UpdatedAt = now
        };

        db.ExecuteInTransaction((connection, transaction) =>
        {
            if (!GoalStatusValues.IsTerminal(status))
            {
                var current = db.QueryFirstOrDefault(
                    connection,
                    transaction,
                    "SELECT * FROM goals WHERE session_id = @sid " +
                    "AND status IN ('pending', 'active') LIMIT 1",
                    EntityMappers.MapGoal,
                    new SqliteParameter("@sid", sessionId));
                if (current != null)
                    throw new InvalidOperationException("Session already has a current goal");
            }

            db.Execute(
                connection,
                transaction,
                "INSERT INTO goals (goal_id, session_id, project_id, objective, status, token_budget, tokens_used, " +
                "time_used_seconds, plans_json, plan_count, completed_plan_count, current_plan_index, " +
                "working_folder, created_at, updated_at) " +
                "VALUES (@gid, @sid, @pid, @obj, @status, @tb, 0, 0, @pj, @pc, @cpc, @cpi, @wf, @ca, @ua)",
                new SqliteParameter("@gid", goalId),
                new SqliteParameter("@sid", sessionId),
                new SqliteParameter("@pid", (object?)entity.ProjectId ?? DBNull.Value),
                new SqliteParameter("@obj", objective),
                new SqliteParameter("@status", status),
                new SqliteParameter("@tb", (object?)entity.TokenBudget ?? DBNull.Value),
                new SqliteParameter("@pj", (object?)plansJson ?? DBNull.Value),
                new SqliteParameter("@pc", entity.PlanCount),
                new SqliteParameter("@cpc", entity.CompletedPlanCount),
                new SqliteParameter("@cpi", entity.CurrentPlanIndex),
                new SqliteParameter("@wf", (object?)entity.WorkingFolder ?? DBNull.Value),
                new SqliteParameter("@ca", now),
                new SqliteParameter("@ua", now));
            InsertEvent(db, connection, transaction, sessionId, goalId, eventType, eventMessage, null, now);
        });

        return GoalRow.FromEntity(entity);
    }

    private static void InsertEvent(DbService db, string sessionId, string goalId, string eventType, string? message, string? metadataJson, long createdAt)
    {
        db.Execute(
            "INSERT INTO goal_events (session_id, goal_id, event_type, message, metadata_json, created_at) " +
            "VALUES (@sid, @gid, @et, @msg, @mj, @ca)",
            EventParameters(sessionId, goalId, eventType, message, metadataJson, createdAt));
    }

    private static void InsertEvent(
        DbService db,
        SqliteConnection connection,
        SqliteTransaction transaction,
        string sessionId,
        string goalId,
        string eventType,
        string? message,
        string? metadataJson,
        long createdAt)
    {
        db.Execute(
            connection,
            transaction,
            "INSERT INTO goal_events (session_id, goal_id, event_type, message, metadata_json, created_at) " +
            "VALUES (@sid, @gid, @et, @msg, @mj, @ca)",
            EventParameters(sessionId, goalId, eventType, message, metadataJson, createdAt));
    }

    private static SqliteParameter[] EventParameters(
        string sessionId,
        string goalId,
        string eventType,
        string? message,
        string? metadataJson,
        long createdAt)
        =>
        [
            new SqliteParameter("@sid", sessionId),
            new SqliteParameter("@gid", goalId),
            new SqliteParameter("@et", eventType),
            new SqliteParameter("@msg", (object?)message ?? DBNull.Value),
            new SqliteParameter("@mj", (object?)metadataJson ?? DBNull.Value),
            new SqliteParameter("@ca", createdAt)
        ];

    private static (string EventType, string Message) GoalStatusEvent(
        string previousStatus,
        string currentStatus,
        string? eventMessage)
        => currentStatus switch
        {
            GoalStatusValues.Complete => ("completed", eventMessage ?? "Goal completed"),
            "failed" => ("failed", eventMessage ?? "Goal failed"),
            GoalStatusValues.Aborted => ("aborted", eventMessage ?? "Goal aborted"),
            _ => ("status_changed", eventMessage ?? $"Status changed: {previousStatus} -> {currentStatus}")
        };

    private static void ApplyGoalPatch(GoalEntity entity, JsonElement parameters)
    {
        if (!parameters.TryGetProperty("patch", out var patch) || patch.ValueKind != JsonValueKind.Object)
            return;

        if (patch.TryGetProperty("objective", out var objective) && objective.ValueKind == JsonValueKind.String)
            entity.Objective = objective.GetString()!;
        if (patch.TryGetProperty("status", out var status) && status.ValueKind == JsonValueKind.String)
            entity.Status = status.GetString()!;
        if (patch.TryGetProperty("tokenBudget", out var tokenBudget))
            entity.TokenBudget = tokenBudget.ValueKind == JsonValueKind.Null ? null : tokenBudget.GetInt64();
        if (patch.TryGetProperty("plansJson", out var plansJson))
            entity.PlansJson = plansJson.ValueKind == JsonValueKind.Null ? null : GetJsonText(plansJson);
        if (patch.TryGetProperty("planCount", out var planCount) && planCount.ValueKind == JsonValueKind.Number)
            entity.PlanCount = planCount.GetInt32();
        if (patch.TryGetProperty("completedPlanCount", out var completedPlanCount) && completedPlanCount.ValueKind == JsonValueKind.Number)
            entity.CompletedPlanCount = completedPlanCount.GetInt32();
        if (patch.TryGetProperty("currentPlanIndex", out var currentPlanIndex) && currentPlanIndex.ValueKind == JsonValueKind.Number)
            entity.CurrentPlanIndex = currentPlanIndex.GetInt32();
        if (patch.TryGetProperty("workingFolder", out var workingFolder))
            entity.WorkingFolder = workingFolder.ValueKind == JsonValueKind.Null ? null : workingFolder.GetString();
    }

    private static string? GetJsonText(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) ? GetJsonText(value) : null;

    private static string? GetJsonText(JsonElement element)
        => element.ValueKind switch
        {
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            JsonValueKind.String => element.GetString(),
            _ => element.GetRawText()
        };

    private static string? GetString(JsonElement element, string name)
        => element.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String ? el.GetString() : null;

    private static long GetLong(JsonElement element, string name, long defaultValue)
        => element.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number ? el.GetInt64() : defaultValue;

    private static long? GetLongOrNull(JsonElement element, string name)
        => element.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number ? el.GetInt64() : null;

    private static int GetInt(JsonElement element, string name, int defaultValue)
        => element.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number ? el.GetInt32() : defaultValue;

}

using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

public static class DbSessionFollowUpTools
{
    private const string FollowUpSelect = "SELECT * FROM session_follow_ups";
    private const long ClaimLeaseMs = 5 * 60 * 1000;

    public static WorkerResponse ListSchedulable(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var now = GetLong(parameters, "now", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            var staleBefore = now - ClaimLeaseMs;
            var rows = db.ExecuteInTransaction((connection, transaction) =>
            {
                db.Execute(
                    connection,
                    transaction,
                    "UPDATE session_follow_ups SET status = 'waiting', claim_token = NULL, claimed_at = NULL, " +
                    "updated_at = @now, last_error = 'Recovered after interrupted follow-up delivery' " +
                    "WHERE status = 'triggered' AND claimed_at IS NOT NULL AND claimed_at <= @staleBefore",
                    new SqliteParameter("@now", now),
                    new SqliteParameter("@staleBefore", staleBefore));
                return db.Query(
                    connection,
                    transaction,
                    $"{FollowUpSelect} WHERE status = 'waiting' ORDER BY follow_up_at ASC, created_at ASC",
                    r => SessionFollowUpRow.FromEntity(EntityMappers.MapSessionFollowUp(r)));
            });
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListSessionFollowUpRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbSessionFollowUpTools.ListSchedulable failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse Get(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            if (string.IsNullOrWhiteSpace(id))
                return Result(false, 0, null, "id is required");

            DbClient.EnsureInitialized(parameters);
            var row = Find(DbClient.GetClient(parameters), id);
            return WorkerResponse.Json(
                new SessionFollowUpFindResult(true, row, null),
                InfrastructureJsonContext.Default.SessionFollowUpFindResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbSessionFollowUpTools.Get failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse Create(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            var todoId = GetString(parameters, "todoId");
            var sourceSessionId = GetString(parameters, "sourceSessionId");
            var targetSessionId = GetString(parameters, "targetSessionId");
            var queryInstruction = GetString(parameters, "queryInstruction");
            var notificationKey = GetString(parameters, "notificationKey") ?? id;
            var followUpAt = GetLong(parameters, "followUpAt", 0);
            if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(todoId) ||
                string.IsNullOrWhiteSpace(sourceSessionId) || string.IsNullOrWhiteSpace(targetSessionId) ||
                string.IsNullOrWhiteSpace(queryInstruction) || string.IsNullOrWhiteSpace(notificationKey) || followUpAt <= 0)
            {
                return Result(false, 0, null,
                    "id, todoId, sourceSessionId, targetSessionId, followUpAt, queryInstruction and notificationKey are required");
            }

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var outcome = db.ExecuteInTransaction((connection, transaction) =>
            {
                var sourceExists = db.QueryScalar<long>(connection, transaction,
                    "SELECT COUNT(*) FROM sessions WHERE id = @id",
                    new SqliteParameter("@id", sourceSessionId));
                var targetExists = db.QueryScalar<long>(connection, transaction,
                    "SELECT COUNT(*) FROM sessions WHERE id = @id",
                    new SqliteParameter("@id", targetSessionId));
                var todoExists = db.QueryScalar<long>(connection, transaction,
                    "SELECT COUNT(*) FROM tasks WHERE id = @todoId AND session_id = @sourceSessionId",
                    new SqliteParameter("@todoId", todoId),
                    new SqliteParameter("@sourceSessionId", sourceSessionId));
                if (sourceExists == 0 || targetExists == 0 || todoExists == 0)
                    return (Changed: 0, Error: "Source session, target session, or source Todo not found");

                var changed = db.Execute(
                    connection,
                    transaction,
                    "INSERT OR IGNORE INTO session_follow_ups " +
                    "(id, todo_id, source_session_id, target_session_id, follow_up_at, status, query_instruction, " +
                    "plugin_id, plugin_type, plugin_chat_id, notification_key, created_at, updated_at) VALUES " +
                    "(@id, @todoId, @sourceSessionId, @targetSessionId, @followUpAt, 'waiting', @queryInstruction, " +
                    "@pluginId, @pluginType, @pluginChatId, @notificationKey, @now, @now)",
                    new SqliteParameter("@id", id),
                    new SqliteParameter("@todoId", todoId),
                    new SqliteParameter("@sourceSessionId", sourceSessionId),
                    new SqliteParameter("@targetSessionId", targetSessionId),
                    new SqliteParameter("@followUpAt", followUpAt),
                    new SqliteParameter("@queryInstruction", queryInstruction),
                    new SqliteParameter("@pluginId", DbValue(GetString(parameters, "pluginId"))),
                    new SqliteParameter("@pluginType", DbValue(GetString(parameters, "pluginType"))),
                    new SqliteParameter("@pluginChatId", DbValue(GetString(parameters, "pluginChatId"))),
                    new SqliteParameter("@notificationKey", notificationKey),
                    new SqliteParameter("@now", now));
                if (changed == 1)
                {
                    db.Execute(
                        connection,
                        transaction,
                        "UPDATE tasks SET status = 'in_progress', updated_at = @now WHERE id = @todoId AND session_id = @sourceSessionId",
                        new SqliteParameter("@now", now),
                        new SqliteParameter("@todoId", todoId),
                        new SqliteParameter("@sourceSessionId", sourceSessionId));
                }
                return (Changed: changed, Error: (string?)null);
            });
            if (outcome.Error != null)
                return Result(false, 0, null, outcome.Error);

            var row = FindByNotificationKey(db, notificationKey);
            if (row == null)
                return Result(false, 0, null, "Follow-up id or notification key conflicts with an existing record");
            if (row.TodoId != todoId || row.SourceSessionId != sourceSessionId || row.TargetSessionId != targetSessionId)
                return Result(false, 0, null, "notificationKey already belongs to a different follow-up");
            return Result(true, outcome.Changed, row, null);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbSessionFollowUpTools.Create failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse Claim(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            var claimToken = GetString(parameters, "claimToken");
            var now = GetLong(parameters, "now", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(claimToken))
                return Result(false, 0, null, "id and claimToken are required");

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var changed = db.Execute(
                "UPDATE session_follow_ups SET status = 'triggered', claim_token = @claimToken, claimed_at = @now, " +
                "attempt_count = attempt_count + 1, updated_at = @now WHERE id = @id AND status = 'waiting' AND follow_up_at <= @now",
                new SqliteParameter("@claimToken", claimToken),
                new SqliteParameter("@now", now),
                new SqliteParameter("@id", id));
            var row = changed == 1 ? Find(db, id) : null;
            return Result(changed == 1, changed, row, changed == 1 ? null : "Follow-up is not due or was already claimed");
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbSessionFollowUpTools.Claim failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse Reschedule(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            var claimToken = GetString(parameters, "claimToken");
            var followUpAt = GetLong(parameters, "followUpAt", 0);
            if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(claimToken) || followUpAt <= 0)
                return Result(false, 0, null, "id, claimToken and followUpAt are required");

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var changed = db.Execute(
                "UPDATE session_follow_ups SET status = 'waiting', follow_up_at = @followUpAt, " +
                "last_query_result = @lastQueryResult, last_error = @lastError, claim_token = NULL, claimed_at = NULL, updated_at = @now " +
                "WHERE id = @id AND status = 'triggered' AND claim_token = @claimToken",
                new SqliteParameter("@followUpAt", followUpAt),
                new SqliteParameter("@lastQueryResult", DbValue(GetString(parameters, "lastQueryResult"))),
                new SqliteParameter("@lastError", DbValue(GetString(parameters, "lastError"))),
                new SqliteParameter("@now", now),
                new SqliteParameter("@id", id),
                new SqliteParameter("@claimToken", claimToken));
            return Result(changed == 1, changed, changed == 1 ? Find(db, id) : null,
                changed == 1 ? null : "Follow-up claim no longer owns this record");
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbSessionFollowUpTools.Reschedule failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse Complete(JsonElement parameters)
    {
        return Finish(parameters, "completed");
    }

    public static WorkerResponse Fail(JsonElement parameters)
    {
        var claimToken = GetString(parameters, "claimToken");
        if (!string.IsNullOrWhiteSpace(claimToken))
            return Finish(parameters, "failed");

        try
        {
            var id = GetString(parameters, "id");
            var sourceSessionId = GetString(parameters, "sourceSessionId");
            if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(sourceSessionId))
                return Result(false, 0, null, "id and sourceSessionId are required before dispatch");

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var changed = db.ExecuteInTransaction((connection, transaction) =>
            {
                var count = db.Execute(
                    connection,
                    transaction,
                    "UPDATE session_follow_ups SET status = 'failed', last_error = @lastError, completed_at = @now, updated_at = @now " +
                    "WHERE id = @id AND source_session_id = @sourceSessionId AND status = 'waiting'",
                    new SqliteParameter("@lastError", DbValue(GetString(parameters, "lastError"))),
                    new SqliteParameter("@now", now),
                    new SqliteParameter("@id", id),
                    new SqliteParameter("@sourceSessionId", sourceSessionId));
                if (count == 1)
                {
                    var taskCount = db.Execute(
                        connection,
                        transaction,
                        "UPDATE tasks SET status = 'blocked', active_form = NULL, updated_at = @now " +
                        "WHERE id = (SELECT todo_id FROM session_follow_ups WHERE id = @id) " +
                        "AND session_id = @sourceSessionId",
                        new SqliteParameter("@now", now),
                        new SqliteParameter("@id", id),
                        new SqliteParameter("@sourceSessionId", sourceSessionId));
                    if (taskCount != 1)
                        throw new InvalidOperationException("Source Todo no longer exists");
                }
                return count;
            });
            return Result(changed == 1, changed, changed == 1 ? Find(db, id) : null,
                changed == 1 ? null : "Follow-up is not waiting or does not belong to this source session");
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbSessionFollowUpTools.Fail failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse Cancel(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            var todoId = GetString(parameters, "todoId");
            var sourceSessionId = GetString(parameters, "sourceSessionId");
            if (string.IsNullOrWhiteSpace(id) && (string.IsNullOrWhiteSpace(todoId) || string.IsNullOrWhiteSpace(sourceSessionId)))
                return Result(false, 0, null, "id or todoId with sourceSessionId is required");

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var changed = string.IsNullOrWhiteSpace(id)
                ? db.Execute(
                    "UPDATE session_follow_ups SET status = 'cancelled', cancelled_at = @now, claim_token = NULL, " +
                    "claimed_at = NULL, updated_at = @now WHERE todo_id = @todoId AND source_session_id = @sourceSessionId " +
                    "AND status IN ('waiting', 'triggered')",
                    new SqliteParameter("@now", now),
                    new SqliteParameter("@todoId", todoId!),
                    new SqliteParameter("@sourceSessionId", sourceSessionId!))
                : db.Execute(
                    "UPDATE session_follow_ups SET status = 'cancelled', cancelled_at = @now, claim_token = NULL, " +
                    "claimed_at = NULL, updated_at = @now WHERE id = @id AND status IN ('waiting', 'triggered')",
                    new SqliteParameter("@now", now),
                    new SqliteParameter("@id", id!));
            return Result(true, changed, !string.IsNullOrWhiteSpace(id) ? Find(db, id) : null, null);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbSessionFollowUpTools.Cancel failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse MarkNotified(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            var target = GetString(parameters, "target");
            if (string.IsNullOrWhiteSpace(id) || target is not ("desktop" or "channel"))
                return Result(false, 0, null, "id and target (desktop or channel) are required");

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var column = target == "desktop" ? "desktop_notified_at" : "channel_notified_at";
            var changed = db.Execute(
                $"UPDATE session_follow_ups SET {column} = COALESCE({column}, @now), updated_at = @now " +
                $"WHERE id = @id AND {column} IS NULL",
                new SqliteParameter("@now", now),
                new SqliteParameter("@id", id));
            return Result(true, changed, Find(db, id), null);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbSessionFollowUpTools.MarkNotified failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    private static WorkerResponse Finish(JsonElement parameters, string status)
    {
        try
        {
            var id = GetString(parameters, "id");
            var claimToken = GetString(parameters, "claimToken");
            if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(claimToken))
                return Result(false, 0, null, "id and claimToken are required");

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var changed = db.ExecuteInTransaction((connection, transaction) =>
            {
                var count = db.Execute(
                    connection,
                    transaction,
                    "UPDATE session_follow_ups SET status = @status, last_query_result = @lastQueryResult, " +
                    "last_error = @lastError, completed_at = @now, updated_at = @now " +
                    "WHERE id = @id AND status = 'triggered' AND claim_token = @claimToken",
                    new SqliteParameter("@status", status),
                    new SqliteParameter("@lastQueryResult", DbValue(GetString(parameters, "lastQueryResult"))),
                    new SqliteParameter("@lastError", DbValue(GetString(parameters, "lastError"))),
                    new SqliteParameter("@now", now),
                    new SqliteParameter("@id", id),
                    new SqliteParameter("@claimToken", claimToken));
                if (count == 1)
                {
                    var taskCount = db.Execute(
                        connection,
                        transaction,
                        "UPDATE tasks SET status = @taskStatus, active_form = NULL, updated_at = @now " +
                        "WHERE id = (SELECT todo_id FROM session_follow_ups WHERE id = @id) " +
                        "AND session_id = (SELECT source_session_id FROM session_follow_ups WHERE id = @id)",
                        new SqliteParameter("@taskStatus", status == "completed" ? "completed" : "blocked"),
                        new SqliteParameter("@now", now),
                        new SqliteParameter("@id", id));
                    if (taskCount != 1)
                        throw new InvalidOperationException("Source Todo no longer exists");
                }
                return count;
            });
            return Result(changed == 1, changed, changed == 1 ? Find(db, id) : null,
                changed == 1 ? null : "Follow-up claim no longer owns this record");
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbSessionFollowUpTools.{status} failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    private static SessionFollowUpRow? Find(DbService db, string id)
    {
        var entity = db.QueryFirstOrDefault(
            $"{FollowUpSelect} WHERE id = @id",
            EntityMappers.MapSessionFollowUp,
            new SqliteParameter("@id", id));
        return entity == null ? null : SessionFollowUpRow.FromEntity(entity);
    }

    private static SessionFollowUpRow? FindByNotificationKey(DbService db, string notificationKey)
    {
        var entity = db.QueryFirstOrDefault(
            $"{FollowUpSelect} WHERE notification_key = @notificationKey",
            EntityMappers.MapSessionFollowUp,
            new SqliteParameter("@notificationKey", notificationKey));
        return entity == null ? null : SessionFollowUpRow.FromEntity(entity);
    }

    private static WorkerResponse Result(bool success, int changed, SessionFollowUpRow? row, string? error)
    {
        return WorkerResponse.Json(
            new SessionFollowUpMutationResult(success, changed, row, error),
            InfrastructureJsonContext.Default.SessionFollowUpMutationResult);
    }

    private static string? GetString(JsonElement parameters, string name)
    {
        return parameters.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }

    private static long GetLong(JsonElement parameters, string name, long fallback)
    {
        return parameters.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number
            ? value.GetInt64()
            : fallback;
    }

    private static object DbValue(string? value) => (object?)value ?? DBNull.Value;
}

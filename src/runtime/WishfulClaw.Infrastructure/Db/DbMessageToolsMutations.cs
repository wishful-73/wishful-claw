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

public static partial class DbMessageTools
{
    // ─── Mutations ───

    public static WorkerResponse Add(JsonElement parameters)
    {
        try
        {
            var message = ReadMessageInput(parameters);
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            InsertMessage(db, message);
            IncrementMessageCount(db, message.SessionId, 1);
            return Mutation(1);
        }
        catch (Exception ex)
        {
            return MutationError(ex.Message);
        }
    }

    public static WorkerResponse AddBatch(JsonElement parameters)
    {
        try
        {
            if (!parameters.TryGetProperty("messages", out var messagesEl) || messagesEl.ValueKind != JsonValueKind.Array)
            {
                return Mutation(0);
            }

            var messages = new List<MessageEntity>();
            foreach (var item in messagesEl.EnumerateArray())
            {
                messages.Add(ReadMessageInput(item));
            }

            if (messages.Count == 0) return Mutation(0);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            foreach (var msg in messages)
            {
                InsertMessage(db, msg);
            }

            var bySession = messages.GroupBy(m => m.SessionId);
            foreach (var grp in bySession)
            {
                IncrementMessageCount(db, grp.Key, grp.Count());
            }

            return Mutation(messages.Count);
        }
        catch (Exception ex)
        {
            return MutationError(ex.Message);
        }
    }

    public static WorkerResponse Upsert(JsonElement parameters)
    {
        try
        {
            var message = ReadMessageInput(parameters);
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var existing = db.QueryFirstOrDefault(
                "SELECT created_at, sort_order FROM messages WHERE id = @id",
                r => new DbCompactionSnapshotStore.MessagePosition(r.GetInt64("created_at"), r.GetInt32("sort_order")),
                new SqliteParameter("@id", message.Id));

            if (existing is not null)
            {
                db.Execute(
                    "UPDATE messages SET session_id = @sid, role = @role, content = @content, " +
                    "meta = @meta, created_at = @ca, usage = @usage, sort_order = @so WHERE id = @id",
                    new SqliteParameter("@sid", message.SessionId),
                    new SqliteParameter("@role", message.Role),
                    new SqliteParameter("@content", message.Content),
                    new SqliteParameter("@meta", (object?)message.Meta ?? DBNull.Value),
                    new SqliteParameter("@ca", message.CreatedAt),
                    new SqliteParameter("@usage", (object?)message.Usage ?? DBNull.Value),
                    new SqliteParameter("@so", message.SortOrder),
                    new SqliteParameter("@id", message.Id));
                DbCompactionSnapshotStore.InvalidateIfUpsertCovered(db, message.SessionId, existing);
            }
            else
            {
                InsertMessage(db, message);
                IncrementMessageCount(db, message.SessionId, 1);
            }

            return Mutation(1);
        }
        catch (Exception ex)
        {
            return MutationError(ex.Message);
        }
    }

    public static WorkerResponse Update(JsonElement parameters)
    {
        try
        {
            var id = RequireString(parameters, "id");
            if (!parameters.TryGetProperty("patch", out var patch) || patch.ValueKind != JsonValueKind.Object)
            {
                return Mutation(0);
            }

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var current = db.QueryFirstOrDefault(
                "SELECT * FROM messages WHERE id = @id",
                EntityMappers.MapMessage,
                new SqliteParameter("@id", id));
            if (current is null) return Mutation(0);

            if (patch.TryGetProperty("content", out var contentEl) && contentEl.ValueKind == JsonValueKind.String)
            {
                current.Content = contentEl.GetString() ?? string.Empty;
            }
            if (patch.TryGetProperty("meta", out var metaEl))
            {
                current.Meta = metaEl.ValueKind == JsonValueKind.String
                    ? DbProjectTools.NormalizeOptional(metaEl.GetString())
                    : null;
            }
            if (patch.TryGetProperty("usage", out var usageEl))
            {
                current.Usage = usageEl.ValueKind == JsonValueKind.String
                    ? DbProjectTools.NormalizeOptional(usageEl.GetString())
                    : null;
            }

            var changed = db.Execute(
                "UPDATE messages SET content = @content, meta = @meta, usage = @usage WHERE id = @id",
                new SqliteParameter("@content", current.Content),
                new SqliteParameter("@meta", (object?)current.Meta ?? DBNull.Value),
                new SqliteParameter("@usage", (object?)current.Usage ?? DBNull.Value),
                new SqliteParameter("@id", id));
            return Mutation(changed);
        }
        catch (Exception ex)
        {
            return MutationError(ex.Message);
        }
    }

    public static WorkerResponse Clear(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            db.ExecuteInTransaction((conn, tx) =>
            {
                db.Execute(conn, tx, "DELETE FROM messages WHERE session_id = @sid", new SqliteParameter("@sid", sessionId));
                DbCompactionSnapshotStore.DeleteForSession(db, conn, tx, sessionId);
            });
            SetMessageCount(db, sessionId, 0);
            return Mutation(1);
        }
        catch (Exception ex)
        {
            return MutationError(ex.Message);
        }
    }

    public static WorkerResponse Delete(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            var messageId = RequireString(parameters, "messageId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var deleted = db.ExecuteInTransaction((conn, tx) =>
            {
                var position = db.QueryFirstOrDefault(
                    conn, tx,
                    "SELECT created_at, sort_order FROM messages WHERE session_id = @sid AND id = @mid",
                    r => new DbCompactionSnapshotStore.MessagePosition(r.GetInt64("created_at"), r.GetInt32("sort_order")),
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@mid", messageId));

                var removed = db.Execute(conn, tx,
                    "DELETE FROM messages WHERE session_id = @sid AND id = @mid",
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@mid", messageId));

                if (removed > 0)
                {
                    DbCompactionSnapshotStore.InvalidateIfCovered(db, conn, tx, sessionId, position);
                }

                return removed;
            });

            if (deleted > 0)
            {
                IncrementMessageCount(db, sessionId, -1);
            }

            return WorkerResponse.Json(new MessageDeleteResult(true, deleted > 0, null), InfrastructureJsonContext.Default.MessageDeleteResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(new MessageDeleteResult(false, false, ex.Message), InfrastructureJsonContext.Default.MessageDeleteResult);
        }
    }

    public static WorkerResponse Count(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var count = db.QueryScalar<int>(
                "SELECT COUNT(*) FROM messages WHERE session_id = @sid",
                new SqliteParameter("@sid", sessionId));
            return WorkerResponse.Json(new MessageCountResult(true, count, null), InfrastructureJsonContext.Default.MessageCountResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(new MessageCountResult(false, 0, ex.Message), InfrastructureJsonContext.Default.MessageCountResult);
        }
    }

    public static WorkerResponse DeleteLast(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            var role = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "role"));
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            string sql = role is not null
                ? "SELECT * FROM messages WHERE session_id = @sid AND role = @role ORDER BY sort_order DESC LIMIT 1"
                : "SELECT * FROM messages WHERE session_id = @sid ORDER BY sort_order DESC LIMIT 1";

            var lastParams = new List<SqliteParameter> { new("@sid", sessionId) };
            if (role is not null)
                lastParams.Add(new SqliteParameter("@role", role));
            var last = db.QueryFirstOrDefault(sql, EntityMappers.MapMessage, [.. lastParams]);

            if (last is null)
            {
                return WorkerResponse.Json(new MessageDeleteLastResult(true, null, null), InfrastructureJsonContext.Default.MessageDeleteLastResult);
            }

            db.ExecuteInTransaction((conn, tx) =>
            {
                db.Execute(conn, tx, "DELETE FROM messages WHERE id = @id", new SqliteParameter("@id", last.Id));
                DbCompactionSnapshotStore.InvalidateIfCovered(
                    db, conn, tx, sessionId, new DbCompactionSnapshotStore.MessagePosition(last.CreatedAt, last.SortOrder));
            });
            IncrementMessageCount(db, sessionId, -1);

            return WorkerResponse.Json(new MessageDeleteLastResult(true, MessageRow.FromEntity(last), null), InfrastructureJsonContext.Default.MessageDeleteLastResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(new MessageDeleteLastResult(false, null, ex.Message), InfrastructureJsonContext.Default.MessageDeleteLastResult);
        }
    }

    public static WorkerResponse TruncateFrom(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            var fromSortOrder = JsonHelpers.GetInt(parameters, "fromSortOrder", 0);
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var deleted = db.ExecuteInTransaction((conn, tx) =>
            {
                var cursor = DbCompactionSnapshotStore.GetCursor(db, conn, tx, sessionId);
                if (cursor is not null)
                {
                    // Truncation overlaps the snapshot coverage when any removed message
                    // (sort_order >= cutoff) lies at or before the snapshot cursor.
                    var overlaps = db.QueryScalar<int>(conn, tx,
                        "SELECT COUNT(*) FROM messages WHERE session_id = @sid AND sort_order >= @so " +
                        "AND (created_at < @tca OR (created_at = @tca AND sort_order <= @tso))",
                        new SqliteParameter("@sid", sessionId),
                        new SqliteParameter("@so", fromSortOrder),
                        new SqliteParameter("@tca", cursor.ThroughCreatedAt),
                        new SqliteParameter("@tso", cursor.ThroughSortOrder)) > 0;
                    if (overlaps)
                    {
                        DbCompactionSnapshotStore.DeleteForSession(db, conn, tx, sessionId);
                    }
                }

                return db.Execute(conn, tx,
                    "DELETE FROM messages WHERE session_id = @sid AND sort_order >= @so",
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@so", fromSortOrder));
            });

            var newCount = db.QueryScalar<int>(
                "SELECT COUNT(*) FROM messages WHERE session_id = @sid",
                new SqliteParameter("@sid", sessionId));
            SetMessageCount(db, sessionId, newCount);

            return Mutation(deleted);
        }
        catch (Exception ex)
        {
            return MutationError(ex.Message);
        }
    }

    // NOTE: CompactSession and UsageStats are in DbMessageCompactTools.cs
}

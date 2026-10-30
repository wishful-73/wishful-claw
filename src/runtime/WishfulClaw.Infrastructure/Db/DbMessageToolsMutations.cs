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

            // S-285：一个事务里批量插入 —— 每条消息都要连 message_parts 一起写，
            // 逐条开事务会把批量导入退化成 N 次提交。
            db.ExecuteInTransaction((conn, tx) =>
            {
                foreach (var msg in messages)
                {
                    InsertMessage(db, conn, tx, msg);
                }
            });

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
                "SELECT * FROM messages WHERE id = @id",
                EntityMappers.MapMessage,
                new SqliteParameter("@id", message.Id));

            if (existing is not null)
            {
                // S-285 分流判据：库里这一行自己的 meta 是否已带块结构。
                // 有 ⇒ 老格式，整行原样写回，一个字节不变，parts 一行不碰。
                // 无 ⇒ 新格式，块结构剥进 message_parts，meta 只留非块字段。
                var keepLegacy = DbMessageParts.HasBlockStructure(existing.Meta);
                var (metaToWrite, parts) = keepLegacy
                    ? (message.Meta, (IReadOnlyList<DbMessageParts.PartRow>)[])
                    : DbMessageParts.SplitMeta(message.Meta, message.CreatedAt);

                // updated_at is stamped by the worker clock on every rewrite — this is
                // what the renderer shows as an assistant reply's display time.
                db.ExecuteInTransaction((conn, tx) =>
                {
                    db.Execute(conn, tx,
                        "UPDATE messages SET session_id = @sid, role = @role, content = @content, " +
                        "meta = @meta, created_at = @ca, updated_at = @ua, usage = @usage, sort_order = @so WHERE id = @id",
                        new SqliteParameter("@sid", message.SessionId),
                        new SqliteParameter("@role", message.Role),
                        new SqliteParameter("@content", message.Content),
                        new SqliteParameter("@meta", (object?)metaToWrite ?? DBNull.Value),
                        new SqliteParameter("@ca", message.CreatedAt),
                        new SqliteParameter("@ua", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()),
                        new SqliteParameter("@usage", (object?)message.Usage ?? DBNull.Value),
                        new SqliteParameter("@so", message.SortOrder),
                        new SqliteParameter("@id", message.Id));

                    // 单行 INSERT OR REPLACE (message_id, seq) —— 状态更新原地覆盖，绝不追加新行。
                    // 老格式时 parts 为空，WriteParts 直接返回。
                    DbMessageParts.WriteParts(conn, tx, message.Id, parts, message.CreatedAt);
                });
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
                // ⚠️ 本端点写 meta 是「整行覆盖」，且**不碰 message_parts**。
                // 新格式消息的块结构在 parts 里，读侧 MergePartsIntoMeta 会用 parts 覆盖
                // meta 里的 segments/toolCalls —— 所以通过这里写进 meta 的块结构会被静默吞掉。
                // 当前渲染端零调用（grep `messages-update` 只有 DbModule 注册），属死端点；
                // 将来真要启用，必须改成与 Upsert 同一套分流：HasBlockStructure ⇒ 原样，
                // 否则 SplitMeta + WriteParts。别直接拿它回写 segments。
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
                "UPDATE messages SET content = @content, meta = @meta, usage = @usage, updated_at = @ua WHERE id = @id",
                new SqliteParameter("@content", current.Content),
                new SqliteParameter("@meta", (object?)current.Meta ?? DBNull.Value),
                new SqliteParameter("@usage", (object?)current.Usage ?? DBNull.Value),
                new SqliteParameter("@ua", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()),
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
                // S-285：parts 表不存 session_id（避免两份真相），靠 messages 子查询定位。
                // ⇒ 必须在 DELETE messages 之前清，否则子查询已空，parts 变孤儿。
                DbMessageParts.DeleteForSession(conn, tx, sessionId);
                db.Execute(conn, tx, "DELETE FROM messages WHERE session_id = @sid", new SqliteParameter("@sid", sessionId));
                DbCompactionSnapshotStore.DetachForSession(db, conn, tx, sessionId);
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

            var deleted = 0;
            db.ExecuteInTransaction((conn, tx) =>
            {
                // S-285：显式清 parts（不加 FK，见 §8.5）。先清后删，避免留下孤儿行。
                DbMessageParts.DeleteForMessage(conn, tx, messageId);
                deleted = db.Execute(conn, tx,
                    "DELETE FROM messages WHERE session_id = @sid AND id = @mid",
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@mid", messageId));
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

    // NOTE: CompactSession and UsageStats are in DbMessageCompactTools.cs
}

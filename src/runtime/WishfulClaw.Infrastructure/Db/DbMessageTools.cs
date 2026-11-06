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
    // ─── Shared Helpers ───
    // Query methods (List/ListPage/ListLocator/ListByTurns/SearchContent) are in DbMessageToolsQueries.cs
    // Mutation methods (Add/AddBatch/Upsert/Update/Clear/Delete/Count) are in DbMessageToolsMutations.cs

    /// <summary>
    /// 插入一条消息（自带事务）。块结构按 S-285 拆进 <c>message_parts</c>。
    /// </summary>
    internal static void InsertMessage(DbService db, MessageEntity message)
    {
        db.ExecuteInTransaction((conn, tx) => InsertMessage(db, conn, tx, message));
    }

    /// <summary>
    /// 在调用方的事务里插入一条消息 —— 批量写（<c>AddBatch</c>）走这条，避免 N 条消息开 N 个事务。
    ///
    /// <para>S-285：新插入的行一律走新格式。老格式的判据是「<b>库里这一行自己的 meta 已带块结构</b>」
    /// （<see cref="DbMessageParts.HasBlockStructure"/>），新插入不可能命中，所以直接拆。</para>
    /// </summary>
    internal static void InsertMessage(
        DbService db,
        SqliteConnection conn,
        SqliteTransaction tx,
        MessageEntity message)
    {
        var (meta, parts) = DbMessageParts.SplitMeta(message.Meta, message.CreatedAt);

        db.Execute(conn, tx,
            "INSERT INTO messages (id, session_id, role, content, meta, created_at, updated_at, usage, sort_order) " +
            "VALUES (@id, @sid, @role, @content, @meta, @ca, @ua, @usage, @so)",
            new SqliteParameter("@id", message.Id),
            new SqliteParameter("@sid", message.SessionId),
            new SqliteParameter("@role", message.Role),
            new SqliteParameter("@content", message.Content),
            new SqliteParameter("@meta", (object?)meta ?? DBNull.Value),
            new SqliteParameter("@ca", message.CreatedAt),
            // Fresh insert: updated_at starts equal to created_at.
            new SqliteParameter("@ua", message.UpdatedAt ?? message.CreatedAt),
            new SqliteParameter("@usage", (object?)message.Usage ?? DBNull.Value),
            new SqliteParameter("@so", message.SortOrder));

        DbMessageParts.WriteParts(conn, tx, message.Id, parts, message.CreatedAt);
    }

    /// <summary>
    /// S-285：实体行 → 对外 DTO 时，把 <c>message_parts</c> 合并回 <c>meta</c>。
    ///
    /// <para>对外形状仍是 <c>{ toolCalls, segments, thinking }</c>，<b>渲染层零改动</b>（§4.3）。
    /// 老格式消息在 parts 表里没有行，<c>Meta</c> 原样返回，行为逐字节不变。</para>
    /// </summary>
    internal static List<MessageRow> ToRowsWithParts(DbService db, List<MessageEntity> entities)
    {
        var rows = entities.Select(MessageRow.FromEntity).ToList();
        if (entities.Count == 0) return rows;

        var partsMap = DbMessageParts.LoadParts(db, entities.Select(e => e.Id).ToList());
        if (partsMap.Count == 0) return rows;

        for (var i = 0; i < entities.Count; i++)
        {
            if (!partsMap.TryGetValue(entities[i].Id, out var parts)) continue;
            rows[i].Meta = DbMessageParts.MergePartsIntoMeta(rows[i].Meta, parts);
        }

        return rows;
    }

    /// <summary>
    /// 会话恢复读取（S-338 / S-328 刀 28）。<paramref name="afterCreatedAt"/> 为 null ⇒ 全量；
    /// 有值 ⇒ 只取快照提交之后写入的消息。
    ///
    /// <para>
    /// <b>边界只能用快照行自己的 <c>created_at</c>，不能用 <c>through_created_at</c> /
    /// <c>through_sort_order</c>。</b>快照行的 <c>created_at</c> 是一次写入、永不改写的壁钟时间，
    /// 普通消息保存动不了它；而 <c>sort_order</c> 是渲染端的 transcript 下标（<c>messages.indexOf</c>），
    /// 压缩在转写中间插入 boundary+summary 对时会整体平移 —— 拿它做过滤历史上报过假的
    /// <c>invalid_cursor</c>，把会话永久卡死。所以 <c>sort_order</c> 只做 <c>ORDER BY</c> 的第二个键，
    /// <b>签名里也刻意不接受它</b>：一旦出现这个参数，下一个人就会拿它做过滤条件，回到那个 bug。
    /// </para>
    /// <para>
    /// <c>ORDER BY created_at ASC, sort_order ASC</c> 两段都不能省：省掉第二段，同一毫秒写入的多条
    /// 会乱序，正文和工具结果错位。
    /// </para>
    /// <para>
    /// 显式列而不是 <c>SELECT *</c>：<c>messages</c> 是最热的表，加列时静默错位的代价最高。
    /// </para>
    /// </summary>
    public static List<MessageEntity> ListForRestore(DbService db, string sessionId, long? afterCreatedAt)
    {
        const string Columns = "id, session_id, role, content, meta, created_at, updated_at, usage, sort_order";

        if (afterCreatedAt is null)
        {
            return db.Query(
                $"SELECT {Columns} FROM messages WHERE session_id = @sid ORDER BY created_at ASC, sort_order ASC",
                EntityMappers.MapMessage,
                DbService.Param("@sid", sessionId));
        }

        return db.Query(
            $"SELECT {Columns} FROM messages " +
            "WHERE session_id = @sid AND created_at > @snapshotCreatedAt " +
            "ORDER BY created_at ASC, sort_order ASC",
            EntityMappers.MapMessage,
            DbService.Param("@sid", sessionId),
            DbService.Param("@snapshotCreatedAt", afterCreatedAt.Value));
    }

    private static WorkerResponse ReadRows(JsonElement parameters, string? role, bool paged)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            List<SqliteParameter> paramList = [new("@sid", sessionId)];
            string sql;

            if (role is not null)
            {
                paramList.Add(new SqliteParameter("@role", role));
                sql = "SELECT * FROM messages WHERE session_id = @sid AND role = @role ORDER BY created_at ASC, sort_order ASC";
            }
            else
            {
                sql = "SELECT * FROM messages WHERE session_id = @sid ORDER BY created_at ASC, sort_order ASC";
            }

            if (paged)
            {
                var limit = Math.Clamp(JsonHelpers.GetInt(parameters, "limit", 100), 1, 5000);
                var offset = Math.Max(0, JsonHelpers.GetInt(parameters, "offset", 0));
                paramList.Add(new SqliteParameter("@limit", limit));
                paramList.Add(new SqliteParameter("@offset", offset));
                sql += " LIMIT @limit OFFSET @offset";
            }

            var entities = db.Query(sql, EntityMappers.MapMessage, [.. paramList]);
            // S-285：块结构合并回 meta，对外形状不变。
            var rows = ToRowsWithParts(db, entities);

            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListMessageRow);
        }
        catch (Exception)
        {
            return WorkerResponse.Json(new List<MessageRow>(), InfrastructureJsonContext.Default.ListMessageRow);
        }
    }

    internal static MessageEntity ReadMessageInput(JsonElement element, string? sessionIdOverride = null)
    {
        return new MessageEntity
        {
            Id = RequireString(element, "id"),
            SessionId = sessionIdOverride ?? RequireString(element, "sessionId"),
            Role = RequireString(element, "role"),
            Content = JsonHelpers.GetString(element, "content") ?? string.Empty,
            Meta = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(element, "meta")),
            CreatedAt = JsonHelpers.GetLong(element, "createdAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()),
            Usage = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(element, "usage")),
            SortOrder = JsonHelpers.GetInt(element, "sortOrder", 0)
        };
    }

    internal static void IncrementMessageCount(DbService db, string sessionId, int delta)
    {
        var session = db.QueryFirstOrDefault(
            "SELECT * FROM sessions WHERE id = @id",
            EntityMappers.MapSession,
            new SqliteParameter("@id", sessionId));
        if (session is null) return;
        session.MessageCount = Math.Max(0, session.MessageCount + delta);
        session.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        db.Execute(
            "UPDATE sessions SET message_count = @mc, updated_at = @ua WHERE id = @id",
            new SqliteParameter("@mc", session.MessageCount),
            new SqliteParameter("@ua", session.UpdatedAt),
            new SqliteParameter("@id", sessionId));
    }

    internal static void SetMessageCount(DbService db, string sessionId, int count)
    {
        db.Execute(
            "UPDATE sessions SET message_count = @mc WHERE id = @id",
            new SqliteParameter("@mc", count),
            new SqliteParameter("@id", sessionId));
    }

    private static string RequireString(JsonElement parameters, string name)
    {
        return JsonHelpers.GetString(parameters, name) is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException($"Missing required field: {name}");
    }

    private static WorkerResponse Mutation(int changed)
    {
        return WorkerResponse.Json(new MessageMutationResult(true, changed, null), InfrastructureJsonContext.Default.MessageMutationResult);
    }

    private static WorkerResponse MutationError(string error)
    {
        return WorkerResponse.Json(new MessageMutationResult(false, 0, error), InfrastructureJsonContext.Default.MessageMutationResult);
    }
}

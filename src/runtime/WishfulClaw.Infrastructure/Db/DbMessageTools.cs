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

    internal static void InsertMessage(DbService db, MessageEntity message)
    {
        db.Execute(
            "INSERT INTO messages (id, session_id, role, content, meta, created_at, usage, sort_order) " +
            "VALUES (@id, @sid, @role, @content, @meta, @ca, @usage, @so)",
            new SqliteParameter("@id", message.Id),
            new SqliteParameter("@sid", message.SessionId),
            new SqliteParameter("@role", message.Role),
            new SqliteParameter("@content", message.Content),
            new SqliteParameter("@meta", (object?)message.Meta ?? DBNull.Value),
            new SqliteParameter("@ca", message.CreatedAt),
            new SqliteParameter("@usage", (object?)message.Usage ?? DBNull.Value),
            new SqliteParameter("@so", message.SortOrder));
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
            var rows = entities.Select(MessageRow.FromEntity).ToList();

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

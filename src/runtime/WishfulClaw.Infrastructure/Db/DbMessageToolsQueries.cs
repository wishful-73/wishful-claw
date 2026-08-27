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
    // ─── Query ───

    public static WorkerResponse List(JsonElement parameters)
    {
        return ReadRows(parameters, role: null, paged: false);
    }

    public static WorkerResponse ListPage(JsonElement parameters)
    {
        return ReadRows(parameters, role: null, paged: true);
    }

    /// <summary>
    /// Lightweight locator index — returns all messages with only id/role/content/createdAt/sortOrder
    /// (no meta/usage). Used by the right-side AssistantReplyRail to render conversation turn markers.
    /// </summary>
    public static WorkerResponse ListLocator(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var entities = db.Query(
                "SELECT id, session_id, role, content, created_at, sort_order FROM messages WHERE session_id = @sid ORDER BY sort_order ASC",
                EntityMappers.MapMessage,
                new SqliteParameter("@sid", sessionId));

            var rows = entities.Select(MessageRow.FromEntity).ToList();
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListMessageRow);
        }
        catch
        {
            return WorkerResponse.Json(new List<MessageRow>(), InfrastructureJsonContext.Default.ListMessageRow);
        }
    }

    /// <summary>
    /// Turn-based pagination: load N conversation turns before a given created_at timestamp.
    /// A "turn" = one user message + all subsequent non-user messages until the next user message.
    /// Returns messages + rangeStart (earliest created_at in the batch) + hasMore.
    /// </summary>
    public static WorkerResponse ListByTurns(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            var turns = Math.Clamp(JsonHelpers.GetInt(parameters, "turns", 5), 1, 50);
            long? beforeCreatedAt = parameters.TryGetProperty("beforeCreatedAt", out var bca) && bca.ValueKind == JsonValueKind.Number
                ? bca.GetInt64()
                : null;

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            // Step 1: Find the created_at of the N most recent user messages before beforeCreatedAt
            List<long> userTimestamps;
            if (beforeCreatedAt.HasValue)
            {
                userTimestamps = db.Query(
                    "SELECT created_at FROM messages WHERE session_id = @sid AND role = 'user' AND created_at < @before ORDER BY created_at DESC LIMIT @turns",
                    (r) => r.GetInt64(0),
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@before", beforeCreatedAt.Value),
                    new SqliteParameter("@turns", turns));
            }
            else
            {
                userTimestamps = db.Query(
                    "SELECT created_at FROM messages WHERE session_id = @sid AND role = 'user' ORDER BY created_at DESC LIMIT @turns",
                    (r) => r.GetInt64(0),
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@turns", turns));
            }

            if (userTimestamps.Count == 0)
            {
                return WorkerResponse.Json(
                    new MessageListByTurnsResult(true, new List<MessageRow>(), 0, false, null),
                    InfrastructureJsonContext.Default.MessageListByTurnsResult);
            }

            // Step 2: rangeStart = earliest user created_at in this batch
            var rangeStart = userTimestamps.Min();

            // Step 3: Load all messages from rangeStart up to (but not including) beforeCreatedAt
            var messages = beforeCreatedAt.HasValue
                ? db.Query(
                    "SELECT * FROM messages WHERE session_id = @sid AND created_at >= @rangeStart AND created_at < @before ORDER BY created_at ASC",
                    EntityMappers.MapMessage,
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@rangeStart", rangeStart),
                    new SqliteParameter("@before", beforeCreatedAt.Value))
                : db.Query(
                    "SELECT * FROM messages WHERE session_id = @sid AND created_at >= @rangeStart ORDER BY created_at ASC",
                    EntityMappers.MapMessage,
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@rangeStart", rangeStart));

            // Step 4: Check if there are more user messages before rangeStart
            var hasMore = db.QueryScalar<int>(
                "SELECT COUNT(*) FROM messages WHERE session_id = @sid AND role = 'user' AND created_at < @rangeStart",
                new SqliteParameter("@sid", sessionId),
                new SqliteParameter("@rangeStart", rangeStart)) > 0;

            var rows = messages.Select(MessageRow.FromEntity).ToList();
            return WorkerResponse.Json(
                new MessageListByTurnsResult(true, rows, rangeStart, hasMore, null),
                InfrastructureJsonContext.Default.MessageListByTurnsResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(
                new MessageListByTurnsResult(false, new List<MessageRow>(), 0, false, ex.Message),
                InfrastructureJsonContext.Default.MessageListByTurnsResult);
        }
    }

    /// <summary>
    /// Incremental restore query: messages persisted strictly after the
    /// (afterCreatedAt, afterSortOrder) cursor, in canonical order.
    /// Used with a valid compaction snapshot to rebuild the tail after the coverage boundary.
    /// </summary>
    public static WorkerResponse ListAfterCursor(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            var afterCreatedAt = JsonHelpers.GetLong(parameters, "afterCreatedAt", 0);
            var afterSortOrder = JsonHelpers.GetInt(parameters, "afterSortOrder", -1);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var entities = db.Query(
                "SELECT * FROM messages WHERE session_id = @sid " +
                "AND (created_at > @ca OR (created_at = @ca AND sort_order > @so)) " +
                "ORDER BY created_at ASC, sort_order ASC",
                EntityMappers.MapMessage,
                new SqliteParameter("@sid", sessionId),
                new SqliteParameter("@ca", afterCreatedAt),
                new SqliteParameter("@so", afterSortOrder));

            var rows = entities.Select(MessageRow.FromEntity).ToList();
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListMessageRow);
        }
        catch
        {
            return WorkerResponse.Json(new List<MessageRow>(), InfrastructureJsonContext.Default.ListMessageRow);
        }
    }

    // ─── Search ───

    /// <summary>
    /// Search message content across all sessions by keyword.
    /// Returns matching messages with a snippet around the keyword and the session title.
    /// </summary>
    public static WorkerResponse SearchContent(JsonElement parameters)
    {
        try
        {
            var query = RequireString(parameters, "query");
            var limit = Math.Clamp(JsonHelpers.GetInt(parameters, "limit", 50), 1, 200);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            // LIKE search on messages.content, join sessions for title
            var sql = """
                SELECT m.id, m.session_id, m.content, m.created_at,
                       s.title AS session_title
                FROM messages m
                JOIN sessions s ON s.id = m.session_id
                WHERE m.content LIKE @pattern
                ORDER BY m.created_at DESC
                LIMIT @limit
                """;

            var pattern = $"%{query}%";
            var rows = db.Query(
                sql,
                (r) =>
                {
                    var content = r.GetString("content");
                    var snippet = BuildSnippet(content, query);
                    return new MessageSearchResultRow
                    {
                        MessageId = r.GetString("id"),
                        SessionId = r.GetString("session_id"),
                        SessionTitle = r.GetString("session_title"),
                        Snippet = snippet,
                        CreatedAt = r.GetInt64("created_at")
                    };
                },
                new SqliteParameter("@pattern", pattern),
                new SqliteParameter("@limit", limit));

            return WorkerResponse.Json(
                new MessageSearchResult(true, rows, null),
                InfrastructureJsonContext.Default.MessageSearchResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(
                new MessageSearchResult(false, new List<MessageSearchResultRow>(), ex.Message),
                InfrastructureJsonContext.Default.MessageSearchResult);
        }
    }

    /// <summary>
    /// Build a short snippet around the first occurrence of <paramref name="query"/>
    /// (already lowercased) within <paramref name="text"/>.
    /// 20 chars before, 30 after — mirrors OpenCowork's buildSnippet.
    /// </summary>
    private static string BuildSnippet(string text, string query)
    {
        var lower = text.ToLowerInvariant();
        var idx = lower.IndexOf(query, StringComparison.OrdinalIgnoreCase);
        if (idx == -1) return string.Empty;
        var start = Math.Max(0, idx - 20);
        var end = idx + query.Length + 30;
        var snippet = (start > 0 ? "..." : "") +
                      text.AsSpan(start, Math.Min(end, text.Length) - start).ToString().Replace("\n", " ") +
                      (end < text.Length ? "..." : "");
        return snippet;
    }
}

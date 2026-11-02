/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

public static partial class DbMessageTools
{
    // ─── S-276：真实用户轮的唯一判据 ───

    /// <summary>
    /// 会话轮次的判定：<c>role = 'user'</c> 且不是压缩摘要卡。
    ///
    /// 压缩摘要写库时 <c>role</c> 也是 <c>'user'</c>（<c>ContextCompression.TokenEstimation.cs</c>
    /// 的 <c>CreateSummaryWireMessage</c> —— 为的是让模型把摘要当成用户陈述来读），
    /// 但它在语义上不是用户发的话。这里数轮次的四处 SQL 都曾只看 <c>role</c>，
    /// 于是一个压缩过 20 次的会话会把「最近 5 轮」的 5 个名额全让给摘要卡，
    /// 真实消息一条都进不了窗口（S-276）。
    ///
    /// 走 <c>meta LIKE</c> 而不是加 <c>is_artifact</c> 列：加列要迁移旧库，收益不抵风险
    /// （S-276 §七-2 定案）。
    ///
    /// 渲染层同口径见 <c>src/renderer/src/lib/agent/context-compression-display.ts</c> 的
    /// <c>isRealUserTurn</c>：跨语言共用不了函数，改一处必须同步另一处，两侧都有单测钉住。
    /// </summary>
    private const string RealUserTurnPredicate =
        "role = 'user' AND (meta IS NULL OR meta NOT LIKE '%compactSummary%')";

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
                "SELECT id, session_id, role, content, created_at, updated_at, sort_order FROM messages WHERE session_id = @sid ORDER BY sort_order ASC",
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

            // Total conversation turns (real user messages) — lets the UI show the
            // loaded/total range without an extra round trip.
            // S-276: 压缩摘要卡不算轮次，否则分母虚高（实测 71 对 51）。
            var totalTurns = db.QueryScalar<int>(
                $"SELECT COUNT(*) FROM messages WHERE session_id = @sid AND {RealUserTurnPredicate}",
                new SqliteParameter("@sid", sessionId));

            // Step 1: Find the created_at of the N most recent user messages before beforeCreatedAt
            List<long> userTimestamps;
            if (beforeCreatedAt.HasValue)
            {
                userTimestamps = db.Query(
                    $"SELECT created_at FROM messages WHERE session_id = @sid AND {RealUserTurnPredicate} AND created_at < @before ORDER BY created_at DESC LIMIT @turns",
                    (r) => r.GetInt64(0),
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@before", beforeCreatedAt.Value),
                    new SqliteParameter("@turns", turns));
            }
            else
            {
                userTimestamps = db.Query(
                    $"SELECT created_at FROM messages WHERE session_id = @sid AND {RealUserTurnPredicate} ORDER BY created_at DESC LIMIT @turns",
                    (r) => r.GetInt64(0),
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@turns", turns));
            }

            if (userTimestamps.Count == 0)
            {
                return WorkerResponse.Json(
                    new MessageListByTurnsResult(true, new List<MessageRow>(), 0, false, null, totalTurns),
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

            // Step 4: Check if there are more real user messages before rangeStart
            var hasMore = db.QueryScalar<int>(
                $"SELECT COUNT(*) FROM messages WHERE session_id = @sid AND {RealUserTurnPredicate} AND created_at < @rangeStart",
                new SqliteParameter("@sid", sessionId),
                new SqliteParameter("@rangeStart", rangeStart)) > 0;

            // S-285：块结构合并回 meta。窗口内消息数由 turns 锁定，parts 查询量固定。
            var rows = ToRowsWithParts(db, messages);
            return WorkerResponse.Json(
                new MessageListByTurnsResult(true, rows, rangeStart, hasMore, null, totalTurns),
                InfrastructureJsonContext.Default.MessageListByTurnsResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(
                new MessageListByTurnsResult(false, new List<MessageRow>(), 0, false, ex.Message),
                InfrastructureJsonContext.Default.MessageListByTurnsResult);
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

    // ─── S-301：用户侧历史发言（给 agent 回看用） ───

    /// <summary>
    /// 折叠的粘贴块在库里的形态是 <c>&lt;pasted-block&gt;{"label":…,"text":…}&lt;/pasted-block&gt;</c>
    /// （<c>src/renderer/src/lib/select-file-tags.ts:45</c>）。那是给聊天窗渲染 chip 用的，
    /// 原样喂给模型等于把用户粘贴的几千字原文当 JSON 塞进上下文。这里整体换成一个占位，
    /// 正文保持可读，真实体量走 <c>attachmentSummary</c> 告知。
    ///
    /// <para>渲染侧同一个正则的 C# 版本 —— 改一处必须同步另一处（S-301 §四）。</para>
    /// </summary>
    private static readonly Regex PastedBlockTagRe = new(
        @"<pasted-block>([\s\S]*?)</pasted-block>",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>
    /// S-301：当前会话里**用户自己**说过的话。
    ///
    /// <para>存在的理由：上下文压缩之后，用户早期说过的话就离开了上下文，agent 于是重复
    /// 问已经定过的事。这里把「用户说过什么」从库里捞回来，<b>只捞 user 侧</b> ——
    /// assistant 回复该由 agent 自己的记忆与摘要承担。</para>
    ///
    /// <para><b>与 <see cref="ListByTurns"/> 是并列新增，不是改造</b>：那个是前端分页加载
    /// 的接口，返回整轮全部内容（assistant 正文 + 工具块 + 思考流），单轮上万 token；
    /// 前端历史加载依赖它，改它等于连带 S-276 的分页逻辑一起翻车。</para>
    ///
    /// <para><b>时区</b>：<c>created_at</c> 是 unix 毫秒，而用户说的「今天」是他本地时区的
    /// 00:00→24:00。按 UTC 切日会把北京时间早上 7 点的话算到前一天，所以这里必须
    /// <c>SpecifyKind(Local)</c> 再换算 —— 直接 <c>parsed.ToUniversalTime()</c> 会因为
    /// <c>DateOnly.ToDateTime</c> 给的 <c>Kind=Unspecified</c> 而按本地解释两次，出现偏移。</para>
    /// </summary>
    public static WorkerResponse ListUserMessages(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            var limit = Math.Clamp(JsonHelpers.GetInt(parameters, "limit", 50), 1, 200);
            var date = JsonHelpers.GetString(parameters, "date")?.Trim();

            long? dayStart = null;
            long dayEnd = 0;
            if (!string.IsNullOrEmpty(date))
            {
                if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                        DateTimeStyles.None, out var parsedDate))
                {
                    // 不静默当成今天 —— 模型传错格式必须让它自己纠正。
                    return WorkerResponse.Json(
                        new MessageListUserResult(false, new List<MessageUserRow>(), false, 0,
                            $"date must be YYYY-MM-DD, got \"{date}\"."),
                        InfrastructureJsonContext.Default.MessageListUserResult);
                }

                var localStart = parsedDate.ToDateTime(TimeOnly.MinValue, DateTimeKind.Local);
                dayStart = new DateTimeOffset(localStart).ToUnixTimeMilliseconds();
                dayEnd = new DateTimeOffset(localStart.AddDays(1)).ToUnixTimeMilliseconds();
            }

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var total = dayStart.HasValue
                ? db.QueryScalar<int>(
                    $"SELECT COUNT(*) FROM messages WHERE session_id = @sid AND {RealUserTurnPredicate} " +
                    "AND created_at >= @start AND created_at < @end",
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@start", dayStart.Value),
                    new SqliteParameter("@end", dayEnd))
                : db.QueryScalar<int>(
                    $"SELECT COUNT(*) FROM messages WHERE session_id = @sid AND {RealUserTurnPredicate}",
                    new SqliteParameter("@sid", sessionId));

            List<MessageUserRow> rows;
            if (dayStart.HasValue)
            {
                rows = db.Query(
                    $"SELECT content, meta, created_at FROM messages WHERE session_id = @sid AND {RealUserTurnPredicate} " +
                    "AND created_at >= @start AND created_at < @end ORDER BY created_at ASC, sort_order ASC LIMIT @limit",
                    MapUserRow,
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@start", dayStart.Value),
                    new SqliteParameter("@end", dayEnd),
                    new SqliteParameter("@limit", limit));
            }
            else
            {
                // 不传日期 ⇒ 最近 limit 条。SQL 走倒序取，再反转回正序，模型读起来才顺。
                rows = db.Query(
                    $"SELECT content, meta, created_at FROM messages WHERE session_id = @sid AND {RealUserTurnPredicate} " +
                    "ORDER BY created_at DESC, sort_order DESC LIMIT @limit",
                    MapUserRow,
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@limit", limit));
                rows.Reverse();
            }

            return WorkerResponse.Json(
                new MessageListUserResult(true, rows, total > rows.Count, total, null),
                InfrastructureJsonContext.Default.MessageListUserResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(
                new MessageListUserResult(false, new List<MessageUserRow>(), false, 0, ex.Message),
                InfrastructureJsonContext.Default.MessageListUserResult);
        }
    }

    private static MessageUserRow MapUserRow(SqliteDataReader r)
    {
        var content = r.GetString("content");
        var meta = r.GetNullableString("meta");
        var (text, pastedChars) = FlattenPastedBlocks(content);
        return new MessageUserRow(
            r.GetInt64("created_at"),
            text,
            BuildAttachmentSummary(meta, pastedChars));
    }

    /// <summary>
    /// 把折叠粘贴块换成人能读的占位，并回报这些块合计多少字。
    /// 解析不出 payload 的标签（脏数据 / 手工编辑过）退化成「[粘贴]」，不抛。
    /// </summary>
    private static (string Text, int PastedChars) FlattenPastedBlocks(string content)
    {
        if (content.Length == 0 || content.IndexOf("<pasted-block>", StringComparison.OrdinalIgnoreCase) < 0)
        {
            return (content, 0);
        }

        var pastedChars = 0;
        var text = PastedBlockTagRe.Replace(content, match =>
        {
            var chars = ReadPastedTextLength(match.Groups[1].Value);
            pastedChars += chars;
            return chars > 0 ? $"[粘贴 · {chars} 字]" : "[粘贴]";
        });
        return (text, pastedChars);
    }

    /// <summary>
    /// 标签里的 payload 是 <c>{"label":…,"text":…}</c>，且经 <c>encodeTagText</c>
    /// 转义过（<c>&amp;</c> / <c>&lt;</c> / <c>&gt;</c>）。先反转义再解析，顺序不能倒 ——
    /// 先解 <c>&amp;lt;</c> 会把一个转义过的字面量 <c>&amp;lt;</c> 误还原成 <c>&lt;</c>。
    /// </summary>
    private static int ReadPastedTextLength(string encodedPayload)
    {
        try
        {
            var json = encodedPayload
                .Replace("&lt;", "<", StringComparison.Ordinal)
                .Replace("&gt;", ">", StringComparison.Ordinal)
                .Replace("&amp;", "&", StringComparison.Ordinal);
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return 0;
            if (!doc.RootElement.TryGetProperty("text", out var textEl) ||
                textEl.ValueKind != JsonValueKind.String)
            {
                return 0;
            }
            return textEl.GetString()?.TrimEnd().Length ?? 0;
        }
        catch
        {
            return 0;
        }
    }

    /// <summary>
    /// 附件摘要：<c>null</c> / <c>"图片 ×1"</c> / <c>"粘贴 400 字"</c> / <c>"图片 ×1，粘贴 400 字"</c>。
    ///
    /// <para>没有这一项，PM 看到用户说「你看看这个」完全不知道在说什么（S-301 §4.1）。
    /// 图片数从 <c>meta.content</c> 的块数组数 —— 用户消息的图片块存在那里
    /// （<c>chat-store/db-helpers.ts:136</c> 的 <c>meta.content</c>），不在正文里。</para>
    /// </summary>
    private static string? BuildAttachmentSummary(string? metaJson, int pastedChars)
    {
        var parts = new List<string>(2);
        var images = CountImageBlocks(metaJson);
        if (images > 0) parts.Add($"图片 ×{images}");
        if (pastedChars > 0) parts.Add($"粘贴 {pastedChars} 字");
        return parts.Count == 0 ? null : string.Join("，", parts);
    }

    private static int CountImageBlocks(string? metaJson)
    {
        if (string.IsNullOrEmpty(metaJson)) return 0;
        try
        {
            using var doc = JsonDocument.Parse(metaJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return 0;
            if (!doc.RootElement.TryGetProperty("content", out var contentEl) ||
                contentEl.ValueKind != JsonValueKind.Array)
            {
                return 0;
            }

            var count = 0;
            foreach (var block in contentEl.EnumerateArray())
            {
                if (block.ValueKind == JsonValueKind.Object &&
                    block.TryGetProperty("type", out var typeEl) &&
                    typeEl.ValueKind == JsonValueKind.String &&
                    string.Equals(typeEl.GetString(), "image", StringComparison.Ordinal))
                {
                    count++;
                }
            }
            return count;
        }
        catch
        {
            return 0;
        }
    }
}

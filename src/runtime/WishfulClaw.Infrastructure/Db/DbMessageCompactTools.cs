using System.Text.Json.Serialization.Metadata;
using System.Buffers;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Infrastructure.Db;

public static class DbMessageCompactTools
{
    public static WorkerResponse CompactSession(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var messages = db.Query(
                "SELECT * FROM messages WHERE session_id = @sid ORDER BY created_at ASC, sort_order ASC",
                EntityMappers.MapMessage,
                new SqliteParameter("@sid", sessionId));

            if (messages.Count < 6)
            {
                return WorkerResponse.Json(new MessageCompactResult(true, messages.Count, 0, null), InfrastructureJsonContext.Default.MessageCompactResult);
            }

            var cutoff = messages.Count - 6;
            var compacted = 0;
            for (var index = 0; index < cutoff; index++)
            {
                var row = messages[index];
                var compactedContent = TryCompactMessageContent(row.Content);
                if (compactedContent is null) continue;

                db.Execute(
                    "UPDATE messages SET content = @content WHERE id = @id",
                    new SqliteParameter("@content", compactedContent),
                    new SqliteParameter("@id", row.Id));
                compacted++;

            }

            return WorkerResponse.Json(new MessageCompactResult(true, messages.Count, compacted, null), InfrastructureJsonContext.Default.MessageCompactResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(new MessageCompactResult(false, 0, 0, ex.Message), InfrastructureJsonContext.Default.MessageCompactResult);
        }
    }

    public static WorkerResponse UsageStats(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            // S-193：会话可被「重置用量统计」—— 重置只写一个起点时间戳，这里据此跳过更早的消息。
            // COALESCE 兜底：会话行不存在、列为 0（从未重置）时行为与改动前完全一致。
            var messages = db.Query(
                "SELECT * FROM messages WHERE session_id = @sid AND role = 'assistant' AND usage IS NOT NULL " +
                "AND created_at > COALESCE((SELECT usage_stats_reset_at FROM sessions WHERE id = @sid), 0) " +
                "ORDER BY created_at ASC",
                EntityMappers.MapMessage,
                new SqliteParameter("@sid", sessionId));

            var stats = new UsageStatsAccumulator();
            foreach (var msg in messages)
            {
                if (string.IsNullOrWhiteSpace(msg.Usage)) continue;
                if (TryAddUsage(stats, msg.Usage))
                {
                    stats.AssistantReplies++;
                    stats.FirstCreatedAt ??= msg.CreatedAt;
                    stats.LastCreatedAt = msg.CreatedAt;
                }
            }

            // S-193：重置过的会话，即使过滤后一条消息都不剩，统计结果依然「有效」—— 结果是 0。
            // 否则调用方（dbGetSessionUsageStats）会把 null 当成「没有数据」，退到「把已加载
            // 消息的 usage 逐条相加」的兜底分支，重置看起来没生效，且重启后依旧。
            // 会话行不存在时 QueryScalar 给 default(long)=0，行为与改动前完全一致。
            var resetAt = db.QueryScalar<long>(
                "SELECT COALESCE(usage_stats_reset_at, 0) FROM sessions WHERE id = @sid",
                new SqliteParameter("@sid", sessionId));

            return WorkerResponse.Json(new MessageUsageStatsResult(
                true,
                stats.AssistantReplies > 0 || resetAt > 0,
                stats.TotalInput,
                stats.TotalOutput,
                stats.TotalCacheCreation,
                stats.TotalCacheRead,
                stats.TotalReasoning,
                stats.TotalDurationMs,
                stats.RequestCount,
                stats.AssistantReplies,
                stats.FirstCreatedAt,
                stats.LastCreatedAt,
                null), InfrastructureJsonContext.Default.MessageUsageStatsResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(new MessageUsageStatsResult(false, false, 0, 0, 0, 0, 0, 0, 0, 0, null, null, ex.Message), InfrastructureJsonContext.Default.MessageUsageStatsResult);
        }
    }

    // ─── Compaction helpers (unchanged from original) ───

    private static string? TryCompactMessageContent(string content)
    {
        try
        {
            using var document = JsonDocument.Parse(content);
            if (document.RootElement.ValueKind != JsonValueKind.Array) return null;

            var changed = false;
            var buffer = new ArrayBufferWriter<byte>();
            using (var writer = new Utf8JsonWriter(buffer))
            {
                writer.WriteStartArray();
                foreach (var block in document.RootElement.EnumerateArray())
                {
                    WriteCompactedBlock(writer, block, ref changed);
                }
                writer.WriteEndArray();
            }

            return changed ? Encoding.UTF8.GetString(buffer.WrittenSpan) : null;
        }
        catch
        {
            return null;
        }
    }

    private static void WriteCompactedBlock(Utf8JsonWriter writer, JsonElement block, ref bool changed)
    {
        if (block.ValueKind != JsonValueKind.Object)
        {
            block.WriteTo(writer);
            return;
        }

        var type = block.TryGetProperty("type", out var typeEl) && typeEl.ValueKind == JsonValueKind.String
            ? typeEl.GetString()
            : null;
        var replaceToolResult = type == "tool_result" &&
            block.TryGetProperty("content", out var contentEl) &&
            GetJsonTextLength(contentEl) > 200;
        var replaceThinking = type == "thinking";

        if (replaceToolResult || replaceThinking) changed = true;

        writer.WriteStartObject();
        foreach (var prop in block.EnumerateObject())
        {
            if (replaceToolResult && prop.NameEquals("content")) continue;
            if (replaceThinking && prop.NameEquals("thinking")) continue;
            prop.WriteTo(writer);
        }

        if (replaceToolResult)
            writer.WriteString("content", "[Context compressed \u2014 stale tool result cleared]");
        if (replaceThinking)
            writer.WriteString("thinking", "[Thinking cleared during compression]");
        writer.WriteEndObject();
    }

    private static int GetJsonTextLength(JsonElement element)
    {
        return element.ValueKind == JsonValueKind.String
            ? element.GetString()?.Length ?? 0
            : element.GetRawText().Length;
    }

    // ─── Usage parsing helpers (unchanged from original) ───

    private static bool TryAddUsage(UsageStatsAccumulator stats, string usageJson)
    {
        try
        {
            using var document = JsonDocument.Parse(usageJson);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return false;

            var inputTokens = GetDouble(root, "inputTokens");
            var cacheReadTokens = GetDouble(root, "cacheReadTokens");
            var cacheCreationTokens = GetDouble(root, "cacheCreationTokens");
            var billableInputTokens = GetDoubleNullable(root, "billableInputTokens");

            stats.TotalInput += billableInputTokens ??
                Math.Max(0, inputTokens - Math.Max(0, cacheReadTokens) - Math.Max(0, cacheCreationTokens));
            stats.TotalOutput += GetDouble(root, "outputTokens");
            stats.TotalCacheCreation += cacheCreationTokens;
            stats.TotalCacheRead += cacheReadTokens;
            stats.TotalReasoning += GetDouble(root, "reasoningTokens");
            stats.TotalDurationMs += GetDouble(root, "totalDurationMs");
            stats.RequestCount += GetRequestTimingCount(root);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static int GetRequestTimingCount(JsonElement root)
    {
        if (root.TryGetProperty("requestTimings", out var timings) && timings.ValueKind == JsonValueKind.Array)
            return timings.GetArrayLength();
        return 1;
    }

    private static double GetDouble(JsonElement obj, string name)
    {
        if (obj.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number)
            return el.GetDouble();
        return 0;
    }

    private static double? GetDoubleNullable(JsonElement obj, string name)
    {
        if (obj.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number)
            return el.GetDouble();
        return null;
    }

    private static string RequireString(JsonElement parameters, string name)
    {
        return JsonHelpers.GetString(parameters, name) is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException($"Missing required field: {name}");
    }

    private sealed class UsageStatsAccumulator
    {
        public double TotalInput { get; set; }
        public double TotalOutput { get; set; }
        public double TotalCacheCreation { get; set; }
        public double TotalCacheRead { get; set; }
        public double TotalReasoning { get; set; }
        public double TotalDurationMs { get; set; }
        public int RequestCount { get; set; }
        public int AssistantReplies { get; set; }
        public long? FirstCreatedAt { get; set; }
        public long? LastCreatedAt { get; set; }
    }
}

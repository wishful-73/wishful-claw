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
            DbCompactionSnapshotStore.MessagePosition? coveredPosition = null;
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

                // Historical content edits invalidate a snapshot covering the modified
                // position; rows are iterated oldest-first (created_at + sort_order), so
                // the first hit is deterministically the earliest.
                coveredPosition ??= new DbCompactionSnapshotStore.MessagePosition(row.CreatedAt, row.SortOrder);
            }

            if (compacted > 0)
            {
                DbCompactionSnapshotStore.InvalidateForCoveredPosition(db, sessionId, coveredPosition);
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

            var messages = db.Query(
                "SELECT * FROM messages WHERE session_id = @sid AND role = 'assistant' AND usage IS NOT NULL ORDER BY created_at ASC",
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

            return WorkerResponse.Json(new MessageUsageStatsResult(
                true,
                stats.AssistantReplies > 0,
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

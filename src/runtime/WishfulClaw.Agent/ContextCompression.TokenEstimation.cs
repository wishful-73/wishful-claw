using System;
using System.Collections.Generic;
using System.Text.Json;
using WishfulClaw.Contracts;

namespace WishfulClaw.Agent;

/// <summary>
/// Token estimation utilities for context compression.
/// </summary>
public static partial class ContextCompression
{
    // ── Token estimation (from Reasonix) ──

    internal static int EstimateMessageTokens(AgentRuntimeChatMessage message)
    {
        var total = 4;
        total += EstimateTextTokens(message.Text);
        foreach (var tu in message.ToolUses)
        {
            total += 8;
            total += EstimateTextTokens(tu.Id);
            total += EstimateTextTokens(tu.Name);
            total += EstimateTextTokens(tu.Input.GetRawText());
        }
        foreach (var tr in message.ToolResults)
        {
            total += 4;
            total += EstimateTextTokens(tr.ToolUseId);
            total += EstimateTextTokens(tr.Content.ValueKind == JsonValueKind.String
                ? tr.Content.GetString() ?? ""
                : tr.Content.GetRawText());
        }
        return total;
    }

    internal static int EstimateMessagesTokens(List<AgentRuntimeChatMessage> messages)
    {
        var total = 0;
        foreach (var m in messages)
            total += EstimateMessageTokens(m);
        return total;
    }

    internal static int EstimateTextTokens(string text)
    {
        if (string.IsNullOrEmpty(text))
            return 0;
        var byBytes = (text.Length + 3) / 4;
        return Math.Max(byBytes, text.Length);
    }

    // ── Helpers ──

    private static bool IsCompactionSummary(AgentRuntimeChatMessage message)
    {
        return message.Role == "user" &&
               !string.IsNullOrEmpty(message.Text) &&
               message.Text.AsSpan().TrimStart().StartsWith(SummaryTagOpen, StringComparison.Ordinal);
    }

    private static JsonElement CreateSummaryWireMessage(string content)
    {
        var json = $"{{\"role\":\"user\",\"content\":{JsonSerializer.Serialize(content, WorkerJsonHelper.GetTypeInfo<string>())}}}";
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    /// <summary>
    /// Builds the summary wire message with a stable id and meta.compactSummary so
    /// the chat window, the persistence snapshot and restore all reference the same
    /// artifact (contract: compression-contract.md §4.2).
    ///
    /// S-208（2026-10-20）：压缩时刻、用户消息时刻、那条消息的执行进度都以**结构化字段**
    /// 落进 meta，不让渲染端去解析正文里的快照块 —— 正文是发给模型的拼接结果，meta 才是
    /// 给人看的那层数据。渲染端沿用 <c>meta.summarizerFailed</c> 的既有模式读它们。
    /// </summary>
    internal static JsonElement CreateSummaryWireMessage(
        string id,
        string content,
        int messagesSummarized,
        bool recentMessagesPreserved,
        bool summarizerFailed,
        DateTimeOffset compactedAt,
        DateTimeOffset? latestUserSentAt,
        string? latestUserState)
    {
        var json = WorkerJsonHelper.BuildJsonString(w =>
        {
            w.WriteStartObject();
            w.WriteString("id", id);
            w.WriteString("role", "user");
            w.WriteString("content", content);
            w.WriteNumber("createdAt", compactedAt.ToUnixTimeMilliseconds());
            w.WritePropertyName("meta");
            w.WriteStartObject();
            w.WritePropertyName("compactSummary");
            w.WriteStartObject();
            w.WriteNumber("messagesSummarized", messagesSummarized);
            w.WriteBoolean("recentMessagesPreserved", recentMessagesPreserved);
            w.WriteNumber("compactedAt", compactedAt.ToUnixTimeMilliseconds());
            if (latestUserSentAt is { } sentAt)
            {
                w.WriteNumber("latestUserSentAt", sentAt.ToUnixTimeMilliseconds());
            }
            if (!string.IsNullOrEmpty(latestUserState))
            {
                w.WriteString("latestUserState", latestUserState);
            }
            if (summarizerFailed)
            {
                w.WriteBoolean("summarizerFailed", true);
            }
            w.WriteEndObject();
            w.WriteEndObject();
            w.WriteEndObject();
        });
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

}

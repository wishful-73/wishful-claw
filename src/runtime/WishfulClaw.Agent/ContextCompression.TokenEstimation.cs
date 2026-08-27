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
    /// </summary>
    internal static JsonElement CreateSummaryWireMessage(
        string id,
        string content,
        int messagesSummarized,
        bool recentMessagesPreserved)
    {
        var json = WorkerJsonHelper.BuildJsonString(w =>
        {
            w.WriteStartObject();
            w.WriteString("id", id);
            w.WriteString("role", "user");
            w.WriteString("content", content);
            w.WriteNumber("createdAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            w.WritePropertyName("meta");
            w.WriteStartObject();
            w.WritePropertyName("compactSummary");
            w.WriteStartObject();
            w.WriteNumber("messagesSummarized", messagesSummarized);
            w.WriteBoolean("recentMessagesPreserved", recentMessagesPreserved);
            w.WriteEndObject();
            w.WriteEndObject();
            w.WriteEndObject();
        });
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

}

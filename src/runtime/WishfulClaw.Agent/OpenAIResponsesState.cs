/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Diagnostics;
using System.Text;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// State and helper methods for the OpenAI Responses API provider.
/// Ported from OpenCowork AgentRuntimeOpenAIResponsesState.cs (simplified —
/// no WebSocket, ComputerUse, ImageGeneration, PromptCache, or previous_response_id).
/// </summary>
internal static partial class OpenAIResponsesProvider
{
    private static string ToolResultToString(JsonElement content)
    {
        return content.ValueKind == JsonValueKind.String
            ? content.GetString() ?? string.Empty
            : content.GetRawText();
    }

    private static bool TryParseJsonObject(string value, out JsonElement element)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            element = CreateEmptyObjectElement();
            return false;
        }
        try
        {
            using var document = JsonDocument.Parse(value);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                element = CreateEmptyObjectElement();
                return false;
            }
            element = document.RootElement.Clone();
            return true;
        }
        catch (JsonException)
        {
            element = CreateEmptyObjectElement();
            return false;
        }
    }

    private static JsonElement CreateEmptyObjectElement()
    {
        using var document = JsonDocument.Parse("{}");
        return document.RootElement.Clone();
    }

    private static string BuildToolCallKey(AgentRuntimeNativeToolCall call)
    {
        return $"{call.Id}:{call.Name}:{call.Input.GetRawText()}";
    }

    private static int ReadInt(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty(propertyName, out var property))
        {
            return 0;
        }
        if (property.ValueKind == JsonValueKind.Number &&
            property.TryGetInt64(out var longValue))
        {
            return longValue > int.MaxValue ? int.MaxValue : (int)Math.Max(0, longValue);
        }
        if (property.ValueKind == JsonValueKind.String &&
            long.TryParse(property.GetString(), out longValue))
        {
            return longValue > int.MaxValue ? int.MaxValue : (int)Math.Max(0, longValue);
        }
        return 0;
    }

    private static void MarkFirstToken(ResponsesParseState parseState, long startedAt)
    {
        parseState.FirstTokenMs ??= ElapsedMs(startedAt);
    }

    private static int EstimateTokenCount(string text)
    {
        return string.IsNullOrWhiteSpace(text) ? 0 : Math.Max(1, text.Length / 4);
    }

    private static long ElapsedMs(long startedAt)
    {
        return (long)Math.Round(Stopwatch.GetElapsedTime(startedAt).TotalMilliseconds);
    }

    private static double? ComputeTps(int outputTokens, long? firstTokenMs, long completedMs)
    {
        if (!firstTokenMs.HasValue || outputTokens <= 0)
        {
            return null;
        }
        var durationMs = completedMs - firstTokenMs.Value;
        return durationMs <= 0 ? null : outputTokens / (durationMs / 1000.0);
    }

    private static Task EmitProjectedEventAsync(
        ResponsesParseState parseState,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        AgentRuntimeStreamEvent streamEvent)
    {
        parseState.ProjectedAnyOutput = true;
        return AgentRuntimeTools.EmitAsync(state, context, streamEvent);
    }

    /// <summary>
    /// Per-request parse state accumulated while streaming Responses API events.
    /// </summary>
    private sealed class ResponsesParseState
    {
        public StringBuilder AssistantText { get; } = new();
        public List<AgentRuntimeNativeToolCall> ToolCalls { get; } = new();
        public Dictionary<string, ResponsesToolBuffer> ToolBuffers { get; } = new(StringComparer.Ordinal);
        public Dictionary<string, string> CallIdAliases { get; } = new(StringComparer.Ordinal);
        public HashSet<string> EmittedToolCallKeys { get; } = new(StringComparer.Ordinal);
        public bool EmittedThinkingDelta { get; set; }
        /// <summary>Segment boundary tracker for text / thinking blocks (S-142).</summary>
        public StreamSegmentBoundary Boundaries { get; } = new();
        public bool ReceivedAnyMessage { get; set; }
        public bool ProjectedAnyOutput { get; set; }
        public long? FirstTokenMs { get; set; }
        public int EstimatedOutputTokens { get; set; }
        public AgentRuntimeTokenUsage? Usage { get; set; }
        public string StopReason { get; set; } = "completed";
        public string? ProviderResponseId { get; set; }
    }

    /// <summary>
    /// Buffer for streaming function call arguments.
    /// </summary>
    private sealed class ResponsesToolBuffer(string callId, string name)
    {
        public string CallId { get; } = callId;
        public string Name { get; set; } = name;
        public StringBuilder Arguments { get; } = new();
    }
}

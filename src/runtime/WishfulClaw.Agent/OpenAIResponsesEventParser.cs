/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// SSE event parser for the OpenAI Responses API provider.
/// Ported from OpenCowork AgentRuntimeOpenAIResponsesEventParser.cs (simplified —
/// no computer_use, image_generation, web_search, or encrypted reasoning).
/// </summary>
internal static partial class OpenAIResponsesProvider
{
    private static async Task<bool> ProcessJsonEventAsync(
        string? eventName,
        string data,
        ResponsesParseState parseState,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        long startedAt)
    {
        using var document = JsonDocument.Parse(data);
        var root = document.RootElement;
        var type = eventName;
        if (string.IsNullOrWhiteSpace(type))
        {
            type = JsonHelpers.GetString(root, "type");
        }
        if (string.IsNullOrWhiteSpace(type))
        {
            return false;
        }

        switch (type)
        {
            case "response.output_text.delta":
                if (JsonHelpers.GetString(root, "delta") is { Length: > 0 } delta)
                {
                    MarkFirstToken(parseState, startedAt);
                    parseState.AssistantText.Append(delta);
                    parseState.EstimatedOutputTokens += EstimateTokenCount(delta);
                    // S-142: boundary before the first delta of a text block.
                    await StreamSegmentBoundary.EmitAsync(
                        state, context,
                        parseState.Boundaries.BeforeDelta(StreamSegmentBoundary.TextKind));
                    await EmitProjectedEventAsync(
                        parseState, state, context,
                        new AgentRuntimeStreamEvent("text_delta", Text: delta));
                }
                break;

            case "response.reasoning_summary_text.delta":
            case "response.reasoning_summary_text.done":
                if ((JsonHelpers.GetString(root, "delta") ?? JsonHelpers.GetString(root, "text")) is { Length: > 0 } thinking)
                {
                    MarkFirstToken(parseState, startedAt);
                    parseState.EmittedThinkingDelta = true;
                    // S-142: boundary before the first delta of a thinking block.
                    await StreamSegmentBoundary.EmitAsync(
                        state, context,
                        parseState.Boundaries.BeforeDelta(StreamSegmentBoundary.ThinkingKind));
                    await EmitProjectedEventAsync(
                        parseState, state, context,
                        new AgentRuntimeStreamEvent("thinking_delta", Thinking: thinking));
                }
                break;

            case "response.output_item.added":
                if (root.TryGetProperty("item", out var addedItem))
                {
                    await ProcessOutputItemAddedAsync(addedItem, parseState, state, context);
                }
                break;

            case "response.function_call_arguments.delta":
                await ProcessFunctionArgumentsDeltaAsync(root, parseState, state, context);
                break;

            case "response.function_call_arguments.done":
                FinalizeFunctionCall(root, parseState);
                break;

            case "response.output_item.done":
                if (root.TryGetProperty("item", out var doneItem))
                {
                    await ProcessOutputItemDoneAsync(doneItem, parseState, state, context, startedAt);
                }
                break;

            case "response.completed":
            case "response.done":
                var finalResponse = root.TryGetProperty("response", out var response)
                    ? response
                    : root;
                if (finalResponse.ValueKind == JsonValueKind.Object)
                {
                    parseState.ProviderResponseId = JsonHelpers.GetString(finalResponse, "id") ?? parseState.ProviderResponseId;
                    parseState.StopReason = JsonHelpers.GetString(finalResponse, "status") ?? parseState.StopReason;
                    if (TryGetFinalResponseUsage(root, finalResponse, out var usage))
                    {
                        parseState.Usage = ReadResponsesUsage(usage);
                    }
                    WorkerLog.Debug(
                        $"responses final event type={type} hasUsage={parseState.Usage is not null} " +
                        $"providerResponseId={parseState.ProviderResponseId ?? string.Empty}");
                    if (finalResponse.TryGetProperty("output", out var output) &&
                        output.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in output.EnumerateArray())
                        {
                            await ProcessOutputItemDoneAsync(item, parseState, state, context, startedAt);
                        }
                    }
                }
                return true;

            case "response.failed":
            case "error":
                throw new InvalidOperationException($"OpenAI Responses stream error: {root.GetRawText()}");
        }

        return false;
    }

    private static async Task ProcessOutputItemAddedAsync(
        JsonElement item,
        ResponsesParseState parseState,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        var itemType = JsonHelpers.GetString(item, "type");
        if (itemType != "function_call")
        {
            return;
        }

        var itemId = JsonHelpers.GetString(item, "id");
        var callId = JsonHelpers.GetString(item, "call_id") ?? itemId;
        var name = JsonHelpers.GetString(item, "name") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(callId) || string.IsNullOrWhiteSpace(name))
        {
            return;
        }
        if (!string.IsNullOrWhiteSpace(itemId))
        {
            parseState.CallIdAliases[itemId] = callId;
        }
        if (!parseState.ToolBuffers.ContainsKey(callId))
        {
            parseState.ToolBuffers[callId] = new ResponsesToolBuffer(callId, name);
        }

        await EmitProjectedEventAsync(
            parseState, state, context,
            new AgentRuntimeStreamEvent(
                "tool_use_streaming_start",
                ToolCallId: callId,
                ToolName: name));
    }

    private static async Task ProcessFunctionArgumentsDeltaAsync(
        JsonElement root,
        ResponsesParseState parseState,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        var callId = ResolveCallId(root, parseState);
        if (string.IsNullOrWhiteSpace(callId))
        {
            return;
        }
        if (!parseState.ToolBuffers.TryGetValue(callId, out var buffer))
        {
            buffer = new ResponsesToolBuffer(callId, JsonHelpers.GetString(root, "name") ?? string.Empty);
            parseState.ToolBuffers[callId] = buffer;
        }

        if (JsonHelpers.GetString(root, "delta") is { } delta)
        {
            buffer.Arguments.Append(delta);
        }
    }

    private static async Task ProcessOutputItemDoneAsync(
        JsonElement item,
        ResponsesParseState parseState,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        long startedAt)
    {
        var itemType = JsonHelpers.GetString(item, "type");
        if (itemType != "function_call")
        {
            return;
        }

        var callId = JsonHelpers.GetString(item, "call_id") ?? JsonHelpers.GetString(item, "id");
        if (string.IsNullOrWhiteSpace(callId))
        {
            return;
        }

        // If the arguments were streamed, finalize from buffer.
        if (parseState.ToolBuffers.TryGetValue(callId, out var buffer))
        {
            FinalizeToolBuffer(buffer, parseState);
        }
        else
        {
            // Arguments arrived complete in the output_item.done event.
            var name = JsonHelpers.GetString(item, "name") ?? string.Empty;
            var arguments = JsonHelpers.GetString(item, "arguments") ?? "{}";
            if (TryParseJsonObject(arguments, out var input))
            {
                AddToolCall(callId, name, input, parseState, state, context);
            }
        }
    }

    private static void FinalizeFunctionCall(JsonElement root, ResponsesParseState parseState)
    {
        var callId = ResolveCallId(root, parseState);
        if (string.IsNullOrWhiteSpace(callId) ||
            !parseState.ToolBuffers.TryGetValue(callId, out var buffer))
        {
            return;
        }
        FinalizeToolBuffer(buffer, parseState);
    }

    private static void FinalizeToolBuffer(
        ResponsesToolBuffer buffer,
        ResponsesParseState parseState)
    {
        var arguments = buffer.Arguments.ToString();
        if (string.IsNullOrWhiteSpace(arguments))
        {
            arguments = "{}";
        }
        if (TryParseJsonObject(arguments, out var input) &&
            !parseState.EmittedToolCallKeys.Contains(BuildToolCallKey(
                new AgentRuntimeNativeToolCall(buffer.CallId, buffer.Name, input))))
        {
            parseState.ToolCalls.Add(new AgentRuntimeNativeToolCall(buffer.CallId, buffer.Name, input));
            parseState.EmittedToolCallKeys.Add($"{buffer.CallId}:{buffer.Name}:{input.GetRawText()}");
        }
        parseState.ToolBuffers.Remove(buffer.CallId);
    }

    private static void AddToolCall(
        string callId,
        string name,
        JsonElement input,
        ResponsesParseState parseState,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        var key = $"{callId}:{name}:{input.GetRawText()}";
        if (parseState.EmittedToolCallKeys.Contains(key))
        {
            return;
        }
        parseState.EmittedToolCallKeys.Add(key);
        parseState.ToolCalls.Add(new AgentRuntimeNativeToolCall(callId, name, input));
    }

    private static void FlushPendingToolCalls(ResponsesParseState parseState)
    {
        foreach (var (callId, buffer) in parseState.ToolBuffers)
        {
            var arguments = buffer.Arguments.ToString();
            if (string.IsNullOrWhiteSpace(arguments))
            {
                arguments = "{}";
            }
            if (TryParseJsonObject(arguments, out var input))
            {
                parseState.ToolCalls.Add(new AgentRuntimeNativeToolCall(callId, buffer.Name, input));
            }
        }
        parseState.ToolBuffers.Clear();
    }

    // ── Usage parsing ──

    private static AgentRuntimeTokenUsage ReadResponsesUsage(JsonElement usage)
    {
        var inputTokens = ReadInt(usage, "input_tokens");
        var outputTokens = ReadInt(usage, "output_tokens");
        var cachedTokens = ReadResponsesCacheReadTokens(usage);
        var cacheWriteTokens = ReadResponsesCacheWriteTokens(usage);
        var reasoningTokens = ReadResponsesReasoningTokens(usage);
        var billableInputTokens = inputTokens > 0 && (cachedTokens > 0 || cacheWriteTokens > 0)
            ? Math.Max(0, inputTokens - cachedTokens - cacheWriteTokens)
            : (int?)null;
        var cacheReadRatio = cachedTokens > 0 && inputTokens > 0
            ? (double)cachedTokens / inputTokens
            : (double?)null;
        return new AgentRuntimeTokenUsage(
            inputTokens,
            outputTokens,
            billableInputTokens,
            cachedTokens > 0 ? cachedTokens : null,
            reasoningTokens > 0 ? reasoningTokens : null,
            inputTokens,
            CacheCreationTokens: cacheWriteTokens > 0 ? cacheWriteTokens : null,
            CacheReadRatio: cacheReadRatio);
    }

    private static bool TryGetFinalResponseUsage(
        JsonElement root,
        JsonElement finalResponse,
        out JsonElement usage)
    {
        if (finalResponse.ValueKind == JsonValueKind.Object &&
            finalResponse.TryGetProperty("usage", out usage) &&
            usage.ValueKind == JsonValueKind.Object)
        {
            return true;
        }
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("usage", out usage) &&
            usage.ValueKind == JsonValueKind.Object)
        {
            return true;
        }
        usage = default;
        return false;
    }

    private static int ReadResponsesCacheReadTokens(JsonElement usage)
    {
        var cachedTokens = ReadFirstPositiveInt(
            usage, "cached_tokens", "cache_read_tokens", "cache_read_input_tokens", "cached_input_tokens");
        if (cachedTokens > 0)
        {
            return cachedTokens;
        }
        foreach (var detailsName in new[] { "input_tokens_details", "prompt_tokens_details" })
        {
            if (usage.TryGetProperty(detailsName, out var details))
            {
                cachedTokens = ReadFirstPositiveInt(
                    details, "cached_tokens", "cache_read_tokens", "cache_read_input_tokens", "cached_input_tokens");
                if (cachedTokens > 0)
                {
                    return cachedTokens;
                }
            }
        }
        return 0;
    }

    private static int ReadResponsesCacheWriteTokens(JsonElement usage)
    {
        var cacheWriteTokens = ReadFirstPositiveInt(
            usage, "cache_write_tokens", "cache_write_input_tokens", "cache_creation_tokens", "cache_creation_input_tokens");
        if (cacheWriteTokens > 0)
        {
            return cacheWriteTokens;
        }
        foreach (var detailsName in new[] { "input_tokens_details", "prompt_tokens_details" })
        {
            if (usage.TryGetProperty(detailsName, out var details))
            {
                cacheWriteTokens = ReadFirstPositiveInt(
                    details, "cache_write_tokens", "cache_write_input_tokens", "cache_creation_tokens", "cache_creation_input_tokens");
                if (cacheWriteTokens > 0)
                {
                    return cacheWriteTokens;
                }
            }
        }
        return 0;
    }

    private static int ReadResponsesReasoningTokens(JsonElement usage)
    {
        var reasoningTokens = ReadFirstPositiveInt(usage, "reasoning_tokens");
        if (reasoningTokens > 0)
        {
            return reasoningTokens;
        }
        foreach (var detailsName in new[] { "output_tokens_details", "completion_tokens_details" })
        {
            if (usage.TryGetProperty(detailsName, out var details))
            {
                reasoningTokens = ReadFirstPositiveInt(details, "reasoning_tokens");
                if (reasoningTokens > 0)
                {
                    return reasoningTokens;
                }
            }
        }
        return 0;
    }

    private static int ReadFirstPositiveInt(JsonElement element, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            var value = ReadInt(element, propertyName);
            if (value > 0)
            {
                return value;
            }
        }
        return 0;
    }

    private static string? ResolveCallId(JsonElement payload, ResponsesParseState parseState)
    {
        var callId = JsonHelpers.GetString(payload, "call_id");
        if (!string.IsNullOrWhiteSpace(callId))
        {
            return callId;
        }
        var itemId = JsonHelpers.GetString(payload, "item_id") ?? JsonHelpers.GetString(payload, "id");
        if (!string.IsNullOrWhiteSpace(itemId) &&
            parseState.CallIdAliases.TryGetValue(itemId, out var alias))
        {
            return alias;
        }
        return itemId;
    }
}

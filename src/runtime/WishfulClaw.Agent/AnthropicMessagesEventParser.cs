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
/// Anthropic SSE event parser.
/// Handles: content_block_start, content_block_delta, content_block_stop,
/// message_delta, message_stop, error.
/// </summary>
internal static partial class AnthropicMessagesProvider
{
    private static async Task ProcessJsonEventAsync(
        string? eventName,
        string data,
        AnthropicParseState parseState,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        long startedAt)
    {
        using var document = JsonDocument.Parse(data);
        var root = document.RootElement;
        var type = string.IsNullOrWhiteSpace(eventName)
            ? JsonHelpers.GetString(root, "type")
            : eventName;
        if (string.IsNullOrWhiteSpace(type))
        {
            return;
        }

        // Merge usage from message or usage fields
        if (root.TryGetProperty("message", out var message) &&
            message.TryGetProperty("usage", out var messageUsage))
        {
            parseState.Usage = MergeUsage(parseState.Usage, messageUsage);
        }
        if (root.TryGetProperty("usage", out var usage))
        {
            parseState.Usage = MergeUsage(parseState.Usage, usage);
        }

        switch (type)
        {
            case "content_block_start":
                await ProcessContentBlockStartAsync(root, parseState, state, context);
                break;

            case "content_block_delta":
                await ProcessContentBlockDeltaAsync(root, parseState, state, context, startedAt);
                break;

            case "content_block_stop":
                await ProcessContentBlockStopAsync(root, parseState, state, context);
                break;

            case "message_delta":
                if (root.TryGetProperty("delta", out var delta))
                {
                    parseState.StopReason = JsonHelpers.GetString(delta, "stop_reason") ?? parseState.StopReason;
                }
                break;

            case "message_stop":
                parseState.StopReason = JsonHelpers.GetString(root, "stop_reason") ?? parseState.StopReason;
                break;

            case "error":
                throw new InvalidOperationException($"Anthropic Messages stream error: {root.GetRawText()}");
        }
    }

    private static async Task ProcessContentBlockStartAsync(
        JsonElement root,
        AnthropicParseState parseState,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        var index = JsonHelpers.GetInt(root, "index", -1);
        if (index < 0 ||
            !root.TryGetProperty("content_block", out var block) ||
            block.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        var blockType = JsonHelpers.GetString(block, "type");
        if (blockType == "tool_use")
        {
            var id = JsonHelpers.GetString(block, "id") ?? $"toolu_{index}";
            var name = JsonHelpers.GetString(block, "name") ?? string.Empty;
            parseState.ToolBuffers[index] = new AnthropicToolBuffer(id, name);
            // PV-2: awaited like every other emit — fire-and-forget broke event
            // ordering and swallowed exceptions.
            await AgentRuntimeTools.EmitAsync(
                state, context,
                new AgentRuntimeStreamEvent(
                    "tool_use_streaming_start",
                    ToolCallId: id,
                    ToolName: name));
        }
    }

    private static async Task ProcessContentBlockDeltaAsync(
        JsonElement root,
        AnthropicParseState parseState,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        long startedAt)
    {
        var index = JsonHelpers.GetInt(root, "index", -1);
        if (!root.TryGetProperty("delta", out var delta) ||
            delta.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        MarkFirstToken(parseState, startedAt);
        var deltaType = JsonHelpers.GetString(delta, "type");

        if (deltaType == "text_delta")
        {
            var text = JsonHelpers.GetString(delta, "text") ?? string.Empty;
            if (text.Length == 0) return;
            parseState.AssistantText.Append(text);
            parseState.EstimatedOutputTokens += AgentLoop.EstimateTokenCount(text);
            await AgentRuntimeTools.EmitAsync(
                state, context,
                new AgentRuntimeStreamEvent("text_delta", Text: text));
            return;
        }

        if (deltaType == "thinking_delta")
        {
            var thinking = JsonHelpers.GetString(delta, "thinking") ?? string.Empty;
            if (thinking.Length > 0)
            {
                await AgentRuntimeTools.EmitAsync(
                    state, context,
                    new AgentRuntimeStreamEvent("thinking_delta", Thinking: thinking));
            }
            return;
        }

        if (deltaType == "input_json_delta" && index >= 0)
        {
            if (!parseState.ToolBuffers.TryGetValue(index, out var buffer))
            {
                buffer = new AnthropicToolBuffer($"toolu_{index}", string.Empty);
                parseState.ToolBuffers[index] = buffer;
            }
            if (JsonHelpers.GetString(delta, "partial_json") is { } partialJson)
            {
                buffer.Arguments.Append(partialJson);
                await AgentRuntimeTools.EmitAsync(
                    state, context,
                    new AgentRuntimeStreamEvent(
                        "tool_use_args_delta",
                        ToolCallId: buffer.Id,
                        PartialInput: JsonSerializer.SerializeToElement(partialJson, WorkerJsonHelper.GetTypeInfo<string>())));
            }
        }
    }

    private static async Task ProcessContentBlockStopAsync(
        JsonElement root,
        AnthropicParseState parseState,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        var index = JsonHelpers.GetInt(root, "index", -1);
        if (index < 0 || !parseState.ToolBuffers.TryGetValue(index, out var buffer))
        {
            return;
        }
        var input = AgentLoop.TryParseJsonObject(buffer.Arguments.ToString(), out var parsed)
            ? parsed
            : AgentRuntimeProviderSupport.CreateEmptyObjectElement();
        parseState.ToolCalls.Add(new AgentRuntimeNativeToolCall(buffer.Id, buffer.Name, input));
        parseState.ToolBuffers.Remove(index);
        await AgentRuntimeTools.EmitAsync(
            state, context,
            new AgentRuntimeStreamEvent(
                "tool_use_generated",
                ToolCallId: buffer.Id,
                ToolUseBlock: new AgentRuntimeToolUseBlock(buffer.Id, buffer.Name, input)));
    }

    private static async Task FlushPendingToolCallsAsync(
        AnthropicParseState parseState,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        foreach (var item in parseState.ToolBuffers.ToArray())
        {
            var buffer = item.Value;
            var input = AgentLoop.TryParseJsonObject(buffer.Arguments.ToString(), out var parsed)
                ? parsed
                : AgentRuntimeProviderSupport.CreateEmptyObjectElement();
            parseState.ToolCalls.Add(new AgentRuntimeNativeToolCall(buffer.Id, buffer.Name, input));
            parseState.ToolBuffers.Remove(item.Key);
            await AgentRuntimeTools.EmitAsync(
                state, context,
                new AgentRuntimeStreamEvent(
                    "tool_use_generated",
                    ToolCallId: buffer.Id,
                    ToolUseBlock: new AgentRuntimeToolUseBlock(buffer.Id, buffer.Name, input)));
        }
    }

    // ── Usage merging ──

    private static AgentRuntimeTokenUsage MergeUsage(AgentRuntimeTokenUsage? current, JsonElement usage)
    {
        var uncachedInputTokens = AgentLoop.ReadInt(usage, "input_tokens");
        var outputTokens = AgentLoop.ReadInt(usage, "output_tokens");
        var cacheReadTokens = AgentLoop.ReadInt(usage, "cache_read_input_tokens");
        if (cacheReadTokens == 0 && usage.TryGetProperty("input_tokens_details", out var inputDetails))
        {
            cacheReadTokens = AgentLoop.ReadInt(inputDetails, "cached_tokens");
        }

        var cacheCreation5m = AgentLoop.ReadInt(usage, "cache_creation_5m_input_tokens");
        var cacheCreation1h = AgentLoop.ReadInt(usage, "cache_creation_1h_input_tokens");
        var cacheCreationTokens = AgentLoop.ReadInt(usage, "cache_creation_input_tokens");
        if (usage.TryGetProperty("cache_creation", out var cacheCreation) &&
            cacheCreation.ValueKind == JsonValueKind.Object)
        {
            cacheCreation5m = Math.Max(cacheCreation5m, AgentLoop.ReadInt(cacheCreation, "ephemeral_5m_input_tokens"));
            cacheCreation1h = Math.Max(cacheCreation1h, AgentLoop.ReadInt(cacheCreation, "ephemeral_1h_input_tokens"));
        }
        if (cacheCreationTokens == 0)
        {
            cacheCreationTokens = cacheCreation5m + cacheCreation1h;
        }

        var cachedInputTokens = cacheReadTokens + cacheCreationTokens;
        var inputTokens = uncachedInputTokens > 0 || cachedInputTokens > 0
            ? uncachedInputTokens + cachedInputTokens
            : current?.InputTokens ?? 0;
        var reasoningTokens = AgentLoop.ReadInt(usage, "reasoning_tokens");
        if (reasoningTokens == 0 && usage.TryGetProperty("output_tokens_details", out var outputDetails))
        {
            reasoningTokens = AgentLoop.ReadInt(outputDetails, "reasoning_tokens");
        }
        var effectiveOutputTokens = outputTokens > 0 ? outputTokens : current?.OutputTokens ?? 0;
        var effectiveCacheRead = cacheReadTokens > 0 ? cacheReadTokens : current?.CacheReadTokens;
        var effectiveCacheCreation = cacheCreationTokens > 0 ? cacheCreationTokens : current?.CacheCreationTokens;
        var cacheReadRatio = inputTokens > 0 && effectiveCacheRead.HasValue
            ? effectiveCacheRead.Value / (double)inputTokens
            : current?.CacheReadRatio;

        return new AgentRuntimeTokenUsage(
            inputTokens,
            effectiveOutputTokens,
            cachedInputTokens > 0 ? uncachedInputTokens : current?.BillableInputTokens,
            effectiveCacheRead,
            reasoningTokens > 0 ? reasoningTokens : current?.ReasoningTokens,
            inputTokens > 0 ? inputTokens : current?.ContextTokens,
            effectiveCacheCreation,
            cacheCreation5m > 0 ? cacheCreation5m : current?.CacheCreation5mTokens,
            cacheCreation1h > 0 ? cacheCreation1h : current?.CacheCreation1hTokens,
            cacheReadRatio);
    }

    private static void MarkFirstToken(AnthropicParseState parseState, long startedAt)
    {
        parseState.FirstTokenMs ??= AgentLoop.ElapsedMs(startedAt);
    }
}

using System.Buffers;
using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// HTTP send and SSE stream reading: provider stream reader, SSE line parsing, delta processing, upstream failure detection. Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
internal static partial class OpenAIChatProvider
{
    // ── HTTP send + SSE stream reading ──

    private static async Task ReadProviderStreamAsync(
        HttpRequestMessage request,
        JsonElement provider,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        Dictionary<int, ToolCallBuffer> toolBuffers,
        List<AgentRuntimeNativeToolCall> toolCalls,
        StringBuilder assistantText,
        StringBuilder reasoningContent,
        List<ReasoningDetailAccumulator> reasoningDetails,
        StreamSegmentBoundary boundary,
        long startedAt,
        Action<long> markFirstTokenMs,
        Action<int> addEstimatedOutputTokens,
        Action<AgentRuntimeTokenUsage> setUsage,
        Action<string> setStopReason,
        Action<string> setNativeStopReason)
    {
        using var response = await AgentRuntimeRequestTimeout.SendAsync(
            Http, request, provider, "OpenAI Chat", state.CancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw await ProviderHttpException.CreateAsync(
                "OpenAI-compatible chat",
                response,
                state.CancellationToken);
        }

        await using var responseStream = await response.Content.ReadAsStreamAsync(state.CancellationToken);
        using var reader = new StreamReader(responseStream, System.Text.Encoding.UTF8);
        var dataBuilder = new StringBuilder();
        var rawResponseBuilder = new StringBuilder();
        var sawSsePayload = false;
        string? line;

        while ((line = await AgentRuntimeRequestTimeout.ReadLineAsync(
            reader, provider, "OpenAI Chat", state.CancellationToken)) is not null)
        {
            if (state.CancellationToken.IsCancellationRequested)
            {
                break;
            }

            if (line.Length == 0)
            {
                if (dataBuilder.Length > 0)
                {
                    var shouldStop = await ProcessSseDataAsync(
                        dataBuilder.ToString(),
                        toolBuffers, toolCalls, assistantText, reasoningContent, reasoningDetails,
                        state, context, boundary, startedAt,
                        markFirstTokenMs, addEstimatedOutputTokens, setUsage, setStopReason,
                        setNativeStopReason);
                    dataBuilder.Clear();
                    sawSsePayload = true;
                    if (shouldStop) break;
                }
                continue;
            }

            if (line.StartsWith("data:", StringComparison.Ordinal))
            {
                var payload = line[5..].TrimStart();
                if (dataBuilder.Length > 0) dataBuilder.Append('\n');
                dataBuilder.Append(payload);
                sawSsePayload = true;
                continue;
            }

            if (!sawSsePayload && !line.StartsWith("event:", StringComparison.Ordinal))
            {
                if (rawResponseBuilder.Length > 0) rawResponseBuilder.Append('\n');
                rawResponseBuilder.Append(line);
            }
        }

        if (dataBuilder.Length > 0)
        {
            await ProcessSseDataAsync(
                dataBuilder.ToString(),
                toolBuffers, toolCalls, assistantText, reasoningContent, reasoningDetails,
                state, context, boundary, startedAt,
                markFirstTokenMs, addEstimatedOutputTokens, setUsage, setStopReason,
                setNativeStopReason);
        }
        else if (!sawSsePayload && rawResponseBuilder.Length > 0)
        {
            await ProcessJsonResponseAsync(
                rawResponseBuilder.ToString(),
                toolCalls, assistantText, reasoningContent, reasoningDetails,
                state, context, boundary, startedAt,
                markFirstTokenMs, addEstimatedOutputTokens, setUsage, setStopReason);
        }

        await FlushRemainingToolBuffersAsync(toolBuffers, toolCalls, state, context);
    }

    // ── SSE processing ──

    private static JsonDocument? TryParseSseJson(string data)
    {
        try
        {
            return JsonDocument.Parse(data);
        }
        catch (JsonException ex)
        {
            WorkerLog.Warn($"openai-chat skipping malformed SSE line: {ex.Message}");
            return null;
        }
    }

    private static async Task<bool> ProcessSseDataAsync(
        string data,
        Dictionary<int, ToolCallBuffer> toolBuffers,
        List<AgentRuntimeNativeToolCall> completedToolCalls,
        StringBuilder assistantText,
        StringBuilder reasoningContent,
        List<ReasoningDetailAccumulator> reasoningDetails,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        StreamSegmentBoundary boundary,
        long startedAt,
        Action<long> markFirstTokenMs,
        Action<int> addEstimatedOutputTokens,
        Action<AgentRuntimeTokenUsage> setUsage,
        Action<string> setStopReason,
        Action<string> setNativeStopReason)
    {
        if (data == "[DONE]")
        {
            return true;
        }

        // Malformed SSE payloads (proxy error pages, truncated lines) must not
        // kill the whole turn — skip the line and keep streaming.
        using var document = TryParseSseJson(data);
        if (document is null) return false;
        var root = document.RootElement;

        if (root.TryGetProperty("usage", out var usageElement) &&
            TryReadUsage(usageElement, out var usage))
        {
            setUsage(usage);
        }

        var choice = TryGetFirstChoice(root);
        if (!choice.HasValue) return false;

        var choiceValue = choice.Value;
        if (choiceValue.TryGetProperty("delta", out var delta))
        {
            AppendReasoningDetails(delta, reasoningDetails);
            var reasoning = AgentLoop.ReadString(delta, "reasoning_content") ??
                AgentLoop.ReadString(delta, "reasoning");
            if (!string.IsNullOrEmpty(reasoning))
            {
                reasoningContent.Append(reasoning);
                markFirstTokenMs(AgentLoop.ElapsedMs(startedAt));
                // S-142: boundary before the first delta of a thinking block.
                await StreamSegmentBoundary.EmitAsync(
                    state, context,
                    boundary.BeforeDelta(StreamSegmentBoundary.ThinkingKind));
                await AgentRuntimeTools.EmitAsync(
                    state, context,
                    new AgentRuntimeStreamEvent("thinking_delta", Thinking: reasoning));
            }

            var text = AgentLoop.ReadString(delta, "content");
            if (!string.IsNullOrEmpty(text))
            {
                markFirstTokenMs(AgentLoop.ElapsedMs(startedAt));
                addEstimatedOutputTokens(AgentLoop.EstimateTokenCount(text));
                assistantText.Append(text);
                // S-142: boundary before the first delta of a text block.
                await StreamSegmentBoundary.EmitAsync(
                    state, context,
                    boundary.BeforeDelta(StreamSegmentBoundary.TextKind));
                await AgentRuntimeTools.EmitAsync(
                    state, context,
                    new AgentRuntimeStreamEvent("text_delta", Text: text));
            }

            if (delta.TryGetProperty("tool_calls", out var toolCallsElement) &&
                toolCallsElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var fragment in toolCallsElement.EnumerateArray())
                {
                    await ProcessToolCallFragmentAsync(fragment, toolBuffers, state, context);
                }
            }
        }

        var finishReason = AgentLoop.ReadString(choiceValue, "finish_reason");
        if (string.IsNullOrEmpty(finishReason)) return false;

        setStopReason(finishReason);

        // OpenRouter appends native_finish_reason when the upstream provider's
        // real finish differs (e.g. stop masking a network_error).
        if (AgentLoop.ReadString(choiceValue, "native_finish_reason") is { Length: > 0 } nativeReason)
        {
            setNativeStopReason(nativeReason);
        }

        // Flush tool buffers for tool_calls/function_call finish reasons.
        if (finishReason is "tool_calls" or "function_call")
        {
            await FlushRemainingToolBuffersAsync(toolBuffers, completedToolCalls, state, context);
        }
        else if (toolBuffers.Count > 0)
        {
            await FlushRemainingToolBuffersAsync(toolBuffers, completedToolCalls, state, context);
        }

        // Do NOT return true for ANY finish_reason — the usage chunk
        // (choices:[] + usage) typically arrives AFTER the finish_reason chunk
        // when stream_options.include_usage is enabled. This applies to ALL
        // finish reasons: stop, length, content_filter, tool_calls, function_call.
        // Returning true would break the outer loop and miss the usage data.
        // Only [DONE] returns true; finish_reason just sets the stop reason.
        return false;
    }

    /// <summary>
    /// True when OpenRouter's native_finish_reason signals an upstream failure
    /// that was masked by a benign finish_reason (e.g. stop over network_error).
    /// </summary>
    private static bool IsUpstreamFailureReason(string? nativeFinishReason, string finishReason)
    {
        if (string.IsNullOrEmpty(nativeFinishReason))
        {
            return false;
        }
        return !nativeFinishReason.Equals(finishReason, StringComparison.OrdinalIgnoreCase) &&
            nativeFinishReason is not ("stop" or "length" or "tool_calls" or "function_call" or "content_filter");
    }
}

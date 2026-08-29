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
/// OpenAI-compatible chat provider (openai-chat protocol).
/// SSE streaming, reasoning_content support, tool call parsing.
/// </summary>
internal static partial class OpenAIChatProvider
{
    private static readonly HttpClient Http = WishfulClaw.Infrastructure.Http.WorkerHttpClientFactory.Create(
        timeout: Timeout.InfiniteTimeSpan,
        allowAutoRedirect: false);

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static async Task<AgentRuntimeProviderTurnResult> ExecuteTurnAsync(
        JsonElement parameters,
        JsonElement provider,
        List<AgentRuntimeChatMessage> conversation,
        IReadOnlyList<ToolDefinition> toolDefs,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        var model = JsonHelpers.GetString(provider, "model") ?? string.Empty;
        var baseUrl = (JsonHelpers.GetString(provider, "baseUrl") ?? "https://api.openai.com/v1")
            .Trim()
            .TrimEnd('/');
        var url = $"{baseUrl}/chat/completions";
        var body = BuildRequestBody(parameters, provider, conversation, toolDefs, state);

        var debugHeaders = BuildDebugHeaders(provider);

        // Emit request_debug event
        await AgentRuntimeTools.EmitAsync(
            state, context,
            new AgentRuntimeStreamEvent(
                "request_debug",
                DebugInfo: new AgentRuntimeRequestDebugInfo(
                    url, "POST", debugHeaders, body,
                    DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    JsonHelpers.GetString(provider, "providerId"),
                    JsonHelpers.GetString(provider, "providerBuiltinId"),
                    model)));

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
        ApplyHeaders(request, provider, JsonHelpers.GetString(provider, "apiKey") ?? string.Empty);

        var startedAt = Stopwatch.GetTimestamp();
        long? firstTokenMs = null;
        var estimatedOutputTokens = 0;
        AgentRuntimeTokenUsage? finalUsage = null;
        var finalStopReason = "stop";
        var assistantText = new StringBuilder();
        var reasoningContent = new StringBuilder();
        var reasoningDetails = new List<ReasoningDetailAccumulator>();
        var toolBuffers = new Dictionary<int, ToolCallBuffer>();
        var toolCalls = new List<AgentRuntimeNativeToolCall>();
        string? nativeFinishReason = null;

        // Connection aborts (unstable upstreams, e.g. OpenRouter stealth routes)
        // surface as HttpRequestException. Convert to a retryable 502 when
        // nothing has been emitted yet, so ProviderRetryPolicy backs off.
        try
        {
            await ReadProviderStreamAsync(
                request, provider, state, context,
                toolBuffers, toolCalls, assistantText, reasoningContent, reasoningDetails,
                startedAt,
                value => firstTokenMs ??= value,
                value => estimatedOutputTokens += value,
                value => finalUsage = value,
                value => finalStopReason = value,
                value => nativeFinishReason = value);
        }
        catch (HttpRequestException ex) when (
            !state.CancellationToken.IsCancellationRequested &&
            assistantText.Length == 0 &&
            reasoningContent.Length == 0 &&
            toolCalls.Count == 0 &&
            toolBuffers.Count == 0)
        {
            WorkerLog.Warn(
                $"openai-chat connection failure, retrying runId={state.RunId} " +
                $"error={ex.GetBaseException().Message}");
            throw new ProviderHttpException(
                "OpenAI-compatible chat",
                HttpStatusCode.BadGateway,
                $"connection error: {ex.GetBaseException().Message}",
                retryAfter: null);
        }

        // Dump the raw provider response when the turn produced nothing usable,
        // so malformed/unexpected payloads are diagnosable from the log file.
        if (string.IsNullOrWhiteSpace(assistantText.ToString()) && toolCalls.Count == 0)
        {
            WorkerLog.Warn(
                $"openai-chat empty turn runId={state.RunId} model={model} " +
                $"stopReason={finalStopReason} nativeStopReason={nativeFinishReason ?? "<none>"} " +
                $"reasoningLength={reasoningContent.Length} " +
                $"reasoningDetails={reasoningDetails.Count} " +
                $"hasUsage={finalUsage is not null}");

            // OpenRouter masks upstream failures as finish_reason="stop" and
            // reports the real cause via native_finish_reason (e.g. network_error,
            // provider_error, timeout). Nothing was emitted to the UI yet, so
            // surface it as a retryable 502 and let ProviderRetryPolicy back off.
            if (IsUpstreamFailureReason(nativeFinishReason, finalStopReason))
            {
                WorkerLog.Warn(
                    $"openai-chat upstream failure, retrying runId={state.RunId} " +
                    $"native_finish_reason={nativeFinishReason}");
                throw new ProviderHttpException(
                    "OpenAI-compatible chat",
                    HttpStatusCode.BadGateway,
                    $"upstream native_finish_reason={nativeFinishReason}",
                    retryAfter: null);
            }
        }

        var totalMs = AgentLoop.ElapsedMs(startedAt);
        AgentLoop.EnsureProviderTurnHasOutput(
            "openai-chat",
            finalStopReason,
            assistantText.ToString(),
            reasoningContent.ToString(),
            toolCalls,
            finalUsage,
            totalMs);
        // Accumulate cache tokens and attach session-cumulative counters + usage source.
        var emitUsage = finalUsage;
        if (emitUsage is not null && state.SessionConversation is { } sessConv)
        {
            var cacheHit = emitUsage.CacheReadTokens ?? 0;
            var billableInput = emitUsage.BillableInputTokens
                ?? Math.Max(0, emitUsage.InputTokens - cacheHit);
            var cacheCreation = emitUsage.CacheCreationTokens ?? 0;
            var cacheMiss = billableInput + cacheCreation;
            sessConv.AccumulateCacheTokens(cacheHit, cacheMiss);
            emitUsage = emitUsage with
            {
                SessionCacheHitTokens = (int)sessConv.SessionCacheHit,
                SessionCacheMissTokens = (int)sessConv.SessionCacheMiss,
                UsageSource = state.UsageSource
            };
        }

        await AgentRuntimeTools.EmitAsync(
            state, context,
            new AgentRuntimeStreamEvent(
                "message_end",
                StopReason: finalStopReason,
                Usage: emitUsage,
                Timing: new AgentRuntimeRequestTiming(
                    totalMs, firstTokenMs,
                    AgentLoop.ComputeTps(finalUsage?.OutputTokens ?? estimatedOutputTokens, firstTokenMs, totalMs))));

        var assistantToolUses = toolCalls
            .Select(call => new AgentRuntimeChatToolUse(call.Id, call.Name, call.Input, call.ExtraContent))
            .ToList();

        return new AgentRuntimeProviderTurnResult(
            new AgentRuntimeChatMessage(
                "assistant",
                assistantText.ToString(),
                assistantToolUses,
                [],
                ReasoningContent: reasoningContent.Length > 0 ? reasoningContent.ToString() : null,
                ReasoningDetails: reasoningDetails.Count > 0
                    ? AgentRuntimeProviderSupport.CreateArrayElement(
                        reasoningDetails.Select(acc => acc.ToJsonElement()))
                    : null),
            toolCalls,
            finalStopReason,
            finalUsage);
    }

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
                        state, context, startedAt,
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
                state, context, startedAt,
                markFirstTokenMs, addEstimatedOutputTokens, setUsage, setStopReason,
                setNativeStopReason);
        }
        else if (!sawSsePayload && rawResponseBuilder.Length > 0)
        {
            await ProcessJsonResponseAsync(
                rawResponseBuilder.ToString(),
                toolCalls, assistantText, reasoningContent, reasoningDetails,
                state, context, startedAt,
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

    private static async Task ProcessJsonResponseAsync(
        string payload,
        List<AgentRuntimeNativeToolCall> completedToolCalls,
        StringBuilder assistantText,
        StringBuilder reasoningContent,
        List<ReasoningDetailAccumulator> reasoningDetails,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        long startedAt,
        Action<long> markFirstTokenMs,
        Action<int> addEstimatedOutputTokens,
        Action<AgentRuntimeTokenUsage> setUsage,
        Action<string> setStopReason)
    {
        using var document = JsonDocument.Parse(payload);
        var root = document.RootElement;

        if (root.TryGetProperty("usage", out var usageElement) &&
            TryReadUsage(usageElement, out var usage))
        {
            setUsage(usage);
        }

        var choice = TryGetFirstChoice(root);
        if (!choice.HasValue) return;

        var choiceValue = choice.Value;
        if (choiceValue.TryGetProperty("message", out var message) &&
            message.ValueKind == JsonValueKind.Object)
        {
            AppendReasoningDetails(message, reasoningDetails);
            var reasoning = AgentLoop.ReadString(message, "reasoning_content") ??
                AgentLoop.ReadString(message, "reasoning");
            if (!string.IsNullOrEmpty(reasoning))
            {
                reasoningContent.Append(reasoning);
                markFirstTokenMs(AgentLoop.ElapsedMs(startedAt));
                await AgentRuntimeTools.EmitAsync(
                    state, context,
                    new AgentRuntimeStreamEvent("thinking_delta", Thinking: reasoning));
            }

            var text = ReadMessageContentText(message);
            if (!string.IsNullOrEmpty(text))
            {
                markFirstTokenMs(AgentLoop.ElapsedMs(startedAt));
                addEstimatedOutputTokens(AgentLoop.EstimateTokenCount(text));
                assistantText.Append(text);
                await AgentRuntimeTools.EmitAsync(
                    state, context,
                    new AgentRuntimeStreamEvent("text_delta", Text: text));
            }

            if (message.TryGetProperty("tool_calls", out var toolCallsElement) &&
                toolCallsElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var toolCallElement in toolCallsElement.EnumerateArray())
                {
                    if (TryCreateCompletedToolCall(toolCallElement, out var toolCall))
                    {
                        completedToolCalls.Add(toolCall);
                        await AgentRuntimeTools.EmitAsync(
                            state, context,
                            new AgentRuntimeStreamEvent(
                                "tool_use_streaming_start",
                                ToolCallId: toolCall.Id,
                                ToolName: toolCall.Name));
                        await AgentRuntimeTools.EmitAsync(
                            state, context,
                            new AgentRuntimeStreamEvent(
                                "tool_use_generated",
                                ToolCallId: toolCall.Id,
                                ToolUseBlock: new AgentRuntimeToolUseBlock(toolCall.Id, toolCall.Name, toolCall.Input)));
                    }
                }
            }
        }

        setStopReason(AgentLoop.ReadString(choiceValue, "finish_reason") ?? "stop");
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

    private static void AppendReasoningDetails(JsonElement element, List<ReasoningDetailAccumulator> destination)
    {
        if (!element.TryGetProperty("reasoning_details", out var details) ||
            details.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var detail in details.EnumerateArray())
        {
            MergeReasoningDetail(detail, destination);
        }
    }

    /// <summary>
    /// Merges a streaming reasoning_details fragment into the accumulated details.
    /// OpenRouter emits one fragment per delta; fragments sharing the same index
    /// must be merged before being passed back on the next request:
    /// reasoning.text concatenates text, reasoning.encrypted concatenates base64 data.
    /// Non-streaming responses already arrive merged and are adopted as-is.
    /// </summary>
    private static void MergeReasoningDetail(JsonElement detail, List<ReasoningDetailAccumulator> destination)
    {
        if (detail.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        var index = JsonHelpers.GetInt(detail, "index", 0);
        var existing = destination.FirstOrDefault(acc => acc.Index == index);
        if (existing is null)
        {
            existing = new ReasoningDetailAccumulator(index);
            destination.Add(existing);
        }
        existing.Absorb(detail);
    }

    private sealed class ReasoningDetailAccumulator
    {
        private readonly StringBuilder _text = new();
        private readonly StringBuilder _data = new();

        public ReasoningDetailAccumulator(int index)
        {
            Index = index;
        }

        public int Index { get; }
        public string Type { get; private set; } = string.Empty;
        public string Format { get; private set; } = string.Empty;
        public bool IsSummary { get; private set; }

        public void Absorb(JsonElement detail)
        {
            if (JsonHelpers.GetString(detail, "type") is { Length: > 0 } type)
            {
                Type = type;
            }
            if (JsonHelpers.GetString(detail, "format") is { } format)
            {
                Format = format;
            }
            if (detail.TryGetProperty("summary", out var summary) &&
                summary.ValueKind is JsonValueKind.True or JsonValueKind.False)
            {
                IsSummary = summary.GetBoolean();
            }

            if (JsonHelpers.GetString(detail, "text") is { } text)
            {
                _text.Append(text);
            }
            if (JsonHelpers.GetString(detail, "data") is { } data)
            {
                _data.Append(data);
            }
        }

        public JsonElement ToJsonElement()
        {
            return AgentRuntimeProviderSupport.CreateObjectElement(writer =>
            {
                writer.WriteString("type", Type);
                if (_text.Length > 0)
                {
                    writer.WriteString("text", _text.ToString());
                }
                if (_data.Length > 0)
                {
                    writer.WriteString("data", _data.ToString());
                }
                writer.WriteString("format", Format);
                writer.WriteNumber("index", Index);
                if (IsSummary)
                {
                    writer.WriteBoolean("summary", true);
                }
            });
        }
    }
}

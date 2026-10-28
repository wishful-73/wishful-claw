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

        var debugHeaders = BuildDebugHeaders(provider, state.SessionId);

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
        ApplyHeaders(request, provider, JsonHelpers.GetString(provider, "apiKey") ?? string.Empty, state.SessionId);

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
        // S-142: per-attempt text/thinking block tracker — the boundary events it
        // emits are what keep the renderer from merging the two kinds out of order.
        var boundary = new StreamSegmentBoundary();
        string? nativeFinishReason = null;

        // Connection aborts (unstable upstreams, e.g. OpenRouter stealth routes)
        // surface as HttpRequestException. Convert to a retryable 502 when
        // nothing has been emitted yet, so ProviderRetryPolicy backs off.
        try
        {
            await ReadProviderStreamAsync(
                request, provider, state, context,
                toolBuffers, toolCalls, assistantText, reasoningContent, reasoningDetails,
                boundary,
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

        // S-142: the response stream is done — close a thinking block that never
        // switched to text, so the renderer marks it complete without waiting.
        await StreamSegmentBoundary.EmitAsync(state, context, boundary.AtEnd());

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

    private static async Task ProcessJsonResponseAsync(
        string payload,
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
                // S-142: boundary before the first delta of a thinking block.
                await StreamSegmentBoundary.EmitAsync(
                    state, context,
                    boundary.BeforeDelta(StreamSegmentBoundary.ThinkingKind));
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
                // S-142: boundary before the first delta of a text block.
                await StreamSegmentBoundary.EmitAsync(
                    state, context,
                    boundary.BeforeDelta(StreamSegmentBoundary.TextKind));
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
}

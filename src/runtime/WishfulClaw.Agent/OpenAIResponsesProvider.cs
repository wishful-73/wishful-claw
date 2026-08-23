/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Diagnostics;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Http;

namespace WishfulClaw.Agent;

/// <summary>
/// OpenAI Responses API provider (openai-responses protocol).
/// HTTP SSE streaming only (no WebSocket transport).
/// Ported from OpenCowork AgentRuntimeOpenAIResponsesProvider.cs + Transport.cs (simplified).
/// </summary>
internal static partial class OpenAIResponsesProvider
{
    private static readonly HttpClient Http = WorkerHttpClientFactory.Create(
        timeout: Timeout.InfiniteTimeSpan);

    public static async Task<AgentRuntimeProviderTurnResult> ExecuteTurnAsync(
        JsonElement parameters,
        JsonElement provider,
        List<AgentRuntimeChatMessage> conversation,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        var model = JsonHelpers.GetString(provider, "model") ?? string.Empty;
        var baseUrl = (JsonHelpers.GetString(provider, "baseUrl") ?? "https://api.openai.com/v1")
            .Trim()
            .TrimEnd('/');
        var url = $"{baseUrl}/responses";
        var body = BuildRequestBody(parameters, provider, conversation);

        await EmitRequestDebugAsync(
            parameters, provider, state, context, url, body, model);

        var startedAt = Stopwatch.GetTimestamp();
        var parseState = new ResponsesParseState();
        WorkerLog.Debug($"responses provider request start model={model} url={url}");

        try
        {
            await ExecuteHttpSseAsync(url, body, provider, parseState, state, context, startedAt);
        }
        catch (OperationCanceledException ex) when (
            !state.IsCancellationRequested &&
            !parseState.ReceivedAnyMessage)
        {
            WorkerLog.Warn(
                "responses HTTP request interrupted before first event; retrying once " +
                $"url={url} error={ex.GetType().Name}: {ex.Message}");
            parseState = new ResponsesParseState();
            await EmitRequestDebugAsync(
                parameters, provider, state, context, url, body, model);
            startedAt = Stopwatch.GetTimestamp();
            await ExecuteHttpSseAsync(url, body, provider, parseState, state, context, startedAt);
        }

        FlushPendingToolCalls(parseState);
        var totalMs = ElapsedMs(startedAt);
        AgentLoop.EnsureProviderTurnHasOutput(
            "openai-responses",
            parseState.StopReason,
            parseState.AssistantText.ToString(),
            null,
            parseState.ToolCalls,
            parseState.Usage,
            totalMs);
        if (parseState.Usage is { } usage)
        {
            WorkerLog.Debug(
                "responses provider usage " +
                $"inputTokens={usage.InputTokens} outputTokens={usage.OutputTokens} " +
                $"cacheReadTokens={usage.CacheReadTokens ?? 0} cacheCreationTokens={usage.CacheCreationTokens ?? 0} " +
                $"billableInputTokens={usage.BillableInputTokens ?? usage.InputTokens} " +
                $"reasoningTokens={usage.ReasoningTokens ?? 0}");
        }

        // Accumulate cache tokens and attach session-cumulative counters.
        var emitUsage = parseState.Usage;
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
                StopReason: parseState.StopReason,
                Usage: emitUsage,
                Timing: new AgentRuntimeRequestTiming(
                    totalMs,
                    parseState.FirstTokenMs,
                    ComputeTps(parseState.Usage?.OutputTokens ?? parseState.EstimatedOutputTokens, parseState.FirstTokenMs, totalMs)),
                ProviderResponseId: parseState.ProviderResponseId));

        return new AgentRuntimeProviderTurnResult(
            new AgentRuntimeChatMessage(
                "assistant",
                parseState.AssistantText.ToString(),
                parseState.ToolCalls
                    .Select(call => new AgentRuntimeChatToolUse(call.Id, call.Name, call.Input, call.ExtraContent))
                    .ToList(),
                [],
                parseState.ProviderResponseId),
            parseState.ToolCalls,
            parseState.StopReason,
            parseState.Usage);
    }

    private static async Task ExecuteHttpSseAsync(
        string url,
        string body,
        JsonElement provider,
        ResponsesParseState parseState,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        long startedAt)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        ApplyHeaders(request, provider);

        using var response = await AgentRuntimeRequestTimeout.SendAsync(
            Http, request, provider, "OpenAI Responses", state.CancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw await ProviderHttpException.CreateAsync(
                "OpenAI Responses", response, state.CancellationToken);
        }

        await using var responseStream = await response.Content.ReadAsStreamAsync(state.CancellationToken);
        using var reader = new StreamReader(responseStream, Encoding.UTF8);
        var dataBuilder = new StringBuilder();
        string? eventName = null;
        string? line;
        while ((line = await AgentRuntimeRequestTimeout.ReadLineAsync(
            reader, provider, "OpenAI Responses", state.CancellationToken)) is not null)
        {
            if (line.Length == 0)
            {
                if (dataBuilder.Length > 0)
                {
                    var data = dataBuilder.ToString();
                    dataBuilder.Clear();
                    if (data == "[DONE]")
                    {
                        break;
                    }
                    parseState.ReceivedAnyMessage = true;
                    var shouldStop = await ProcessJsonEventAsync(
                        eventName, data, parseState, state, context, startedAt);
                    eventName = null;
                    if (shouldStop)
                    {
                        break;
                    }
                }
                continue;
            }

            if (line.StartsWith("event:", StringComparison.Ordinal))
            {
                eventName = line[6..].TrimStart();
                continue;
            }
            if (line.StartsWith("data:", StringComparison.Ordinal))
            {
                if (dataBuilder.Length > 0)
                {
                    dataBuilder.Append('\n');
                }
                dataBuilder.Append(line[5..].TrimStart());
            }
        }
    }

    private static async Task EmitRequestDebugAsync(
        JsonElement parameters,
        JsonElement provider,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        string requestUrl,
        string body,
        string model)
    {
        var debugHeaders = BuildDebugHeaders(provider);
        await AgentRuntimeTools.EmitAsync(
            state, context,
            new AgentRuntimeStreamEvent(
                "request_debug",
                DebugInfo: new AgentRuntimeRequestDebugInfo(
                    requestUrl,
                    "POST",
                    debugHeaders,
                    body,
                    DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    JsonHelpers.GetString(provider, "providerId"),
                    JsonHelpers.GetString(provider, "providerBuiltinId"),
                    model)));
    }

    private static void ApplyHeaders(HttpRequestMessage request, JsonElement provider)
    {
        var apiKey = JsonHelpers.GetString(provider, "apiKey") ?? string.Empty;
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);
        ApiUserAgent.Apply(request, provider);

        if (JsonHelpers.GetString(provider, "organization") is { Length: > 0 } organization)
        {
            request.Headers.TryAddWithoutValidation("OpenAI-Organization", organization);
        }
        if (JsonHelpers.GetString(provider, "project") is { Length: > 0 } project)
        {
            request.Headers.TryAddWithoutValidation("OpenAI-Project", project);
        }
        if (JsonHelpers.GetString(provider, "serviceTier") is { Length: > 0 } serviceTier)
        {
            request.Headers.TryAddWithoutValidation("service_tier", serviceTier);
        }

        ProviderRequestOverrides.ApplyHttpHeaderOverrides(request, provider);
        ApiUserAgent.Ensure(request, provider);
    }

    private static IReadOnlyDictionary<string, string> BuildDebugHeaders(JsonElement provider)
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Content-Type"] = "application/json",
            ["Authorization"] = "Bearer ***"
        };
        ApiUserAgent.ApplyDebug(headers, provider);
        if (JsonHelpers.GetString(provider, "serviceTier") is { Length: > 0 } serviceTier)
        {
            headers["service_tier"] = serviceTier;
        }
        ProviderRequestOverrides.ApplyDebugHeaderOverrides(headers, provider);
        ApiUserAgent.EnsureDebug(headers, provider);
        return headers;
    }
}

/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// Anthropic Messages API provider (anthropic protocol).
/// SSE streaming with content_block events, thinking support, tool use.
/// Simplified from WishfulClaw — no cache_control, no sanitizer, no request validator.
/// </summary>
internal static partial class AnthropicMessagesProvider
{
    private static readonly HttpClient Http = new(new HttpClientHandler
    {
        ServerCertificateCustomValidationCallback = (_, _, _, _) => true
    })
    {
        Timeout = Timeout.InfiniteTimeSpan
    };

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
        var baseUrl = (JsonHelpers.GetString(provider, "baseUrl") ?? "https://api.anthropic.com")
            .Trim()
            .TrimEnd('/');
        var url = $"{baseUrl}/v1/messages";
        var body = BuildRequestBody(parameters, provider, conversation, toolDefs, state);

        await AgentRuntimeTools.EmitAsync(
            state, context,
            new AgentRuntimeStreamEvent(
                "request_debug",
                DebugInfo: new AgentRuntimeRequestDebugInfo(
                    url, "POST", BuildDebugHeaders(provider), body,
                    DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    JsonHelpers.GetString(provider, "providerId"),
                    JsonHelpers.GetString(provider, "providerBuiltinId"),
                    model)));

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        ApplyHeaders(request, provider);

        var startedAt = Stopwatch.GetTimestamp();
        var parseState = new AnthropicParseState();
        WorkerLog.Debug($"anthropic messages request start model={model} url={url}");

        using var response = await AgentRuntimeRequestTimeout.SendAsync(
            Http, request, provider, "Anthropic Messages", state.CancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw await ProviderHttpException.CreateAsync(
                "Anthropic Messages",
                response,
                state.CancellationToken);
        }

        await using var responseStream = await response.Content.ReadAsStreamAsync(state.CancellationToken);
        using var reader = new StreamReader(responseStream, Encoding.UTF8);
        var dataBuilder = new StringBuilder();
        string? eventName = null;
        string? line;

        while ((line = await AgentRuntimeRequestTimeout.ReadLineAsync(
            reader, provider, "Anthropic Messages", state.CancellationToken)) is not null)
        {
            if (line.Length == 0)
            {
                if (dataBuilder.Length > 0)
                {
                    var data = dataBuilder.ToString();
                    dataBuilder.Clear();
                    if (data != "[DONE]")
                    {
                        await ProcessJsonEventAsync(eventName, data, parseState, state, context, startedAt);
                    }
                    eventName = null;
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
                if (dataBuilder.Length > 0) dataBuilder.Append('\n');
                dataBuilder.Append(line[5..].TrimStart());
            }
        }

        await FlushPendingToolCallsAsync(parseState, state, context);

        var totalMs = AgentLoop.ElapsedMs(startedAt);
        AgentLoop.EnsureProviderTurnHasOutput(
            "anthropic",
            parseState.StopReason,
            parseState.AssistantText.ToString(),
            null,
            parseState.ToolCalls,
            parseState.Usage,
            totalMs);
        // Accumulate cache tokens and attach session-cumulative counters + usage source.
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
                    AgentLoop.ComputeTps(parseState.Usage?.OutputTokens ?? parseState.EstimatedOutputTokens, parseState.FirstTokenMs, totalMs))));

        return new AgentRuntimeProviderTurnResult(
            new AgentRuntimeChatMessage(
                "assistant",
                parseState.AssistantText.ToString(),
                parseState.ToolCalls
                    .Select(call => new AgentRuntimeChatToolUse(call.Id, call.Name, call.Input))
                    .ToList(),
                []),
            parseState.ToolCalls,
            parseState.StopReason,
            parseState.Usage);
    }

    // ── Headers ──

    private static void ApplyHeaders(HttpRequestMessage request, JsonElement provider)
    {
        var apiKey = JsonHelpers.GetString(provider, "apiKey") ?? string.Empty;
        var providerBuiltinId = JsonHelpers.GetString(provider, "providerBuiltinId");

        if (providerBuiltinId == "longcat")
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            request.Headers.TryAddWithoutValidation("x-api-key", apiKey);
        }
        else
        {
            request.Headers.TryAddWithoutValidation("x-api-key", apiKey);
        }

        request.Headers.TryAddWithoutValidation("anthropic-version", "2023-06-01");
        request.Headers.TryAddWithoutValidation("anthropic-beta", BuildAnthropicBetaHeader(provider));
        ApiUserAgent.Apply(request, provider);
        ProviderRequestOverrides.ApplyHttpHeaderOverrides(request, provider);
        ApiUserAgent.Ensure(request, provider);
    }

    private static IReadOnlyDictionary<string, string> BuildDebugHeaders(JsonElement provider)
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Content-Type"] = "application/json",
            ["anthropic-version"] = "2023-06-01",
            ["anthropic-beta"] = BuildAnthropicBetaHeader(provider)
        };

        if (JsonHelpers.GetString(provider, "providerBuiltinId") == "longcat")
        {
            headers["Authorization"] = "Bearer ***";
            headers["x-api-key"] = "***";
        }
        else
        {
            headers["x-api-key"] = "***";
        }

        ApiUserAgent.ApplyDebug(headers, provider);
        ProviderRequestOverrides.ApplyDebugHeaderOverrides(headers, provider);
        ApiUserAgent.EnsureDebug(headers, provider);
        return headers;
    }

    private static string BuildAnthropicBetaHeader(JsonElement provider)
    {
        return JsonHelpers.GetString(provider, "cacheTtl") == "1h"
            ? "prompt-caching-2024-07-31,interleaved-thinking-2025-05-14,extended-cache-ttl-2025-04-11"
            : "prompt-caching-2024-07-31,interleaved-thinking-2025-05-14";
    }

    // ── Parse state ──

    public sealed class AnthropicParseState
    {
        public StringBuilder AssistantText { get; } = new();
        public Dictionary<int, AnthropicToolBuffer> ToolBuffers { get; } = new();
        public List<AgentRuntimeNativeToolCall> ToolCalls { get; } = new();
        public HashSet<string> EmittedEncryptedReasoning { get; } = new(StringComparer.Ordinal);
        public long? FirstTokenMs { get; set; }
        public int EstimatedOutputTokens { get; set; }
        public AgentRuntimeTokenUsage? Usage { get; set; }
        public string StopReason { get; set; } = "end_turn";
    }

    public sealed class AnthropicToolBuffer(string id, string name)
    {
        public string Id { get; } = id;
        public string Name { get; } = name;
        public StringBuilder Arguments { get; } = new();
    }
}

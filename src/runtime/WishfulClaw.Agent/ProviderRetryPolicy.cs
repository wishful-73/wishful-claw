/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License");
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Net;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Exception thrown by providers when an HTTP request fails.
/// Carries status code and Retry-After header for the retry policy.
/// Ported from WishfulClaw's AgentRuntimeProviderRetryPolicy.
/// </summary>
public sealed class ProviderHttpException : InvalidOperationException
{
    public ProviderHttpException(
        string providerName,
        HttpStatusCode statusCode,
        string responseBody,
        TimeSpan? retryAfter)
        : base($"{providerName} request failed HTTP {(int)statusCode}: {responseBody}")
    {
        StatusCode = (int)statusCode;
        RetryAfter = retryAfter;
    }

    public int StatusCode { get; }

    public TimeSpan? RetryAfter { get; }

    public static async Task<ProviderHttpException> CreateAsync(
        string providerName,
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
        return new ProviderHttpException(
            providerName,
            response.StatusCode,
            responseBody,
            response.Headers.RetryAfter?.Delta);
    }
}

/// <summary>
/// Retry policy for transient AI provider failures (429, 5xx).
/// Implements exponential backoff with jitter and Retry-After header support.
/// Design aligned with Reasonix's backoffDelay: exponential + jitter to avoid
/// thundering-herd cascading 429s that destroy prefix cache locality.
/// </summary>
public static class ProviderRetryPolicy
{
    private const int DefaultMaxRetryAttempts = 10;
    /// <summary>
    /// Retries beyond this attempt use a fixed 60s interval — by then the provider
    /// is rate-limiting at its own pace (per-minute quota), so exponential backoff
    /// adds nothing but user-visible dead time.
    /// </summary>
    private const int SlowRetryThreshold = 10;
    private const int SlowRetryDelayMs = 60_000;
    private const int BaseDelayMs = 500;
    private const int MaxBackoffMs = 15_000;
    private const int MaxRetryAfterMs = 60_000;
    private const int JitterMs = 250;

    private static readonly Random JitterRng = new();

    /// <summary>
    /// Wraps a provider turn execution with automatic retry on 429/5xx.
    /// Emits request_retry stream events so the UI can show retry status.
    /// The optional provider payload carries the user-configured
    /// requestMaxRetries: null/missing → 10 (default); 0 → unlimited; &gt;0 → that count.
    /// </summary>
    public static async Task<AgentRuntimeProviderTurnResult> ExecuteAsync(
        Func<Task<AgentRuntimeProviderTurnResult>> execute,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        JsonElement? provider = null)
    {
        var maxAttempts = ResolveMaxRetryAttempts(provider);
        var isUnlimited = maxAttempts == 0;

        for (var retryAttempt = 0; ; retryAttempt++)
        {
            try
            {
                return await execute();
            }
            catch (TimeoutException ex) when (!state.IsCancellationRequested)
            {
                // Idle/TTFB timeout from AgentRuntimeRequestTimeout — treat as
                // transient and let the same backoff schedule handle it.
                var attempt = retryAttempt + 1;
                var delayMs = ComputeDelayMs(attempt, null);
                WorkerLog.Warn(
                    $"provider request timed out ({ex.Message}); retrying in {delayMs}ms " +
                    $"attempt={attempt}{(isUnlimited ? "/unlimited" : $"/{maxAttempts}")}");
                await AgentRuntimeTools.EmitAsync(
                    state,
                    context,
                    new AgentRuntimeStreamEvent(
                        "request_retry",
                        Reason: "timeout",
                        Attempt: attempt,
                        MaxAttempts: isUnlimited ? 0 : maxAttempts,
                        DelayMs: delayMs));
                await Task.Delay(delayMs, state.CancellationToken);
            }
            catch (ProviderHttpException ex) when (
                IsRetryableStatus(ex.StatusCode) &&
                (isUnlimited || retryAttempt < maxAttempts) &&
                !state.IsCancellationRequested)
            {
                var attempt = retryAttempt + 1;
                var delayMs = ComputeDelayMs(attempt, ex.RetryAfter);
                WorkerLog.Warn(
                    $"provider request failed ({ex.Message}); retrying in {delayMs}ms " +
                    $"attempt={attempt}{(isUnlimited ? "/unlimited" : $"/{maxAttempts}")}");
                await AgentRuntimeTools.EmitAsync(
                    state,
                    context,
                    new AgentRuntimeStreamEvent(
                        "request_retry",
                        Reason: $"HTTP {ex.StatusCode}",
                        Attempt: attempt,
                        // 0 signals "unlimited" to the renderer.
                        MaxAttempts: isUnlimited ? 0 : maxAttempts,
                        DelayMs: delayMs,
                        StatusCode: ex.StatusCode));
                await Task.Delay(delayMs, state.CancellationToken);
            }
        }
    }

    /// <summary>
    /// Reads the user-configured max retry count from the provider payload.
    /// requestMaxRetries: null/missing → 10 (default); 0 → unlimited; &gt;0 → that count.
    /// </summary>
    internal static int ResolveMaxRetryAttempts(JsonElement? provider)
    {
        if (provider is not { } p)
        {
            return DefaultMaxRetryAttempts;
        }

        var configured = JsonHelpers.GetIntNullable(p, "requestMaxRetries");
        if (configured is null || configured < 0)
        {
            return DefaultMaxRetryAttempts;
        }

        return configured.Value;
    }

    private static bool IsRetryableStatus(int statusCode)
    {
        return statusCode == 400 || statusCode == 429 || statusCode >= 500;
    }

    /// <summary>
    /// Exponential backoff with jitter, honoring Retry-After.
    /// Attempt 1: 500ms + jitter(0-250ms) = 500-750ms
    /// Attempt 2: 1000ms + jitter = 1000-1250ms
    /// Attempt 3: 2000ms + jitter = 2000-2250ms
    /// ...capped at MaxBackoffMs (15s).
    /// If Retry-After is provided, it takes precedence (capped at MaxRetryAfterMs).
    /// Attempts beyond SlowRetryThreshold retry at a fixed 1-minute interval.
    /// </summary>
    private static int ComputeDelayMs(int attempt, TimeSpan? retryAfter)
    {
        // Honor Retry-After header if present
        if (retryAfter is { } ra)
        {
            var raMs = (int)Math.Clamp(ra.TotalMilliseconds, 0, MaxRetryAfterMs);
            if (raMs > 0) return Math.Min(raMs, MaxBackoffMs);
        }

        // Beyond SlowRetryThreshold the provider is rate-limiting on its own
        // schedule (e.g. per-minute quota) — retry at a fixed 1-minute interval.
        if (attempt > SlowRetryThreshold)
        {
            return SlowRetryDelayMs;
        }

        // Exponential backoff: 500ms * 2^(attempt-1)
        var exponentialMs = BaseDelayMs * (1 << Math.Min(attempt - 1, 20));
        var cappedMs = Math.Min(exponentialMs, MaxBackoffMs);

        // Add jitter to avoid thundering-herd cascading 429s
        var jitter = JitterRng.Next(0, JitterMs);
        return cappedMs + jitter;
    }
}

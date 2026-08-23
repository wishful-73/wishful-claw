/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Net.Http;
using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Request timeout helper for provider HTTP requests.
/// Reads the configured request timeout from the provider payload (requestTimeoutSeconds).
/// The deadline only covers time-to-first-byte; every provider sends with
/// HttpCompletionOption.ResponseHeadersRead, so the countdown stops once headers arrive.
/// Ported from OpenCowork AgentRuntimeRequestTimeout.cs (simplified — no transport exception).
/// </summary>
internal static class AgentRuntimeRequestTimeout
{
    public const int DefaultTimeoutSeconds = 100;

    /// <summary>
    /// Reads the configured request timeout from the provider payload.
    /// Returns null when the timeout is disabled (0 or negative), meaning
    /// the request waits until the provider responds or the user cancels.
    /// </summary>
    public static TimeSpan? Resolve(JsonElement provider)
    {
        var seconds = JsonHelpers.GetIntNullable(provider, "requestTimeoutSeconds")
            ?? DefaultTimeoutSeconds;
        return seconds > 0 ? TimeSpan.FromSeconds(seconds) : null;
    }

    /// <summary>
    /// Sends a streaming provider request bounded by the configured timeout.
    /// The returned response is read headers-first and the deadline stops once
    /// the headers arrive, so the caller can stream for as long as the provider
    /// keeps producing events.
    /// </summary>
    public static async Task<HttpResponseMessage> SendAsync(
        HttpClient http,
        HttpRequestMessage request,
        JsonElement provider,
        string providerLabel,
        CancellationToken cancellationToken)
    {
        var configured = Resolve(provider);

        if (configured is not { } timeout)
        {
            return await http.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);
        }

        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(timeout);
        try
        {
            return await http.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                deadline.Token);
        }
        catch (OperationCanceledException ex)
            when (deadline.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            throw new TimeoutException(
                $"{providerLabel} did not return response headers within {timeout.TotalSeconds:0}s. " +
                "Raise the API request timeout in Settings (0 waits indefinitely) if this model " +
                "needs longer before it starts responding.",
                ex);
        }
    }

    /// <summary>
    /// Reads one SSE line bounded by the same configured timeout, applied as an
    /// idle deadline: it restarts for every line, so a stream that keeps producing
    /// events is never cut off, but a stalled connection (headers arrived, no data)
    /// fails after the timeout instead of hanging forever.
    /// </summary>
    public static async Task<string?> ReadLineAsync(
        StreamReader reader,
        JsonElement provider,
        string providerLabel,
        CancellationToken cancellationToken)
    {
        var timeout = Resolve(provider);

        if (timeout is not { } idleTimeout)
        {
            return await reader.ReadLineAsync(cancellationToken);
        }

        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(idleTimeout);
        try
        {
            return await reader.ReadLineAsync(deadline.Token);
        }
        catch (OperationCanceledException ex)
            when (deadline.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            throw new TimeoutException(
                $"{providerLabel} stream idle for {idleTimeout.TotalSeconds:0}s with no data; " +
                "connection appears stalled.",
                ex);
        }
    }
}

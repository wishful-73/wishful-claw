/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Collections.Concurrent;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent.Executors;

/// <summary>
/// Enables the native worker to send a request to the renderer (via the main process)
/// and await the response. The worker emits a "agent/reverse-request" event, and the
/// main process routes it (e.g. to the browser tool handler in the renderer). The
/// response comes back as a "agent/reverse-response" request.
/// Ported from WishfulClaw AgentRuntimeReverseRequests.
/// </summary>
public static class AgentRuntimeReverseRequests
{
    private static readonly ConcurrentDictionary<string, PendingReverseRequest> Pending = new(StringComparer.Ordinal);
    private static long nextId;

    internal static int PendingCount => Pending.Count;

    public static async Task<JsonElement> RequestAsync(
        IWorkerRequestContext context,
        string method,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        var id = Interlocked.Increment(ref nextId).ToString(System.Globalization.CultureInfo.InvariantCulture);
        var pending = new PendingReverseRequest();
        if (!Pending.TryAdd(id, pending))
        {
            throw new InvalidOperationException($"Duplicate reverse request id: {id}");
        }

        using var registration = cancellationToken.Register(static state =>
        {
            var requestId = (string)state!;
            if (Pending.TryRemove(requestId, out var request))
            {
                request.TrySetCanceled();
            }
        }, id);

        try
        {
            await context.EmitEventAsync(
                "agent/reverse-request",
                new AgentRuntimeReverseRequestEnvelope(id, method, parameters),
                AgentRuntimeJsonContext.Default.AgentRuntimeReverseRequestEnvelope);
            return await pending.Task.ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            try
            {
                await context.EmitEventIgnoringCancellationAsync(
                    "agent/reverse-cancel",
                    new AgentRuntimeReverseCancelEnvelope(id, method),
                    AgentRuntimeJsonContext.Default.AgentRuntimeReverseCancelEnvelope);
            }
            catch (Exception ex)
            {
                WorkerLog.Warn(
                    $"reverse cancel notification failed id={id} method={method} error={ex.GetType().Name}: {ex.Message}");
            }
            throw;
        }
        finally
        {
            Pending.TryRemove(id, out _);
        }
    }

    public static WorkerResponse Complete(JsonElement parameters)
    {
        var id = ReadId(parameters);
        if (string.IsNullOrEmpty(id) || !Pending.TryRemove(id, out var pending))
        {
            return WorkerResponse.Json(new AgentRuntimeReverseResponseResult(false), AgentRuntimeJsonContext.Default.AgentRuntimeReverseResponseResult);
        }

        var error = JsonHelpers.GetString(parameters, "error");
        if (!string.IsNullOrEmpty(error))
        {
            pending.TrySetException(new InvalidOperationException(error));
        }
        else if (parameters.ValueKind == JsonValueKind.Object &&
            parameters.TryGetProperty("result", out var result))
        {
            pending.TrySetResult(result.Clone());
        }
        else
        {
            pending.TrySetResult(CreateNullElement());
        }

        return WorkerResponse.Json(new AgentRuntimeReverseResponseResult(true), AgentRuntimeJsonContext.Default.AgentRuntimeReverseResponseResult);
    }

    private static string? ReadId(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("id", out var id))
        {
            return null;
        }

        return id.ValueKind switch
        {
            JsonValueKind.String => id.GetString(),
            JsonValueKind.Number => id.GetRawText(),
            _ => null
        };
    }

    private static JsonElement CreateNullElement()
    {
        using var document = JsonDocument.Parse("null");
        return document.RootElement.Clone();
    }

    private sealed class PendingReverseRequest
    {
        private readonly TaskCompletionSource<JsonElement> source =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task<JsonElement> Task => source.Task;

        public void TrySetResult(JsonElement result)
        {
            source.TrySetResult(result);
        }

        public void TrySetException(Exception exception)
        {
            source.TrySetException(exception);
        }

        public void TrySetCanceled()
        {
            source.TrySetCanceled();
        }
    }
}

public sealed record AgentRuntimeReverseRequestEnvelope(string Id, string Method, JsonElement Params);
public sealed record AgentRuntimeReverseCancelEnvelope(string Id, string Method);
public sealed record AgentRuntimeReverseResponseResult(bool Ok);

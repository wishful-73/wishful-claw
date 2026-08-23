/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Agent runtime run management: accept/cancel/stop runs, event emission.
/// Simplified from WishfulClaw — no SubAgent/Team/Reverse support.
/// </summary>
public static class AgentRuntimeTools
{
    private const int ProtocolVersion = 1;
    private const int MaxConcurrentRuns = 8;
    private static readonly ConcurrentDictionary<string, AgentRuntimeRunState> ActiveRuns = new(StringComparer.Ordinal);
    private static readonly SemaphoreSlim RunSlots = new(MaxConcurrentRuns, MaxConcurrentRuns);
    private static long _generatedRunId;

    // ── Run management ──

    public static Task<WorkerResponse> RunAsync(JsonElement parameters, IWorkerRequestContext context)
    {
        if (!RunSlots.Wait(0))
        {
            return Task.FromResult(WorkerResponse.Error(
                $"Agent run quota exceeded ({MaxConcurrentRuns} concurrent runs)."));
        }

        var runId = NormalizeRunId(JsonHelpers.GetString(parameters, "runId"));
        var sessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim() ?? string.Empty;
        var initialMessageCount = CountArray(parameters, "messages");
        var state = new AgentRuntimeRunState(runId, sessionId);
        try
        {
            state.ReplaceParameters(parameters.Clone());
        }
        catch
        {
            RunSlots.Release();
            state.Dispose();
            throw;
        }

        if (!ActiveRuns.TryAdd(runId, state))
        {
            RunSlots.Release();
            state.Dispose();
            return Task.FromResult(WorkerResponse.Error($"Agent run already exists: {runId}"));
        }

        WorkerLog.Debug(
            $"agent run accepted runId={runId} sessionId={FormatLogValue(sessionId)} " +
            $"messages={initialMessageCount} permissionMode={FormatLogValue(JsonHelpers.GetString(parameters, "permissionMode"))}");

        var backgroundContext = context.ForBackgroundOperation();
        _ = Task.Run(
            async () =>
            {
                try
                {
                    await ExecuteRunAsync(state, backgroundContext);
                }
                catch (Exception ex)
                {
                    // ExecuteRunAsync already has internal try-catch,
                    // but if EmitAsync itself fails (e.g. client disconnected),
                    // the exception would escape as an unobserved task exception.
                    // Catch it here to prevent process crash.
                    WorkerLog.Error(
                        $"agent run outer crash runId={state.RunId} error={FormatExceptionSummary(ex)}");
                    try { ActiveRuns.TryRemove(state.RunId, out _); } catch { }
                    try { RunSlots.Release(); } catch { }
                    try { state.Dispose(); } catch { }
                }
            },
            CancellationToken.None);

        return Task.FromResult(WorkerResponse.Json(
            new AgentRuntimeRunResult(true, runId), AgentRuntimeJsonContext.Default.AgentRuntimeRunResult));
    }

    public static WorkerResponse Cancel(JsonElement parameters)
    {
        var runId = JsonHelpers.GetString(parameters, "runId")?.Trim();
        if (string.IsNullOrEmpty(runId))
        {
            return WorkerResponse.Json(new AgentRuntimeCancelResult(false, null), AgentRuntimeJsonContext.Default.AgentRuntimeCancelResult);
        }

        if (!ActiveRuns.TryGetValue(runId, out var state))
        {
            return WorkerResponse.Json(new AgentRuntimeCancelResult(false, runId), AgentRuntimeJsonContext.Default.AgentRuntimeCancelResult);
        }

        state.Cancel("user");
        WorkerLog.Info($"agent run cancel requested runId={runId}");
        return WorkerResponse.Json(new AgentRuntimeCancelResult(true, runId), AgentRuntimeJsonContext.Default.AgentRuntimeCancelResult);
    }

    public static WorkerResponse RequestStop(JsonElement parameters)
    {
        var runId = JsonHelpers.GetString(parameters, "runId")?.Trim();
        if (string.IsNullOrEmpty(runId))
        {
            return WorkerResponse.Json(new AgentRuntimeStopResult(false, null), AgentRuntimeJsonContext.Default.AgentRuntimeStopResult);
        }

        if (!ActiveRuns.TryGetValue(runId, out var state))
        {
            return WorkerResponse.Json(new AgentRuntimeStopResult(false, runId), AgentRuntimeJsonContext.Default.AgentRuntimeStopResult);
        }

        state.RequestStop("user");
        WorkerLog.Info($"agent run stop requested runId={runId}");
        return WorkerResponse.Json(new AgentRuntimeStopResult(true, runId), AgentRuntimeJsonContext.Default.AgentRuntimeStopResult);
    }

    /// <summary>
    /// Drain buffered background sub-agent completion notifications for a
    /// session whose main run already finalized. Called by the renderer right
    /// before waking the main agent so the reports ride along with the wake
    /// message instead of being lost.
    /// </summary>
    public static WorkerResponse DrainSubAgentNotifications(JsonElement parameters)
    {
        var sessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim();
        if (string.IsNullOrEmpty(sessionId))
        {
            return WorkerResponse.Json(
                new AgentRuntimeDrainResult(false, new List<JsonElement>()),
                AgentRuntimeJsonContext.Default.AgentRuntimeDrainResult);
        }

        var messages = BackgroundSubAgentNotifications.Drain(sessionId);
        WorkerLog.Info(
            $"drained background sub-agent notifications sessionId={sessionId} count={messages.Count}");
        return WorkerResponse.Json(
            new AgentRuntimeDrainResult(true, messages),
            AgentRuntimeJsonContext.Default.AgentRuntimeDrainResult);
    }

    /// <summary>
    /// Find the first active run for a session and return its parameters (including provider config).
    /// Used by GoalOrchestrator.Resume when the goal has no saved OriginalParameters.
    /// </summary>
    public static bool TryGetSessionParameters(string sessionId, out JsonElement parameters)
    {
        foreach (var kvp in ActiveRuns)
        {
            if (string.Equals(kvp.Value.SessionId, sessionId, StringComparison.Ordinal))
            {
                parameters = kvp.Value.Parameters;
                return true;
            }
        }
        parameters = default;
        return false;
    }

    public static WorkerResponse AppendMessages(JsonElement parameters)
    {
        var runId = JsonHelpers.GetString(parameters, "runId")?.Trim();
        if (string.IsNullOrEmpty(runId))
        {
            return WorkerResponse.Json(new AgentRuntimeAppendMessagesResult(false, null, 0), AgentRuntimeJsonContext.Default.AgentRuntimeAppendMessagesResult);
        }

        if (!ActiveRuns.TryGetValue(runId, out var state))
        {
            return WorkerResponse.Json(new AgentRuntimeAppendMessagesResult(false, runId, 0), AgentRuntimeJsonContext.Default.AgentRuntimeAppendMessagesResult);
        }

        var count = state.EnqueueMessages(parameters);
        WorkerLog.Debug($"agent run append messages runId={runId} count={count}");
        return WorkerResponse.Json(new AgentRuntimeAppendMessagesResult(count > 0, runId, count), AgentRuntimeJsonContext.Default.AgentRuntimeAppendMessagesResult);
    }

    // ── Event emission ──

    internal static async Task EmitAsync(
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        params AgentRuntimeStreamEvent[] events)
    {
        if (events.Length == 0)
        {
            return;
        }

        // Sub-agent event interception: when SuppressTransportEvents is true,
        // events are routed to the EventObserver instead of the frontend.
        // This allows the SubAgentExecutor to capture child loop events.
        if (state.SuppressTransportEvents && state.EventObserver is not null)
        {
            foreach (var evt in events)
            {
                await state.EventObserver(evt);
            }
            return;
        }

        var envelope = new AgentRuntimeStreamEnvelope(
            ProtocolVersion,
            state.RunId,
            state.SessionId,
            state.NextSeq(),
            events);

        var messagePackEvent = AgentStreamMessagePackEmitter.Encode(envelope);
        await context.EmitMessagePackEventAsync(messagePackEvent.EventName, messagePackEvent.Payload);

        // Per-envelope DEBUG floods the console for high-throughput runs
        // (streaming deltas, goal sub-agent forwarding). Only slow or
        // unusually large envelopes are worth a trace line.
        if (messagePackEvent.Payload.Length > 64 * 1024)
        {
            WorkerLog.Debug(
                $"agent stream emitted runId={state.RunId} seq={envelope.Seq} " +
                $"events={events.Length} bytes={messagePackEvent.Payload.Length}");
        }
    }

    // ── Internal execution ──

    private static async Task ExecuteRunAsync(AgentRuntimeRunState state, IWorkerRequestContext context)
    {
        try
        {
            await EmitAsync(state, context, new AgentRuntimeStreamEvent("loop_start"));

            if (state.IsCancellationRequested)
            {
                await AgentLoop.EmitLoopEndAsync(state, context, "aborted");
                return;
            }

            await AgentLoop.ExecuteLoopAsync(state.Parameters, state, context);
        }
        catch (OperationCanceledException) when (state.IsCancellationRequested)
        {
            await AgentLoop.EmitLoopEndAsync(state, context, "aborted");
        }
        catch (Exception ex)
        {
            var errorSummary = FormatExceptionSummary(ex);
            WorkerLog.Warn($"agent run failed runId={state.RunId} error={errorSummary}");
            await EmitAsync(
                state,
                context,
                new AgentRuntimeStreamEvent(
                    "error",
                    Message: errorSummary,
                    ErrorType: ex.GetType().Name,
                    Details: errorSummary,
                    StackTrace: ex.StackTrace));
            await AgentLoop.EmitLoopEndAsync(state, context, "error");
        }
        finally
        {
            ActiveRuns.TryRemove(state.RunId, out _);
            RunSlots.Release();
            state.Dispose();
            WorkerLog.Info($"agent run finalized runId={state.RunId}");
        }
    }

    // ── Reverse response (from renderer tool execution) ──

    // ── Session management ──

    /// <summary>
    /// Clears the SessionConversation state for a given sessionId.
    /// Called when the user deletes a session or clears session messages.
    /// </summary>
    public static WorkerResponse ClearSession(JsonElement parameters)
    {
        var sessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim();
        if (string.IsNullOrEmpty(sessionId))
        {
            return WorkerResponse.Error("sessionId is required.");
        }

        SessionConversationManager.Remove(sessionId);
        WorkerLog.Info($"agent session cleared sessionId={FormatLogValue(sessionId)}");
        return WorkerResponse.Json(new ClearSessionResult(true, sessionId), AgentRuntimeJsonContext.Default.ClearSessionResult);
    }

    // ── Reverse response (from renderer tool execution) ──

    public static WorkerResponse ReverseResponse(JsonElement parameters)
    {
        return AgentRuntimeReverseRequests.Complete(parameters);
    }

    // ── Helpers ──

    private static string NormalizeRunId(string? runId)
    {
        var trimmed = runId?.Trim();
        if (!string.IsNullOrEmpty(trimmed))
        {
            return trimmed;
        }

        var next = Interlocked.Increment(ref _generatedRunId);
        return $"wc-agent-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{next}";
    }

    private static int CountArray(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty(propertyName, out var property) ||
            property.ValueKind != JsonValueKind.Array)
        {
            return 0;
        }
        return property.GetArrayLength();
    }

    private static string FormatLogValue(string? value)
    {
        return string.IsNullOrEmpty(value) ? "<empty>" : value;
    }

    private static string FormatExceptionSummary(Exception exception)
    {
        const int maxDepth = 4;
        const int maxSummaryLength = 1_500;
        var parts = new List<string>(maxDepth);
        Exception? current = exception;
        var depth = 0;

        while (current is not null && depth < maxDepth)
        {
            var message = SanitizeExceptionMessage(current.Message);
            parts.Add($"{current.GetType().Name}: {message}");
            current = current.InnerException;
            depth++;
        }

        if (current is not null)
        {
            parts.Add("...");
        }

        var summary = string.Join(" -> ", parts);
        return summary.Length <= maxSummaryLength
            ? summary
            : summary[..maxSummaryLength] + "...";
    }

    private static string SanitizeExceptionMessage(string? message)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            return "<no message>";
        }

        var sanitized = string.Join(' ', message.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        sanitized = System.Text.RegularExpressions.Regex.Replace(
            sanitized,
            "(?i)(Bearer\\s+)[^\\s,;]+",
            "$1<redacted>");
        sanitized = System.Text.RegularExpressions.Regex.Replace(
            sanitized,
            "(?i)([?&](?:api[_-]?key|access[_-]?token|token|key)=)[^&\\s]+",
            "$1<redacted>");
        sanitized = System.Text.RegularExpressions.Regex.Replace(
            sanitized,
            "(?i)([\\\"']?(?:api[_-]?key|access[_-]?token|token|secret)[\\\"']?\\s*[:=]\\s*[\\\"']?)[^\\\"'&,\\s}]+",
            "$1<redacted>");
        return sanitized;
    }
}

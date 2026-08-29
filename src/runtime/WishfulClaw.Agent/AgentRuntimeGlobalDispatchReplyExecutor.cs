using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// reply_global_dispatch executor — visible to normal/goal project sessions.
/// Records the target session agent's explicit result/blocker/follow-up on the
/// dispatch record (latest_report + status) and delivers it back to the global
/// agent's own session via the project/send-session-message reverse-request.
/// Never touches the session-scoped tasks table.
/// </summary>
public static class AgentRuntimeGlobalDispatchReplyExecutor
{
    private static readonly HashSet<string> AllowedReplyStatuses = new(StringComparer.Ordinal)
    {
        GlobalTaskDispatchStatusValues.InProgress,
        GlobalTaskDispatchStatusValues.Completed,
        GlobalTaskDispatchStatusValues.Blocked
    };

    public static bool IsGlobalDispatchReplyTool(string toolName)
    {
        return toolName == "reply_global_dispatch";
    }

    public static async Task<string> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        JsonElement parameters,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        if (!IsGlobalDispatchReplyTool(call.Name))
            return EncodeError($"Dispatch reply tool not registered: {call.Name}");

        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            var dispatchId = RequireString(call.Input, "dispatchId");
            var report = RequireString(call.Input, "report");
            var requestedStatus = JsonHelpers.GetString(call.Input, "status")?.Trim();

            // 1. Load the dispatch record (snake_case row).
            var getParams = WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                w.WriteString("id", dispatchId);
                w.WriteEndObject();
            });
            var getResponse = DbGlobalTaskDispatchTools.Get(getParams);
            if (!TryGetDispatch(getResponse, out var dispatch, out var getError))
                return EncodeError(getError ?? "Dispatch not found");

            var currentStatus = dispatch.GetProperty("status").GetString() ?? string.Empty;

            // 2. Resolve the new status: explicit value wins; otherwise an
            // untouched (pending/sent) dispatch becomes acknowledged.
            string newStatus;
            if (!string.IsNullOrEmpty(requestedStatus))
            {
                if (!AllowedReplyStatuses.Contains(requestedStatus))
                    return EncodeError("status must be one of: in_progress / completed / blocked");
                newStatus = requestedStatus;
            }
            else
            {
                newStatus = currentStatus is GlobalTaskDispatchStatusValues.Pending
                    or GlobalTaskDispatchStatusValues.Sent
                    ? GlobalTaskDispatchStatusValues.Acknowledged
                    : currentStatus;
            }

            var patch = WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                w.WriteString("id", dispatchId);
                w.WritePropertyName("patch");
                w.WriteStartObject();
                w.WriteString("status", newStatus);
                w.WriteString("latestReport", report);
                if (newStatus == GlobalTaskDispatchStatusValues.Completed)
                    w.WriteNumber("completedAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                w.WriteEndObject();
                w.WriteEndObject();
            });
            var updateResponse = DbGlobalTaskDispatchTools.Update(patch);
            if (!TryDbMutationOk(updateResponse, out var updateError))
                return EncodeError(updateError ?? "Failed to record the dispatch reply");

            // 3. Deliver the reply back to the global agent's session so it can
            // react in-conversation. Missing source session (legacy rows, deleted
            // global session) degrades to "recorded only" without failing.
            var delivered = false;
            string? deliveryNote = null;
            var sourceSessionId = dispatch.TryGetProperty("source_session_id", out var src)
                && src.ValueKind == JsonValueKind.String
                ? src.GetString()
                : null;
            if (!string.IsNullOrEmpty(sourceSessionId))
            {
                var globalTaskId = dispatch.GetProperty("global_task_id").GetString() ?? string.Empty;
                var fromSessionId = dispatch.GetProperty("session_id").GetString() ?? string.Empty;
                var content =
                    $"[GLOBAL DISPATCH REPLY] dispatch_id={dispatchId} global_task_id={globalTaskId} " +
                    $"from_session={fromSessionId} status={newStatus}\n\n{report}";

                var reverseParams = WorkerJsonHelper.BuildJsonElement(w =>
                {
                    w.WriteStartObject();
                    w.WriteString("sessionId", sourceSessionId);
                    w.WriteString("content", content);
                    w.WriteString("workingFolder", string.Empty);
                    w.WriteString("projectId", string.Empty);
                    w.WriteEndObject();
                });

                try
                {
                    var deliveryResult = await AgentRuntimeReverseRequests.RequestAsync(
                        context, "project/send-session-message", reverseParams, cancellationToken);
                    var failure = AgentRuntimeGlobalTaskExecutor.ExtractDeliveryFailure(deliveryResult);
                    if (failure is null)
                    {
                        delivered = true;
                    }
                    else
                    {
                        deliveryNote = $"Reply recorded but not delivered to the global session: {failure}";
                    }
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception deliveryEx)
                {
                    deliveryNote = $"Reply recorded but not delivered to the global session: {deliveryEx.Message}";
                }
            }
            else
            {
                deliveryNote = "Reply recorded; no global session to deliver to (dispatch has no source session).";
            }

            var result = JsonSerializer.Serialize(
                new GlobalDispatchReplyToolResult(true, dispatchId, newStatus, delivered, deliveryNote),
                WorkerJsonHelper.GetTypeInfo<GlobalDispatchReplyToolResult>());
            return result;
        }
        catch (OperationCanceledException) { throw; }
        catch (InvalidOperationException ex)
        {
            return EncodeError(ex.Message);
        }
        catch (Exception ex)
        {
            return EncodeError($"Failed to reply to dispatch: {ex.Message}");
        }
    }

    // ─── Helpers ───

    /// <summary>Parses the DbGlobalTaskDispatchTools.Get envelope into the snake_case dispatch row.</summary>
    private static bool TryGetDispatch(WorkerResponse response, out JsonElement dispatch, out string? error)
    {
        dispatch = default;
        try
        {
            using var document = JsonDocument.Parse(response.ToJsonBytes(null));
            var root = document.RootElement;
            if (root.TryGetProperty("error", out var envelopeError))
            {
                error = envelopeError.GetString();
                return false;
            }
            var result = root.GetProperty("result");
            if (!result.TryGetProperty("dispatch", out var row) || row.ValueKind != JsonValueKind.Object)
            {
                error = result.TryGetProperty("error", out var resultError)
                    ? resultError.GetString()
                    : "Dispatch not found";
                return false;
            }
            dispatch = row.Clone();
            error = null;
            return true;
        }
        catch (Exception ex)
        {
            error = $"Failed to read dispatch: {ex.Message}";
            return false;
        }
    }

    private static bool TryDbMutationOk(WorkerResponse response, out string? error)
    {
        try
        {
            using var document = JsonDocument.Parse(response.ToJsonBytes(null));
            var root = document.RootElement;
            if (root.TryGetProperty("error", out var envelopeError))
            {
                error = envelopeError.GetString();
                return false;
            }
            var result = root.GetProperty("result");
            if (result.ValueKind == JsonValueKind.Object
                && result.TryGetProperty("success", out var success)
                && !success.GetBoolean())
            {
                error = result.TryGetProperty("error", out var resultError) ? resultError.GetString() : "operation failed";
                return false;
            }
            error = null;
            return true;
        }
        catch (Exception ex)
        {
            error = $"Failed to update dispatch: {ex.Message}";
            return false;
        }
    }

    private static string RequireString(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException($"Expected object, got {element.ValueKind}");

        if (!element.TryGetProperty(name, out var prop) || prop.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException($"Missing or invalid required field: {name}");

        var value = prop.GetString()?.Trim();
        if (string.IsNullOrEmpty(value))
            throw new InvalidOperationException($"Required field '{name}' is empty");

        return value;
    }

    private static string EncodeError(string message)
    {
        var buffer = new System.Buffers.ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("error", message);
            writer.WriteEndObject();
        }
        return System.Text.Encoding.UTF8.GetString(buffer.WrittenSpan);
    }
}

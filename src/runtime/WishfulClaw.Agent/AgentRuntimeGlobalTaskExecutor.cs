using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Global agent task tools executor — list_global_tasks / create_global_task /
/// update_global_task / list_global_dispatches / send_work_request / update_dispatch.
/// CRUD runs directly against the DB tools (global_tasks / global_task_dispatches).
/// send_work_request creates a dispatch record and delivers the instruction through
/// the existing project/send-session-message reverse-request channel.
/// These tools never read or write the session-scoped tasks table.
/// </summary>
public static class AgentRuntimeGlobalTaskExecutor
{
    private static readonly HashSet<string> GlobalTaskToolNames = new(StringComparer.Ordinal)
    {
        "list_global_tasks", "create_global_task", "update_global_task",
        "list_global_dispatches", "send_work_request", "update_dispatch"
    };

    public static bool IsGlobalTaskTool(string toolName)
    {
        return GlobalTaskToolNames.Contains(toolName);
    }

    public static async Task<string> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        JsonElement parameters,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        return call.Name switch
        {
            "list_global_tasks" => ListGlobalTasks(call.Input, parameters),
            "create_global_task" => CreateGlobalTask(call.Input, parameters),
            "update_global_task" => UpdateGlobalTask(call.Input, parameters),
            "list_global_dispatches" => ListGlobalDispatches(call.Input, parameters),
            "send_work_request" => await SendWorkRequestAsync(call.Input, parameters, context, cancellationToken),
            "update_dispatch" => UpdateDispatch(call.Input, parameters),
            _ => EncodeError($"Global task tool not registered: {call.Name}")
        };
    }

    // ── list_global_tasks ──

    private static string ListGlobalTasks(JsonElement input, JsonElement parameters)
    {
        try
        {
            var dbParams = WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                CopyStringProperty(input, w, "status");
                CopyStringProperty(input, w, "keyword");
                CopyBooleanProperty(input, w, "includeArchived");
                w.WriteEndObject();
            });
            var response = DbGlobalTaskTools.List(dbParams);
            return ForwardDbResult(response);
        }
        catch (Exception ex)
        {
            return EncodeError($"Failed to list global tasks: {ex.Message}");
        }
    }

    // ── create_global_task ──

    private static string CreateGlobalTask(JsonElement input, JsonElement parameters)
    {
        try
        {
            var title = RequireString(input, "title");
            var taskId = $"gt_{Guid.NewGuid():N}";
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            var dbParams = WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                w.WriteString("id", taskId);
                w.WriteString("title", title);
                CopyStringProperty(input, w, "description");
                CopyStringProperty(input, w, "priority");
                CopyProperty(input, w, "tags");
                CopyNumberProperty(input, w, "dueAt");
                w.WriteEndObject();
            });

            var response = DbGlobalTaskTools.Create(dbParams);
            if (!TryDbResult(response, out _, out var error))
                return EncodeError(error ?? "Failed to create global task");

            var result = JsonSerializer.Serialize(
                new GlobalTaskCreateToolResult(taskId, title, GlobalTaskStatusValues.Pending, now),
                WorkerJsonHelper.GetTypeInfo<GlobalTaskCreateToolResult>());
            return result;
        }
        catch (InvalidOperationException ex)
        {
            return EncodeError(ex.Message);
        }
        catch (Exception ex)
        {
            return EncodeError($"Failed to create global task: {ex.Message}");
        }
    }

    // ── update_global_task ──

    private static string UpdateGlobalTask(JsonElement input, JsonElement parameters)
    {
        try
        {
            var taskId = RequireString(input, "taskId");
            if (!input.TryGetProperty("patch", out var patch) || patch.ValueKind != JsonValueKind.Object)
                return EncodeError("patch object is required");

            var dbParams = WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                w.WriteString("id", taskId);
                w.WritePropertyName("patch");
                patch.WriteTo(w);
                w.WriteEndObject();
            });

            var response = DbGlobalTaskTools.Update(dbParams);
            if (!TryDbResult(response, out var result, out var error))
                return EncodeError(error ?? "Failed to update global task");

            var changed = result.TryGetProperty("changed", out var c) ? c.GetInt32() : 0;
            return JsonSerializer.Serialize(
                new GlobalTaskMutationToolResult(true, taskId, changed, null),
                WorkerJsonHelper.GetTypeInfo<GlobalTaskMutationToolResult>());
        }
        catch (InvalidOperationException ex)
        {
            return EncodeError(ex.Message);
        }
        catch (Exception ex)
        {
            return EncodeError($"Failed to update global task: {ex.Message}");
        }
    }

    // ── list_global_dispatches ──

    private static string ListGlobalDispatches(JsonElement input, JsonElement parameters)
    {
        try
        {
            var dbParams = WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                CopyStringProperty(input, w, "globalTaskId");
                CopyStringProperty(input, w, "sessionId");
                CopyStringProperty(input, w, "projectId");
                CopyStringProperty(input, w, "status");
                w.WriteEndObject();
            });
            var response = DbGlobalTaskDispatchTools.List(dbParams);
            return ForwardDbResult(response);
        }
        catch (Exception ex)
        {
            return EncodeError($"Failed to list dispatches: {ex.Message}");
        }
    }

    // ── send_work_request ──

    private static async Task<string> SendWorkRequestAsync(
        JsonElement input, JsonElement parameters, IWorkerRequestContext context, CancellationToken cancellationToken)
    {
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            var globalTaskId = RequireString(input, "globalTaskId");
            var sessionId = RequireString(input, "sessionId");
            var instruction = RequireString(input, "instruction");
            var projectId = JsonHelpers.GetString(input, "projectId")?.Trim();

            var dispatchId = $"gd_{Guid.NewGuid():N}";
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            // 1. Create the dispatch record (validates task + session existence).
            var createParams = WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                w.WriteString("id", dispatchId);
                w.WriteString("globalTaskId", globalTaskId);
                w.WriteString("sessionId", sessionId);
                if (!string.IsNullOrEmpty(projectId))
                    w.WriteString("projectId", projectId);
                w.WriteString("kind", GlobalTaskDispatchKindValues.WorkRequest);
                w.WriteString("instruction", instruction);
                w.WriteString("status", GlobalTaskDispatchStatusValues.Pending);
                w.WriteEndObject();
            });
            var createResponse = DbGlobalTaskDispatchTools.Create(createParams);
            if (!TryDbResult(createResponse, out _, out var createError))
                return EncodeError(createError ?? "Failed to create dispatch record");

            // 2. Deliver the instruction through the existing reverse-request channel.
            var content =
                $"[GLOBAL AGENT WORK REQUEST] dispatch_id={dispatchId} global_task_id={globalTaskId}\n\n" +
                $"{instruction}\n\n" +
                "This work request was dispatched by the global agent. Decide yourself how to execute it " +
                "(including whether to create your own temporary Todos). When you finish or get blocked, " +
                "reply explicitly with the result or the blocker so the global agent can track it.";

            var reverseParams = WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                w.WriteString("sessionId", sessionId);
                w.WriteString("content", content);
                w.WriteString("workingFolder", string.Empty);
                w.WriteString("projectId", projectId ?? string.Empty);
                w.WriteEndObject();
            });

            try
            {
                await AgentRuntimeReverseRequests.RequestAsync(
                    context, "project/send-session-message", reverseParams, cancellationToken);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception deliveryEx)
            {
                // Delivery failed: record an explicit failure state on the dispatch.
                MarkDispatchFailed(dispatchId, $"Delivery failed: {deliveryEx.Message}");
                return EncodeError($"Work request delivery failed: {deliveryEx.Message}");
            }

            // 3. Mark the dispatch as sent.
            var sentPatch = WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                w.WriteString("id", dispatchId);
                w.WritePropertyName("patch");
                w.WriteStartObject();
                w.WriteString("status", GlobalTaskDispatchStatusValues.Sent);
                w.WriteEndObject();
                w.WriteEndObject();
            });
            DbGlobalTaskDispatchTools.Update(sentPatch);

            var result = JsonSerializer.Serialize(
                new GlobalDispatchCreateToolResult(true, dispatchId, globalTaskId, sessionId,
                    GlobalTaskDispatchStatusValues.Sent, null),
                WorkerJsonHelper.GetTypeInfo<GlobalDispatchCreateToolResult>());
            return result;
        }
        catch (OperationCanceledException) { throw; }
        catch (InvalidOperationException ex)
        {
            return EncodeError(ex.Message);
        }
        catch (Exception ex)
        {
            return EncodeError($"Failed to send work request: {ex.Message}");
        }
    }

    // ── update_dispatch ──

    private static string UpdateDispatch(JsonElement input, JsonElement parameters)
    {
        try
        {
            var dispatchId = RequireString(input, "dispatchId");
            if (!input.TryGetProperty("patch", out var patch) || patch.ValueKind != JsonValueKind.Object)
                return EncodeError("patch object is required");

            var normalizedPatch = NormalizeDispatchPatch(patch);
            var dbParams = WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                w.WriteString("id", dispatchId);
                w.WritePropertyName("patch");
                normalizedPatch.WriteTo(w);
                w.WriteEndObject();
            });

            var response = DbGlobalTaskDispatchTools.Update(dbParams);
            if (!TryDbResult(response, out var result, out var error))
                return EncodeError(error ?? "Failed to update dispatch");

            var changed = result.TryGetProperty("changed", out var c) ? c.GetInt32() : 0;
            return JsonSerializer.Serialize(
                new GlobalDispatchUpdateToolResult(true, dispatchId, changed, null),
                WorkerJsonHelper.GetTypeInfo<GlobalDispatchUpdateToolResult>());
        }
        catch (InvalidOperationException ex)
        {
            return EncodeError(ex.Message);
        }
        catch (Exception ex)
        {
            return EncodeError($"Failed to update dispatch: {ex.Message}");
        }
    }

    // ─── Helpers ───

    /// <summary>
    /// Stamp completedAt automatically when the patch marks a dispatch as
    /// completed without supplying a completion timestamp.
    /// </summary>
    private static JsonElement NormalizeDispatchPatch(JsonElement patch)
    {
        var statusCompleted = patch.TryGetProperty("status", out var status)
            && status.ValueKind == JsonValueKind.String
            && status.GetString() == GlobalTaskDispatchStatusValues.Completed;
        var hasCompletedAt = patch.TryGetProperty("completedAt", out _);
        if (!statusCompleted || hasCompletedAt)
            return patch;

        return WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            foreach (var property in patch.EnumerateObject())
            {
                w.WritePropertyName(property.Name);
                property.Value.WriteTo(w);
            }
            w.WriteNumber("completedAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            w.WriteEndObject();
        });
    }

    private static void MarkDispatchFailed(string dispatchId, string error)
    {
        try
        {
            var dbParams = WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                w.WriteString("id", dispatchId);
                w.WritePropertyName("patch");
                w.WriteStartObject();
                w.WriteString("status", GlobalTaskDispatchStatusValues.Failed);
                w.WriteString("error", error);
                w.WriteEndObject();
                w.WriteEndObject();
            });
            DbGlobalTaskDispatchTools.Update(dbParams);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"MarkDispatchFailed({dispatchId}) failed: {ex.Message}");
        }
    }

    /// <summary>Returns the DB result JSON verbatim, or an encoded error envelope.</summary>
    private static string ForwardDbResult(WorkerResponse response)
    {
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        var root = document.RootElement;
        if (root.TryGetProperty("error", out var error))
            return EncodeError(error.GetString() ?? "DB operation failed");
        return root.GetProperty("result").GetRawText();
    }

    private static bool TryDbResult(WorkerResponse response, out JsonElement result, out string? error)
    {
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        var root = document.RootElement;
        if (root.TryGetProperty("error", out var envelopeError))
        {
            result = default;
            error = envelopeError.GetString();
            return false;
        }
        result = root.GetProperty("result").Clone();
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

    private static void CopyStringProperty(JsonElement source, Utf8JsonWriter writer, string name)
    {
        if (source.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String)
        {
            writer.WritePropertyName(name);
            value.WriteTo(writer);
        }
    }

    private static void CopyNumberProperty(JsonElement source, Utf8JsonWriter writer, string name)
    {
        if (source.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number)
        {
            writer.WritePropertyName(name);
            value.WriteTo(writer);
        }
    }

    private static void CopyBooleanProperty(JsonElement source, Utf8JsonWriter writer, string name)
    {
        if (source.TryGetProperty(name, out var value)
            && value.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            writer.WritePropertyName(name);
            value.WriteTo(writer);
        }
    }

    private static void CopyProperty(JsonElement source, Utf8JsonWriter writer, string name)
    {
        if (source.TryGetProperty(name, out var value))
        {
            writer.WritePropertyName(name);
            value.WriteTo(writer);
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

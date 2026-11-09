using System.Text.Json;
using WishfulClaw.Agent.Results;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent.Executors;

/// <summary>
/// reply_global_dispatch executor — visible to normal/goal project sessions.
/// Records the target session agent's explicit result/blocker/follow-up on the
/// dispatch record (latest_report + status) and delivers it back to the global
/// agent's own session via the project/send-session-message reverse-request.
/// Never touches the session-scoped tasks table.
/// </summary>
public static class AgentRuntimeGlobalDispatchReplyExecutor
{
    // Serialize the read/check/write/delivery sequence so concurrent retries in
    // this worker cannot both notify the source session.
    private static readonly SemaphoreSlim ReplyGate = new(1, 1);

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
        await ReplyGate.WaitAsync(cancellationToken);
        try
        {
            return await ExecuteCoreAsync(call, parameters, context, cancellationToken);
        }
        finally
        {
            ReplyGate.Release();
        }
    }

    private static async Task<string> ExecuteCoreAsync(
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
            var getResponse = ReadDispatchRow(dispatchId, getParams);
            if (!TryGetDispatch(getResponse, out var dispatch, out var getError))
                return EncodeError(getError ?? "Dispatch not found");

            var currentStatus = DispatchStatusMachine.ReadStatus(dispatch);
            var currentReport = DispatchStatusMachine.ReadLatestReport(dispatch);
            var callerSessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim();
            var targetSessionId = dispatch.GetProperty("session_id").GetString()?.Trim();
            if (string.IsNullOrEmpty(callerSessionId) ||
                !string.Equals(callerSessionId, targetSessionId, StringComparison.Ordinal))
            {
                return EncodeError("Dispatch reply is only allowed from its target session.");
            }

            // 2. 状态决议走公共层 DispatchStatusMachine（两张派活表共用一份，不复制粘贴）。
            string newStatus;
            try
            {
                newStatus = DispatchStatusMachine.ResolveExplicitReply(currentStatus, requestedStatus);
            }
            catch (InvalidOperationException ex)
            {
                return EncodeError(ex.Message);
            }

            // S-280 铁律：**显式永远覆盖隐式**。completed_implicit 不是终态，
            // 目标会话事后补一条显式回执必须能改写它 —— 所以这里只拦真正的终态。
            if (DispatchStatusMachine.IsTerminal(currentStatus) ||
                (string.Equals(currentStatus, newStatus, StringComparison.Ordinal) &&
                 string.Equals(currentReport, report, StringComparison.Ordinal)))
            {
                return EncodeSuccess(dispatchId, currentStatus, delivered: false,
                    note: "Dispatch reply already recorded; source session was not woken again.");
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
            var updateResponse = UpdateDispatchRow(dispatchId, patch);
            if (!TryDbMutationOk(updateResponse, out var updateError))
                return EncodeError(updateError ?? "Failed to record the dispatch reply");

            // Timeline instrumentation (S-25.4): dispatch reply is a decision point.
            DbAgentTimelineTools.Log(
                DbClient.GetClient(),
                callerSessionId,
                null,
                "task_reported",
                report,
                DbAgentTimelineTools.Metadata(
                    ("dispatch_id", dispatchId),
                    ("global_task_id", dispatch.GetProperty("global_task_id").GetString()),
                    ("from", currentStatus),
                    ("to", newStatus)));

            await AgentRuntimeGlobalBoardEvents.EmitDispatchChangedAsync(
                context,
                dispatchId,
                dispatch.GetProperty("global_task_id").GetString() ?? string.Empty,
                "replied");

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
                    // S-279 收尾（2026-10-31）：回执在全局会话里也得是卡片。
                    // `content` 那串协议头（dispatch_id / from_session / status）是给模型
                    // 定位用的，落到聊天窗就是一段污染 —— 正文走 `displayContent`，
                    // 结构化字段进 `meta.globalDispatchReply` 供渲染端做徽章（S-278 同一机制）。
                    w.WriteString("displayContent", report);
                    w.WritePropertyName("meta");
                    w.WriteStartObject();
                    w.WritePropertyName("globalDispatchReply");
                    w.WriteStartObject();
                    w.WriteString("dispatchId", dispatchId);
                    // 普通消息（`gm_`）不绑任务，这一列是空串。空值就不写字段 ——
                    // 与 `globalDispatch` 那边的口径一致（可选字段宁可缺席，不要落 `""`，
                    // 否则渲染端拿到 `globalTaskId: ""` 得额外判一次 falsy）。
                    if (!string.IsNullOrEmpty(globalTaskId)) w.WriteString("globalTaskId", globalTaskId);
                    w.WriteString("fromSessionId", fromSessionId);
                    w.WriteString("status", newStatus);
                    w.WriteEndObject();
                    w.WriteEndObject();
                    w.WriteString("workingFolder", string.Empty);
                    w.WriteString("projectId", string.Empty);
                    // The source session is the global agent's own session —
                    // deliver in global mode so it keeps its identity prompt
                    // and global-only tools (update_dispatch, etc.).
                    w.WriteString("sessionMode", "global");
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

            return EncodeSuccess(dispatchId, newStatus, delivered, deliveryNote);
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

    /// <summary>
    /// S-279：回执入口按 id 前缀分表查 —— <c>gm_</c> 走普通消息派活表，其余走任务派活表。
    /// 路由规则只在 <see cref="DispatchTableRouter"/> 里写一份，这里不重复判断前缀。
    /// </summary>
    private static WorkerResponse ReadDispatchRow(string dispatchId, JsonElement getParams)
    {
        return DispatchTableRouter.IsMessageDispatch(dispatchId)
            ? DbGlobalMessageDispatchTools.Get(getParams)
            : DbGlobalTaskDispatchTools.Get(getParams);
    }

    private static WorkerResponse UpdateDispatchRow(string dispatchId, JsonElement patchParams)
    {
        return DispatchTableRouter.IsMessageDispatch(dispatchId)
            ? DbGlobalMessageDispatchTools.Update(patchParams)
            : DbGlobalTaskDispatchTools.Update(patchParams);
    }

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

    private static string EncodeSuccess(string dispatchId, string status, bool delivered, string? note)
    {
        return JsonSerializer.Serialize(
            new GlobalDispatchReplyToolResult(true, dispatchId, status, delivered, note),
            WorkerJsonHelper.GetTypeInfo<GlobalDispatchReplyToolResult>());
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

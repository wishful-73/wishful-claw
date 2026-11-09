using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent.Executors;

/// <summary>
/// S-301: <c>list_user_messages</c> — the agent reading back the user's own messages in this session.
///
/// <para><b>The one hard boundary lives here</b>: the session id is taken from the run state
/// (<c>parameters.sessionId</c>, injected by <c>AgentRuntimeTools.ExecuteRunAsync</c>), never from
/// the model's tool input (<c>input</c>). Letting the model pass a session id would hand the
/// "which sessions may I read" decision to the model — a global PM could then read a project
/// session's user messages, which is exactly the thing this feature must not allow. Same
/// convention as <c>AgentRuntimeGlobalTaskExecutor.ResolveCurrentProjectId</c> (S-300).</para>
/// </summary>
public static class AgentRuntimeSessionHistoryExecutor
{
    private const string ListUserMessagesTool = "list_user_messages";

    public static bool IsSessionHistoryTool(string toolName) =>
        string.Equals(toolName, ListUserMessagesTool, StringComparison.Ordinal);

    public static string Execute(JsonElement input, JsonElement parameters)
    {
        try
        {
            var sessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim();
            if (string.IsNullOrEmpty(sessionId))
            {
                // __default__ (empty session id) has no DB history — say so instead of
                // returning an empty list that reads like "the user said nothing".
                return EncodeError("This run has no session, so there is no user history to read.");
            }

            var dbParams = WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                w.WriteString("sessionId", sessionId);
                CopyStringProperty(input, w, "date");
                CopyNumberProperty(input, w, "limit");
                w.WriteEndObject();
            });

            var response = DbMessageTools.ListUserMessages(dbParams);
            return ForwardDbResult(response);
        }
        catch (Exception ex)
        {
            return EncodeError($"Failed to list user messages: {ex.Message}");
        }
    }

    /// <summary>Returns the DB result JSON verbatim, or an encoded error envelope.</summary>
    private static string ForwardDbResult(WorkerResponse response)
    {
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        var root = document.RootElement;
        if (root.TryGetProperty("error", out var error))
        {
            return EncodeError(error.GetString() ?? "DB operation failed");
        }

        var result = root.GetProperty("result");
        // The DB result carries its own success flag; a failed query must surface as a tool
        // error rather than as an empty-but-successful list the model would trust.
        if (result.TryGetProperty("success", out var success) &&
            success.ValueKind == JsonValueKind.False)
        {
            var message = result.TryGetProperty("error", out var resultError)
                ? resultError.GetString()
                : null;
            return EncodeError(message ?? "Failed to list user messages.");
        }
        return result.GetRawText();
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

    private static string EncodeError(string message) =>
        WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteBoolean("error", true);
            w.WriteString("message", message);
            w.WriteEndObject();
        }).GetRawText();
}

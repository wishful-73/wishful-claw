using System.Buffers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Terminal tool executor: start / read / stop a long-lived process in the user's bottom terminal dock.
///
/// Routed through the Main process as a reverse-request (terminal:start / read / stop) rather than
/// spawned here, because the point of the tool is a process the user can see and touch: Main owns the
/// node-pty sessions behind the dock, so the agent's process lands in the same list as the user's own
/// terminals — same buffer, same tab, same kill path.
///
/// Unlike <see cref="AgentRuntimeSshToolExecutor"/> this is always local. A remote PTY would be a
/// second, invisible session type; SSH projects keep their own terminal story untouched.
/// </summary>
public static class AgentRuntimeTerminalExecutor
{
    private static readonly HashSet<string> TerminalToolNames = new(StringComparer.Ordinal)
    {
        "Terminal"
    };

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    // ── Detection ──

    /// <summary>
    /// Checks if the tool name is the terminal tool.
    /// </summary>
    public static bool IsTerminalTool(string toolName)
    {
        return TerminalToolNames.Contains(toolName);
    }

    // ── Execution ──

    /// <summary>
    /// Dispatches on the requested action. Each action is a separate Main-process reverse-request.
    /// </summary>
    public static async Task<(string Output, bool IsError)> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        JsonElement runParameters,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var action = JsonHelpers.GetString(call.Input, "action")?.Trim().ToLowerInvariant();

        return action switch
        {
            "start" => await StartAsync(call, runParameters, context, cancellationToken),
            "read" => await ReadAsync(call, context, cancellationToken),
            "stop" => await StopAsync(call, context, cancellationToken),
            _ => (EncodeError("Missing or invalid 'action'. Use 'start', 'read', or 'stop'."), true)
        };
    }

    private static async Task<(string Output, bool IsError)> StartAsync(
        AgentRuntimeNativeToolCall call,
        JsonElement runParameters,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var input = call.Input;
        var command = JsonHelpers.GetString(input, "command")?.Trim();
        if (string.IsNullOrWhiteSpace(command))
        {
            return (EncodeError("Missing 'command' field — it is required when action is 'start'."), true);
        }

        // The bottom dock filters tabs by session, so a terminal started without a session id would
        // run with nothing pointing at it. Same rule the goal tools already enforce.
        var sessionId = JsonHelpers.GetString(runParameters, "sessionId")?.Trim();
        if (string.IsNullOrWhiteSpace(sessionId))
        {
            return (EncodeError("No active session — a terminal belongs to a session and cannot be started outside one."), true);
        }

        // Working directory: explicit cwd, else the session's working folder.
        var cwd = JsonHelpers.GetString(input, "cwd")?.Trim();
        if (string.IsNullOrWhiteSpace(cwd))
        {
            cwd = JsonHelpers.GetString(runParameters, "workingFolder")?.Trim();
        }

        var shell = JsonHelpers.GetString(input, "shell")?.Trim();
        var title = JsonHelpers.GetString(input, "title")?.Trim();
        var projectId = JsonHelpers.GetString(runParameters, "projectId")?.Trim();

        var request = CreateJsonObject(writer =>
        {
            writer.WriteString("command", command);
            writer.WriteString("sessionId", sessionId);
            if (!string.IsNullOrWhiteSpace(cwd))
                writer.WriteString("cwd", cwd);
            if (!string.IsNullOrWhiteSpace(shell))
                writer.WriteString("shell", shell);
            if (!string.IsNullOrWhiteSpace(title))
                writer.WriteString("title", title);
            if (!string.IsNullOrWhiteSpace(projectId))
                writer.WriteString("projectId", projectId);

            // env passes through as written: Main owns sanitizing the override names and filtering
            // undefined values, so there is no second opinion to hold here.
            if (input.ValueKind == JsonValueKind.Object
                && input.TryGetProperty("env", out var env)
                && env.ValueKind == JsonValueKind.Object)
            {
                writer.WritePropertyName("env");
                env.WriteTo(writer);
            }
        });

        WorkerLog.Debug($"agent terminal start session={MaskId(sessionId)} commandLen={command.Length}");

        JsonElement response;
        try
        {
            response = await AgentRuntimeReverseRequests.RequestAsync(
                context, "terminal:start", request, cancellationToken);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"agent terminal start failed: {ex.GetType().Name}: {ex.Message}");
            return (EncodeError($"Failed to start terminal: {ex.Message}"), true);
        }

        if (!JsonHelpers.GetBool(response, "success", false))
        {
            return (EncodeError(JsonHelpers.GetString(response, "error") ?? "Failed to start terminal."), true);
        }

        var terminalId = JsonHelpers.GetString(response, "terminalId") ?? string.Empty;
        var status = JsonHelpers.GetString(response, "status") ?? "running";
        var reused = JsonHelpers.GetBool(response, "reused", false);
        var tail = JsonHelpers.GetString(response, "tail") ?? string.Empty;
        var exitCode = JsonHelpers.GetInt(response, "exitCode", -1);
        // Main owns the wording because it owns the reason: "attached to the running process" and
        // "typed it in again after an interrupt" are different answers to the same call.
        var note = JsonHelpers.GetString(response, "note") ?? string.Empty;

        WorkerLog.Debug($"agent terminal start done terminal={MaskId(terminalId)} reused={reused} status={status}");

        if (string.IsNullOrEmpty(terminalId))
        {
            return (EncodeError("Terminal start returned no terminalId."), true);
        }

        var output = EncodeJsonObject(writer =>
        {
            writer.WriteString("terminalId", terminalId);
            writer.WriteString("status", status);
            if (exitCode >= 0)
                writer.WriteNumber("exitCode", exitCode);
            writer.WriteString("command", command);
            writer.WriteString("tail", tail);
            if (!string.IsNullOrEmpty(note))
            {
                writer.WriteString("note", note);
            }
        });

        // A process that has already exited is not an error: the output is the answer, and the
        // caller reads 'status' to tell the two apart.
        return (output, false);
    }

    private static async Task<(string Output, bool IsError)> ReadAsync(
        AgentRuntimeNativeToolCall call,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var terminalId = JsonHelpers.GetString(call.Input, "terminalId")?.Trim();
        if (string.IsNullOrWhiteSpace(terminalId))
        {
            return (EncodeError("Missing 'terminalId' field — it is required when action is 'read'."), true);
        }

        var request = CreateJsonObject(writer => writer.WriteString("terminalId", terminalId));

        JsonElement response;
        try
        {
            response = await AgentRuntimeReverseRequests.RequestAsync(
                context, "terminal:read", request, cancellationToken);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"agent terminal read failed: {ex.GetType().Name}: {ex.Message}");
            return (EncodeError($"Failed to read terminal: {ex.Message}"), true);
        }

        if (!JsonHelpers.GetBool(response, "success", false))
        {
            return (EncodeError(JsonHelpers.GetString(response, "error") ?? "Failed to read terminal."), true);
        }

        var status = JsonHelpers.GetString(response, "status") ?? "running";
        var text = JsonHelpers.GetString(response, "text") ?? string.Empty;
        var exitCode = JsonHelpers.GetInt(response, "exitCode", -1);

        var output = EncodeJsonObject(writer =>
        {
            writer.WriteString("terminalId", terminalId);
            writer.WriteString("status", status);
            if (exitCode >= 0)
                writer.WriteNumber("exitCode", exitCode);
            writer.WriteString("text", text);
        });

        return (output, false);
    }

    private static async Task<(string Output, bool IsError)> StopAsync(
        AgentRuntimeNativeToolCall call,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var terminalId = JsonHelpers.GetString(call.Input, "terminalId")?.Trim();
        if (string.IsNullOrWhiteSpace(terminalId))
        {
            return (EncodeError("Missing 'terminalId' field — it is required when action is 'stop'."), true);
        }

        var request = CreateJsonObject(writer => writer.WriteString("terminalId", terminalId));

        JsonElement response;
        try
        {
            response = await AgentRuntimeReverseRequests.RequestAsync(
                context, "terminal:stop", request, cancellationToken);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"agent terminal stop failed: {ex.GetType().Name}: {ex.Message}");
            return (EncodeError($"Failed to stop terminal: {ex.Message}"), true);
        }

        if (!JsonHelpers.GetBool(response, "success", false))
        {
            return (EncodeError(JsonHelpers.GetString(response, "error") ?? "Failed to stop terminal."), true);
        }

        WorkerLog.Debug($"agent terminal stop done terminal={MaskId(terminalId)}");

        return (EncodeJsonObject(writer =>
        {
            writer.WriteString("terminalId", terminalId);
            writer.WriteString("status", "stopped");
        }), false);
    }

    // ── Helpers ──

    private static string EncodeError(string message)
    {
        return EncodeJsonObject(writer => writer.WriteString("error", message));
    }

    private static string EncodeJsonObject(Action<Utf8JsonWriter> writeProperties)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            writeProperties(writer);
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    private static JsonElement CreateJsonObject(Action<Utf8JsonWriter> writeProperties)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            writeProperties(writer);
            writer.WriteEndObject();
        }
        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    private static string MaskId(string? id)
    {
        if (string.IsNullOrEmpty(id))
            return "(none)";
        if (id.Length <= 8)
            return id[..4] + "****";
        return id[..4] + "****" + id[^4..];
    }
}

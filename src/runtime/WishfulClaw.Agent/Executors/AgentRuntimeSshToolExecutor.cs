/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Buffers;
using System.Diagnostics;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent.Executors;

/// <summary>
/// SSH tool executor that routes Bash/Shell commands to a remote SSH server
/// via the Main process's connection manager (ssh:exec IPC).
///
/// Only Bash/Shell remote execution is supported — no remote file operations
/// (Read/Write/Edit/LS/Glob/Grep). The Main process maintains persistent SSH
/// connections via ssh2, so each call reuses the long-lived connection and
/// returns structured {stdout, stderr, exitCode} without interactive PTY.
///
/// Ported from WishfulClaw AgentRuntimeSshToolExecutor (simplified).
/// </summary>
public static class AgentRuntimeSshToolExecutor
{
    private const int ShellDefaultTimeoutMs = 600_000;   // 10 min
    private const int ShellMaxTimeoutMs = 3_600_000;      // 1 hour
    private const int ShellMaxOutputChars = 12_000;

    private static readonly HashSet<string> SshToolNames = new(StringComparer.Ordinal)
    {
        "Bash", "Shell", "ShellExec"
    };

    private static readonly HashSet<string> SshInfoToolNames = new(StringComparer.Ordinal)
    {
        "SshListConnections"
    };

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    // ── Detection ──

    /// <summary>
    /// Checks if the tool name is one that can be routed to SSH.
    /// </summary>
    public static bool IsSshCapableTool(string toolName)
    {
        return SshToolNames.Contains(toolName);
    }

    /// <summary>
    /// Checks if the tool name is an SSH info tool (e.g. list connections).
    /// </summary>
    public static bool IsSshInfoTool(string toolName)
    {
        return SshInfoToolNames.Contains(toolName);
    }

    /// <summary>
    /// Determines whether a tool call should be routed to SSH.
    /// True when the tool is SSH-capable AND an sshConnectionId is present
    /// (either in the tool input or in the run-level parameters).
    /// </summary>
    public static bool ShouldRouteToSsh(string toolName, JsonElement toolInput, JsonElement runParameters)
    {
        if (!IsSshCapableTool(toolName))
            return false;

        // Agent can force local execution by passing local: true
        if (JsonHelpers.GetBool(toolInput, "local", false))
            return false;

        // Check tool input first (Agent explicitly passes sshConnectionId)
        var connId = JsonHelpers.GetString(toolInput, "sshConnectionId");
        if (!string.IsNullOrWhiteSpace(connId))
            return true;

        // Check run-level parameters (project/session-level SSH binding)
        connId = JsonHelpers.GetString(runParameters, "sshConnectionId");
        return !string.IsNullOrWhiteSpace(connId);
    }

    // ── Execution ──

    /// <summary>
    /// Executes a Bash/Shell command on a remote SSH server.
    /// Routes through Main process via ssh:exec reverse-request.
    /// </summary>
    public static async Task<(string Output, bool IsError)> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        JsonElement runParameters,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var input = call.Input;
        var command = JsonHelpers.GetString(input, "command");
        if (string.IsNullOrWhiteSpace(command))
        {
            return (EncodeError("Missing 'command' field"), true);
        }

        // Resolve connection ID: tool input takes priority, then run parameters
        var connectionId = JsonHelpers.GetString(input, "sshConnectionId")
            ?? JsonHelpers.GetString(runParameters, "sshConnectionId");
        if (string.IsNullOrWhiteSpace(connectionId))
        {
            return (EncodeError("No SSH connection specified. Pass sshConnectionId in the tool call or bind a connection at the project level."), true);
        }

        // Resolve working directory
        var cwd = JsonHelpers.GetString(input, "cwd")?.Trim();
        if (string.IsNullOrWhiteSpace(cwd))
        {
            cwd = JsonHelpers.GetString(runParameters, "workingFolder")?.Trim();
        }

        // Build remote command: cd to working dir first if specified
        var remoteCommand = string.IsNullOrWhiteSpace(cwd)
            ? command
            : $"cd {ShellQuote(cwd)} && {command}";

        var timeoutMs = Math.Clamp(
            JsonHelpers.GetInt(input, "timeout", ShellDefaultTimeoutMs),
            1,
            ShellMaxTimeoutMs);

        var startedAt = Stopwatch.GetTimestamp();

        WorkerLog.Debug(
            $"agent ssh exec start tool={call.Name} connectionId={MaskId(connectionId)} " +
            $"commandLen={command.Length} timeoutMs={timeoutMs}");

        // Build request for Main process ssh:exec
        var request = CreateJsonObject(writer =>
        {
            writer.WriteString("connectionId", connectionId);
            writer.WriteString("command", remoteCommand);
            writer.WriteNumber("timeoutMs", timeoutMs);
            // execId lets the frontend correlate real-time output chunks
            // (ssh:exec-output events) with this specific tool call.
            writer.WriteString("execId", call.Id);
        });

        JsonElement response;
        try
        {
            response = await AgentRuntimeReverseRequests.RequestAsync(
                context, "ssh:exec", request, cancellationToken);
        }
        catch (Exception ex)
        {
            var elapsedMs = ElapsedMs(startedAt);
            WorkerLog.Warn(
                $"agent ssh exec failed tool={call.Name} connectionId={MaskId(connectionId)} " +
                $"elapsedMs={elapsedMs} error={ex.GetType().Name}: {ex.Message}");
            return (EncodeError($"SSH exec failed: {ex.Message}"), true);
        }

        var elapsedMsTotal = ElapsedMs(startedAt);
        var success = JsonHelpers.GetBool(response, "success", false);
        var exitCode = JsonHelpers.GetInt(response, "exitCode", -1);
        var stdout = JsonHelpers.GetString(response, "stdout") ?? string.Empty;
        var stderr = JsonHelpers.GetString(response, "stderr") ?? string.Empty;
        var error = JsonHelpers.GetString(response, "error");

        WorkerLog.Debug(
            $"agent ssh exec done tool={call.Name} connectionId={MaskId(connectionId)} " +
            $"exitCode={exitCode} success={success} elapsedMs={elapsedMsTotal} " +
            $"stdoutLen={stdout.Length} stderrLen={stderr.Length}");

        // Build structured output
        var displayCwd = string.IsNullOrWhiteSpace(cwd) ? "~" : cwd;
        var output = EncodeJsonObject(writer =>
        {
            writer.WriteNumber("exitCode", exitCode);
            writer.WriteString("stdout", Truncate(stdout, ShellMaxOutputChars));
            writer.WriteString("stderr", Truncate(stderr, ShellMaxOutputChars));
            writer.WriteString("cwd", displayCwd);
            writer.WriteString("command", command);
            writer.WriteNumber("totalMs", elapsedMsTotal);
            writer.WriteString("executionEngine", "ssh");
            if (!string.IsNullOrEmpty(error))
            {
                writer.WriteString("error", error);
            }
        });

        // Error if exit code is non-zero and no stdout/stderr
        var isError = !success || (exitCode != 0 && string.IsNullOrWhiteSpace(stdout) && string.IsNullOrWhiteSpace(stderr));
        return (output, isError);
    }

    // ── SSH Info Tools ──

    /// <summary>
    /// Lists all available SSH connections by reverse-requesting the Main process.
    /// Returns a JSON array of connection metadata (id, name, host, port, username, authType).
    /// </summary>
    public static async Task<(string Output, bool IsError)> ExecuteListConnectionsAsync(
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        WorkerLog.Debug("agent ssh list-connections start");

        JsonElement response;
        try
        {
            // SshListConnections takes no parameters — send an empty JSON object
            var emptyRequest = CreateJsonObject(writer => { });
            response = await AgentRuntimeReverseRequests.RequestAsync(
                context, "ssh:connection:list", emptyRequest, cancellationToken);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"agent ssh list-connections failed: {ex.GetType().Name}: {ex.Message}");
            return (EncodeError($"Failed to list SSH connections: {ex.Message}"), true);
        }

        // Build a compact summary for the Agent
        var connections = new List<(string Id, string Name, string Host, int Port, string Username, string AuthType)>();

        if (response.ValueKind == JsonValueKind.Array)
        {
            foreach (var conn in response.EnumerateArray())
            {
                var id = JsonHelpers.GetString(conn, "id") ?? "";
                var name = JsonHelpers.GetString(conn, "name") ?? "";
                var host = JsonHelpers.GetString(conn, "host") ?? "";
                var port = JsonHelpers.GetInt(conn, "port", 22);
                var username = JsonHelpers.GetString(conn, "username") ?? "";
                var authType = JsonHelpers.GetString(conn, "authType") ?? "";
                connections.Add((id, name, host, port, username, authType));
            }
        }

        WorkerLog.Debug($"agent ssh list-connections done count={connections.Count}");

        if (connections.Count == 0)
        {
            return (EncodeJsonObject(writer =>
            {
                writer.WriteString("message", "No SSH connections configured. Ask the user to set up SSH connections in Settings > SSH.");
                writer.WriteStartArray("connections");
                writer.WriteEndArray();
            }), false);
        }

        var output = EncodeJsonObject(writer =>
        {
            writer.WriteStartArray("connections");
            foreach (var c in connections)
            {
                writer.WriteStartObject();
                writer.WriteString("id", c.Id);
                writer.WriteString("name", c.Name);
                writer.WriteString("host", c.Host);
                writer.WriteNumber("port", c.Port);
                writer.WriteString("username", c.Username);
                writer.WriteString("authType", c.AuthType);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            writer.WriteString("hint", "Use the 'id' value as the sshConnectionId parameter in the Bash tool to execute commands on the remote server.");
        });

        return (output, false);
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

    /// <summary>
    /// Shell-quote a path for use in "cd {path} && command".
    /// Uses single quotes, escaping any embedded single quotes.
    /// </summary>
    private static string ShellQuote(string value)
    {
        if (string.IsNullOrEmpty(value))
            return "''";

        // If it's a simple path without special chars, no quoting needed
        if (value.All(c => char.IsLetterOrDigit(c) || c is '/' or '_' or '-' or '.' or '~'))
            return value;

        return "'" + value.Replace("'", "'\\''") + "'";
    }

    private static string Truncate(string value, int maxChars)
    {
        if (string.IsNullOrEmpty(value) || value.Length <= maxChars)
            return value;
        return value[..maxChars] + "\n[output truncated at " + maxChars + " chars]";
    }

    private static string MaskId(string? id)
    {
        if (string.IsNullOrEmpty(id))
            return "(none)";
        if (id.Length <= 8)
            return id[..4] + "****";
        return id[..4] + "****" + id[^4..];
    }

    private static long ElapsedMs(long startedAt)
    {
        return (long)Math.Round(Stopwatch.GetElapsedTime(startedAt).TotalMilliseconds);
    }
}

/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Diagnostics;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Code compatible tool executor — PowerShell execution and output monitoring.
/// Simplified port from WishfulClaw (uses Process directly, no session management).
/// Ported from WishfulClaw AgentRuntimeCodeCompatibleExecutor.
/// </summary>
public static class AgentRuntimeCodeCompatibleExecutor
{
    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static bool IsCodeCompatibleTool(string toolName)
    {
        return string.Equals(toolName, "PowerShell", StringComparison.Ordinal) ||
               string.Equals(toolName, "Monitor", StringComparison.Ordinal);
    }

    public static async Task<string> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        if (string.Equals(call.Name, "PowerShell", StringComparison.Ordinal))
        {
            return await ExecutePowerShellAsync(call, parameters, cancellationToken);
        }

        if (string.Equals(call.Name, "Monitor", StringComparison.Ordinal))
        {
            return await ExecuteMonitorAsync(call, parameters, cancellationToken);
        }

        return EncodeError($"Unknown code compatible tool: {call.Name}");
    }

    private static async Task<string> ExecutePowerShellAsync(
        AgentRuntimeNativeToolCall call,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        // 参数名必须与 CodeCompatibleToolProvider 的 schema 对齐 —— 那里声明的是
        // "command"。历史上这里读的是 "script"，两边对不上，于是这个工具对任何调用方
        // （直连、代理都一样）都只回一句「requires a non-empty script」。
        var command = JsonHelpers.GetString(call.Input, "command")?.Trim() ?? string.Empty;
        if (command.Length == 0)
        {
            return EncodeError("PowerShell requires a non-empty command.");
        }

        var cwd = JsonHelpers.GetString(parameters, "workingFolder") ??
                  JsonHelpers.GetString(call.Input, "cwd") ??
                  Environment.CurrentDirectory;
        var timeoutMs = JsonHelpers.GetInt(call.Input, "timeoutMs", 60_000);

        var psi = new ProcessStartInfo
        {
            FileName = OperatingSystem.IsWindows() ? "powershell.exe" : "pwsh",
            // -EncodedCommand 收 Base64(UTF-16LE)，脚本原样送到 PowerShell，不经过命令行
            // 引号/转义解析。手拼 \" 的写法遇到脚本内的引号、$、反斜杠就会被拆坏。
            Arguments = $"-NoLogo -NoProfile -EncodedCommand {Convert.ToBase64String(Encoding.Unicode.GetBytes(command))}",
            WorkingDirectory = Directory.Exists(cwd) ? cwd : Environment.CurrentDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        try
        {
            using var process = Process.Start(psi);
            if (process is null)
            {
                return EncodeError("Failed to start PowerShell process.");
            }

            var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
            var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);

            if (!process.WaitForExit(timeoutMs))
            {
                process.Kill(entireProcessTree: true);
                return EncodeError($"PowerShell timed out after {timeoutMs}ms.");
            }

            var stdout = await stdoutTask;
            var stderr = await stderrTask;

            return EncodeJsonObject(writer =>
            {
                writer.WriteNumber("exitCode", process.ExitCode);
                writer.WriteString("stdout", stdout);
                writer.WriteString("stderr", stderr);
                writer.WriteBoolean("success", process.ExitCode == 0);
            });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return EncodeError($"PowerShell execution failed: {ex.Message}");
        }
    }

    private static async Task<string> ExecuteMonitorAsync(
        AgentRuntimeNativeToolCall call,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        var command = JsonHelpers.GetString(call.Input, "command")?.Trim() ?? string.Empty;
        if (command.Length == 0)
        {
            return EncodeError("Monitor requires a non-empty command.");
        }

        var cwd = JsonHelpers.GetString(parameters, "workingFolder") ??
                  JsonHelpers.GetString(call.Input, "cwd") ??
                  Environment.CurrentDirectory;
        var timeoutMs = JsonHelpers.GetInt(call.Input, "timeoutMs", 30_000);

        var psi = new ProcessStartInfo
        {
            FileName = OperatingSystem.IsWindows() ? "cmd.exe" : "/bin/sh",
            Arguments = OperatingSystem.IsWindows() ? $"/c {command}" : $"-c \"{command.Replace("\"", "\\\"")}\"",
            WorkingDirectory = Directory.Exists(cwd) ? cwd : Environment.CurrentDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        try
        {
            using var process = Process.Start(psi);
            if (process is null)
            {
                return EncodeError("Failed to start monitor process.");
            }

            var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
            var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);

            if (!process.WaitForExit(timeoutMs))
            {
                process.Kill(entireProcessTree: true);
                return EncodeError($"Monitor timed out after {timeoutMs}ms.");
            }

            var stdout = await stdoutTask;
            var stderr = await stderrTask;

            return EncodeJsonObject(writer =>
            {
                writer.WriteNumber("exitCode", process.ExitCode);
                writer.WriteString("stdout", stdout);
                writer.WriteString("stderr", stderr);
                writer.WriteBoolean("success", process.ExitCode == 0);
            });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return EncodeError($"Monitor execution failed: {ex.Message}");
        }
    }

    private static string EncodeError(string message)
    {
        return EncodeJsonObject(writer => writer.WriteString("error", message));
    }

    private static string EncodeJsonObject(Action<Utf8JsonWriter> writeProperties)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, WriterOptions))
        {
            writer.WriteStartObject();
            writeProperties(writer);
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }
}

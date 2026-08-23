using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using WishfulClaw.Core.Tools;
using static WishfulClaw.Agent.Tools.ToolHelpers;

namespace WishfulClaw.Agent.Tools.ShellTools;

public sealed partial class ShellExecuteTool : IToolExecutor

{

    private const int DefaultTimeoutMs = 600_000;   // 10 minutes

    private const int MaxTimeoutMs = 3_600_000;      // 1 hour

    private const int MaxOutputChars = 64_000;       // 64KB per stream



    private static readonly ConcurrentDictionary<string, RunningProcess> Running = new(StringComparer.Ordinal);



    public string Name => "Bash";



    public string Description =>

        "Execute a shell command and return stdout, stderr, exit code, and timing. " +

        "Prefer dedicated file tools (Glob, Grep, Read, LS, Edit, Write) over shell commands for file operations. " +

        "Pass sshConnectionId to run remotely via SSH (see SshListConnections); pass local=true to force local execution when a project has a bound SSH connection. " +

        "Note: PowerShell does not support '&&' — use ';' to chain commands, or set shell to 'bash' for bash syntax.";



    public JsonElement InputSchema { get; } = ParseSchema(

        """

        {

          "type": "object",

          "properties": {

            "command": {

              "type": "string",

              "description": "The shell command to execute"

            },

            "timeout": {

              "type": "integer",

              "description": "Timeout in milliseconds. Default: 600000 (10 min). Max: 3600000 (1 hour).",

              "default": 600000

            },

            "cwd": {

              "type": "string",

              "description": "Working directory. Defaults to the session working folder."

            },

            "shell": {

              "type": "string",

              "description": "Preferred shell executable. On Windows: powershell.exe, pwsh.exe, cmd.exe. On Unix: zsh, bash, sh. Defaults to platform default."

            },

            "env": {

              "type": "object",

              "description": "Additional environment variables (key-value pairs).",

              "additionalProperties": { "type": "string" }

            },

            "sshConnectionId": {

              "type": "string",

              "description": "SSH connection ID — runs the command on the remote server via SSH. Use SshListConnections to get IDs; auto-filled when the project has a bound connection."

            },

            "local": {

              "type": "boolean",

              "description": "Force local execution even when the project has a bound SSH connection.",

              "default": false

            }

          },

          "required": ["command"]

        }

        """);



    public async Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)

    {

        var command = GetString(input, "command");

        if (string.IsNullOrWhiteSpace(command))

        {

            return new ToolResult(

                "{\"exitCode\":1,\"stderr\":\"Missing 'command' field\"}",

                IsError: true,

                Error: "Missing 'command' field");

        }



        var cwd = ResolveCwd(GetString(input, "cwd"), context.WorkingFolder);

        var preferredShell = GetString(input, "shell");

        var timeoutMs = Math.Clamp(

            GetInt(input, "timeout", DefaultTimeoutMs),

            1,

            MaxTimeoutMs);



        var launch = ResolveLaunch(preferredShell);

        var startedAt = Stopwatch.GetTimestamp();



        try

        {

            var (stdout, stderr, exitCode, timedOut, spawnMs, firstChunkMs) = await RunProcessAsync(

                command, cwd, launch, input, timeoutMs, context.CancellationToken);



            var totalMs = ElapsedMs(startedAt);



            var result = ShellOutputFormatter.Format(

                stdout, stderr, exitCode, timedOut,

                cwd, command, launch.Shell, totalMs, spawnMs, firstChunkMs);



            var isError = exitCode != 0 && string.IsNullOrWhiteSpace(stdout) && string.IsNullOrWhiteSpace(stderr);

            return new ToolResult(result, isError);

        }

        catch (OperationCanceledException)

        {

            throw;

        }

        catch (Exception ex)

        {

            var totalMs = ElapsedMs(startedAt);

            var result = ShellOutputFormatter.Format(

                string.Empty, ex.Message, -1, false,

                cwd, command, launch.Shell, totalMs, 0, null);

            return new ToolResult(result, IsError: true, Error: ex.Message);

        }

    }



}

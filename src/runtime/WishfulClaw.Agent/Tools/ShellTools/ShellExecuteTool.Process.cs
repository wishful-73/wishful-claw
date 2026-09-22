using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using WishfulClaw.Core.Tools;
using static WishfulClaw.Agent.Tools.ToolHelpers;

namespace WishfulClaw.Agent.Tools.ShellTools;

public sealed partial class ShellExecuteTool
{
    // ── Process execution ──



    private static async Task<(string Stdout, string Stderr, int ExitCode, bool TimedOut, long SpawnMs, long? FirstChunkMs)> RunProcessAsync(

        string command,

        string cwd,

        ShellLaunch launch,

        JsonElement input,

        int timeoutMs,

        CancellationToken cancellationToken,

        string? execId)

    {

        var startInfo = CreateProcessStartInfo(launch, command, cwd, input);



        using var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };

        var stdoutCollector = new OutputCollector(MaxOutputChars);

        var stderrCollector = new OutputCollector(MaxOutputChars);



        var spawnStartedAt = Stopwatch.GetTimestamp();

        process.Start();

        var spawnMs = ElapsedMs(spawnStartedAt);



        using var timeoutCts = new CancellationTokenSource(timeoutMs);

        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(

            cancellationToken,

            timeoutCts.Token);



        long? firstChunkMs = null;



        var stdoutTask = ReadStreamAsync(

            process.StandardOutput, stdoutCollector, linkedCts.Token,

            () => firstChunkMs ??= ElapsedMs(spawnStartedAt));

        var stderrTask = ReadStreamAsync(

            process.StandardError, stderrCollector, linkedCts.Token,

            () => firstChunkMs ??= ElapsedMs(spawnStartedAt));



        bool timedOut = false;

        // 登记进中止表：渲染层的「停止进程」按钮拿同一个 execId 找回来
        // （iter-34 S-137）。execId 就是模型返回的 tool call id。
        if (execId is not null)

        {

            Running[execId] = new RunningProcess(process);

        }



        try

        {

            try

            {

                await process.WaitForExitAsync(linkedCts.Token);

            }

            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)

            {

                // 外部中止（会话停止 / shell:abort 之外的取消）：必须显式杀掉进程树。

                // 只靠 using 去 dispose 的话，Process 对象没了，子进程会变成孤儿继续跑。

                TryKillProcessTree(process);

                try { await process.WaitForExitAsync(CancellationToken.None); } catch { }

                throw;

            }

            catch (OperationCanceledException)

            {

                timedOut = true;

                TryKillProcessTree(process);

                try { await process.WaitForExitAsync(CancellationToken.None); } catch { }

            }



            try { await stdoutTask; } catch { }

            try { await stderrTask; } catch { }



            var exitCode = timedOut ? 124 : process.ExitCode;

            return (stdoutCollector.ToString(), stderrCollector.ToString(), exitCode, timedOut, spawnMs, firstChunkMs);

        }

        finally

        {

            if (execId is not null)

            {

                Running.TryRemove(execId, out _);

            }

        }

    }



    private static ProcessStartInfo CreateProcessStartInfo(

        ShellLaunch launch, string command, string cwd, JsonElement input)

    {

        // For cmd.exe, use the system default code page (usually GBK/936 on

        // Chinese Windows) because chcp 65001 doesn't reliably affect piped

        // output from all legacy programs. For PowerShell/bash, UTF-8 is safe.

        var isCmd = OperatingSystem.IsWindows() && !IsPowerShell(launch.Shell);

        var outputEncoding = isCmd ? GetSystemEncoding() : Encoding.UTF8;



        var startInfo = new ProcessStartInfo

        {

            FileName = launch.Shell,

            WorkingDirectory = cwd,

            UseShellExecute = false,

            RedirectStandardOutput = true,

            RedirectStandardError = true,

            StandardOutputEncoding = outputEncoding,

            StandardErrorEncoding = outputEncoding,

            CreateNoWindow = true

        };



        foreach (var arg in GetLaunchArgs(launch, command))

        {

            startInfo.ArgumentList.Add(arg);

        }



        // Ensure child processes use UTF-8 for console I/O (fixes Chinese garbled output)

        startInfo.Environment["PYTHONUTF8"] = "1";

        startInfo.Environment["PYTHONIOENCODING"] = "utf-8";

        if (OperatingSystem.IsWindows())

        {

            startInfo.Environment["LANG"] = "zh_CN.UTF-8";

        }



        ApplyEnvironment(startInfo, input);

        return startInfo;

    }



    private static void ApplyEnvironment(ProcessStartInfo startInfo, JsonElement input)

    {

        if (!input.TryGetProperty("env", out var envElement) || envElement.ValueKind != JsonValueKind.Object)

        {

            return;

        }



        foreach (var prop in envElement.EnumerateObject())

        {

            if (prop.Value.ValueKind == JsonValueKind.String)

            {

                startInfo.Environment[prop.Name] = prop.Value.GetString() ?? string.Empty;

            }

        }

    }


}

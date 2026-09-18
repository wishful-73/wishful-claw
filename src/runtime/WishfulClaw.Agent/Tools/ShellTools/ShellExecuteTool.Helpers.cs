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
    // ── Working directory resolution ──



    private static string ResolveCwd(string? cwd, ToolExecutionContext context)

    {

        // 三个分支都要过沙箱：显式 cwd、会话工作目录、以及最后的 UserProfile 兜底
        // —— 兜底那条尤其要拦，否则沙箱开了还能靠「不带 cwd」跑到用户主目录去。

        if (!string.IsNullOrWhiteSpace(cwd) && Directory.Exists(cwd))

        {

            var resolved = Path.GetFullPath(cwd);

            EnsureInsideSandbox(resolved, context);

            return resolved;

        }



        if (!string.IsNullOrWhiteSpace(context.WorkingFolder) && Directory.Exists(context.WorkingFolder))

        {

            var resolved = Path.GetFullPath(context.WorkingFolder);

            EnsureInsideSandbox(resolved, context);

            return resolved;

        }



        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        var fallback = Directory.Exists(home) ? home : Environment.CurrentDirectory;

        EnsureInsideSandbox(fallback, context);

        return fallback;

    }



    // ── Stream reading ──



    private static async Task ReadStreamAsync(

        StreamReader reader,

        OutputCollector collector,

        CancellationToken ct,

        Action onFirstChunk)

    {

        var buffer = new char[4096];

        var firstChunkRecorded = false;



        while (!ct.IsCancellationRequested)

        {

            int read;

            try

            {

                read = await reader.ReadAsync(buffer, ct);

            }

            catch (OperationCanceledException)

            {

                break;

            }



            if (read <= 0)

            {

                break;

            }



            if (!firstChunkRecorded)

            {

                firstChunkRecorded = true;

                onFirstChunk();

            }



            collector.Append(buffer, 0, read);

        }

    }



    // ── Process kill ──



    private static void TryKillProcessTree(Process process)

    {

        try

        {

            if (!process.HasExited)

            {

                process.Kill(entireProcessTree: true);

            }

        }

        catch

        {

            // Process may have exited between check and Kill

        }

    }



    // ── Timing helper ──



    private static long ElapsedMs(long startedAt)

    {

        return (long)Math.Round(Stopwatch.GetElapsedTime(startedAt).TotalMilliseconds);

    }

}



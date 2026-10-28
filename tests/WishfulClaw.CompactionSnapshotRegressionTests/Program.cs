// 压缩快照回归：入口、子进程模式与断言/清理辅助。
// 拆分自原单文件 Program.cs（S-252，2026-10-28），方法体逐字平移。
using System.Diagnostics;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Agent;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.TestSupport;

namespace WishfulClaw.CompactionSnapshotRegressionTests;

internal static partial class Program
{
    private static int _passed;

    public static int Main(string[] args)
    {
        WorkerJsonHelper.ConfigureAotResolver(InfrastructureJsonContext.Default);
        try
        {
            // iter-29 T-13: pure string checks, no DB — run before the child-mode dispatch.
            PastedBlockRestoreChecks.Run();
            // iter-33 S-95: rolling-summary partition checks (also no DB).
            SummaryRollingChecks.Run();
            // iter-37 S-161: a compaction product must not carry pre-compaction usage.
            UsageStripChecks.Run();

            if (args.Length == 2)
                return RunChildMode(args[0], args[1]);
            if (args.Length == 1 && string.Equals(args[0], "--schema-only", StringComparison.Ordinal))
                return RunSchemaOnlyMode();

            var testRoot = Path.Combine(TestOutputRoot.Resolve(), $"wishful-compaction-regression-{Guid.NewGuid():N}");
            Directory.CreateDirectory(testRoot);
            try
            {
                var legacyDbPath = Path.Combine(testRoot, "legacy.db");
                var newDbPath = Path.Combine(testRoot, "new.db");
                SeedLegacyDatabase(legacyDbPath);
                RunChild("--suite-legacy", legacyDbPath);
                RunChild("--suite-new", newDbPath);
            }
            finally
            {
                TryDeleteDirectory(testRoot);
            }

            Console.WriteLine($"Compaction snapshot regression parent checks passed: {_passed}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Compaction snapshot regression test failed: {ex}");
            return 1;
        }
    }

    private static int RunSchemaOnlyMode()
    {
        var testRoot = Path.Combine(TestOutputRoot.Resolve(), $"wishful-compaction-schema-{Guid.NewGuid():N}");
        Directory.CreateDirectory(testRoot);
        try
        {
            var legacyDbPath = Path.Combine(testRoot, "legacy.db");
            var newDbPath = Path.Combine(testRoot, "new.db");
            SeedLegacyDatabase(legacyDbPath);
            RunChild("--schema-legacy", legacyDbPath);
            RunChild("--schema-new", newDbPath);
            Console.WriteLine($"Compaction snapshot schema checks passed: {_passed}");
            return 0;
        }
        finally
        {
            TryDeleteDirectory(testRoot);
        }
    }

    private static int RunChildMode(string mode, string dbPath)
    {
        try
        {
            WorkerJsonHelper.ConfigureAotResolver(InfrastructureJsonContext.Default);
            switch (mode)
            {
                case "--suite-legacy":
                    RunLegacySuite(dbPath);
                    break;
                case "--suite-new":
                    RunNewDatabaseSuite(dbPath);
                    break;
                case "--schema-legacy":
                    RunLegacySchemaSuite(dbPath);
                    break;
                case "--schema-new":
                    RunNewSchemaSuite(dbPath);
                    break;
                default:
                    throw new InvalidOperationException($"Unknown child mode: {mode}");
            }

            Console.WriteLine($"Compaction snapshot regression child checks passed ({mode}): {_passed}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Compaction snapshot regression child failed ({mode}): {ex}");
            return 1;
        }
    }


    private static void RunChild(string mode, string dbPath)
    {
        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Current process path is unavailable");
        var startInfo = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        if (string.Equals(Path.GetFileNameWithoutExtension(executable), "dotnet", StringComparison.OrdinalIgnoreCase))
            startInfo.ArgumentList.Add(Environment.GetCommandLineArgs()[0]);
        startInfo.ArgumentList.Add(mode);
        startInfo.ArgumentList.Add(dbPath);

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException($"Failed to start child mode {mode}");
        var stdout = process.StandardOutput.ReadToEnd();
        var stderr = process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (!string.IsNullOrWhiteSpace(stdout)) Console.Write(stdout);
        if (!string.IsNullOrWhiteSpace(stderr)) Console.Error.Write(stderr);
        AssertEqual(0, process.ExitCode, $"child mode {mode} exits successfully");
    }

    private static void Assert(bool condition, string name)
    {
        if (!condition)
            throw new InvalidOperationException(name);
        _passed++;
        Console.WriteLine($"PASS: {name}");
    }

    private static void AssertEqual<T>(T expected, T actual, string name)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new InvalidOperationException($"{name}: expected={expected}, actual={actual}");
        Assert(true, name);
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path))
                Directory.Delete(path, true);
        }
        catch
        {
            // Best-effort cleanup for temporary regression data.
        }
    }
}

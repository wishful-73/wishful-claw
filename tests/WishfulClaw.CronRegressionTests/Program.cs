// Cron 回归：常量、入口、子进程模式与断言/清理辅助。
// 拆分自原单文件 Program.cs（S-252，2026-10-28），方法体逐字平移。
using System.Diagnostics;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Agent.Tools.Providers;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Tools;
using WishfulClaw.Infrastructure;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.TestSupport;

namespace WishfulClaw.CronRegressionTests;

internal static partial class Program
{
    private const string PersistentJobId = "cron-persistent";
    private const string DisabledJobId = "cron-disabled";
    private const string SmokeJobId = "cron-smoke-at";
    private const string RunId = "cron-run-regression-1";
    private static int _passed;

    public static int Main(string[] args)
    {
        WorkerJsonHelper.ConfigureAotResolver(InfrastructureJsonContext.Default);
        try
        {
            if (args.Length == 2)
                return RunChildMode(args[0], args[1]);

            RunSchemaRegressionSuite();
            var testRoot = Path.Combine(TestOutputRoot.Resolve(), $"wishful-cron-regression-{Guid.NewGuid():N}");
            Directory.CreateDirectory(testRoot);
            try
            {
                var legacyDbPath = Path.Combine(testRoot, "legacy.db");
                var newDbPath = Path.Combine(testRoot, "new.db");
                SeedLegacyCronDatabase(legacyDbPath);
                RunChild("--exercise-legacy", legacyDbPath);
                RunChild("--verify-reopen", legacyDbPath);
                RunChild("--verify-new", newDbPath);
            }
            finally
            {
                TryDeleteDirectory(testRoot);
            }

            Console.WriteLine($"Cron regression parent checks passed: {_passed}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Cron regression test failed: {ex}");
            return 1;
        }
    }

    private static int RunChildMode(string mode, string dbPath)
    {
        try
        {
            switch (mode)
            {
                case "--exercise-legacy":
                    RunLegacyAndCrudSuite(dbPath);
                    break;
                case "--verify-reopen":
                    RunReopenSuite(dbPath);
                    break;
                case "--verify-new":
                    RunNewDatabaseSuite(dbPath);
                    break;
                case "--seed-smoke":
                    SeedSmokeTask(dbPath);
                    break;
                case "--verify-smoke":
                    VerifySmokeTask(dbPath);
                    break;
                default:
                    throw new InvalidOperationException($"Unknown child mode: {mode}");
            }

            Console.WriteLine($"Cron regression child checks passed ({mode}): {_passed}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Cron regression child failed ({mode}): {ex}");
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

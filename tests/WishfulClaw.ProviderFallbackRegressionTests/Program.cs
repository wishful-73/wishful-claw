/*
 * Regression suite for the multi-provider fallback flow (iter-29 / S-21).
 *
 * D1-D7 live in `docs/plans/iter-v2-29/plan.md` (需求 9). The status-machine
 * tests land with D3 and the AgentLoop-integration tests land with D4 —
 * keeping the runner compilable from day one is the whole reason this suite
 * has a `WishfulClaw.sln` entry up front (otherwise it silently leaks, like
 * the unslotted `WishfulClaw.CronRegressionTests` / `WishfulClaw.MemoryRecall
 * RegressionTests` did). The `sln` membership is the contract.
 */
namespace WishfulClaw.ProviderFallbackRegressionTests;

internal static class Program
{
    private static int _passed;

    public static int Main(string[] args)
    {
        SanityRunnerChecks();

        Console.WriteLine(
            _failed == 0
                ? $"ALL PASS ({_passed} assertion{(_passed == 1 ? string.Empty : "s")})"
                : $"{_failed} FAILED of {_passed}");
        return _failed == 0 ? 0 : 1;
    }

    private static int _failed;

    private static void Assert(bool condition, string message)
    {
        if (condition)
        {
            _passed++;
            return;
        }
        _failed++;
        Console.WriteLine($"  FAIL: {message}");
    }

    /// <summary>
    /// Asserts that this entry point is alive and the sln wiring pulled it in.
    /// Anything more meaningful needs D3 (status machine) and D4 (AgentLoop
    /// integration) — keep the slot reserved rather than skipping the suite.
    /// </summary>
    private static void SanityRunnerChecks()
    {
        Assert(true, "sanity: the runner starts");
    }
}
using WishfulClaw.Agent.Tools.SearchTools;

namespace WishfulClaw.GrepPatternRegressionTests;

/// <summary>
/// iter-33 S-88: Grep's <c>file_pattern</c> previously understood only "*.ext" and
/// treated any other value as a literal file name, so patterns such as "*.ts*"
/// silently matched nothing (the agent then concluded "the repo has none of these").
/// These checks pin the matcher semantics and the "pattern rejected every candidate"
/// diagnostic.
/// </summary>
internal static class Program
{
    private static int _passed;

    public static int Main()
    {
        try
        {
            RunMatcherChecks();
            RunRejectionHintChecks();

            Console.WriteLine($"Grep pattern regression checks passed: {_passed}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Grep pattern regression test failed: {ex}");
            return 1;
        }
    }

    private static void RunMatcherChecks()
    {
        // Legacy fast path: "*.ext" must keep working.
        AssertMatch("*.cs", "GrepTool.cs", true);
        AssertMatch("*.cs", "GrepTool.ts", false);
        AssertMatch("*.ts", "use-chat-actions.ts", true);
        AssertMatch("*.TS", "App.ts", true);

        // Exact file name, no wildcard.
        AssertMatch("GrepTool.cs", "GrepTool.cs", true);
        AssertMatch("GrepTool.cs", "OtherGrepTool.cs", false);

        // Catch-all.
        AssertMatch("*", "anything.TXT", true);
        AssertMatch(string.Empty, "anything.TXT", true);

        // S-88 regression: multi-wildcard patterns must not be read as literals.
        AssertMatch("*.ts*", "use-chat-actions.ts", true);
        AssertMatch("*.ts*", "App.tsx", true);
        AssertMatch("*.ts*", "App.js", false);
        AssertMatch("*.c*", "Program.cs", true);
        AssertMatch("*.c*", "config.json", false);
        AssertMatch("*.t?s", "a.tas", true);
        AssertMatch("*.t?s", "a.tt", false);
        AssertMatch("Grep*Tool.cs", "GrepTool.cs", true);
        AssertMatch("Grep*Tool.cs", "GrepXTool.cs", true);
        AssertMatch("Grep*Tool.cs", "Tool.cs", false);
    }

    private static void RunRejectionHintChecks()
    {
        Assert(GrepTool.ShouldReportPatternRejected(5, 5), "all candidates rejected must be reported");
        Assert(!GrepTool.ShouldReportPatternRejected(5, 4), "partial rejection must not be reported");
        Assert(!GrepTool.ShouldReportPatternRejected(0, 0), "empty directory must not be reported");
    }

    private static void AssertMatch(string pattern, string fileName, bool expected)
    {
        var actual = GrepTool.MatchesFileName(fileName, pattern);
        Assert(actual == expected, $"pattern \"{pattern}\" vs file \"{fileName}\": expected {expected}, got {actual}");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException(message);
        }

        _passed++;
    }
}

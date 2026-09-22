using WishfulClaw.Agent;
using WishfulClaw.Agent.Tools;
using WishfulClaw.Agent.Tools.Providers;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.TerminalToolRegressionTests;

/// <summary>
/// Pins the Terminal tool (iter-34 S-134) at the three seams that would otherwise fail silently.
///
/// The tool itself is three delegates and a schema, so there is nothing clever to test — what matters
/// is that the wiring stays complete, because every one of these failures looks like "the feature just
/// doesn't exist" rather than an error:
///
///   1. Registration — no definition means the model never sees the tool at all, and nothing logs.
///   2. Routing — ToolDispatchRouter reaches the executor by name, so a renamed or missing branch
///      falls through to the registry placeholder, which reports a routing bug instead of doing work.
///   3. Approval — Terminal starts a process on the user's machine, so it must be in the default-mode
///      approval set. A tool missing from that set runs without asking, silently, in the one mode
///      where the user asked to be asked.
///
/// The daemon-vs-visibility split (a channel run can never reach it) is asserted through the declared
/// scopes, since that is where it is actually enforced.
/// </summary>
internal static class Program
{
    private static int _checks;

    public static int Main()
    {
        try
        {
            var definition = AssertDefinitionIsRegistered();
            AssertSchemaTellsTheThreeActionsApart(definition);
            AssertOnlyTheExactNameIsRoutedToTheTerminalExecutor();
            AssertDefaultModeAsksBeforeStartingAProcess();

            Console.WriteLine($"Terminal tool regression checks passed ({_checks} assertions).");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Terminal tool regression test failed: {ex}");
            return 1;
        }
    }

    private static ToolDefinition AssertDefinitionIsRegistered()
    {
        var registry = new ToolRegistry();
        var provider = new TerminalToolProvider();

        // Same sequence ToolModule uses, so the category tag is exercised the way production sets it.
        registry.PushCategory(provider.Category);
        provider.RegisterTools(registry);
        registry.PopCategory();

        Assert("the provider registers exactly one tool", registry.GetToolNames().Count == 1);
        Assert("that tool is named Terminal", registry.IsRegistered("Terminal"));
        Assert("it is categorised as a shell tool", registry.GetCategory("Terminal") == "shell");

        var definition = registry.GetToolDefinitions().Single(d => d.Name == "Terminal");
        Assert("the definition is not empty", !string.IsNullOrWhiteSpace(definition.Description));
        Assert("it is a core tool", definition.IsCore);
        Assert(
            "a human must be present to run it",
            definition.VisibleScopes is not null
                && definition.VisibleScopes.SequenceEqual(ToolVisibilityScopes.HumanAttended));
        Assert(
            "channels and unattended runs are excluded",
            definition.ExcludedScopes is not null
                && definition.ExcludedScopes.SequenceEqual(ToolVisibilityScopes.NoHumanToAnswer));

        // The description carries the Bash-vs-Terminal boundary; a model that reads only this has to be
        // able to tell them apart, so both names must appear in it.
        Assert("the description names Bash as the one-shot alternative", definition.Description.Contains("Bash", StringComparison.Ordinal));

        // `read` follows the tail instead of re-taking a snapshot. The two are indistinguishable from
        // the JSON shape, so the description is the only place the model can learn which one it got —
        // a description that goes back to promising "the output" would quietly restore the replay that
        // made a second read repeat the first, and nothing else would fail.
        Assert(
            "the description says a read returns only what is new",
            definition.Description.Contains("SINCE THE PREVIOUS READ", StringComparison.Ordinal));

        return definition;
    }

    private static void AssertSchemaTellsTheThreeActionsApart(ToolDefinition definition)
    {
        var schema = definition.InputSchema;
        Assert("the schema is an object", schema.GetProperty("type").GetString() == "object");

        var required = schema.GetProperty("required").EnumerateArray().Select(e => e.GetString()).ToArray();
        Assert("action is the only required argument", required.SequenceEqual(new[] { "action" }));

        var properties = schema.GetProperty("properties");
        var actions = properties.GetProperty("action").GetProperty("enum")
            .EnumerateArray().Select(e => e.GetString()).ToArray();
        Assert("start / read / stop are the declared actions", actions.SequenceEqual(new[] { "start", "read", "stop" }));

        // A missing property here is a parameter the executor reads but the model cannot fill in.
        foreach (var name in new[] { "command", "terminalId", "cwd", "shell", "env", "title" })
        {
            Assert($"'{name}' is documented in the schema", properties.TryGetProperty(name, out _));
        }
    }

    private static void AssertOnlyTheExactNameIsRoutedToTheTerminalExecutor()
    {
        Assert(
            "ToolDispatchRouter's predicate recognises the registered name",
            AgentRuntimeTerminalExecutor.IsTerminalTool("Terminal"));

        foreach (var name in new[] { "terminal", "Terminalx", "Bash", "Shell", "ShellExec", "BashOutput" })
        {
            Assert($"{name} is not routed to the terminal executor", !AgentRuntimeTerminalExecutor.IsTerminalTool(name));
        }
    }

    private static void AssertDefaultModeAsksBeforeStartingAProcess()
    {
        Assert(
            "default mode pauses before Terminal starts a process",
            ToolCallProcessor.IsDefaultModeApprovalTool("Terminal"));
        Assert(
            "the approval match is exact, not case-insensitive",
            !ToolCallProcessor.IsDefaultModeApprovalTool("terminal"));
    }

    private static void Assert(string message, bool condition)
    {
        _checks++;
        if (!condition)
        {
            throw new InvalidOperationException($"Assertion failed: {message}");
        }
    }
}

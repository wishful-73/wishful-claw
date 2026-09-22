using System.Text.Json;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers the Terminal tool: run a long-lived process inside the bottom terminal panel, read its
/// accumulated output, and stop it.
///
/// Execution: ToolDispatchRouter → AgentRuntimeTerminalExecutor (reverse-request to main process),
/// which drives the very same node-pty session manager the user's own terminals use — so the agent's
/// process is a real, visible PTY in the dock, not a hidden pipe.
/// </summary>
public sealed class TerminalToolProvider : IToolProvider
{
    private const string Description =
        "Run a LONG-LIVED process inside the user's bottom terminal panel and keep control of it, or read / stop one already there.\n"
        + "Use it for servers and watchers that must outlive a single call — a dev server, a file watcher, a log stream, a REPL you want to poke at — because the terminal stays alive between turns and the user can watch it, read it, and type into it.\n"
        + "Do NOT use it for ordinary commands whose output and exit code you need in this turn: use Bash. Bash runs the command, waits, and hands back stdout/stderr/exit code; Terminal only starts something and returns the first output, so a short command leaves you with a terminal to clean up and nothing else.\n"
        + "\n"
        + "The terminal is a real interactive shell and your command is typed into it, so the output carries the prompt and the command line the same way a hand-typed one would, and the user can take the tab over. If the user presses Ctrl+C the command stops while the shell stays alive: a read then shows `^C` and a fresh prompt, and start with the same command types it in again instead of attaching to an idle prompt.\n"
        + "\n"
        + "Actions:\n"
        + "- start: launch a process. Returns the terminalId plus the opening output (prompt and echoed command included). Reusing start with the same command in the same session re-uses the existing terminal instead of spawning a second one.\n"
        + "- read: fetch what the terminal printed SINCE THE PREVIOUS READ, for a terminalId you got from start — the first read picks up right after the `tail` start already returned. Output is bounded (about the last 12000 characters) and is a text projection — no colours, no cursor moves. Empty text means nothing new, which is normal on a quiet terminal.\n"
        + "- stop: kill a terminal's process and close its tab.\n"
        + "\n"
        + "Always LOCAL, even in an SSH project: this tool never runs on the remote host. It also does not inherit Bash's environment setup — it starts from the app's own environment plus the shell configured in Settings → Terminal & SSH, so a command that works under Bash may need its environment spelled out here.";

    public string Category => "shell";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "Terminal",
            Description,
            ToolSchemaBuilder.Object(
                new Dictionary<string, JsonElement>
                {
                    ["action"] = ToolSchemaBuilder.String(
                        "Required. 'start' launches a process, 'read' fetches a terminal's output, 'stop' kills it.",
                        ["start", "read", "stop"]),
                    ["command"] = ToolSchemaBuilder.String(
                        "For 'start'. The command line to run, e.g. 'npm run dev'. Required when action is 'start'."),
                    ["terminalId"] = ToolSchemaBuilder.String(
                        "For 'read' and 'stop'. The terminalId returned by 'start'."),
                    ["cwd"] = ToolSchemaBuilder.String(
                        "For 'start'. Working directory. Defaults to the session's working folder."),
                    ["shell"] = ToolSchemaBuilder.String(
                        "For 'start'. Shell executable to launch. Defaults to the shell from Settings → Terminal & SSH."),
                    ["env"] = ToolSchemaBuilder.Object(
                        description: "For 'start'. Extra environment variables as a flat string-to-string object, merged over the app environment."),
                    ["title"] = ToolSchemaBuilder.String(
                        "For 'start'. Title for the terminal's tab. Defaults to 'Agent: ' plus the start of the command.")
                },
                ["action"]),
            visibleScopes: ToolVisibilityScopes.HumanAttended,
            excludedScopes: ToolVisibilityScopes.NoHumanToAnswer,
            isCore: true));
    }
}

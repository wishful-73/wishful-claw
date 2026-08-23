using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers code-compatible tool definitions (PowerShell, Monitor).
/// Execution: ToolDispatchRouter → AgentRuntimeCodeCompatibleExecutor.
/// </summary>
public sealed class CodeCompatibleToolProvider : IToolProvider
{
    public string Category => "code-compatible";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "PowerShell",
            "Execute a PowerShell command on the local system. " +
            "Note: PowerShell does not support '&&' — use ';' to chain commands.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["command"] = ToolSchemaBuilder.String("The PowerShell command to execute."),
                    ["cwd"] = ToolSchemaBuilder.String("Working directory. Defaults to the session's working folder.")
                },
                ["command"])));

        registry.Register(new ToolDefinitionPlaceholder(
            "Monitor",
            "Monitor the output of a previously started long-running process.",
            ToolSchemaBuilder.Object(
                new() { ["session_id"] = ToolSchemaBuilder.String("The session ID to monitor.") },
                ["session_id"])));
    }
}

using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers SSH-related tool definitions.
/// Execution: ToolDispatchRouter → AgentRuntimeSshToolExecutor (reverse-request to main process).
/// </summary>
public sealed class SshToolProvider : IToolProvider
{
    public string Category => "ssh";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "SshListConnections",
            "List saved SSH connections (id, name, host, port, username, auth type). Provides the sshConnectionId values used by the Bash tool for remote execution.",
            ToolSchemaBuilder.Object()));
    }
}

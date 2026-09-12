using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers team collaboration tool definitions.
/// Execution: ToolDispatchRouter → AgentRuntimeTeamExecutor (in-memory + reverse-request).
/// </summary>
public sealed class TeamToolProvider : IToolProvider
{
    public string Category => "team";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "TeamCreate",
            "Create a new agent team for multi-agent collaboration.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["name"] = ToolSchemaBuilder.String("Team name."),
                    ["members"] = ToolSchemaBuilder.ArraySchema("Team member configurations.", ToolSchemaBuilder.String("Member agent name."))
                },
                ["name"]
            ),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.WorkRunsOnly
        ));

        registry.Register(new ToolDefinitionPlaceholder(
            "TeamStatus",
            "Get the status of an agent team.",
            ToolSchemaBuilder.Object(
                new() { ["name"] = ToolSchemaBuilder.String("Team name.") },
                ["name"]
            ),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.WorkRunsOnly
        ));

        registry.Register(new ToolDefinitionPlaceholder(
            "TeamDelete",
            "Delete an agent team.",
            ToolSchemaBuilder.Object(
                new() { ["name"] = ToolSchemaBuilder.String("Team name.") },
                ["name"]
            ),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.WorkRunsOnly
        ));

        registry.Register(new ToolDefinitionPlaceholder(
            "SendMessage",
            "Send a message to a team member.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["team"] = ToolSchemaBuilder.String("Team name."),
                    ["member"] = ToolSchemaBuilder.String("Member agent name."),
                    ["message"] = ToolSchemaBuilder.String("Message content.")
                },
                ["team", "member", "message"]
            ),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.WorkRunsOnly
        ));
    }
}
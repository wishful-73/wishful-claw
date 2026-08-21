using WishfulClaw.Agent.Tools;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers goal management tool definitions.
/// Execution: ToolDispatchRouter → AgentRuntimeGoalExecutor using SQLite plus Orchestrator runtime state.
/// Available in goal mode only.
/// </summary>
public sealed class GoalToolProvider : IToolProvider
{
    public string Category => "goal";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "get_goal",
            "Get the current goal for the agent session.",
            ToolSchemaBuilder.Object(),
            availableModes: ["goal"]));

        registry.Register(new ToolDefinitionPlaceholder(
            "list_goals",
            "List goals for the current session with cursor pagination. Includes terminal history without exposing other sessions.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["limit"] = ToolSchemaBuilder.Number("Page size. Defaults to 20, maximum 100."),
                    ["cursorCurrentRank"] = ToolSchemaBuilder.Number("Cursor current-state rank from the previous page."),
                    ["cursorUpdatedAt"] = ToolSchemaBuilder.Number("Cursor updatedAt from the previous page."),
                    ["cursorGoalId"] = ToolSchemaBuilder.String("Cursor goalId from the previous page.")
                }),
            availableModes: ["goal"]));

        registry.Register(new ToolDefinitionPlaceholder(
            "get_goal_history",
            "Get one goal and its audit events for the current session with cursor pagination.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["goalId"] = ToolSchemaBuilder.String("The goal identifier."),
                    ["limit"] = ToolSchemaBuilder.Number("Event page size. Defaults to 50, maximum 200."),
                    ["cursorCreatedAt"] = ToolSchemaBuilder.Number("Event cursor createdAt from the previous page."),
                    ["cursorEventId"] = ToolSchemaBuilder.Number("Event cursor id from the previous page.")
                },
                ["goalId"]),
            availableModes: ["goal"]));

        registry.Register(new ToolDefinitionPlaceholder(
            "create_goal",
            "Create a new goal for the agent session. The goal is created in a pending state and will not start until the user confirms it via the frontend confirmation card. After confirmation, the goal orchestrator runs the goal in the background automatically - you do NOT execute the goal work yourself, only supervise and report progress.",
            ToolSchemaBuilder.Object(
                new() { ["objective"] = ToolSchemaBuilder.String("The goal description.") },
                ["objective"]),
            availableModes: ["goal"]));

        registry.Register(new ToolDefinitionPlaceholder(
            "reopen_goal",
            "Reopen a terminal goal without mutating its history. Creates a new pending goal linked to the source goal and waits for user confirmation before execution.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["goalId"] = ToolSchemaBuilder.String("The terminal source goal identifier."),
                    ["objective"] = ToolSchemaBuilder.String("Optional revised objective for the new goal.")
                },
                ["goalId"]),
            availableModes: ["goal"]));

        registry.Register(new ToolDefinitionPlaceholder(
            "update_goal",
            "Update the current goal's status or content.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["objective"] = ToolSchemaBuilder.String("Updated goal description."),
                    ["status"] = ToolSchemaBuilder.String(
                        "New status.",
                        [GoalStatusValues.Active, GoalStatusValues.Complete, GoalStatusValues.Aborted])
                }),
            availableModes: ["goal"]));

        registry.Register(new ToolDefinitionPlaceholder(
            "pause_goal",
            "Pause the current goal execution. The orchestrator will stop and can be resumed later.",
            ToolSchemaBuilder.Object(),
            availableModes: ["goal"]));

        registry.Register(new ToolDefinitionPlaceholder(
            "resume_goal",
            "Resume a paused goal execution.",
            ToolSchemaBuilder.Object(),
            availableModes: ["goal"]));

        registry.Register(new ToolDefinitionPlaceholder(
            "abort_goal",
            "Abort/cancel the current goal execution permanently.",
            ToolSchemaBuilder.Object(),
            availableModes: ["goal"]));
    }
}
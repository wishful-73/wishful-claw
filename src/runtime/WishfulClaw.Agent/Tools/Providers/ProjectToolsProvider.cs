using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers project management tools for the "global session" (project manager) mode.
/// Execution: ToolDispatchRouter -> AgentRuntimeProjectExecutor.
/// </summary>
public sealed class ProjectToolsProvider : IToolProvider
{
    public string Category => "project";

    public void RegisterTools(ToolRegistry registry)
    {
        // list_projects: List all projects (id, name, path)
        registry.Register(new ToolDefinitionPlaceholder(
            "list_projects",
            "List registered projects (id, name, working directory path).",
            ToolSchemaBuilder.Object(
                new Dictionary<string, System.Text.Json.JsonElement>
                {
                    ["filter"] = ToolSchemaBuilder.String(
                        "Optional case-insensitive name filter.")
                },
                []),
                availableModes: new[] { "global" },
                visibleScopes: ToolVisibilityScopes.Everywhere));

        // get_project_details: Get project details including sessions and task status
        registry.Register(new ToolDefinitionPlaceholder(
            "get_project_details",
            "Get project details (session list, task status). Reads .wishful-claw/project-status.md for a summary; if missing or stale, the response includes a statusUpdateTemplate to send via send_session_message.",
            ToolSchemaBuilder.Object(
                new Dictionary<string, System.Text.Json.JsonElement>
                {
                    ["projectId"] = ToolSchemaBuilder.String(
                        "The project ID (from list_projects).")
                },
                ["projectId"]),
                availableModes: new[] { "global" },
                visibleScopes: ToolVisibilityScopes.Everywhere));

        // create_session: Create a new session for a project
        registry.Register(new ToolDefinitionPlaceholder(
            "create_session",
            "Create a new conversation session for a project. Returns the new session ID for use with send_session_message.",
            ToolSchemaBuilder.Object(
                new Dictionary<string, System.Text.Json.JsonElement>
                {
                    ["projectId"] = ToolSchemaBuilder.String(
                        "The ID of the project to create a session for."),
                    ["sessionName"] = ToolSchemaBuilder.String(
                        "Optional session name. Defaults to an auto-generated name.")
                },
                ["projectId"]),
                availableModes: new[] { "global" },
                visibleScopes: ToolVisibilityScopes.GlobalSideAndWorkRuns));

        // send_session_message: Send a message to a session, optionally with a session Todo follow-up.
        registry.Register(new ToolDefinitionPlaceholder(
            "send_session_message",
            "Send a user message to another session. Returns immediately. For a simple temporary delegation that needs an automatic later check, first create a Todo in the source session, then include followUp. Omit followUp for an ordinary message. Complex tracked work must use global tasks and send_work_request instead.",
            ToolSchemaBuilder.Object(
                new Dictionary<string, System.Text.Json.JsonElement>
                {
                    ["sessionId"] = ToolSchemaBuilder.String(
                        "The ID of the target session."),
                    ["content"] = ToolSchemaBuilder.String(
                        "The message content (appears as a user message in the target session)."),
                    ["workingFolder"] = ToolSchemaBuilder.String(
                        "Optional working directory for the target session. Defaults to the project's working folder."),
                    ["projectId"] = ToolSchemaBuilder.String(
                        "Optional project ID. If omitted, inferred from the session."),
                    ["followUp"] = ToolSchemaBuilder.Object(
                        new Dictionary<string, System.Text.Json.JsonElement>
                        {
                            ["todoId"] = ToolSchemaBuilder.String(
                                "The existing Todo ID in the source session that tracks this temporary delegation."),
                            ["delayMs"] = ToolSchemaBuilder.Number(
                                "Delay in milliseconds before the source session checks the target (minimum 1000)."),
                            ["queryInstruction"] = ToolSchemaBuilder.String(
                                "What the source Agent should inspect or decide when the countdown fires."),
                            ["notificationKey"] = ToolSchemaBuilder.String(
                                "Optional idempotency key for this temporary follow-up.")
                        },
                        ["todoId", "delayMs", "queryInstruction"])
                },
                ["sessionId", "content"]),
                availableModes: new[] { "normal", "goal", "global", "channel" },
                visibleScopes: ToolVisibilityScopes.GlobalSideOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "update_session_follow_up",
            "Update the current session's temporary follow-up after an automatic check. Complete when the target result is ready, reschedule when it is still running, or fail for a terminal error. This never creates or updates a global task.",
            ToolSchemaBuilder.Object(
                new Dictionary<string, System.Text.Json.JsonElement>
                {
                    ["followUpId"] = ToolSchemaBuilder.String("The follow-up ID from the automatic check message."),
                    ["claimToken"] = ToolSchemaBuilder.String("The claim token from the automatic check message."),
                    ["action"] = ToolSchemaBuilder.String("complete, reschedule, or fail."),
                    ["lastQueryResult"] = ToolSchemaBuilder.String("The latest query result or completion summary."),
                    ["delayMs"] = ToolSchemaBuilder.Number("Required for reschedule: delay before the next check in milliseconds (minimum 1000)."),
                    ["error"] = ToolSchemaBuilder.String("Optional terminal or retry error detail.")
                },
                ["followUpId", "claimToken", "action", "lastQueryResult"]),
                availableModes: new[] { "normal", "goal", "global", "channel" },
                visibleScopes: ToolVisibilityScopes.GlobalSideOnly));
    }
}

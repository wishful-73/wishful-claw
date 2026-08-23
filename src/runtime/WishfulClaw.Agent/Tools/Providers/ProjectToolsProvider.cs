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
                availableModes: new[] { "global" }));

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
                availableModes: new[] { "global" }));

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
                availableModes: new[] { "global" }));

        // send_session_message: Send a message to a session
        registry.Register(new ToolDefinitionPlaceholder(
            "send_session_message",
            "Send a user message to a project session to dispatch tasks or instructions. Returns immediately; the target session processes it asynchronously — check results later with get_project_details.",
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
                        "Optional project ID. If omitted, inferred from the session.")
                },
                ["sessionId", "content"]),
                availableModes: new[] { "global" }));
    }
}
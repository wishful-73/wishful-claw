using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers global task tools for the "global session" (product manager) mode.
/// These tools manage the global agent's own high-level tasks and dispatch
/// records; they never touch session-scoped Todos (tasks table).
/// Execution: ToolDispatchRouter -> AgentRuntimeGlobalTaskExecutor.
/// </summary>
public sealed class GlobalTaskToolsProvider : IToolProvider
{
    public string Category => "global-task";

    public void RegisterTools(ToolRegistry registry)
    {
        // list_global_tasks: List the global agent's own tasks
        registry.Register(new ToolDefinitionPlaceholder(
            "list_global_tasks",
            "List your global tasks (title, status, priority, tags, due date, archived flag). " +
            "Archived tasks are hidden unless includeArchived is true. Never returns session-internal Todos.",
            ToolSchemaBuilder.Object(
                new Dictionary<string, System.Text.Json.JsonElement>
                {
                    ["status"] = ToolSchemaBuilder.String(
                        "Optional status filter: pending / in_progress / blocked / completed / cancelled."),
                    ["keyword"] = ToolSchemaBuilder.String(
                        "Optional keyword filter matched against title and description."),
                    ["includeArchived"] = ToolSchemaBuilder.Boolean(
                        "Include archived tasks. Defaults to false.")
                },
                []),
                availableModes: new[] { "global" }));

        // create_global_task: Create a new global task
        registry.Register(new ToolDefinitionPlaceholder(
            "create_global_task",
            "Create a global task for a cross-project goal or follow-up item. Returns the new task id. " +
            "Global tasks are never deleted, only archived.",
            ToolSchemaBuilder.Object(
                new Dictionary<string, System.Text.Json.JsonElement>
                {
                    ["title"] = ToolSchemaBuilder.String("Short task title."),
                    ["description"] = ToolSchemaBuilder.String("Optional detailed description."),
                    ["priority"] = ToolSchemaBuilder.String(
                        "Optional priority: low / normal / high / urgent. Defaults to normal."),
                    ["tags"] = ToolSchemaBuilder.ArraySchema("Optional list of tags."),
                    ["dueAt"] = ToolSchemaBuilder.Number("Optional due date (unix milliseconds).")
                },
                ["title"]),
                availableModes: new[] { "global" }));

        // update_global_task: Update status/priority/tags/etc. or archive
        registry.Register(new ToolDefinitionPlaceholder(
            "update_global_task",
            "Update a global task's fields (title, description, status, priority, tags, dueAt) " +
            "or archive it with archived=true. There is no delete operation for global tasks.",
            ToolSchemaBuilder.Object(
                new Dictionary<string, System.Text.Json.JsonElement>
                {
                    ["taskId"] = ToolSchemaBuilder.String("The global task id."),
                    ["patch"] = ToolSchemaBuilder.Object(
                        new Dictionary<string, System.Text.Json.JsonElement>
                        {
                            ["title"] = ToolSchemaBuilder.String("New title."),
                            ["description"] = ToolSchemaBuilder.String("New description."),
                            ["status"] = ToolSchemaBuilder.String(
                                "New status: pending / in_progress / blocked / completed / cancelled."),
                            ["priority"] = ToolSchemaBuilder.String(
                                "New priority: low / normal / high / urgent."),
                            ["tags"] = ToolSchemaBuilder.ArraySchema("Replacement tag list."),
                            ["dueAt"] = ToolSchemaBuilder.Number("New due date (unix milliseconds)."),
                            ["archived"] = ToolSchemaBuilder.Boolean("Archive the task (true). Global tasks are never deleted.")
                        })
                },
                ["taskId", "patch"]),
                availableModes: new[] { "global" }));

        // list_global_dispatches: List dispatch records
        registry.Register(new ToolDefinitionPlaceholder(
            "list_global_dispatches",
            "List your dispatch records (messages / work requests sent to project sessions) with their " +
            "status, latest explicit reply and failure reason. Filter by task, session or project.",
            ToolSchemaBuilder.Object(
                new Dictionary<string, System.Text.Json.JsonElement>
                {
                    ["globalTaskId"] = ToolSchemaBuilder.String("Optional global task id filter."),
                    ["sessionId"] = ToolSchemaBuilder.String("Optional target session id filter."),
                    ["projectId"] = ToolSchemaBuilder.String("Optional target project id filter."),
                    ["status"] = ToolSchemaBuilder.String("Optional dispatch status filter.")
                },
                []),
                availableModes: new[] { "global" }));

        // send_work_request: Trackable work dispatch to a target session
        registry.Register(new ToolDefinitionPlaceholder(
            "send_work_request",
            "Send a trackable work request to a project session, bound to a global task. Creates a " +
            "dispatch record and delivers the instruction to the target session. The target session " +
            "works autonomously and replies explicitly; use list_global_dispatches to read its latest " +
            "reply, then update_dispatch when the outcome is clear. For plain questions or follow-ups " +
            "without tracking, use send_session_message instead.",
            ToolSchemaBuilder.Object(
                new Dictionary<string, System.Text.Json.JsonElement>
                {
                    ["globalTaskId"] = ToolSchemaBuilder.String("The global task this work request belongs to."),
                    ["sessionId"] = ToolSchemaBuilder.String("The target session id (from get_project_details)."),
                    ["instruction"] = ToolSchemaBuilder.String(
                        "Clear, self-contained work instruction for the target session."),
                    ["projectId"] = ToolSchemaBuilder.String(
                        "Optional project id. If omitted, inferred from the target session.")
                },
                ["globalTaskId", "sessionId", "instruction"]),
                availableModes: new[] { "global" }));

        // update_dispatch: Update dispatch status / record the latest reply
        registry.Register(new ToolDefinitionPlaceholder(
            "update_dispatch",
            "Update a dispatch record after judging the target session's explicit reply: set status " +
            "(acknowledged / in_progress / completed / blocked / failed) and record the reply summary " +
            "in latestReport. Never mark completed without an explicit result from the target session.",
            ToolSchemaBuilder.Object(
                new Dictionary<string, System.Text.Json.JsonElement>
                {
                    ["dispatchId"] = ToolSchemaBuilder.String("The dispatch record id."),
                    ["patch"] = ToolSchemaBuilder.Object(
                        new Dictionary<string, System.Text.Json.JsonElement>
                        {
                            ["status"] = ToolSchemaBuilder.String(
                                "New dispatch status: acknowledged / in_progress / completed / blocked / failed."),
                            ["latestReport"] = ToolSchemaBuilder.String(
                                "Summary of the target session's latest explicit reply."),
                            ["error"] = ToolSchemaBuilder.String("Failure reason when the delivery or work failed."),
                            ["completedAt"] = ToolSchemaBuilder.Number("Completion timestamp (unix milliseconds).")
                        })
                },
                ["dispatchId", "patch"]),
                availableModes: new[] { "global" }));
    }
}

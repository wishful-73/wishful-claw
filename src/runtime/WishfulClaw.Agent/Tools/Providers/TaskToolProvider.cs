using WishfulClaw.Agent.Tools;
using System.Text.Json;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers task management tool definitions (TaskCreate/Get/Update/List).
/// Execution: ToolDispatchRouter → AgentRuntimeTaskExecutor (SQLite-backed, OpenCowork semantics).
/// Note: The SubAgent "Task" tool is a separate IToolExecutor (TaskTool.cs) registered directly.
/// </summary>
public sealed class TaskToolProvider : IToolProvider
{
    public string Category => "task";

    public void RegisterTools(ToolRegistry registry)
    {
        var activeForm = ToolSchemaBuilder.String(
            "Present continuous form shown in spinner when in_progress (e.g., \"Running tests\")");
        var metadata = ToolSchemaBuilder.String(
            "Optional JSON object of metadata to attach to the task (convention keys: priority / tags / dueAt). Use a JSON object value.");

        registry.Register(new ToolDefinitionPlaceholder(
            "TaskCreate",
            "Create a task for the current session. Use this to track progress on complex multi-step work. " +
            "Tasks are displayed in the Steps panel.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["title"] = ToolSchemaBuilder.String(
                        "A detailed task title with enough context that no separate description is needed"),
                    ["description"] = ToolSchemaBuilder.String("Optional extra description appended to the title."),
                    ["activeForm"] = activeForm,
                    ["metadata"] = metadata
                },
                ["title"])));

        registry.Register(new ToolDefinitionPlaceholder(
            "TaskGet",
            "Retrieve a task by its ID to inspect its title, status, ownership, and dependencies.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["taskId"] = ToolSchemaBuilder.String("The ID of the task to retrieve")
                },
                ["taskId"])));

        registry.Register(new ToolDefinitionPlaceholder(
            "TaskUpdate",
            "Update a task: change status, title, owner, or manage dependencies. " +
            "Set status to \"deleted\" to permanently remove a task.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["taskId"] = ToolSchemaBuilder.String("The ID of the task to update"),
                    ["title"] = ToolSchemaBuilder.String(
                        "New detailed title for the task. Include enough detail that no description is needed."),
                    ["activeForm"] = activeForm,
                    ["status"] = ToolSchemaBuilder.String("New status for the task",
                        ["pending", "in_progress", "blocked", "in_review", "completed", "deleted"]),
                    ["addBlocks"] = ToolSchemaBuilder.ArraySchema("Task IDs that this task blocks",
                        ToolSchemaBuilder.String("A task ID")),
                    ["addBlockedBy"] = ToolSchemaBuilder.ArraySchema("Task IDs that block this task",
                        ToolSchemaBuilder.String("A task ID")),
                    ["owner"] = ToolSchemaBuilder.String("New owner for the task"),
                    ["metadata"] = ToolSchemaBuilder.String(
                        "Metadata keys to merge into the task as a JSON object. Set a key to null to delete it.")
                },
                ["taskId"])));

        registry.Register(new ToolDefinitionPlaceholder(
            "TaskList",
            "List all tasks in the current session with their detailed titles, status, owner, and dependencies.",
            ToolSchemaBuilder.Object()));
    }
}

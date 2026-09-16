using WishfulClaw.Agent.Tools;
using System.Text.Json;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers todo task tool definitions (TodoTaskCreate/Get/Update/List).
/// Execution: ToolDispatchRouter → AgentRuntimeTaskExecutor (SQLite-backed, OpenCowork semantics).
/// Note: The SubAgent "Task" tool is a separate IToolExecutor (TaskTool.cs) registered directly.
///
/// These are the run's own todo list — session-local bookkeeping, which is why all four are declared
/// for every context, sub-agents included.
///
/// iter-30: category moved "task" → "todo" and all four are now <c>IsCore</c>. The todo list is
/// high-frequency bookkeeping the model reaches for mid-task, so it belongs in the direct tool list
/// rather than behind the <c>use_capability</c> proxy; the previous arrangement forced a prompt block
/// (<c>&lt;session_todo&gt;</c>, since removed) to explain a detour that should not exist. The sub-agent
/// tools (Task / SubAgentStatus / SubAgentDetail) keep their own "task" category and stay proxy-reachable.
/// </summary>
public sealed class TaskToolProvider : IToolProvider
{
    public string Category => "todo";

    public void RegisterTools(ToolRegistry registry)
    {
        var activeForm = ToolSchemaBuilder.String(
            "Present continuous form shown in spinner when in_progress (e.g., \"Running tests\")");
        var metadata = ToolSchemaBuilder.String(
            "Optional JSON object of metadata to attach to the task (convention keys: priority / tags / dueAt). Use a JSON object value.");

        registry.Register(new ToolDefinitionPlaceholder(
            "TodoTaskCreate",
            "Create a task for this session. For work with three or more distinct steps, create the tasks " +
            "up front so the plan stays visible while you work. Tasks appear in the Steps panel.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["title"] = ToolSchemaBuilder.String(
                        "A detailed task title with enough context that no separate description is needed"),
                    ["description"] = ToolSchemaBuilder.String("Optional extra description appended to the title."),
                    ["activeForm"] = activeForm,
                    ["metadata"] = metadata
                },
                ["title"]),
            visibleScopes: ToolVisibilityScopes.Everywhere,
            isCore: true));

        registry.Register(new ToolDefinitionPlaceholder(
            "TodoTaskGet",
            "Retrieve a task by its ID to inspect its title, status, ownership, and dependencies.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["taskId"] = ToolSchemaBuilder.String("The ID of the task to retrieve")
                },
                ["taskId"]),
            visibleScopes: ToolVisibilityScopes.Everywhere,
            isCore: true));

        registry.Register(new ToolDefinitionPlaceholder(
            "TodoTaskUpdate",
            "Update a task: change status, title, owner, or manage dependencies. " +
            "Set status to \"deleted\" to permanently remove a task.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["taskId"] = ToolSchemaBuilder.String("The ID of the task to update"),
                    ["title"] = ToolSchemaBuilder.String(
                        "New detailed title for the task. Include enough detail that no description is needed."),
                    ["activeForm"] = activeForm,
                    // 状态语义原本写在系统提示词的 <session_todo> 块里（iter-30 已删除该块）。
                    // 挪到参数描述上 —— 这里是「随取随用」的位置，不占每轮的提示词预算。
                    ["status"] = ToolSchemaBuilder.String(
                        "New status for the task. in_progress = starting it (only one at a time); " +
                        "blocked = stuck, needs something external; in_review = done but awaiting user " +
                        "confirmation; completed = fully done and verified; deleted = remove permanently.",
                        ["pending", "in_progress", "blocked", "in_review", "completed", "deleted"]),
                    ["addBlocks"] = ToolSchemaBuilder.ArraySchema("Task IDs that this task blocks",
                        ToolSchemaBuilder.String("A task ID")),
                    ["addBlockedBy"] = ToolSchemaBuilder.ArraySchema("Task IDs that block this task",
                        ToolSchemaBuilder.String("A task ID")),
                    ["owner"] = ToolSchemaBuilder.String("New owner for the task"),
                    ["metadata"] = ToolSchemaBuilder.String(
                        "Metadata keys to merge into the task as a JSON object. Set a key to null to delete it.")
                },
                ["taskId"]),
            visibleScopes: ToolVisibilityScopes.Everywhere,
            isCore: true));

        registry.Register(new ToolDefinitionPlaceholder(
            "TodoTaskList",
            "List all tasks in the current session with their detailed titles, status, owner, and dependencies.",
            ToolSchemaBuilder.Object(),
            visibleScopes: ToolVisibilityScopes.Everywhere,
            isCore: true));
    }
}

using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers cron/scheduled task tool definitions.
/// Execution: ToolDispatchRouter → AgentRuntimeCronExecutor (reverse-request to main process).
/// Available in normal and goal modes only (not sub-agent).
/// </summary>
public sealed class CronToolProvider : IToolProvider
{
    public string Category => "cron";

    public void RegisterTools(ToolRegistry registry)
    {
        var cronSchedule = ToolSchemaBuilder.Object(
            new()
            {
                ["kind"] = ToolSchemaBuilder.String("Schedule kind.", ["at", "every", "cron"]),
                ["at"] = ToolSchemaBuilder.String("For kind=at, use a relative offset such as +10m, +2h, +30s, or +1d."),
                ["every"] = ToolSchemaBuilder.Number("For kind=every, interval in milliseconds (minimum 1000)."),
                ["expr"] = ToolSchemaBuilder.String("For kind=cron, a valid 5- or 6-field cron expression."),
                ["tz"] = ToolSchemaBuilder.String("Optional IANA timezone for kind=cron. Defaults to UTC.")
            },
            ["kind"]);
        var cronPrompt = ToolSchemaBuilder.String("Task instruction for the Cron Agent to execute when the job fires.");
        var cronName = ToolSchemaBuilder.String("Human-readable job name shown in the UI.");
        var createProperties = CreateProperties(cronSchedule, cronPrompt, cronName);

        registry.Register(new ToolDefinitionPlaceholder(
            "CronAdd",
            "Schedule a background Agent task (legacy alias for CronCreate).",
            ToolSchemaBuilder.Object(createProperties, ["name", "schedule", "prompt"]),
            availableModes: ["normal", "goal", "global"]));

        registry.Register(new ToolDefinitionPlaceholder(
            "CronCreate",
            "Create a scheduled task that runs automatically at the specified time.",
            ToolSchemaBuilder.Object(createProperties, ["name", "schedule", "prompt"]),
            availableModes: ["normal", "goal", "global"]));

        registry.Register(new ToolDefinitionPlaceholder(
            "CronUpdate",
            "Update an existing scheduled task.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["jobId"] = ToolSchemaBuilder.String("Cron job ID to update."),
                    ["patch"] = ToolSchemaBuilder.Object(UpdateProperties(cronSchedule, cronPrompt, cronName))
                },
                ["jobId", "patch"]),
            availableModes: ["normal", "goal", "global"]));

        registry.Register(new ToolDefinitionPlaceholder(
            "CronRemove",
            "Remove and soft-delete a scheduled task (legacy alias for CronDelete).",
            DeleteSchema(),
            availableModes: ["normal", "goal", "global"]));

        registry.Register(new ToolDefinitionPlaceholder(
            "CronDelete",
            "Delete and archive a scheduled task.",
            DeleteSchema(),
            availableModes: ["normal", "goal", "global"]));

        registry.Register(new ToolDefinitionPlaceholder(
            "CronList",
            "List all cron jobs with their schedule, status, and latest execution result.",
            ToolSchemaBuilder.Object(),
            availableModes: ["normal", "goal", "global"]));
    }

    private static Dictionary<string, System.Text.Json.JsonElement> CreateProperties(
        System.Text.Json.JsonElement schedule,
        System.Text.Json.JsonElement prompt,
        System.Text.Json.JsonElement name) => new()
    {
        ["name"] = name,
        ["schedule"] = schedule,
        ["prompt"] = prompt,
        ["sessionId"] = ToolSchemaBuilder.String("Session associated with the task and default session delivery target."),
        ["agentId"] = ToolSchemaBuilder.String("Optional registered Agent override."),
        ["model"] = ToolSchemaBuilder.String("Optional model override."),
        ["thinkingEnabled"] = ToolSchemaBuilder.Boolean("Optional task-level thinking override. Omit to follow the model default without sending thinking parameters."),
        ["reasoningEffort"] = ToolSchemaBuilder.String("Optional reasoning effort used only when thinkingEnabled is true.", ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]),
        ["workingFolder"] = ToolSchemaBuilder.String("Working directory for the Agent run."),
        ["deliveryMode"] = ToolSchemaBuilder.String("Result delivery mode.", ["desktop", "session", "plugin", "none"]),
        ["deliveryTarget"] = ToolSchemaBuilder.String("Explicit delivery target; for session delivery this is the target session ID."),
        ["pluginId"] = ToolSchemaBuilder.String("Messaging plugin ID for plugin delivery."),
        ["pluginType"] = ToolSchemaBuilder.String("Messaging plugin type, such as feishu or weixin."),
        ["pluginChatId"] = ToolSchemaBuilder.String("Chat ID for plugin delivery."),
        ["deleteAfterRun"] = ToolSchemaBuilder.Boolean("Archive the task after its run completes. Defaults to true for kind=at."),
        ["maxIterations"] = ToolSchemaBuilder.Integer("Maximum Agent loop iterations. Defaults to 15.")
    };

    private static Dictionary<string, System.Text.Json.JsonElement> UpdateProperties(
        System.Text.Json.JsonElement schedule,
        System.Text.Json.JsonElement prompt,
        System.Text.Json.JsonElement name)
    {
        var properties = CreateProperties(schedule, prompt, name);
        properties["enabled"] = ToolSchemaBuilder.Boolean("Whether the task is enabled.");
        return properties;
    }

    private static System.Text.Json.JsonElement DeleteSchema() => ToolSchemaBuilder.Object(
        new() { ["jobId"] = ToolSchemaBuilder.String("Cron job ID to delete.") },
        ["jobId"]);
}

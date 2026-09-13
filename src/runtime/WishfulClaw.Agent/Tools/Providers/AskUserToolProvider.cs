using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers AskUser tool definitions.
/// Execution: ToolDispatchRouter → AgentRuntimeAskUserExecutor (reverse-request to renderer).
/// </summary>
public sealed class AskUserToolProvider : IToolProvider
{
    public string Category => "ask-user";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "AskUserQuestion",
            "Present structured choices to the user and wait for their selection. Use when you need the user to decide between options, confirm an action, or provide direction. Supports single-select and multi-select questions with option descriptions.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["header"] = ToolSchemaBuilder.String("Short label for the question card (max 12 characters)."),
                    ["questions"] = ToolSchemaBuilder.ArraySchema(
                        "List of 1-5 questions to present.",
                        ToolSchemaBuilder.Object(new()
                        {
                            ["question"] = ToolSchemaBuilder.String("The question text."),
                            ["multiSelect"] = ToolSchemaBuilder.Boolean("Whether multiple options can be selected."),
                            ["options"] = ToolSchemaBuilder.ArraySchema(
                                "2-4 options. First option is the recommended/default.",
                                ToolSchemaBuilder.Object(new()
                                {
                                    ["label"] = ToolSchemaBuilder.String("Short option label (max 20 characters)."),
                                    ["description"] = ToolSchemaBuilder.String("Supplementary explanation of the option.")
                                }))
                        }))
                },
                ["header", "questions"]),
            visibleScopes: ToolVisibilityScopes.HumanAttended,
            excludedScopes: ToolVisibilityScopes.NoHumanToAnswer));
    }
}

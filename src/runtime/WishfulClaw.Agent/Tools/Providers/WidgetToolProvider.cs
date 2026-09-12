using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers widget tool definitions.
/// Execution: ToolDispatchRouter → AgentRuntimeWidgetExecutor (pure Worker, no I/O).
/// </summary>
public sealed class WidgetToolProvider : IToolProvider
{
    public string Category => "widget";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "visualize_show_widget",
            "Display a UI widget (chart, table, HTML, or image) in the chat interface.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["type"] = ToolSchemaBuilder.String("Widget type: chart, table, html, or image.", ["chart", "table", "html", "image"]),
                    ["title"] = ToolSchemaBuilder.String("Widget title."),
                    ["data"] = ToolSchemaBuilder.String("Widget data (JSON string or HTML depending on type).")
                },
                ["type", "data"]),
            visibleScopes: ToolVisibilityScopes.HumanAttended));
    }
}

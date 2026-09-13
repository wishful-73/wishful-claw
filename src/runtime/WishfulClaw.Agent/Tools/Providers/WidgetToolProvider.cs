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
        // Schema must stay in sync with renderer/src/lib/tools/widget-tool.ts:
        // the executor (AgentRuntimeWidgetExecutor) and every renderer consumer
        // (sanitizer, summaries, ToolCallCard) read "widget_code", not type/data.
        // loading_messages is intentionally NOT required and has no minItems/maxItems
        // — the executor fails soft (defaults to "Rendering {title}…"), and strict
        // provider-side validators reject missing/minItems-violating fields otherwise.
        registry.Register(new ToolDefinitionPlaceholder(
            "visualize_show_widget",
            "Show visual content — SVG graphics, diagrams, charts, or interactive HTML widgets — that renders inline alongside your text response.\n"
                + "Use for flowcharts, architecture diagrams, dashboards, forms, calculators, data tables, games, illustrations, or any visual content.\n"
                + "The code is auto-detected: starts with <svg = SVG mode, otherwise HTML mode.\n"
                + "A global sendPrompt(text) function is available — it sends a message to chat as if the user typed it.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["title"] = ToolSchemaBuilder.String("Short snake_case identifier for this visual. Must be specific and disambiguating."),
                    ["loading_messages"] = ToolSchemaBuilder.ArraySchema(
                        "1-4 loading messages shown to the user while the visual renders.",
                        ToolSchemaBuilder.String("A loading message.")),
                    ["widget_code"] = ToolSchemaBuilder.String("SVG or HTML code to render. For SVG: raw SVG code starting with <svg> tag. For HTML: raw HTML content without DOCTYPE, <html>, <head>, or <body> tags.")
                },
                ["title", "widget_code"]),
            visibleScopes: ToolVisibilityScopes.HumanAttended,
            excludedScopes: ToolVisibilityScopes.NoHumanToAnswer));
    }
}

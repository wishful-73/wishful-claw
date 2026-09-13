using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers web search and fetch tool definitions.
/// Execution: ToolDispatchRouter → AgentRuntimeWebSearchExecutor / AgentRuntimeWebFetchExecutor (direct HTTP in Worker).
/// </summary>
public sealed class WebToolProvider : IToolProvider
{
    public string Category => "web";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "WebSearch",
            "Search the web for information. Returns titles, URLs, and snippets for relevant results.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["query"] = ToolSchemaBuilder.String("The search query."),
                    ["count"] = ToolSchemaBuilder.Number("Number of results to return. Defaults to 10.")
                },
                ["query"]),
            visibleScopes: ToolVisibilityScopes.Everywhere));

        registry.Register(new ToolDefinitionPlaceholder(
            "WebFetch",
            "Fetch and parse a web page. Returns the page content as markdown.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["url"] = ToolSchemaBuilder.String("The URL to fetch."),
                    ["maxTokens"] = ToolSchemaBuilder.Number("Maximum tokens to return. Defaults to 10000.")
                },
                ["url"]),
            visibleScopes: ToolVisibilityScopes.Everywhere));
    }
}

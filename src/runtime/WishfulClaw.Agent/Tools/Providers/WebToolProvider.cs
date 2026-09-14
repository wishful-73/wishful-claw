using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers the web fetch tool definition.
/// Execution: ToolDispatchRouter → AgentRuntimeWebFetchExecutor (direct HTTP in Worker).
///
/// Web search used to live here too (a provider-API-backed `WebSearch`), but that chain is
/// retired in iter-29 (S-23): the tool the agent actually uses is the renderer-side multi-engine
/// scraper, now declared as `WebSearch` by BrowserToolProvider and executed through
/// renderer-tool-bridge. Keeping a second, key-gated `WebSearch` here meant the LLM saw two
/// search tools and the configurable one was the dead one.
/// </summary>
public sealed class WebToolProvider : IToolProvider
{
    public string Category => "web";

    public void RegisterTools(ToolRegistry registry)
    {
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

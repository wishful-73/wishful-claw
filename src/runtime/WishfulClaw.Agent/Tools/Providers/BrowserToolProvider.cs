using WishfulClaw.Agent.Tools;
using System.Text.Json;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers browser tool definitions.
/// Execution: ToolDispatchRouter → AgentRuntimeBrowserExecutor (reverse-request to renderer).
/// </summary>
public sealed class BrowserToolProvider : IToolProvider
{
    public string Category => "browser";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "BrowserNavigate",
            "Navigate the built-in browser to a URL. Actions: goto (default, requires url), back, forward, refresh. Opens the browser panel automatically.",
            BrowserToolSchema.CreateObjectSchema(
                new Dictionary<string, JsonElement>
                {
                    ["url"] = BrowserToolSchema.CreateStringProperty("URL to navigate to. Required for goto action."),
                    ["action"] = BrowserToolSchema.CreateStringProperty("goto | back | forward | refresh. Default: goto.")
                })));

        registry.Register(new ToolDefinitionPlaceholder(
            "BrowserGetContent",
            "Extract page content as Markdown (default) or HTML. Optional CSS selector to target a section.",
            BrowserToolSchema.CreateObjectSchema(
                new Dictionary<string, JsonElement>
                {
                    ["selector"] = BrowserToolSchema.CreateStringProperty("CSS selector to scope extraction. Omit for full page."),
                    ["type"] = BrowserToolSchema.CreateStringProperty("markdown (default) or html.")
                })));

        registry.Register(new ToolDefinitionPlaceholder(
            "BrowserScreenshot",
            "Capture a screenshot of the current browser viewport.",
            BrowserToolSchema.CreateObjectSchema(new Dictionary<string, JsonElement>())));

        registry.Register(new ToolDefinitionPlaceholder(
            "BrowserSnapshot",
            "List all interactive elements with CSS selectors. Call before BrowserClick/BrowserType.",
            BrowserToolSchema.CreateObjectSchema(new Dictionary<string, JsonElement>())));

        registry.Register(new ToolDefinitionPlaceholder(
            "BrowserClick",
            "Click an element by CSS selector or text= prefix.",
            BrowserToolSchema.CreateObjectSchema(
                new Dictionary<string, JsonElement>
                {
                    ["selector"] = BrowserToolSchema.CreateStringProperty("CSS selector or text=<visible text>.")
                },
                new[] { "selector" })));

        registry.Register(new ToolDefinitionPlaceholder(
            "BrowserType",
            "Type text into an input element. Optionally clear first and submit.",
            BrowserToolSchema.CreateObjectSchema(
                new Dictionary<string, JsonElement>
                {
                    ["selector"] = BrowserToolSchema.CreateStringProperty("CSS selector of input element."),
                    ["text"] = BrowserToolSchema.CreateStringProperty("Text to type."),
                    ["clear"] = BrowserToolSchema.CreateBooleanProperty("Clear before typing. Default: true.", true),
                    ["submit"] = BrowserToolSchema.CreateBooleanProperty("Press Enter after typing. Default: false.", false)
                },
                new[] { "selector", "text" })));

        registry.Register(new ToolDefinitionPlaceholder(
            "BrowserScroll",
            "Scroll the page up or down.",
            BrowserToolSchema.CreateObjectSchema(
                new Dictionary<string, JsonElement>
                {
                    ["direction"] = BrowserToolSchema.CreateStringProperty("down (default) or up."),
                    ["amount"] = BrowserToolSchema.CreateNumberProperty("Pixels to scroll. Omit for one viewport height.")
                })));

        registry.Register(new ToolDefinitionPlaceholder(
            "BrowserEvaluate",
            "Execute JavaScript in the page context. Use return to return a value; await is supported.",
            BrowserToolSchema.CreateObjectSchema(
                new Dictionary<string, JsonElement>
                {
                    ["code"] = BrowserToolSchema.CreateStringProperty("JavaScript to execute.")
                },
                new[] { "code" })));

        registry.Register(new ToolDefinitionPlaceholder(
            "BrowserSearch",
            "Multi-engine aggregated web search (Baidu, Bing, Sogou, GitHub, ArXiv, etc.). No API key required; auto-detects intent, runs engines in parallel, and deduplicates results.",
            BrowserToolSchema.CreateObjectSchema(
                new Dictionary<string, JsonElement>
                {
                    ["query"] = BrowserToolSchema.CreateStringProperty("The search query."),
                    ["intent"] = BrowserToolSchema.CreateStringProperty("Override auto-detected intent: general, tech, academic, finance, social, knowledge."),
                    ["maxResults"] = BrowserToolSchema.CreateNumberProperty("Maximum results after deduplication. Default 10.")
                },
                new[] { "query" })));
    }
}

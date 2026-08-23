using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers the unified capability proxy tool.
/// Instead of registering every MCP tool and Skill as individual tools
/// (which bloats the LLM request and causes HTTP 413), a single stable
/// use_capability tool lets the agent discover, inspect, and call
/// MCP tools and Skills on demand.
///
/// Inspired by Reasonix's use_capability design.
/// Execution: ToolDispatchRouter → AgentRuntimeUseCapabilityExecutor.
/// </summary>
public sealed class UseCapabilityToolProvider : IToolProvider
{
    public string Category => "capability";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "use_capability",
            "Stable capability proxy for MCP tools, Skills, and proxied built-in tools. "
            + "action=\"list\" returns paged summaries (filters: type, category, query, cursor, page_size); "
            + "action=\"inspect\" returns one capability's full input schema; action=\"call\" executes it. "
            + "capability_id format: \"mcp-tool:server/tool\", \"skill:name\", or \"builtin:toolName\".",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["action"] = ToolSchemaBuilder.String(
                        "list | inspect | call",
                        new[] { "list", "inspect", "call" }),
                    ["capability_id"] = ToolSchemaBuilder.String(
                        "Capability id: mcp-tool:server/tool, mcp-server:name, skill:name, or builtin:toolName. "
                        + "Not required for action=list."),
                    ["type"] = ToolSchemaBuilder.String(
                        "Optional action=list filter: mcp-server, mcp-tool, skill, or builtin."),
                    ["category"] = ToolSchemaBuilder.String(
                        "Optional action=list category filter, such as mcp, skill, project, desktop, or goal."),
                    ["query"] = ToolSchemaBuilder.String(
                        "Optional action=list case-insensitive search over capability id, name, and description."),
                    ["cursor"] = ToolSchemaBuilder.String(
                        "Optional action=list cursor returned as next_cursor by the previous page."),
                    ["page_size"] = ToolSchemaBuilder.Number(
                        "Optional action=list page size. Defaults to 20, maximum 100."),
                    ["arguments"] = ToolSchemaBuilder.Object(
                        new()
                        {
                            ["(any)"] = ToolSchemaBuilder.String("Tool arguments as JSON object. Only for action=call.")
                        })
                },
                new[] { "action" })));
    }
}

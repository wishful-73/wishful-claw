using WishfulClaw.Agent;
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
            AgentRuntimeUseCapabilityExecutor.BuildCapabilityDescription(),
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
                        "Optional action=list category filter. Use mcp, skill, or a built-in category named in this tool description."),
                    ["query"] = ToolSchemaBuilder.String(
                        "Optional action=list case-insensitive search over capability id, name, and description."),
                    ["cursor"] = ToolSchemaBuilder.String(
                        "Optional action=list cursor returned as next_cursor by the previous page."),
                    ["page_size"] = ToolSchemaBuilder.Number(
                        "Optional action=list page size. Defaults to 20, maximum 100."),
                    // T-11: 曾把 arguments 描述成 { "(any)": string } —— 实测会诱导模型
                    // 传「JSON 字符串」，而执行侧只接受 JSON 对象（`ValueKind == Object`），
                    // 于是参数被丢成空对象（内置 Task 表现为 "Task requires a non-empty
                    // prompt"）。改为自由对象（无 properties），与执行侧口径一致。
                    ["arguments"] = ToolSchemaBuilder.Object()
                },
                new[] { "action" }),
            visibleScopes: ToolVisibilityScopes.Everywhere, isCore: true));
    }
}

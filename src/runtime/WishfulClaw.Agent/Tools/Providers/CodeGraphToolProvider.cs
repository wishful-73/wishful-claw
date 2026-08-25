using System.Text.Json;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers the CodeGraph tool definition for the Agent.
/// Execution: ToolDispatchRouter -> AgentRuntimeCodeGraphExecutor -> Main reverse request.
/// </summary>
public sealed class CodeGraphToolProvider : IToolProvider
{
    public string Category => "codegraph";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "codegraph_explore",
            "PRIMARY code-intelligence tool. Give a natural-language question or symbol/file names and get ranked related source, definitions, callers/callees, call paths, and impact. Prefer this over Read/Grep for understanding how code fits together. Requires CodeGraph to be enabled and the project to be indexed.",
            ToolSchemaBuilder.Object(
                new Dictionary<string, JsonElement>
                {
                    ["query"] = ToolSchemaBuilder.String(
                        "A symbol name or natural-language question about the codebase structure."),
                    ["projectPath"] = ToolSchemaBuilder.String(
                        "Optional absolute path to the project root. Defaults to the active working folder.")
                },
                ["query"])));
    }
}

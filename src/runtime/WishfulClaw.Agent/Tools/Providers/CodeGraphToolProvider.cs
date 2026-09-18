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
            "Query the indexed code graph. Give a natural-language question, or a space-separated bag of "
                + "symbol/file names, and get verbatim source grouped by file plus the call paths and impact "
                + "among those symbols — in one call. Prefer this over Read/Grep for understanding how code "
                + "fits together.",
            ToolSchemaBuilder.Object(
                new Dictionary<string, JsonElement>
                {
                    ["query"] = ToolSchemaBuilder.String(
                        "A natural-language question, or a space-separated bag of symbol/file names."),
                    ["projectPath"] = ToolSchemaBuilder.String(
                        "Absolute path to the project root whose graph to query. Defaults to the active working folder.")
                },
                ["query"]),
            visibleScopes: ToolVisibilityScopes.Everywhere,
            isCore: true));
    }
}

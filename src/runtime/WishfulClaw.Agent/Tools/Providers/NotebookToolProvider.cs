using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers notebook editing tool definitions.
/// Execution: ToolDispatchRouter → AgentRuntimeNotebookEditExecutor.
/// </summary>
public sealed class NotebookToolProvider : IToolProvider
{
    public string Category => "notebook";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "NotebookEdit",
            "Edit a Jupyter Notebook cell. Supports replace, insert, and delete operations.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["notebook_path"] = ToolSchemaBuilder.String("Path to the .ipynb file."),
                    ["cell_id"] = ToolSchemaBuilder.String("The cell ID to edit."),
                    ["new_source"] = ToolSchemaBuilder.String("The new source code for the cell."),
                    ["cell_type"] = ToolSchemaBuilder.String("Cell type: code, markdown, or raw.", ["code", "markdown", "raw"]),
                    ["edit_mode"] = ToolSchemaBuilder.String("Edit mode: replace, insert, or delete.", ["replace", "insert", "delete"])
                },
                ["notebook_path", "cell_id", "new_source"]),
            visibleScopes: ToolVisibilityScopes.WorkRunsOnly));
    }
}

using System.Text.Json;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Core.Tools;

/// <summary>
/// Generic placeholder for tools whose definitions must appear in tool/list
/// but whose execution is intercepted by ToolDispatchRouter (reverse-request,
/// native executor, etc.). Registering the definition makes the tool visible
/// to the LLM; the ExecuteAsync here should never be reached.
/// </summary>
public sealed class ToolDefinitionPlaceholder : IToolExecutor
{
    public string Name { get; }
    public string Description { get; }
    public JsonElement InputSchema { get; }
    public string[]? AvailableModes { get; }
    public string[]? VisibleScopes { get; }
    public string[]? ExcludedScopes { get; }
    public bool IsCore { get; }

    public ToolDefinitionPlaceholder(
        string name,
        string description,
        JsonElement inputSchema,
        string[]? availableModes = null,
        string[]? visibleScopes = null,
        string[]? excludedScopes = null,
        bool isCore = false)
    {
        Name = name;
        Description = description;
        InputSchema = inputSchema;
        AvailableModes = availableModes;
        VisibleScopes = visibleScopes;
        ExcludedScopes = excludedScopes;
        IsCore = isCore;
    }

    public Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)
    {
        return Task.FromResult(new ToolResult(
            $"Tool '{Name}' should be executed via the ToolDispatchRouter, not the registry. " +
            "This is a bug in the tool routing logic.",
            IsError: true));
    }
}
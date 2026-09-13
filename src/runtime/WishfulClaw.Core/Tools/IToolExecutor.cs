using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace WishfulClaw.Core.Tools;

/// <summary>
/// Interface for tool executors. Each tool implements this interface.
/// Executor pattern — each tool is self-contained, adding a tool = new file.
/// </summary>
public interface IToolExecutor
{
    /// <summary>
    /// Tool name (e.g. "Read", "Write", "Bash").
    /// </summary>
    string Name { get; }

    /// <summary>
    /// Human-readable description for the LLM.
    /// </summary>
    string Description { get; }

    /// <summary>
    /// JSON schema for the tool's input parameters.
    /// </summary>
    JsonElement InputSchema { get; }

    /// <summary>
    /// The session modes this tool is available in. null = all modes.
    /// e.g. ["normal"] = only in normal mode, ["goal"] = only in goal mode.
    /// Default implementation returns null (available in all modes).
    /// </summary>
    string[]? AvailableModes => null;

    /// <summary>
    /// Run-context patterns this tool is visible under, e.g. "project:cowork" or "*:chat@subagent".
    /// null/empty = visible everywhere (an undeclared tool stays visible — see ToolDefinition.VisibleScopes).
    /// Default implementation returns null so every existing executor keeps its current visibility.
    /// </summary>
    string[]? VisibleScopes => null;

    /// <summary>
    /// Run-context patterns this tool is explicitly unavailable under, same syntax as
    /// <see cref="VisibleScopes"/> — e.g. a tool that needs a human present declares "*:channel@*".
    /// Wins over both a matching VisibleScopes pattern and the default-visible rule.
    /// Default implementation returns null (excludes nothing), so every existing executor keeps its
    /// current visibility.
    /// </summary>
    string[]? ExcludedScopes => null;

    /// <summary>
    /// Whether this tool should be listed directly in the system prompt (core tool set) rather than
    /// being reachable on demand through use_capability.
    /// Defaults to false: visibility and core-ness are orthogonal, so tools opt in explicitly.
    /// </summary>
    bool IsCore => false;

    /// <summary>
    /// Execute the tool with the given input and context.
    /// </summary>
    Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context);
}
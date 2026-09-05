using System.Text.Json;

namespace WishfulClaw.Core.Tools;

/// <summary>
/// Tool definition sent to the LLM provider.
/// </summary>
public sealed record ToolDefinition(
    string Name,
    string Description,
    JsonElement InputSchema,
    string[]? AvailableModes = null,
    string? Category = null,
    int Priority = 100);

/// <summary>
/// Result of executing a tool.
/// </summary>
public sealed record ToolResult(
    string Content,
    bool IsError = false,
    string? Error = null);

/// <summary>
/// Context passed to tool executors.
/// </summary>
public sealed record ToolExecutionContext(
    string? WorkingFolder = null,
    string? SessionId = null,
    string? RunId = null,
    string? ProjectId = null,
    string? SshConnectionId = null,
    CancellationToken CancellationToken = default);

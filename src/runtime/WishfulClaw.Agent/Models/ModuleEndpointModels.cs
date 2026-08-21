namespace WishfulClaw.Agent;

using System.Text.Json;

/// <summary>
/// Result types for AgentRuntime module endpoints (run/cancel/stop/append).
/// </summary>
public sealed record AgentRuntimeRunResult(bool Started, string RunId);

public sealed record AgentRuntimeCancelResult(bool Cancelled, string? RunId);

public sealed record AgentRuntimeStopResult(bool Stopped, string? RunId);

public sealed record AgentRuntimeAppendMessagesResult(bool Appended, string? RunId, int Count);

public sealed record AgentRuntimeDrainResult(bool Ok, List<JsonElement> Messages);

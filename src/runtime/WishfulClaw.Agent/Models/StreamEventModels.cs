using System.Text.Json;

namespace WishfulClaw.Agent;

/// <summary>
/// Stream envelope and event records sent to the renderer via MessagePack.
/// </summary>
public sealed record AgentRuntimeStreamEnvelope(
    int V,
    string RunId,
    string SessionId,
    long Seq,
    AgentRuntimeStreamEvent[] Events);

/// <summary>
/// Flat event record. Field names are camelCase to match the frontend codec.
/// The MessagePack encoder skips nulls, so additional fields can be added
/// without breaking the protocol.
/// </summary>
public sealed record AgentRuntimeStreamEvent(
    string Type,
    int? Iteration = null,
    string? Reason = null,
    string? StopReason = null,
    string? Text = null,
    string? Thinking = null,
    string? Message = null,
    string? Content = null,
    string? Provider = null,
    string? ErrorType = null,
    string? Details = null,
    string? StackTrace = null,
    string? ToolCallId = null,
    string? ToolName = null,
    JsonElement? PartialInput = null,
    AgentRuntimeToolUseBlock? ToolUseBlock = null,
    AgentRuntimeToolCallState? ToolCall = null,
    AgentRuntimeToolResult[]? ToolResults = null,
    AgentRuntimeRequestDebugInfo? DebugInfo = null,
    AgentRuntimeTokenUsage? Usage = null,
    AgentRuntimeRequestTiming? Timing = null,
    string? ProviderResponseId = null,
    int? OriginalCount = null,
    int? NewCount = null,
    int? KeptMessageCount = null,
    // Context compression metadata (context_compression_start / context_compressed)
    string? Trigger = null,
    bool? SummarizerFailed = null,
    int? MessagesSummarized = null,
    JsonElement[]? Messages = null,
    JsonElement[]? CompactArtifacts = null,
    string? ToolUseId = null,
    int? Attempt = null,
    int? MaxAttempts = null,
    int? DelayMs = null,
    int? StatusCode = null,
    // Sub-agent event fields
    string? SubAgentName = null,
    string? Report = null,
    string? Status = null,
    JsonElement? Input = null,
    JsonElement? PromptMessage = null,
    JsonElement? Result = null,
    // Session-cumulative cache tokens (carried on message_end events)
    int? SessionCacheHit = null,
    int? SessionCacheMiss = null,
    // Usage source: "executor", "subagent", "compaction", etc.
    string? UsageSource = null);

using System.Text.Json;

namespace WishfulClaw.Agent;

/// <summary>
/// Provider turn result returned by ExecuteTurnAsync.
/// </summary>
public sealed record AgentRuntimeProviderTurnResult(
    AgentRuntimeChatMessage AssistantMessage,
    List<AgentRuntimeNativeToolCall> ToolCalls,
    string StopReason,
    AgentRuntimeTokenUsage? Usage = null);

/// <summary>
/// Chat message used in the agent loop conversation.
/// </summary>
public sealed record AgentRuntimeChatMessage(
    string Role,
    string Text,
    List<AgentRuntimeChatToolUse> ToolUses,
    List<AgentRuntimeToolResult> ToolResults,
    string? ProviderResponseId = null,
    List<JsonElement>? ContentBlocks = null,
    string? ReasoningContent = null,
    JsonElement? ReasoningDetails = null)
{
    public static AgentRuntimeChatMessage UserToolResults(List<AgentRuntimeToolResult> toolResults)
    {
        return new AgentRuntimeChatMessage("user", string.Empty, [], toolResults);
    }

    public static AgentRuntimeChatMessage User(string text)
    {
        return new AgentRuntimeChatMessage("user", text, [], []);
    }
}

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
/// <remarks>
/// S-208（2026-10-20）把「数据」和「发给模型的拼接结果」拆成两个字段：
/// <see cref="Text"/> 是真正写进对话、发给 provider 的那份，可能被
/// <c>InjectTransientPrefix</c> 在**尾部**附加了 <c>&lt;current_time&gt;</c> /
/// <c>&lt;memory-recall&gt;</c> / <c>&lt;memory-update&gt;</c> 这些运行时附加块
/// （S-231 起由前置改为后置，好让「取首条 user 做标题」的第三方网关读到用户原话）；
/// <see cref="OriginalText"/> 永远只装用户自己的话。下游要「用户到底说了什么」
/// 就读后者，不必再去剥字符串。
/// </remarks>
public sealed record AgentRuntimeChatMessage(
    string Role,
    string Text,
    List<AgentRuntimeChatToolUse> ToolUses,
    List<AgentRuntimeToolResult> ToolResults,
    string? ProviderResponseId = null,
    List<JsonElement>? ContentBlocks = null,
    string? ReasoningContent = null,
    JsonElement? ReasoningDetails = null,
    // 干净原文。null = 从未被运行时块污染过（此时与 Text 等值）。
    string? OriginalText = null,
    // 消息落入对话的时刻。Text 里的 <current_time> 是展示层的字符串，
    // 读它属于解析而非取数；需要时间的下游（压缩快照）读这个字段。
    DateTimeOffset? SentAt = null)
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

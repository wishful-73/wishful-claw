using System.Text.Json;

namespace WishfulClaw.Agent.SubAgents;

/// <summary>
/// Collects text events from a sub-agent's event stream and forwards
/// key events to the parent's stream via a callback.
///
/// The final assistant text is accumulated from "text" events and returned
/// as the sub-agent's output. Tool call details are collected for the
/// context summary that gets appended to the tool_result in Phase 2.
/// </summary>
public sealed class SubAgentRunCollector
{
    private readonly List<string> _textParts = [];
    private readonly List<string> _thinkingParts = [];
    private int _toolCallCount;
    private int _iterations;
    private readonly List<ToolCallSummary> _toolCallSummaries = [];

    /// <summary>
    /// Callback invoked for each event that should be forwarded to the
    /// parent's stream. The SubAgentExecutor sets this to wrap events
    /// with sub_agent_ prefix and emit to the parent stream.
    /// </summary>
    public Func<AgentRuntimeStreamEvent, ValueTask>? ForwardEvent { get; set; }

    /// <summary>
    /// 进度快照回调：<c>tool_call_start</c> / <c>tool_call_result</c> / <c>iteration_start</c>
    /// 时各触发一次。
    ///
    /// 存在的理由：`BackgroundSubAgentRegistry.UpdateProgress` 原先只在
    /// `ExecuteLoopAsync` **整个返回之后**调用一次 —— 于是 `SubAgentStatus` 在子 agent
    /// 运行期间永远报 `Tool calls: 0 / Iterations: 0`。实测过：系统进程表里 `Start-Sleep`
    /// 明明在跑，状态工具却说 0 次；这会让调用方（尤其是人）误判成「还没启动」。
    /// 这里补的就是那条实时通道，只挂这三类低频事件，不挂 text_delta。
    /// </summary>
    public Action? ProgressChanged { get; set; }

    public async ValueTask ObserveAsync(AgentRuntimeStreamEvent evt)
    {
        switch (evt.Type)
        {
            case "text":
            case "text_delta":
                if (!string.IsNullOrEmpty(evt.Text))
                {
                    _textParts.Add(evt.Text);
                }
                await ForwardAsync(new AgentRuntimeStreamEvent(
                    "sub_agent_text_delta",
                    Text: evt.Text));
                break;

            case "thinking_delta":
                if (!string.IsNullOrEmpty(evt.Thinking))
                {
                    _thinkingParts.Add(evt.Thinking);
                }
                await ForwardAsync(new AgentRuntimeStreamEvent(
                    "sub_agent_thinking_delta",
                    Thinking: evt.Thinking));
                break;

            case "tool_call_start":
                _toolCallCount++;
                if (evt.ToolCall is not null)
                {
                    _toolCallSummaries.Add(new ToolCallSummary(
                        evt.ToolCall.Id,
                        evt.ToolCall.Name,
                        evt.ToolCall.Input,
                        "running"));
                }
                await ForwardAsync(new AgentRuntimeStreamEvent(
                    "sub_agent_tool_call",
                    ToolCall: evt.ToolCall));
                ProgressChanged?.Invoke();
                break;

            case "tool_call_result":
                if (evt.ToolCall is not null)
                {
                    var idx = _toolCallSummaries.FindIndex(t => t.Id == evt.ToolCall.Id);
                    if (idx >= 0)
                    {
                        _toolCallSummaries[idx] = _toolCallSummaries[idx] with
                        {
                            Status = evt.ToolCall.Status
                        };
                    }
                }
                await ForwardAsync(new AgentRuntimeStreamEvent(
                    "sub_agent_tool_call",
                    ToolCall: evt.ToolCall));
                ProgressChanged?.Invoke();
                break;

            case "iteration_start":
                if (evt.Iteration.HasValue)
                {
                    _iterations = evt.Iteration.Value;
                }
                await ForwardAsync(new AgentRuntimeStreamEvent(
                    "sub_agent_iteration",
                    Iteration: evt.Iteration));
                ProgressChanged?.Invoke();
                break;

            case "tool_use_streaming_start":
                await ForwardAsync(new AgentRuntimeStreamEvent(
                    "sub_agent_tool_use_streaming_start",
                    ToolCallId: evt.ToolCallId,
                    ToolName: evt.ToolName));
                break;

            case "tool_use_args_delta":
                await ForwardAsync(new AgentRuntimeStreamEvent(
                    "sub_agent_tool_use_args_delta",
                    ToolCallId: evt.ToolCallId,
                    PartialInput: evt.PartialInput));
                break;

            case "tool_use_generated":
                await ForwardAsync(new AgentRuntimeStreamEvent(
                    "sub_agent_tool_use_generated",
                    ToolUseBlock: evt.ToolUseBlock));
                break;

            case "message_end":
                await ForwardAsync(new AgentRuntimeStreamEvent(
                    "sub_agent_message_end",
                    Usage: evt.Usage));
                break;
        }
    }

    /// <summary>
    /// SA-4: cap on the final text output injected into the parent context.
    /// Sub-agents can produce very long transcripts; the conclusion lives in
    /// the tail, so keep only the last MaxFinalOutputChars characters.
    /// </summary>
    private const int MaxFinalOutputChars = 12_000;

    /// <summary>
    /// Returns the final assistant text output.
    /// The text events come in deltas, so we concatenate all parts.
    /// Oversized output is truncated to its tail (SA-4) — the final report's
    /// conclusion is at the end, and the parent still has the tool-call
    /// summary for detail. Fallback: when no text was emitted (reasoning
    /// models can spend every turn thinking), return the accumulated
    /// thinking content — the answer is often embedded there. Empty only
    /// when neither exists.
    /// </summary>
    public string GetFinalOutput()
    {
        if (_textParts.Count > 0)
        {
            var text = string.Concat(_textParts);
            if (text.Length > MaxFinalOutputChars)
            {
                return "[final report truncated — showing last " + MaxFinalOutputChars + " characters]\n…" +
                       text[^MaxFinalOutputChars..];
            }
            return text;
        }
        if (_thinkingParts.Count > 0)
        {
            var thinking = string.Concat(_thinkingParts);
            // Cap: thinking can be very long; the tail holds the conclusion.
            return thinking.Length > 8000
                ? "[reasoning-only output]\n…" + thinking[^8000..]
                : "[reasoning-only output]\n" + thinking;
        }
        return string.Empty;
    }

    /// <summary>
    /// Tool call summaries collected during the sub-agent run.
    /// Used by SubAgentExecutor to build the context summary for Phase 2.
    /// </summary>
    public IReadOnlyList<ToolCallSummary> ToolCallSummaries => _toolCallSummaries;

    public int Iterations => _iterations;
    public int ToolCallCount => _toolCallCount;

    private async ValueTask ForwardAsync(AgentRuntimeStreamEvent evt)
    {
        if (ForwardEvent is not null)
        {
            await ForwardEvent(evt);
        }
    }
}

/// <summary>
/// Summary of a single tool call within a sub-agent run.
/// Used to build the context summary appended to the tool_result.
/// </summary>
public sealed record ToolCallSummary(
    string Id,
    string Name,
    JsonElement Input,
    string Status);

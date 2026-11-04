using System.Text.Json;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools;

/// <summary>
/// S-308：让 agent 停掉自己派出的子 agent（前台或后台）。
///
/// 存在的理由：后台子 agent 的设计目标是「活得比父 run 长」，而唯一的取消通路（父 run 的
/// CancellationToken 注册回调）在父 run 结束时就 dispose 了 —— 于是孤儿一旦出问题，
/// 唯一的办法是杀进程。这个工具补上那条缺失的、与父 run 生命周期无关的通路。
/// </summary>
public sealed class SubAgentStopTool : IToolExecutor
{
    public string Name => "SubAgentStop";

    public string Description =>
        "Stop a sub-agent that is still running (foreground or background) by its toolUseId. " +
        "Use this when a background sub-agent's direction is no longer needed — otherwise it keeps " +
        "burning tokens until it finishes on its own. The stop takes effect asynchronously: this " +
        "call confirms the request was delivered, and SubAgentStatus reports the final state.";

    public string[]? VisibleScopes => ToolVisibilityScopes.Everywhere;

    public JsonElement InputSchema { get; } = JsonDocument.Parse(
        """
        {
          "type": "object",
          "properties": {
            "toolUseId": {
              "type": "string",
              "description": "The sub-agent's toolUseId (returned when it was started)."
            }
          },
          "required": ["toolUseId"]
        }
        """).RootElement.Clone();

    public Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)
    {
        var toolUseId = ToolHelpers.GetString(input, "toolUseId")?.Trim();
        if (string.IsNullOrWhiteSpace(toolUseId))
        {
            return Task.FromResult(new ToolResult(
                "SubAgentStop requires a 'toolUseId' parameter.", true));
        }

        var record = BackgroundSubAgentRegistry.Get(toolUseId);
        if (record is null)
        {
            return Task.FromResult(new ToolResult(
                $"No sub-agent found with toolUseId '{toolUseId}'.", true));
        }

        // 已经不跑了：别谎称「正在停止」，直接说明它现在的终态。
        if (record.Status != BackgroundSubAgentRegistry.SubAgentRunStatus.Running)
        {
            var status = record.Status switch
            {
                BackgroundSubAgentRegistry.SubAgentRunStatus.Completed => "completed",
                BackgroundSubAgentRegistry.SubAgentRunStatus.Failed => "failed",
                BackgroundSubAgentRegistry.SubAgentRunStatus.Cancelled => "cancelled",
                _ => "finished"
            };
            return Task.FromResult(new ToolResult(
                $"Sub-agent '{toolUseId}' is not running (status: {status}); nothing to stop."));
        }

        // 登记表里有记录但触达不到执行体：这是真缺陷，如实报告，不假装成功。
        if (!SubAgentRunControl.TryStop(toolUseId, "agent"))
        {
            return Task.FromResult(new ToolResult(
                $"Sub-agent '{toolUseId}' is marked running but its execution handle is gone " +
                "(it may have just finished). Call SubAgentStatus to confirm its final state.", true));
        }

        WorkerLog.Info($"sub-agent stop requested by agent toolUseId={toolUseId}");

        return Task.FromResult(new ToolResult(
            $"Stop requested for sub-agent '{toolUseId}'. It stops at the next cancellation point. " +
            "Call SubAgentStatus to confirm the final state; do not block or poll for it."));
    }
}

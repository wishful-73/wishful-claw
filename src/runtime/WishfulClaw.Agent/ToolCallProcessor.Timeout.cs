using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;
using WishfulClaw.Agent.Executors;

namespace WishfulClaw.Agent;

/// <summary>
/// S-309 的调用侧一半：把工具执行包进「到点必回」的竞速里。
///
/// 收口放在这里而不是各工具实现里 —— 工具会一直加，谁漏谁就是下一个黑洞。
/// 放在调用方，新工具自动继承兜底。
/// </summary>
public static partial class ToolCallProcessor
{
    /// <summary>
    /// 按 <see cref="ToolCallTimeout"/> 的分档执行一次分发；超时则返回显式失败，
    /// 而不是让整个回合一直等下去。
    /// </summary>
    private static async Task<(string Output, bool IsError, JsonElement? ContentBlocks)> DispatchWithTimeoutAsync(
        AgentRuntimeNativeToolCall toolCall,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        ToolRegistry? registry,
        string? workingFolder,
        string? projectId,
        string? sshConnectionId,
        Tools.PathBoundary.Policy sandbox,
        ToolCallTimeout.Decision decision)
    {
        var pending = ToolDispatchRouter.DispatchAsync(
            toolCall, state, context, registry, workingFolder, projectId, sshConnectionId, sandbox);

        // 豁免（background 子 agent）：它的设计目标就是活得比父 run 长，原样等。
        if (decision.IsExempt)
        {
            return await pending.ConfigureAwait(false);
        }

        var limit = decision.Limit!.Value;
        var (raced, timedOut, elapsed) = await ToolCallTimeout.RaceAsync(
            pending, limit, state.CancellationToken).ConfigureAwait(false);

        if (!timedOut)
        {
            return raced;
        }

        // 取证材料：工具名、实际耗时、上限，一条齐。日志「开始没有结束」的配对关系
        // 也靠这条补齐 —— 超时的那次调用从此有明确的结束记录。
        WorkerLog.Warn(
            $"agent tool timeout runId={state.RunId} tool={toolCall.Name} id={toolCall.Id} " +
            $"kind={decision.Kind} limitMs={(long)limit.TotalMilliseconds} " +
            $"elapsedMs={(long)elapsed.TotalMilliseconds}");

        return (
            ToolCallTimeout.Message(decision.Kind, toolCall.Name, limit),
            true,
            null);
    }
}

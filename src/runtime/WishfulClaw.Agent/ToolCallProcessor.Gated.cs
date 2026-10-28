using System.Buffers;
using System.Text;
using System.Text.Json;
using WishfulClaw.Agent.Tools;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// Availability gating for tools the renderer has not enabled. Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
public static partial class ToolCallProcessor
{
    private static async Task<AgentRuntimeToolResult> RejectUnavailableToolAsync(
        AgentRuntimeNativeToolCall toolCall,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        AgentRunContext runContext,
        bool allowedByContext)
    {
        var startedAt = AgentLoop.NowMs();
        var message = allowedByContext
            ? $"Tool '{toolCall.Name}' is not available for runtime role '{runContext.RuntimeRole}'."
            : $"Tool '{toolCall.Name}' is not available in {runContext.Scope}:{runContext.CollaborationMode} sessions.";

        await AgentRuntimeTools.EmitAsync(
            state, context,
            new AgentRuntimeStreamEvent(
                "tool_call_start",
                ToolCall: new AgentRuntimeToolCallState(
                    toolCall.Id,
                    toolCall.Name,
                    toolCall.Input,
                    "running",
                    null,
                    null,
                    false,
                    startedAt,
                    null)));

        var completedAt = AgentLoop.NowMs();
        await AgentRuntimeTools.EmitAsync(
            state, context,
            new AgentRuntimeStreamEvent(
                "tool_call_result",
                ToolCallId: toolCall.Id,
                ToolName: toolCall.Name,
                ToolCall: new AgentRuntimeToolCallState(
                    toolCall.Id,
                    toolCall.Name,
                    toolCall.Input,
                    "error",
                    AgentRuntimeProviderSupport.CreateStringElement(message),
                    message,
                    false,
                    startedAt,
                    completedAt)));

        return new AgentRuntimeToolResult(
            toolCall.Id,
            AgentRuntimeProviderSupport.CreateStringElement(message),
            true);
    }

    /// <summary>
    /// Executes an approval-gated tool call: waits for the previous gated call's
    /// approval to be resolved before starting its own approval + execution, so
    /// gated tools run strictly in LLM emission order even though they are
    /// dispatched concurrently. The barrier is released as soon as this call's
    /// approval phase completes (approved or rejected) — execution itself may
    /// then overlap with the next gated call's user dialog.
    /// </summary>
    private static async Task<AgentRuntimeToolResult> ExecuteGatedAsync(
        AgentRuntimeNativeToolCall toolCall,
        string? workingFolder,
        string? projectId,
        string? sshConnectionId,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        SemaphoreSlim? semaphore,
        ToolRegistry? registry,
        bool defaultModeApproval,
        Task? prevBarrier,
        TaskCompletionSource gateTcs,
        PathBoundary.Policy sandbox)
    {
        try
        {
            if (prevBarrier is not null)
            {
                await prevBarrier.ConfigureAwait(false);
            }
            return await ExecuteSingleAsync(
                toolCall, workingFolder, projectId, sshConnectionId, state, context, semaphore, registry,
                defaultModeApproval, sandbox).ConfigureAwait(false);
        }
        finally
        {
            // Release the chain even on rejection/cancellation so later calls
            // are not stuck behind a gate that never opens.
            gateTcs.TrySetResult();
        }
    }
}

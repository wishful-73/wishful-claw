using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Change notifications for the global agent Task Board. Emitted from the
/// global task / dispatch executors after DB mutations succeed, so the Task
/// Board refreshes without polling. Never carries session-internal Todo data.
/// Events are best-effort: emission failures never break the tool result.
/// </summary>
public sealed record GlobalBoardTaskChangedEvent(string TaskId, string Action);

public sealed record GlobalBoardDispatchChangedEvent(string DispatchId, string GlobalTaskId, string Action);

public static class AgentRuntimeGlobalBoardEvents
{
    public const string TaskChangedEvent = "global/task-changed";
    public const string DispatchChangedEvent = "global/dispatch-changed";

    public static async ValueTask EmitTaskChangedAsync(
        IWorkerRequestContext? context, string taskId, string action)
    {
        if (context is null) return;
        try
        {
            await context.EmitEventAsync(
                TaskChangedEvent,
                new GlobalBoardTaskChangedEvent(taskId, action),
                AgentRuntimeJsonContext.Default.GlobalBoardTaskChangedEvent);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"EmitTaskChangedAsync({taskId}, {action}) failed: {ex.Message}");
        }
    }

    public static async ValueTask EmitDispatchChangedAsync(
        IWorkerRequestContext? context, string dispatchId, string globalTaskId, string action)
    {
        if (context is null) return;
        try
        {
            await context.EmitEventAsync(
                DispatchChangedEvent,
                new GlobalBoardDispatchChangedEvent(dispatchId, globalTaskId, action),
                AgentRuntimeJsonContext.Default.GlobalBoardDispatchChangedEvent);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"EmitDispatchChangedAsync({dispatchId}, {action}) failed: {ex.Message}");
        }
    }
}

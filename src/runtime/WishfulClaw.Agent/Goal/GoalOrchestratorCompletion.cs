using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

public static partial class GoalOrchestrator
{
    private sealed record GoalRunOutcome(
        string Status,
        GoalEventType EventType,
        string Message);

    private static async Task FinalizeOwnedRunAsync(
        GoalContext goal,
        long generation,
        GoalRunOutcome outcome,
        JsonElement parameters,
        AgentRuntimeRunState runtimeState,
        IWorkerRequestContext context)
    {
        GoalEventType eventType;
        string message;
        bool isTerminal;
        lock (goal.LifecycleSync)
        {
            if (goal.RunGeneration != generation)
            {
                runtimeState.Dispose();
                return;
            }

            // Failure outcomes keep the Goal active (not terminal); only
            // complete/aborted are persisted as terminal business states.
            if (!GoalStatusValues.IsTerminal(goal.Status))
                goal.Status = outcome.Status;

            isTerminal = GoalStatusValues.IsTerminal(goal.Status);
            goal.RunState = GoalRunStateValues.Idle;
            (eventType, message) = ResolveTerminalEvent(goal.Status, outcome);
        }

        PersistTerminalState(goal, parameters, message);
        await EmitGoalEventAsync(goal, eventType, message, context);

        lock (goal.LifecycleSync)
        {
            if (goal.RunGeneration == generation)
            {
                goal.RunTask = null;
                goal.RuntimeState = null;
                goal.RunState = GoalRunStateValues.Idle;
                // Only remove from ActiveGoals when the Goal is truly terminal.
                // A failed-but-active Goal stays in ActiveGoals so get_goal
                // can still report its runtime state and the user can Resume.
                if (isTerminal && IsCurrentGoalContext(goal))
                {
                    ActiveGoals.TryRemove(goal.GoalId, out _);
                    goal.DisposeEventRunState();
                }
            }
        }

        runtimeState.Dispose();
    }

    private static void FinalizeIdleTerminal(
        GoalContext goal,
        string status,
        string message)
    {
        goal.Status = status;
        goal.RunState = GoalRunStateValues.Idle;
        PersistTerminalState(goal, BuildResumeParameters(goal), message);
        if (IsCurrentGoalContext(goal) && ActiveGoals.TryRemove(goal.GoalId, out _))
            goal.DisposeEventRunState();
    }

    private static void PersistTerminalState(
        GoalContext goal,
        JsonElement parameters,
        string eventMessage)
    {
        // WriteGoalState is already best-effort (try-catch + Warn inside);
        // SyncGoalToDb likewise. Both channels are independent archives.
        WriteGoalState(goal);
        SyncGoalToDb(goal, parameters, eventMessage);
    }

    private static (GoalEventType EventType, string Message) ResolveTerminalEvent(
        string status,
        GoalRunOutcome outcome)
    {
        if (string.Equals(status, outcome.Status, StringComparison.Ordinal))
            return (outcome.EventType, outcome.Message);

        return status switch
        {
            GoalStatusValues.Complete => (GoalEventType.GoalCompleted, "All plans completed successfully"),
            _ when outcome.EventType == GoalEventType.GoalFailed => (GoalEventType.GoalFailed, outcome.Message),
            GoalStatusValues.Aborted => (GoalEventType.GoalAborted, "Goal aborted"),
            _ => (outcome.EventType, outcome.Message)
        };
    }
}

using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

public static partial class GoalOrchestrator
{
    internal static Func<
        GoalContext,
        JsonElement,
        AgentRuntimeRunState,
        IWorkerRequestContext,
        Task>? OwnedRunOverride { get; set; }

    private static GoalActionResult StartOrResumeRun(
        GoalContext goal,
        JsonElement parameters,
        IWorkerRequestContext context)
    {
        lock (goal.LifecycleSync)
        {
            if (!IsCurrentGoalContext(goal))
                return GoalActionNotFound("resume", goal.GoalId);

            if (GoalStatusValues.IsTerminal(goal.Status))
                return GoalActionTerminal("resume", goal);

            if (goal.RunState == GoalRunStateValues.Paused
                && goal.RunTask is { IsCompleted: false })
            {
                goal.RunState = GoalRunStateValues.Running;
                return GoalAction(goal, true, "resumed");
            }

            if (goal.RunState == GoalRunStateValues.Running
                && goal.RunTask is { IsCompleted: false })
            {
                return GoalAction(goal, true, "already_running");
            }

            goal.RunState = GoalRunStateValues.Running;
            var generation = ++goal.RunGeneration;
            var runtimeState = new AgentRuntimeRunState(
                $"goal-{goal.GoalId}-{generation}",
                goal.SessionId);
            try
            {
                runtimeState.ReplaceParameters(parameters);
                var backgroundContext = context.ForBackgroundOperation();
                goal.RuntimeState = runtimeState;
                goal.RunTask = Task.Run(() => RunOwnedAsync(
                    goal,
                    generation,
                    parameters,
                    runtimeState,
                    backgroundContext));
                return GoalAction(goal, true, "started");
            }
            catch
            {
                runtimeState.Dispose();
                goal.RunTask = null;
                goal.RuntimeState = null;
                goal.RunState = GoalRunStateValues.Idle;
                if (IsCurrentGoalContext(goal) && ActiveGoals.TryRemove(goal.GoalId, out _))
                    goal.DisposeEventRunState();
                throw;
            }
        }
    }

    private static async Task RunOwnedAsync(
        GoalContext goal,
        long generation,
        JsonElement parameters,
        AgentRuntimeRunState runtimeState,
        IWorkerRequestContext context)
    {
        using var goalCancellationRegistration = goal.CancellationTokenSource.Token.Register(
            static state => ((AgentRuntimeRunState)state!).Cancel("goal"),
            runtimeState);

        GoalRunOutcome outcome;
        try
        {
            if (OwnedRunOverride != null)
            {
                await OwnedRunOverride(goal, parameters, runtimeState, context);
                outcome = new GoalRunOutcome(
                    GoalStatusValues.Complete,
                    GoalEventType.GoalCompleted,
                    "All plans completed successfully");
            }
            else
            {
                outcome = await RunAsync(goal, parameters, runtimeState, context);
            }
        }
        catch (OperationCanceledException)
        {
            outcome = new GoalRunOutcome(
                GoalStatusValues.Aborted,
                GoalEventType.GoalAborted,
                "Goal aborted");
        }
        catch (Exception ex)
        {
            outcome = new GoalRunOutcome(
                GoalStatusValues.Active,
                GoalEventType.GoalFailed,
                $"Goal failed: {ex.Message}");
        }

        await FinalizeOwnedRunAsync(
            goal,
            generation,
            outcome,
            parameters,
            runtimeState,
            context);
    }
}

using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Agent;

/// <summary>
/// Lifecycle ownership and state transitions for GoalOrchestrator.
/// </summary>
public static partial class GoalOrchestrator
{
    /// <summary>
    /// Start a new Goal execution asynchronously.
    /// Returns immediately; the orchestration loop runs in the background.
    /// goalId is provided by the caller (from DB / PendingGoal) to ensure
    /// ActiveGoals key matches the persisted goalId.
    /// </summary>
    public static Task<string> StartAsync(
        string goalText,
        string sessionId,
        string? workingFolder,
        string goalId,
        JsonElement parameters,
        IWorkerRequestContext context,
        string? modelConfigJson = null)
    {
        var goal = new GoalContext
        {
            GoalId = goalId,
            GoalContextId = $"goal-context:{goalId}",
            SessionId = sessionId,
            GoalText = goalText,
            WorkingFolder = workingFolder,
            Status = GoalStatusValues.Active,
            RunState = GoalRunStateValues.Idle,
            StartedAt = DateTime.UtcNow
        };

        if (parameters.ValueKind == JsonValueKind.Object)
            goal.OriginalParameters = parameters.Clone();
        goal.ModelConfigJson = modelConfigJson;

        if (!ActiveGoals.TryAdd(goalId, goal))
        {
            if (ActiveGoals.TryGetValue(goalId, out var existingGoal))
            {
                StartOrResumeRun(existingGoal, parameters, context);
            }
            return Task.FromResult(goalId);
        }

        // Start the owned loop FIRST so RunState is already Running when the
        // "Goal created" event goes out — emitting before StartOrResumeRun made
        // the first event carry runState=idle and left the frontend showing
        // idle until decomposition finished (~10s).
        StartOrResumeRun(goal, parameters, context);

        _ = EmitGoalEventAsync(goal, GoalEventType.GoalStarted,
            $"Goal created: {goalText}. Decomposing into plans...", context);
        return Task.FromResult(goalId);
    }
}

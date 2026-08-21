using System.Collections.Concurrent;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// GoalOrchestrator — manages the full lifecycle of a Goal execution.
/// Decomposes a goal into plans, spawns sub-agents to execute each plan serially,
/// collects results, and emits progress events.
///
/// Two-layer architecture:
/// - Orchestration layer (this class): LLM-based goal decomposition + plan management
/// - Execution layer (sub-agents): reuse AgentLoop + plan mode tools
///
/// Plans 4-6 will add: self-check evaluation, 429 backoff, interruptible.
/// </summary>
public static partial class GoalOrchestrator
{
    private static readonly ConcurrentDictionary<string, GoalContext> ActiveGoals = new(StringComparer.Ordinal);

    /// <summary>
    /// Pending goals awaiting user confirmation before the orchestrator starts.
    /// Holds the parameters needed to start the orchestration loop once confirmed.
    /// </summary>
    private static readonly ConcurrentDictionary<string, PendingGoal> PendingGoals = new(StringComparer.Ordinal);

    /// <summary>
    /// Check if a Goal is currently running.
    /// </summary>
    public static bool IsActive(string goalId)
    {
        return ActiveGoals.TryGetValue(goalId, out var goal) && goal.Status == GoalStatusValues.Active;
    }

    /// <summary>
    /// Get the active goal ID for a session, if one exists.
    /// Linear scan is fine here: ActiveGoals holds only live goals (a handful
    /// per process); an index would be over-engineering.
    /// </summary>
    public static string? GetActiveGoalId(string sessionId)
    {
        foreach (var kvp in ActiveGoals)
        {
            if (kvp.Value.SessionId == sessionId && kvp.Value.Status == GoalStatusValues.Active)
                return kvp.Key;
        }
        return null;
    }

    /// <summary>
    /// Get the current context for a running Goal.
    /// </summary>
    public static GoalContext? GetContext(string goalId)
    {
        return ActiveGoals.TryGetValue(goalId, out var goal) ? goal : null;
    }

    // ── Event emission ──

    public static async Task EmitRunStateChangedAsync(
        string sessionId,
        GoalActionResult action,
        IWorkerRequestContext context)
    {
        if (string.IsNullOrWhiteSpace(action.GoalId) || string.IsNullOrWhiteSpace(sessionId))
            return;

        var goal = GetContext(action.GoalId);
        var startedAt = goal is null
            ? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            : new DateTimeOffset(goal.StartedAt).ToUnixTimeMilliseconds();
        var payload = new GoalRunStateChanged(
            sessionId,
            action.GoalId,
            action.Status,
            action.RunState,
            action.Action,
            startedAt,
            action.Error);
        try
        {
            await context.EmitEventAsync(
                "goal:run-state",
                payload,
                AgentRuntimeJsonContext.Default.GoalRunStateChanged);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"Failed to emit goal run state: {ex.Message}");
        }
    }

    /// <summary>
    /// Emit a goal progress event to the frontend via the agent stream.
    /// </summary>
    private static async Task EmitGoalEventAsync(
        GoalContext goal,
        GoalEventType eventType,
        string message,
        IWorkerRequestContext context)
    {
        try
        {
            var eventPayload = new AgentRuntimeStreamEvent(
                "goal_progress",
                SubAgentName: $"Goal: {goal.GoalText.Substring(0, Math.Min(50, goal.GoalText.Length))}",
                ToolUseId: goal.GoalId,
                Input: WorkerJsonHelper.BuildJsonElement(w =>
                {
                    w.WriteStartObject();
                    w.WriteString("goalId", goal.GoalId);
                    w.WriteString("sessionId", goal.SessionId);
                    w.WriteString("objective", goal.GoalText);
                    w.WriteString("eventType", eventType.ToString());
                    w.WriteString("message", message);
                    w.WriteString("status", goal.Status);
                    w.WriteString("runState", goal.RunState);
                    w.WriteNumber("currentPlanIndex", goal.CurrentPlanIndex);
                    w.WriteNumber("planCount", goal.Plans.Count);
                    w.WriteNumber("completedPlans", goal.Plans.Count(p => p.Status == GoalPlanStatusValues.Complete));
                    w.WriteNumber("timestamp", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                    w.WriteEndObject();
                }));

            await AgentRuntimeTools.EmitAsync(
                goal.GetOrCreateEventRunState(),
                context,
                eventPayload);
        }
        catch (Exception ex)
        {
            // Event emission failures should not crash the orchestration loop,
            // but a persistently broken channel must leave a trace.
            WorkerLog.Warn($"Failed to emit goal_progress (goal={goal.GoalId}, type={eventType}): {ex.Message}");
        }
    }

    // ── Pending goal (user confirmation required before orchestrator starts) ──

    /// <summary>
    /// Create a pending goal without starting the orchestrator.
    /// The goal will be stored in memory until the user confirms via ConfirmGoalAsync.
    /// </summary>
    public static string CreatePendingGoal(
        string goalId,
        string goalText,
        string sessionId,
        string? workingFolder,
        JsonElement parameters)
    {
        PendingGoals[goalId] = new PendingGoal
        {
            GoalId = goalId,
            SessionId = sessionId,
            GoalText = goalText,
            WorkingFolder = workingFolder,
            Parameters = parameters.Clone()
        };
        return goalId;
    }

    /// <summary>
    /// Emit a goal_progress event for a pending goal so the frontend can
    /// display the confirmation card before the orchestrator starts.
    /// </summary>
    public static async Task EmitPendingGoalAsync(
        string goalId,
        string sessionId,
        string goalText,
        IWorkerRequestContext context)
    {
        WorkerLog.Info($"EmitPendingGoalAsync goalId={goalId} sessionId={sessionId} goalText={goalText.Substring(0, Math.Min(50, goalText.Length))}");
            var eventPayload = new AgentRuntimeStreamEvent(
                "goal_progress",
                SubAgentName: $"Goal: {goalText.Substring(0, Math.Min(50, goalText.Length))}",
                ToolUseId: goalId,
                Input: WorkerJsonHelper.BuildJsonElement(w =>
                {
                    w.WriteStartObject();
                    w.WriteString("goalId", goalId);
                    w.WriteString("sessionId", sessionId);
                    w.WriteString("objective", goalText);
                    w.WriteString("eventType", "GoalPending");
                    w.WriteString("message", $"Goal created: {goalText}. Awaiting your confirmation.");
                    w.WriteString("status", "pending");
                    w.WriteNumber("currentPlanIndex", -1);
                    w.WriteNumber("planCount", 0);
                    w.WriteNumber("completedPlans", 0);
                    w.WriteNumber("timestamp", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                    w.WriteEndObject();
                }));

        // Pending goals have no GoalContext yet; the confirmation-card event
        // uses a throwaway run state disposed right after this single emit.
        var runState = new AgentRuntimeRunState($"goal-{goalId}", sessionId);
        try
        {
            await AgentRuntimeTools.EmitAsync(runState, context, eventPayload);
        }
        catch (Exception ex)
        {
            // Event emission failures should not crash goal creation.
            WorkerLog.Warn($"Failed to emit pending goal_progress (goal={goalId}): {ex.Message}");
        }
        finally
        {
            runState.Dispose();
        }
    }

    /// <summary>
    /// Confirm a pending goal and start the orchestration loop.
    /// </summary>
    public static async Task<bool> ConfirmGoalAsync(
        string goalId,
        string sessionId,
        string? workingFolder,
        JsonElement parameters,
        IWorkerRequestContext context)
    {
        if (!PendingGoals.TryRemove(goalId, out var pending))
            return false;

        // Use provided parameters (from confirm) or fall back to pending's saved parameters
        var actualParameters = parameters.ValueKind == JsonValueKind.Object
            ? parameters
            : pending.Parameters;

        await StartAsync(
            pending.GoalText,
            sessionId,
            workingFolder ?? pending.WorkingFolder,
            goalId,
            actualParameters,
            context);

        return true;
    }

    /// <summary>
    /// Get a pending goal by goalId, or null if not found.
    /// </summary>
    public static PendingGoal? GetPendingGoal(string goalId)
    {
        return PendingGoals.TryGetValue(goalId, out var pending) ? pending : null;
    }

    /// <summary>
    /// Get the pending goal ID for a session, if one exists.
    /// </summary>
    public static string? GetPendingGoalId(string sessionId)
    {
        foreach (var kvp in PendingGoals)
        {
            if (kvp.Value.SessionId == sessionId)
                return kvp.Key;
        }
        return null;
    }

    /// <summary>
    /// Remove a pending goal (e.g. when the user discards it).
    /// </summary>
    public static void RemovePendingGoal(string goalId)
    {
        PendingGoals.TryRemove(goalId, out _);
    }
}

/// <summary>
/// Pending goal awaiting user confirmation before orchestration starts.
/// </summary>
public sealed class PendingGoal
{
    public string GoalId { get; set; } = string.Empty;
    public string SessionId { get; set; } = string.Empty;
    public string GoalText { get; set; } = string.Empty;
    public string? WorkingFolder { get; set; }
    public JsonElement Parameters { get; set; }
}

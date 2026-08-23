namespace WishfulClaw.Agent;

/// <summary>
/// Single factory for Goal-related identifiers. Every generator used to
/// hand-write its own Guid formatting and Substring truncation (plan 16
/// chars, task/goal 21 chars), which made collision windows and formats
/// drift independently. All IDs are now full-length lowercase hex — IDs
/// are opaque strings matched by equality; UI truncates for display only.
/// </summary>
public static class GoalIds
{
    public static string NewGoalId() => $"goal-{Guid.NewGuid():N}";

    public static string NewPlanId() => $"plan-{Guid.NewGuid():N}";

    public static string NewTaskId() => $"task-{Guid.NewGuid():N}";
}

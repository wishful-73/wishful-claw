namespace WishfulClaw.Agent;

/// <summary>
/// Tags a run as a Goal-orchestrated plan execution. When present on the
/// parent run state, sub-agent events forwarded to the parent stream are
/// additionally re-emitted as "goal_activity" events carrying this context,
/// letting the Goal panel show a live per-plan activity feed.
/// </summary>
public sealed record GoalEventContext(
    string GoalId,
    string PlanId,
    int Round,
    string? PlanTitle = null,
    string? SessionId = null);

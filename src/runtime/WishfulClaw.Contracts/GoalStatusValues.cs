namespace WishfulClaw.Contracts;

public static class GoalStatusValues
{
    public const string Pending = "pending";
    public const string Active = "active";
    public const string Paused = "paused";
    public const string Complete = "complete";
    public const string Aborted = "aborted";
    // Interrupted is a runtime/attempt state, not a persisted Goal lifecycle state.

    public static bool IsTerminal(string? status)
        => status is Complete or Aborted;
}

public static class GoalRunStateValues
{
    public const string Idle = "idle";
    public const string Running = "running";
    public const string Paused = "paused";
    public const string Interrupted = "interrupted";
}

public static class GoalPlanStatusValues
{
    public const string Pending = "pending";
    public const string Active = "active";
    public const string Paused = "paused";
    public const string Complete = "complete";
    public const string Aborted = "aborted";
    /// <summary>Plan row replaced by an adjusted plan (original_plan_id chain).</summary>
    public const string Superseded = "superseded";
    /// <summary>Runtime sweep state: plan was executing when the app shut down.</summary>
    public const string Interrupted = "interrupted";
}

public static class GoalExecutionAttemptStatusValues
{
    public const string Executing = "executing";
    public const string Completed = "completed";
    public const string Failed = "failed";
    public const string Interrupted = "interrupted";
}

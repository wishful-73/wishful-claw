using System.Text.Json;
using WishfulClaw.Contracts;

namespace WishfulClaw.Agent;

/// <summary>
/// Data models for GoalOrchestrator.
/// </summary>

/// <summary>
/// Execution result of a single plan by a sub-agent.
/// </summary>
public sealed class PlanExecutionResult
{
    public string PlanId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Status { get; set; } = GoalPlanStatusValues.Pending; // pending | active | complete | aborted
    public string? Summary { get; set; }
    public string? Error { get; set; }
    public bool Is429 { get; set; }
    public string? RetryAfterHint { get; set; }
    /// <summary>Host-observed tool receipts digest (what actually ran), separate from the model's own report.</summary>
    public string? EvidenceDigest { get; set; }
    public int RetryCount { get; set; }
    public long ElapsedMs { get; set; }

    public static PlanExecutionResult FromPlanItem(GoalPlanItem plan) => new()
    {
        PlanId = plan.PlanId,
        Title = plan.Title,
        Status = plan.Status,
        RetryCount = plan.RetryCount,
        Summary = plan.ResultSummary
    };
}

/// <summary>
/// Result of LLM goal decomposition.
/// </summary>
public sealed class GoalDecompositionResult
{
    public bool Success { get; set; }
    public List<GoalPlanItem> Plans { get; set; } = new();
    public string? Error { get; set; }
}

/// <summary>
/// Goal orchestration context — holds all state for one Goal execution.
/// </summary>
public sealed class GoalContext
{
    public string GoalId { get; set; } = string.Empty;
    /// <summary>Stable, private AgentLoop conversation identity for this Goal.</summary>
    public string GoalContextId { get; set; } = string.Empty;
    public string SessionId { get; set; } = string.Empty;
    public string GoalText { get; set; } = string.Empty;
    public string? WorkingFolder { get; set; }
    /// <summary>数据库 Goal 状态：pending | active | complete | aborted。</summary>
    public string Status { get; set; } = GoalStatusValues.Active;
    private string _runState = GoalRunStateValues.Idle;
    /// <summary>前端/编排器运行态（不写入数据库）：idle | running | paused | interrupted。</summary>
    public string RunState
    {
        get => Volatile.Read(ref _runState);
        set => Volatile.Write(ref _runState, value);
    }
    public List<GoalPlanItem> Plans { get; set; } = new();
    public int CurrentPlanIndex { get; set; } = -1;
    /// <summary>Goal 确认时固定的非 secret provider/model 快照 JSON。</summary>
    public string? ModelConfigJson { get; set; }

    /// <summary>创建时的完整参数（仅在当前进程内作为兼容 fallback）。</summary>
    public JsonElement? OriginalParameters { get; set; }
    public CancellationTokenSource CancellationTokenSource { get; set; } = new();
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    internal object LifecycleSync { get; } = new();
    internal Task? RunTask { get; set; }
    internal AgentRuntimeRunState? RuntimeState { get; set; }
    /// <summary>
    /// Run state of the in-flight sub-agent turn (set by GoalSubAgentExecutor
    /// while a turn executes). The pause watcher cancels it so Pause interrupts
    /// the current turn — including its provider retry loop — immediately.
    /// </summary>
    internal volatile AgentRuntimeRunState? CurrentTurnState;
    internal long RunGeneration { get; set; }

    private AgentRuntimeRunState? _eventRunState;

    /// <summary>
    /// Long-lived event stream state for goal_progress events. One instance per
    /// Goal lifetime: the envelope seq stays continuous across the whole Goal
    /// (instead of resetting to 1 on every event) and no per-event CTS leaks.
    /// Disposed when the Goal is removed from ActiveGoals.
    /// </summary>
    internal AgentRuntimeRunState GetOrCreateEventRunState()
    {
        var existing = _eventRunState;
        if (existing != null) return existing;
        // GoalId already carries the "goal-" prefix — use it as the runId
        // verbatim so pending and active phases share one stream identity.
        var created = new AgentRuntimeRunState(GoalId, SessionId);
        var winner = Interlocked.CompareExchange(ref _eventRunState, created, null);
        if (winner != null)
        {
            created.Dispose();
            return winner;
        }
        return created;
    }

    internal void DisposeEventRunState()
    {
        Interlocked.Exchange(ref _eventRunState, null)?.Dispose();
        // The goal sub-agent conversation is keyed by GoalContextId (see
        // AgentLoop). Terminal removal is the only point where it will never
        // be appended again — drop it so the manager dictionary doesn't grow
        // unbounded across goals (mirrors the __subagent__ cleanup).
        if (!string.IsNullOrWhiteSpace(GoalContextId))
        {
            SessionConversationManager.Remove($"__goal__{GoalContextId}");
        }
    }

    /// <summary>
    /// In-memory adaptive run state for the live endpoint: the orchestrator
    /// appends one record per executed step so goal/live can serve the panel
    /// without touching the DB. Cleared when the goal is removed.
    /// </summary>
    internal GoalAdaptiveLiveState? AdaptiveLive { get; set; }
}

/// <summary>
/// Volatile per-goal adaptive execution snapshot (host memory only — never
/// serialized to the DB). The panel's 1s live poll reads this instead of
/// querying SQLite.
/// </summary>
public sealed class GoalAdaptiveLiveState
{
    private readonly object _sync = new();
    private readonly List<GoalAdaptiveLiveStep> _steps = [];

    public string CurrentAction { get; private set; } = "starting";
    public string? CurrentTitle { get; private set; }

    public void SetCurrent(string action, string? title)
    {
        lock (_sync)
        {
            CurrentAction = action;
            CurrentTitle = title;
        }
    }

    public void AddStep(int step, string title, bool succeeded, string? summary)
    {
        lock (_sync)
        {
            _steps.Add(new GoalAdaptiveLiveStep(step, title, succeeded, summary, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
        }
    }

    public GoalAdaptiveLiveSnapshot Snapshot()
    {
        lock (_sync)
        {
            return new GoalAdaptiveLiveSnapshot(
                CurrentAction,
                CurrentTitle,
                [.. _steps]);
        }
    }
}

public sealed record GoalAdaptiveLiveStep(
    int Step,
    string Title,
    bool Succeeded,
    string? Summary,
    long TimestampMs);

public sealed record GoalAdaptiveLiveSnapshot(
    string CurrentAction,
    string? CurrentTitle,
    IReadOnlyList<GoalAdaptiveLiveStep> Steps);

/// <summary>
/// Event types for goal progress tracking.
/// </summary>
public enum GoalEventType
{
    GoalStarted,
    PlanStarted,
    PlanCompleted,
    PlanFailed,
    PlanRetried,
    PlanAdjusted,
    BackoffStarted,
    BackoffProgress,
    BackoffResolved,
    /// <summary>Backoff gave up after the max polling window (6h) — distinct from BackoffStarted so consumers can tell "waiting" from "gave up".</summary>
    BackoffTimedOut,
    GoalPaused,
    GoalResumed,
    GoalAborted,
    GoalCompleted,
    GoalFailed,
    GoalEvaluationPassed,
    GoalEvaluationFailed
}

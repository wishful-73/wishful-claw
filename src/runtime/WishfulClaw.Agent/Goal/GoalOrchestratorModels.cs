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
    /// <summary>创建时的完整参数（含 provider 配置），用于 Resume 时重建子 Agent。</summary>
    public JsonElement? OriginalParameters { get; set; }
    public CancellationTokenSource CancellationTokenSource { get; set; } = new();
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    internal object LifecycleSync { get; } = new();
    internal Task? RunTask { get; set; }
    internal AgentRuntimeRunState? RuntimeState { get; set; }
    internal long RunGeneration { get; set; }
}

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
    GoalPaused,
    GoalResumed,
    GoalAborted,
    GoalCompleted,
    GoalFailed,
    GoalEvaluationPassed,
    GoalEvaluationFailed
}

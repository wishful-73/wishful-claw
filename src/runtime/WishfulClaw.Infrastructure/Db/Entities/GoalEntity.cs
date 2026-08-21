
using WishfulClaw.Contracts;

namespace WishfulClaw.Infrastructure.Db;

// ─── Goal Entity ───

public class GoalEntity
{
    public string GoalId { get; set; } = string.Empty;

    public string SessionId { get; set; } = string.Empty;

    public string? ProjectId { get; set; }

    public string Objective { get; set; } = string.Empty;

    /// <summary>
    /// pending | active | complete | aborted
    /// </summary>
    public string Status { get; set; } = GoalStatusValues.Active;

    public long? TokenBudget { get; set; }

    public long TokensUsed { get; set; }

    public long TimeUsedSeconds { get; set; }

    /// <summary>
    /// JSON array of plan items: [{ planId, title, description, status, retryCount, resultSummary }]
    /// Used by GoalOrchestrator for plan management.
    /// </summary>
    public string? PlansJson { get; set; }

    public int PlanCount { get; set; }

    public int CompletedPlanCount { get; set; }

    public int CurrentPlanIndex { get; set; } = -1;

    public string? WorkingFolder { get; set; }

    public long CreatedAt { get; set; }

    public long UpdatedAt { get; set; }
}

// ─── Goal Event Entity ───

public class GoalEventEntity
{
    public long Id { get; set; }

    public string SessionId { get; set; } = string.Empty;

    public string? GoalId { get; set; }

    /// <summary>
    /// created | confirmed | objective_updated | budget_updated | status_changed | usage_accounted |
    /// usage_limited | budget_limited | completion_deferred | blocked | completed | failed | aborted |
    /// stall_paused | auto_continue_blocked
    /// </summary>
    public string EventType { get; set; } = "created";

    public string? Message { get; set; }

    public string? MetadataJson { get; set; }

    public long CreatedAt { get; set; }
}

// ─── Goal DTO (matches frontend SessionGoalRow) ───

public sealed class GoalRow
{
    public string GoalId { get; set; } = string.Empty;
    public string SessionId { get; set; } = string.Empty;
    public string? ProjectId { get; set; }
    public string Objective { get; set; } = string.Empty;
    public string Status { get; set; } = GoalStatusValues.Active;
    public long? TokenBudget { get; set; }
    public long TokensUsed { get; set; }
    public long TimeUsedSeconds { get; set; }
    public string? PlansJson { get; set; }
    public int PlanCount { get; set; }
    public int CompletedPlanCount { get; set; }
    public int CurrentPlanIndex { get; set; } = -1;
    public string? WorkingFolder { get; set; }
    public long CreatedAt { get; set; }
    public long UpdatedAt { get; set; }

    public static GoalRow FromEntity(GoalEntity e) => new()
    {
    GoalId = e.GoalId,
    SessionId = e.SessionId,
    ProjectId = e.ProjectId,
    Objective = e.Objective,
    Status = e.Status,
    TokenBudget = e.TokenBudget,
    TokensUsed = e.TokensUsed,
    TimeUsedSeconds = e.TimeUsedSeconds,
    PlansJson = e.PlansJson,
    PlanCount = e.PlanCount,
    CompletedPlanCount = e.CompletedPlanCount,
    CurrentPlanIndex = e.CurrentPlanIndex,
    WorkingFolder = e.WorkingFolder,
    CreatedAt = e.CreatedAt,
    UpdatedAt = e.UpdatedAt
    };
}

// ─── Goal Event DTO (matches frontend SessionGoalEventRow) ───

public sealed class GoalEventRow
{
    public long Id { get; set; }
    public string SessionId { get; set; } = string.Empty;
    public string? GoalId { get; set; }
    public string EventType { get; set; } = "created";
    public string? Message { get; set; }
    public string? MetadataJson { get; set; }
    public long CreatedAt { get; set; }

    public static GoalEventRow FromEntity(GoalEventEntity e) => new()
    {
    Id = e.Id,
    SessionId = e.SessionId,
    GoalId = e.GoalId,
    EventType = e.EventType,
    Message = e.Message,
    MetadataJson = e.MetadataJson,
    CreatedAt = e.CreatedAt
    };
}

// ─── Result Records ───

public sealed record GoalFindResult(bool Success, GoalRow? Goal, string? Error);
public sealed record GoalMutationResult(bool Success, int Changed, string? Error);
public sealed record GoalEventFindResult(bool Success, List<GoalEventRow> Events, string? Error);
public sealed record GoalEventMutationResult(bool Success, GoalEventRow? Event, string? Error);
public sealed record GoalPageResult(
    List<GoalRow> Items,
    bool HasMore,
    int? NextCurrentRank = null,
    long? NextUpdatedAt = null,
    string? NextGoalId = null);
public sealed record GoalEventPageResult(
    List<GoalEventRow> Items,
    bool HasMore,
    long? NextCreatedAt = null,
    long? NextEventId = null);
public sealed record GoalReopenResult(
    bool Success,
    GoalRow? Goal = null,
    string? SourceGoalId = null,
    string? Error = null);

// ─── Goal Plan Task Entity (per-round execution record) ───

public class GoalPlanTaskEntity
{
    public long Id { get; set; }

    public string SessionId { get; set; } = string.Empty;

    public string GoalId { get; set; } = string.Empty;

    public string PlanId { get; set; } = string.Empty;

    public string? OriginalPlanId { get; set; }

    public string? PlanTitle { get; set; }

    public int Round { get; set; } = 1;

    /// <summary>Execution attempt: executing | completed | failed | interrupted.</summary>
    public string Status { get; set; } = GoalExecutionAttemptStatusValues.Executing;

    public string? Description { get; set; }

    public string? StepsJson { get; set; }

    public string? Summary { get; set; }

    public string? EvaluationReasoning { get; set; }

    public bool? EvaluationSatisfied { get; set; }

    public bool Adjusted { get; set; }

    public long StartedAt { get; set; }

    public long? FinishedAt { get; set; }
}

public sealed class GoalPlanTaskRow
{
    public long Id { get; set; }
    public string SessionId { get; set; } = string.Empty;
    public string GoalId { get; set; } = string.Empty;
    public string PlanId { get; set; } = string.Empty;
    public string? OriginalPlanId { get; set; }
    public string? PlanTitle { get; set; }
    public int Round { get; set; }
    public string Status { get; set; } = GoalExecutionAttemptStatusValues.Executing;
    public string? Description { get; set; }
    public string? StepsJson { get; set; }
    public string? Summary { get; set; }
    public string? EvaluationReasoning { get; set; }
    public bool? EvaluationSatisfied { get; set; }
    public bool Adjusted { get; set; }
    public long StartedAt { get; set; }
    public long? FinishedAt { get; set; }

    public static GoalPlanTaskRow FromEntity(GoalPlanTaskEntity e) => new()
    {
        Id = e.Id,
        SessionId = e.SessionId,
        GoalId = e.GoalId,
        PlanId = e.PlanId,
        OriginalPlanId = e.OriginalPlanId,
        PlanTitle = e.PlanTitle,
        Round = e.Round,
        Status = e.Status,
        Description = e.Description,
        StepsJson = e.StepsJson,
        Summary = e.Summary,
        EvaluationReasoning = e.EvaluationReasoning,
        EvaluationSatisfied = e.EvaluationSatisfied,
        Adjusted = e.Adjusted,
        StartedAt = e.StartedAt,
        FinishedAt = e.FinishedAt
    };
}

public sealed record GoalPlanTaskFindResult(bool Success, List<GoalPlanTaskRow> Tasks, string? Error);
public sealed record GoalPlanTaskMutationResult(bool Success, GoalPlanTaskRow? Task, string? Error);

// Goal-specific hierarchy records. These are definitions; execution attempts remain separate.
public sealed class GoalPlanEntity
{
    public string PlanId { get; set; } = string.Empty;
    public string GoalId { get; set; } = string.Empty;
    public string SessionId { get; set; } = string.Empty;
    public int Ordinal { get; set; }
    public string? OriginalPlanId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? ContentJson { get; set; }
    public string Status { get; set; } = GoalPlanStatusValues.Pending;
    public int RetryCount { get; set; }
    public string? ResultSummary { get; set; }
    public long CreatedAt { get; set; }
    public long UpdatedAt { get; set; }
    public long? StartedAt { get; set; }
    public long? CompletedAt { get; set; }
}

public sealed class GoalTaskEntity
{
    public string TaskId { get; set; } = string.Empty;
    public string GoalId { get; set; } = string.Empty;
    public string PlanId { get; set; } = string.Empty;
    public string SessionId { get; set; } = string.Empty;
    public int Ordinal { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? ContentJson { get; set; }
    public string Status { get; set; } = GoalPlanStatusValues.Pending;
    public int RetryCount { get; set; }
    public string? ResultSummary { get; set; }
    public long CreatedAt { get; set; }
    public long UpdatedAt { get; set; }
    public long? StartedAt { get; set; }
    public long? CompletedAt { get; set; }
}

public sealed record GoalPlanRow(
    string PlanId, string GoalId, string SessionId, int Ordinal,
    string? OriginalPlanId, string Title, string Description, string? ContentJson,
    string Status, int RetryCount, string? ResultSummary,
    long CreatedAt, long UpdatedAt, long? StartedAt, long? CompletedAt);

public sealed record GoalTaskRow(
    string TaskId, string GoalId, string PlanId, string SessionId, int Ordinal,
    string Title, string Description, string? ContentJson, string Status,
    int RetryCount, string? ResultSummary,
    long CreatedAt, long UpdatedAt, long? StartedAt, long? CompletedAt);

public sealed record GoalHierarchyResult(
    bool Success, List<GoalPlanRow> Plans, List<GoalTaskRow> Tasks, string? Error);

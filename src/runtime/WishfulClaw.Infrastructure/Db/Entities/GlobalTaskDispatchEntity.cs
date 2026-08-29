using System.Text.Json.Serialization;

namespace WishfulClaw.Infrastructure.Db;

// ─── Global Task Dispatch Entity (global task → project session assignments) ───
// Dispatch records are permanent: they are never cascade-deleted with tasks or
// sessions, and they must NOT reference the session-scoped tasks table.

public static class GlobalTaskDispatchKindValues
{
    /// <summary>Plain communication: question, reminder, follow-up.</summary>
    public const string Message = "message";

    /// <summary>Trackable work assignment bound to a global task.</summary>
    public const string WorkRequest = "work_request";
}

public static class GlobalTaskDispatchStatusValues
{
    public const string Pending = "pending";
    public const string Sent = "sent";
    public const string Acknowledged = "acknowledged";
    public const string InProgress = "in_progress";
    public const string Completed = "completed";
    public const string Blocked = "blocked";
    public const string Failed = "failed";
    public const string Cancelled = "cancelled";
}

public class GlobalTaskDispatchEntity
{
    public string Id { get; set; } = string.Empty;

    public string GlobalTaskId { get; set; } = string.Empty;

    public string? ProjectId { get; set; }

    public string SessionId { get; set; } = string.Empty;

    public string Kind { get; set; } = GlobalTaskDispatchKindValues.Message;

    public string Instruction { get; set; } = string.Empty;

    public string Status { get; set; } = GlobalTaskDispatchStatusValues.Pending;

    /// <summary>Latest explicit reply / result summary from the target session agent.</summary>
    public string? LatestReport { get; set; }

    /// <summary>Failure reason when delivery fails (target missing/deleted etc.).</summary>
    public string? Error { get; set; }

    public long CreatedAt { get; set; }

    public long UpdatedAt { get; set; }

    public long? CompletedAt { get; set; }
}

// ─── Global Task Dispatch DTO (snake_case wire format) ───

public sealed class GlobalTaskDispatchRow
{
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("global_task_id")]
    public string GlobalTaskId { get; set; } = string.Empty;

    [JsonPropertyName("project_id")]
    public string? ProjectId { get; set; }

    [JsonPropertyName("session_id")]
    public string SessionId { get; set; } = string.Empty;

    public string Kind { get; set; } = GlobalTaskDispatchKindValues.Message;

    public string Instruction { get; set; } = string.Empty;

    public string Status { get; set; } = GlobalTaskDispatchStatusValues.Pending;

    [JsonPropertyName("latest_report")]
    public string? LatestReport { get; set; }

    public string? Error { get; set; }

    [JsonPropertyName("created_at")]
    public long CreatedAt { get; set; }

    [JsonPropertyName("updated_at")]
    public long UpdatedAt { get; set; }

    [JsonPropertyName("completed_at")]
    public long? CompletedAt { get; set; }

    public static GlobalTaskDispatchRow FromEntity(GlobalTaskDispatchEntity e) => new()
    {
        Id = e.Id,
        GlobalTaskId = e.GlobalTaskId,
        ProjectId = e.ProjectId,
        SessionId = e.SessionId,
        Kind = e.Kind,
        Instruction = e.Instruction,
        Status = e.Status,
        LatestReport = e.LatestReport,
        Error = e.Error,
        CreatedAt = e.CreatedAt,
        UpdatedAt = e.UpdatedAt,
        CompletedAt = e.CompletedAt
    };
}

// ─── Global Task Dispatch Result Records ───

public sealed record GlobalTaskDispatchFindResult(bool Success, GlobalTaskDispatchRow? Dispatch, string? Error);
public sealed record GlobalTaskDispatchListResult(bool Success, List<GlobalTaskDispatchRow> Dispatches, string? Error);
public sealed record GlobalTaskDispatchMutationResult(bool Success, int Changed, string? Error);

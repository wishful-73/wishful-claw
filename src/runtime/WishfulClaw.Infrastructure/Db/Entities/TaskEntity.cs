using System.Text.Json.Serialization;

namespace WishfulClaw.Infrastructure.Db;

// ─── Task Entity (session-scoped agent Todo, OpenCowork semantics) ───

public class TaskEntity
{
    public string Id { get; set; } = string.Empty;

    public string SessionId { get; set; } = string.Empty;

    public string? PlanId { get; set; }

    public string Subject { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public string? ActiveForm { get; set; }

    public string Status { get; set; } = "pending";

    public string? Owner { get; set; }

    public string Blocks { get; set; } = "[]";

    public string BlockedBy { get; set; } = "[]";

    public string? Metadata { get; set; }

    public int SortOrder { get; set; }

    public long CreatedAt { get; set; }

    public long UpdatedAt { get; set; }
}

// ─── Task DTO (snake_case wire format, matches renderer TaskRow contract) ───

public sealed class TaskRow
{
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("session_id")]
    public string SessionId { get; set; } = string.Empty;

    [JsonPropertyName("plan_id")]
    public string? PlanId { get; set; }

    public string Subject { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    [JsonPropertyName("active_form")]
    public string? ActiveForm { get; set; }

    public string Status { get; set; } = "pending";

    public string? Owner { get; set; }

    public string Blocks { get; set; } = "[]";

    [JsonPropertyName("blocked_by")]
    public string BlockedBy { get; set; } = "[]";

    public string? Metadata { get; set; }

    [JsonPropertyName("sort_order")]
    public int SortOrder { get; set; }

    [JsonPropertyName("created_at")]
    public long CreatedAt { get; set; }

    [JsonPropertyName("updated_at")]
    public long UpdatedAt { get; set; }

    public static TaskRow FromEntity(TaskEntity e) => new()
    {
        Id = e.Id,
        SessionId = e.SessionId,
        PlanId = e.PlanId,
        Subject = e.Subject,
        Description = e.Description,
        ActiveForm = e.ActiveForm,
        Status = e.Status,
        Owner = e.Owner,
        Blocks = e.Blocks,
        BlockedBy = e.BlockedBy,
        Metadata = e.Metadata,
        SortOrder = e.SortOrder,
        CreatedAt = e.CreatedAt,
        UpdatedAt = e.UpdatedAt
    };
}

// ─── Task Result Records ───

public sealed record TaskFindResult(bool Success, TaskRow? Task, string? Error);
public sealed record TaskListResult(bool Success, List<TaskRow> Tasks, string? Error);
public sealed record TaskMutationResult(bool Success, int Changed, string? Error);

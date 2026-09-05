using System.Text.Json.Serialization;

namespace WishfulClaw.Infrastructure.Db;

// ─── Global Task Entity (global agent's high-level work items, Plan A) ───
// Global tasks are never deleted, only archived (archived = 1).

public static class GlobalTaskStatusValues
{
    public const string Pending = "pending";
    public const string InProgress = "in_progress";
    public const string Blocked = "blocked";
    public const string Completed = "completed";
    public const string Cancelled = "cancelled";
}

public static class GlobalTaskPriorityValues
{
    public const string Low = "low";
    public const string Normal = "normal";
    public const string High = "high";
    public const string Urgent = "urgent";
}

public class GlobalTaskEntity
{
    public string Id { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public string Status { get; set; } = GlobalTaskStatusValues.Pending;

    public string Priority { get; set; } = GlobalTaskPriorityValues.Normal;

    /// <summary>JSON array text, e.g. ["tag-a","tag-b"].</summary>
    public string Tags { get; set; } = "[]";

    public long? DueAt { get; set; }

    public int Archived { get; set; }

    public long CreatedAt { get; set; }

    public long UpdatedAt { get; set; }
}

// ─── Global Task DTO (snake_case wire format) ───

public sealed class GlobalTaskRow
{
    public string Id { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public string Status { get; set; } = GlobalTaskStatusValues.Pending;

    public string Priority { get; set; } = GlobalTaskPriorityValues.Normal;

    public string Tags { get; set; } = "[]";

    [JsonPropertyName("due_at")]
    public long? DueAt { get; set; }

    public int Archived { get; set; }

    [JsonPropertyName("created_at")]
    public long CreatedAt { get; set; }

    [JsonPropertyName("updated_at")]
    public long UpdatedAt { get; set; }

    public static GlobalTaskRow FromEntity(GlobalTaskEntity e) => new()
    {
        Id = e.Id,
        Title = e.Title,
        Description = e.Description,
        Status = e.Status,
        Priority = e.Priority,
        Tags = e.Tags,
        DueAt = e.DueAt,
        Archived = e.Archived,
        CreatedAt = e.CreatedAt,
        UpdatedAt = e.UpdatedAt
    };
}

// ─── Global Task Result Records ───

public sealed record GlobalTaskFindResult(bool Success, GlobalTaskRow? Task, string? Error);
public sealed record GlobalTaskListResult(bool Success, List<GlobalTaskRow> Tasks, string? Error);
public sealed record GlobalTaskMutationResult(bool Success, int Changed, string? Error);

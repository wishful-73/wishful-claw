
namespace WishfulClaw.Infrastructure.Db;

// ─── Message Entity ───

public class MessageEntity
{
    public string Id { get; set; } = string.Empty;

    public string SessionId { get; set; } = string.Empty;

    public string Role { get; set; } = string.Empty;

    public string Content { get; set; } = string.Empty;

    public string? Meta { get; set; }

    public long CreatedAt { get; set; }

    public string? Usage { get; set; }

    /// <summary>
    /// Display-order aid: the renderer's transcript index at save time, so ordinary message
    /// writes can rewrite it. Valid only inside ORDER BY created_at, sort_order — never as an
    /// identity or coverage-boundary comparison.
    /// </summary>
    public int SortOrder { get; set; }
}

// ─── Message DTO ───

public sealed class MessageRow
{
    public string Id { get; set; } = string.Empty;
    public string SessionId { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string? Meta { get; set; }
    public long CreatedAt { get; set; }
    public string? Usage { get; set; }
    public int SortOrder { get; set; }

    public static MessageRow FromEntity(MessageEntity e) => new()
    {
    Id = e.Id,
    SessionId = e.SessionId,
    Role = e.Role,
    Content = e.Content,
    Meta = e.Meta,
    CreatedAt = e.CreatedAt,
    Usage = e.Usage,
    SortOrder = e.SortOrder
    };
}

// ─── Message Result Records ───

public sealed record MessageMutationResult(bool Success, int Changed, string? Error);
public sealed record MessageDeleteResult(bool Success, bool Deleted, string? Error);
public sealed record MessageCountResult(bool Success, int Count, string? Error);
public sealed record MessageCompactResult(bool Success, int TotalMessages, int Compacted, string? Error);
public sealed record MessageUsageStatsResult(bool Success, bool HasUsage, double TotalInput, double TotalOutput, double TotalCacheCreation, double TotalCacheRead, double TotalReasoning, double TotalDurationMs, int RequestCount, int AssistantReplies, long? FirstCreatedAt, long? LastCreatedAt, string? Error);
public sealed record MessageListByTurnsResult(bool Success, List<MessageRow> Messages, long RangeStart, bool HasMore, string? Error, int TotalTurns = 0);

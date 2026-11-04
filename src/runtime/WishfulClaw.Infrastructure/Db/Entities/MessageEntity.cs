
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

    /// <summary>
    /// Last mutation time (null for legacy rows). Assistant replies surface this
    /// as their display time; NULL falls back to CreatedAt in the renderer.
    /// </summary>
    public long? UpdatedAt { get; set; }

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
    public long? UpdatedAt { get; set; }
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
    UpdatedAt = e.UpdatedAt,
    Usage = e.Usage,
    SortOrder = e.SortOrder
    };
}

// ─── Message Result Records ───

public sealed record MessageMutationResult(bool Success, int Changed, string? Error);
public sealed record MessageDeleteResult(bool Success, bool Deleted, string? Error);
public sealed record MessageCountResult(bool Success, int Count, string? Error);
public sealed record MessageUsageStatsResult(bool Success, bool HasUsage, double TotalInput, double TotalOutput, double TotalCacheCreation, double TotalCacheRead, double TotalReasoning, double TotalDurationMs, int RequestCount, int AssistantReplies, long? FirstCreatedAt, long? LastCreatedAt, string? Error);
public sealed record MessageListByTurnsResult(bool Success, List<MessageRow> Messages, long RangeStart, bool HasMore, string? Error, int TotalTurns = 0);

// ─── S-301：用户侧历史发言的精简投影 ───

/// <summary>
/// 一条用户发言的精简行。<b>故意不含</b> assistant 正文、工具块、思考流 ——
/// 那些是 <see cref="MessageListByTurnsResult"/> 的活，塞进 agent 上下文就是自杀（S-301 §3.2）。
/// </summary>
/// <param name="CreatedAt">unix 毫秒，与 <c>messages.created_at</c> 同源。</param>
/// <param name="Text">正文，其中折叠的粘贴块已展开成「[粘贴 · N 字]」占位。</param>
/// <param name="AttachmentSummary">附件摘要（图片 / 粘贴），无附件时为 null。</param>
public sealed record MessageUserRow(long CreatedAt, string Text, string? AttachmentSummary);

/// <summary>
/// <see cref="DbMessageTools.ListUserMessages"/> 的返回。
/// <c>TotalOnDate</c> 是查询域内的真实总数（按日期查时是该日总数，不传日期时是全会话总数），
/// 用来和 <c>Truncated</c> 配合告诉模型「你看到的不是全部」。
/// </summary>
public sealed record MessageListUserResult(bool Success, List<MessageUserRow> Messages, bool Truncated, int TotalOnDate, string? Error);

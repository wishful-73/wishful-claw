namespace WishfulClaw.Infrastructure.Db;

// ─── Agent Timeline Event DTO (S-25, iteration 29) ───
// One decision-level agent action (task dispatch/report, todo transition,
// cron firing, sub-agent run). Session-scoped rows carry session_id; app-level
// rows (null session) are visible in the global timeline feed.

public sealed class AgentTimelineEventRow
{
    public long Id { get; set; }
    public string? SessionId { get; set; }
    public string? ProjectId { get; set; }
    public string EventType { get; set; } = string.Empty;
    public string? Message { get; set; }
    public string? MetadataJson { get; set; }
    public long CreatedAt { get; set; }
}

public sealed record AgentTimelinePageResult(
    List<AgentTimelineEventRow> Items,
    bool HasMore,
    long? NextCreatedAt = null,
    long? NextId = null);

public sealed record AgentTimelineMutationResult(bool Success, AgentTimelineEventRow? Event, string? Error);

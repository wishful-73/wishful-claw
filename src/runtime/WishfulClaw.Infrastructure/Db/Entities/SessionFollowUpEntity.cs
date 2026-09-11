using System.Text.Json.Serialization;

namespace WishfulClaw.Infrastructure.Db;

public sealed class SessionFollowUpEntity
{
    public string Id { get; set; } = string.Empty;
    public string TodoId { get; set; } = string.Empty;
    public string SourceSessionId { get; set; } = string.Empty;
    public string TargetSessionId { get; set; } = string.Empty;
    public long FollowUpAt { get; set; }
    public string Status { get; set; } = "waiting";
    public string QueryInstruction { get; set; } = string.Empty;
    public string? LastQueryResult { get; set; }
    public int AttemptCount { get; set; }
    public string? ClaimToken { get; set; }
    public long? ClaimedAt { get; set; }
    public string? PluginId { get; set; }
    public string? PluginType { get; set; }
    public string? PluginChatId { get; set; }
    public string NotificationKey { get; set; } = string.Empty;
    public long? DesktopNotifiedAt { get; set; }
    public long? ChannelNotifiedAt { get; set; }
    public long? CompletedAt { get; set; }
    public long? CancelledAt { get; set; }
    public string? LastError { get; set; }
    public long CreatedAt { get; set; }
    public long UpdatedAt { get; set; }
}

public sealed class SessionFollowUpRow
{
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("todo_id")]
    public string TodoId { get; set; } = string.Empty;

    [JsonPropertyName("source_session_id")]
    public string SourceSessionId { get; set; } = string.Empty;

    [JsonPropertyName("target_session_id")]
    public string TargetSessionId { get; set; } = string.Empty;

    [JsonPropertyName("follow_up_at")]
    public long FollowUpAt { get; set; }

    public string Status { get; set; } = "waiting";

    [JsonPropertyName("query_instruction")]
    public string QueryInstruction { get; set; } = string.Empty;

    [JsonPropertyName("last_query_result")]
    public string? LastQueryResult { get; set; }

    [JsonPropertyName("attempt_count")]
    public int AttemptCount { get; set; }

    [JsonPropertyName("claim_token")]
    public string? ClaimToken { get; set; }

    [JsonPropertyName("claimed_at")]
    public long? ClaimedAt { get; set; }

    [JsonPropertyName("plugin_id")]
    public string? PluginId { get; set; }

    [JsonPropertyName("plugin_type")]
    public string? PluginType { get; set; }

    [JsonPropertyName("plugin_chat_id")]
    public string? PluginChatId { get; set; }

    [JsonPropertyName("notification_key")]
    public string NotificationKey { get; set; } = string.Empty;

    [JsonPropertyName("desktop_notified_at")]
    public long? DesktopNotifiedAt { get; set; }

    [JsonPropertyName("channel_notified_at")]
    public long? ChannelNotifiedAt { get; set; }

    [JsonPropertyName("completed_at")]
    public long? CompletedAt { get; set; }

    [JsonPropertyName("cancelled_at")]
    public long? CancelledAt { get; set; }

    [JsonPropertyName("last_error")]
    public string? LastError { get; set; }

    [JsonPropertyName("created_at")]
    public long CreatedAt { get; set; }

    [JsonPropertyName("updated_at")]
    public long UpdatedAt { get; set; }

    public static SessionFollowUpRow FromEntity(SessionFollowUpEntity entity) => new()
    {
        Id = entity.Id,
        TodoId = entity.TodoId,
        SourceSessionId = entity.SourceSessionId,
        TargetSessionId = entity.TargetSessionId,
        FollowUpAt = entity.FollowUpAt,
        Status = entity.Status,
        QueryInstruction = entity.QueryInstruction,
        LastQueryResult = entity.LastQueryResult,
        AttemptCount = entity.AttemptCount,
        ClaimToken = entity.ClaimToken,
        ClaimedAt = entity.ClaimedAt,
        PluginId = entity.PluginId,
        PluginType = entity.PluginType,
        PluginChatId = entity.PluginChatId,
        NotificationKey = entity.NotificationKey,
        DesktopNotifiedAt = entity.DesktopNotifiedAt,
        ChannelNotifiedAt = entity.ChannelNotifiedAt,
        CompletedAt = entity.CompletedAt,
        CancelledAt = entity.CancelledAt,
        LastError = entity.LastError,
        CreatedAt = entity.CreatedAt,
        UpdatedAt = entity.UpdatedAt
    };
}

public sealed record SessionFollowUpFindResult(bool Success, SessionFollowUpRow? FollowUp, string? Error);
public sealed record SessionFollowUpListResult(bool Success, List<SessionFollowUpRow> FollowUps, string? Error);
public sealed record SessionFollowUpMutationResult(bool Success, int Changed, SessionFollowUpRow? FollowUp, string? Error);

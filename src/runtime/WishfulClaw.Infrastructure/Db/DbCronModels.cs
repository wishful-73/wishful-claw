using System.Text.Json.Serialization;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// SQLite representation of a persisted Cron task.
/// JSON fields remain opaque strings so the database layer does not depend on scheduler types.
/// </summary>
public sealed class CronEntity
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? SessionId { get; set; }
    public string Scope { get; set; } = "global";
    public string? ProjectId { get; set; }
    public string ScheduleJson { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public string? AgentId { get; set; }
    public string? Model { get; set; }
    public string? WorkingFolder { get; set; }
    public string DeliveryMode { get; set; } = "desktop";
    public string OutputMode { get; set; } = "new_session";
    public string? ReuseSessionId { get; set; }
    public string RunMode { get; set; } = "background";
    public string? DeliveryTarget { get; set; }
    public string? PluginId { get; set; }
    public string? PluginType { get; set; }
    public string? PluginChatId { get; set; }
    public bool DeleteAfterRun { get; set; }
    public int MaxIterations { get; set; } = 15;
    public bool Enabled { get; set; } = true;
    public long? DeletedAt { get; set; }
    public long? LastFiredAt { get; set; }
    public long? LastRunAt { get; set; }
    public string? LastRunStatus { get; set; }
    public string? LastRunSummary { get; set; }
    public string? LastError { get; set; }
    public long FireCount { get; set; }
    public long CreatedAt { get; set; }
    public long UpdatedAt { get; set; }
}

public sealed class CronRow
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("session_id")]
    public string? SessionId { get; set; }

    [JsonPropertyName("scope")]
    public string Scope { get; set; } = "global";

    [JsonPropertyName("project_id")]
    public string? ProjectId { get; set; }

    [JsonPropertyName("schedule_json")]
    public string ScheduleJson { get; set; } = string.Empty;

    [JsonPropertyName("prompt")]
    public string Prompt { get; set; } = string.Empty;

    [JsonPropertyName("agent_id")]
    public string? AgentId { get; set; }

    [JsonPropertyName("model")]
    public string? Model { get; set; }

    [JsonPropertyName("working_folder")]
    public string? WorkingFolder { get; set; }

    [JsonPropertyName("delivery_mode")]
    public string DeliveryMode { get; set; } = "desktop";

    [JsonPropertyName("output_mode")]
    public string OutputMode { get; set; } = "new_session";

    [JsonPropertyName("reuse_session_id")]
    public string? ReuseSessionId { get; set; }

    [JsonPropertyName("run_mode")]
    public string RunMode { get; set; } = "background";

    [JsonPropertyName("delivery_target")]
    public string? DeliveryTarget { get; set; }

    [JsonPropertyName("plugin_id")]
    public string? PluginId { get; set; }

    [JsonPropertyName("plugin_type")]
    public string? PluginType { get; set; }

    [JsonPropertyName("plugin_chat_id")]
    public string? PluginChatId { get; set; }

    [JsonPropertyName("delete_after_run")]
    public bool DeleteAfterRun { get; set; }

    [JsonPropertyName("max_iterations")]
    public int MaxIterations { get; set; }

    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    [JsonPropertyName("deleted_at")]
    public long? DeletedAt { get; set; }

    [JsonPropertyName("last_fired_at")]
    public long? LastFiredAt { get; set; }

    [JsonPropertyName("last_run_at")]
    public long? LastRunAt { get; set; }

    [JsonPropertyName("last_run_status")]
    public string? LastRunStatus { get; set; }

    [JsonPropertyName("last_run_summary")]
    public string? LastRunSummary { get; set; }

    [JsonPropertyName("last_error")]
    public string? LastError { get; set; }

    [JsonPropertyName("fire_count")]
    public long FireCount { get; set; }

    [JsonPropertyName("created_at")]
    public long CreatedAt { get; set; }

    [JsonPropertyName("updated_at")]
    public long UpdatedAt { get; set; }

    public static CronRow FromEntity(CronEntity entity) => new()
    {
        Id = entity.Id,
        Name = entity.Name,
        SessionId = entity.SessionId,
        Scope = entity.Scope,
        ProjectId = entity.ProjectId,
        ScheduleJson = entity.ScheduleJson,
        Prompt = entity.Prompt,
        AgentId = entity.AgentId,
        Model = entity.Model,
        WorkingFolder = entity.WorkingFolder,
        DeliveryMode = entity.DeliveryMode,
        OutputMode = entity.OutputMode,
        ReuseSessionId = entity.ReuseSessionId,
        RunMode = entity.RunMode,
        DeliveryTarget = entity.DeliveryTarget,
        PluginId = entity.PluginId,
        PluginType = entity.PluginType,
        PluginChatId = entity.PluginChatId,
        DeleteAfterRun = entity.DeleteAfterRun,
        MaxIterations = entity.MaxIterations,
        Enabled = entity.Enabled,
        DeletedAt = entity.DeletedAt,
        LastFiredAt = entity.LastFiredAt,
        LastRunAt = entity.LastRunAt,
        LastRunStatus = entity.LastRunStatus,
        LastRunSummary = entity.LastRunSummary,
        LastError = entity.LastError,
        FireCount = entity.FireCount,
        CreatedAt = entity.CreatedAt,
        UpdatedAt = entity.UpdatedAt
    };
}

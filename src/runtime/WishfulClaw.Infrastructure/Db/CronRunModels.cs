using System.Text.Json.Serialization;

namespace WishfulClaw.Infrastructure.Db;

public sealed class CronRunEntity
{
    public string RunId { get; set; } = string.Empty;
    public string CronId { get; set; } = string.Empty;
    public string? SessionId { get; set; }
    public string FireId { get; set; } = string.Empty;
    public string Status { get; set; } = "running";
    public string? Summary { get; set; }
    public string? Error { get; set; }
    public int ToolCallCount { get; set; }
    public long StartedAt { get; set; }
    public long? FinishedAt { get; set; }
}

public sealed class CronRunRow
{
    [JsonPropertyName("runId")] public string RunId { get; set; } = string.Empty;
    [JsonPropertyName("cronId")] public string CronId { get; set; } = string.Empty;
    [JsonPropertyName("sessionId")] public string? SessionId { get; set; }
    [JsonPropertyName("fireId")] public string FireId { get; set; } = string.Empty;
    [JsonPropertyName("status")] public string Status { get; set; } = "running";
    [JsonPropertyName("summary")] public string? Summary { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
    [JsonPropertyName("toolCallCount")] public int ToolCallCount { get; set; }
    [JsonPropertyName("startedAt")] public long StartedAt { get; set; }
    [JsonPropertyName("finishedAt")] public long? FinishedAt { get; set; }

    public static CronRunRow FromEntity(CronRunEntity entity) => new()
    {
        RunId = entity.RunId,
        CronId = entity.CronId,
        SessionId = entity.SessionId,
        FireId = entity.FireId,
        Status = entity.Status,
        Summary = entity.Summary,
        Error = entity.Error,
        ToolCallCount = entity.ToolCallCount,
        StartedAt = entity.StartedAt,
        FinishedAt = entity.FinishedAt
    };
}

public sealed record CronRunMutationResult(bool Success, CronRunRow? Run, string? Error);

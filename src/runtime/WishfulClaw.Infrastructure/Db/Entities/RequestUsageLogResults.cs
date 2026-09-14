namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Query results for the request-level usage log (#1, iteration 28).
///
/// All five DTOs are named records (never anonymous types) so Native AOT source
/// generation can produce JsonTypeInfo for them. Each is registered in
/// InfrastructureJsonContext — a missing registration compiles fine and only
/// fails at runtime, so keep the two in step when adding fields.
///
/// Every result carries a time window (<paramref name="From"/>/<paramref name="To"/>,
/// Unix ms, inclusive-from/exclusive-to) so the UI can label the range without
/// re-deriving it. A window with no rows yields zeroed totals and empty arrays —
/// never null — so the panel renders an empty state rather than an error.
///
/// Cost fields are nullable: a model with no configured price contributes NULL,
/// and the aggregate stays NULL when nothing in the window was priced. This is
/// deliberate (requirement 6.4): a missing price is unknown, not free.
/// </summary>
public sealed record UsageOverviewResult(
    bool Success,
    long From,
    long To,
    int RequestCount,
    int SuccessCount,
    int ErrorCount,
    long InputTokens,
    long BillableInputTokens,
    long OutputTokens,
    long CacheReadTokens,
    long CacheCreationTokens,
    long ReasoningTokens,
    double? TotalCostUsd,
    double? AvgDurationMs,
    int RetryCount,
    string? Error);

/// <summary>
/// One bucket of a time series. <paramref name="BucketStart"/> is the bucket's
/// inclusive start in Unix ms; buckets advance by a fixed step (hour for 24h,
/// day for 7d/30d) and empty buckets are emitted as zero rows so the chart has a
/// continuous x-axis.
/// </summary>
public sealed record UsageBucketRow(
    long BucketStart,
    int RequestCount,
    int SuccessCount,
    int ErrorCount,
    long BillableInputTokens,
    long OutputTokens,
    double? TotalCostUsd);

public sealed record UsageBucketsResult(
    bool Success,
    string Interval,
    long From,
    long To,
    List<UsageBucketRow> Buckets,
    string? Error);

public sealed record UsageModelBucketRow(
    long BucketStart,
    int RequestCount);

public sealed record UsageModelSeries(
    string? ProviderId,
    string ModelId,
    string? ProviderType,
    List<UsageModelBucketRow> Buckets);

public sealed record UsageModelBucketsResult(
    bool Success,
    string Interval,
    long From,
    long To,
    List<UsageModelSeries> Series,
    string? Error);

/// <summary>Per-model rollup. <paramref name="ModelId"/> is never null (unattributed requests use "(unknown)").</summary>
public sealed record UsageModelRow(
    string? ProviderId,
    string ModelId,
    string? ProviderType,
    int RequestCount,
    int ErrorCount,
    long BillableInputTokens,
    long OutputTokens,
    long CacheReadTokens,
    long CacheCreationTokens,
    double? TotalCostUsd);

public sealed record UsageByModelResult(
    bool Success,
    long From,
    long To,
    List<UsageModelRow> Rows,
    string? Error);

/// <summary>
/// A single request-log line for the detail table. Token counts reuse the entity's
/// column names so the UI reads the same vocabulary it sees in the database.
/// </summary>
public sealed record UsageLogDetailRow(
    string Id,
    string? SessionId,
    string? RuntimeRole,
    string? Scope,
    string? CollaborationMode,
    string? ProviderId,
    string? ProviderType,
    string? ModelId,
    string Status,
    string? ErrorKind,
    string? ErrorMessage,
    int? HttpStatusCode,
    int AttemptIndex,
    int? TotalAttempts,
    long InputTokens,
    long BillableInputTokens,
    long OutputTokens,
    long CacheReadTokens,
    long CacheCreationTokens,
    long ReasoningTokens,
    double? InputCost,
    double? OutputCost,
    double? CacheCreationCost,
    double? CacheHitCost,
    double? TotalCostUsd,
    long StartedAt,
    long? CompletedAt,
    long DurationMs,
    long? TtftMs,
    double? Tps,
    string? SwitchedFromProviderId);

public sealed record UsageLogsResult(
    bool Success,
    long From,
    long To,
    int Total,
    int Offset,
    int Limit,
    List<UsageLogDetailRow> Rows,
    string? Error);

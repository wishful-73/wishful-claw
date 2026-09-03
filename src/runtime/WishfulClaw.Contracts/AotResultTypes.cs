using System.Text.Json;

namespace WishfulClaw.Contracts;

/// <summary>
/// Result types for anonymous-type replacement (AOT-safe).
/// These records replace inline `new { ok = true, ... }` anonymous types
/// that cannot be used with JsonSerializer source generation.
/// </summary>

// ── Generic ok/error results ──
public sealed record SimpleOkResult(bool Ok, string? Error = null);

// ── Generic success/error results ──
public sealed record SimpleSuccessResult(bool Success, string? Error = null);

// ── Session context restore/manifest results ──
public sealed record SessionRestoreFailure(
    string SessionId,
    string? SnapshotId,
    string Reason,
    bool Recoverable,
    bool RequiresUserAction);

public sealed record SessionContextManifestRow(
    string SessionId,
    string? CurrentSnapshotId,
    long ContextRevision,
    bool HasSnapshot,
    int? SnapshotVersion,
    long? SnapshotCreatedAt,
    long? SnapshotUpdatedAt,
    long? ThroughCreatedAt,
    int? ThroughSortOrder,
    int? OriginalCount,
    int? NewCount,
    int? MessagesSummarized,
    bool? SummarizerFailed,
    int PrefixMessageCount,
    int IncrementalMessageCount,
    string RestoreSource,
    string? RestoreReason,
    SessionRestoreFailure? Failure);

public sealed record SessionContextManifestResult(
    bool Success,
    SessionContextManifestRow? Manifest,
    string? Error);

// ── Provider test results ──
public sealed record ProviderTestResult(
    bool Ok,
    int? StatusCode = null,
    string? Error = null,
    List<string>? Models = null,
    int? StatusCode2 = null);

/// <summary>
/// Single model entry returned by provider/fetch-models.
/// </summary>
public sealed record ProviderModelInfo(
    string Id,
    string Name,
    bool Enabled);

/// <summary>
/// Provider test result with model list.
/// </summary>
public sealed record ProviderTestModelsResult(
    bool Ok,
    List<ProviderModelInfo>? Models = null);

/// <summary>
/// One tool call requested by the model in a lightweight completion.
/// </summary>
public sealed record ProviderCompletionToolCall(
    string Id,
    string Name,
    string ArgumentsJson);

/// <summary>
/// Result of a single-shot provider completion (provider/complete).
/// No streaming, no agent loop — one request, one response.
/// </summary>
public sealed record ProviderCompletionResult(
    bool Ok,
    string? Text = null,
    List<ProviderCompletionToolCall>? ToolCalls = null,
    string? Error = null);

// ── Goal module results ──
public sealed record GoalSimpleResult(bool Success);
public sealed record GoalActionResult(
    bool Success,
    string Action,
    string Status,
    string RunState,
    string? GoalId = null,
    string? Error = null);
public sealed record GoalRunStateChanged(
    string SessionId,
    string GoalId,
    string Status,
    string RunState,
    string Action,
    long StartedAt,
    string? Error = null);
public sealed record GoalStatusResponse(
    bool Active,
    string Status = "unknown",
    string RunState = "unknown",
    string? GoalId = null,
    int CurrentPlanIndex = -1,
    int PlanCount = 0,
    int CompletedPlans = 0);

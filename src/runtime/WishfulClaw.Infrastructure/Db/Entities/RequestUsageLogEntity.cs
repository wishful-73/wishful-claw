namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// One row per HTTP request attempt against a model provider (iteration 28, #1).
///
/// Granularity is deliberately "one HTTP request", not "one user turn": a single
/// user turn runs N provider requests through the tool loop, and a failing request
/// may be retried M times. Each attempt — success or failure — lands as its own row
/// so retry rate and failure attribution stay observable.
///
/// The AgentLoop main path writes one row per retry attempt. Auxiliary request
/// chains also write one logical row with a distinct RuntimeRole source because
/// they do not use the AgentLoop retry policy.
///
/// Cost columns are computed at write time from the model's explicitly configured
/// prices. When a price is not configured the corresponding cost stays NULL — no
/// extrapolation, and no fallback multipliers (see usage-analytics-requirement.md
/// section 6.4).
/// </summary>
public class RequestUsageLogEntity
{
    public string Id { get; set; } = string.Empty;

    /// <summary>Session that originated the request; null for host-less runs.</summary>
    public string? SessionId { get; set; }

    /// <summary>Runtime role as produced by the existing run state (e.g. sessionAgent, automation).</summary>
    public string? RuntimeRole { get; set; }

    /// <summary>Session scope: project / global / unknown.</summary>
    public string? Scope { get; set; }

    /// <summary>Collaboration mode: chat / cowork.</summary>
    public string? CollaborationMode { get; set; }

    public string? ProviderId { get; set; }

    public string? ProviderType { get; set; }

    public string? ModelId { get; set; }

    /// <summary>success / error</summary>
    public string Status { get; set; } = "success";

    /// <summary>Coarse failure kind for grouping (e.g. http_429, timeout, connection).</summary>
    public string? ErrorKind { get; set; }

    public string? ErrorMessage { get; set; }

    public int? HttpStatusCode { get; set; }

    /// <summary>1-based attempt index within this request's retry loop.</summary>
    public int AttemptIndex { get; set; } = 1;

    /// <summary>Total attempts made for this logical request (filled on the terminal row).</summary>
    public int? TotalAttempts { get; set; }

    // ── Token accounting ──
    // BillableInput follows DbMessageCompactTools.cs:186 — input minus cacheRead
    // minus cacheCreation (the authoritative repo-wide definition).

    public long InputTokens { get; set; }

    public long BillableInputTokens { get; set; }

    public long OutputTokens { get; set; }

    public long CacheReadTokens { get; set; }

    public long CacheCreationTokens { get; set; }

    public long ReasoningTokens { get; set; }

    // ── Cost (NULL when the matching price is not configured) ──

    public double? InputCost { get; set; }

    public double? OutputCost { get; set; }

    public double? CacheCreationCost { get; set; }

    public double? CacheHitCost { get; set; }

    /// <summary>Sum of the non-null cost components; NULL when all four are NULL.</summary>
    public double? TotalCostUsd { get; set; }

    // ── Timing ──

    public long StartedAt { get; set; }

    public long? CompletedAt { get; set; }

    public long DurationMs { get; set; }

    /// <summary>
    /// Reserved for a future per-request latency metric. Deliberately never written in
    /// this iteration: providers compute first-token timing for stream events only, and
    /// the turn result handed to the retry policy carries no timing.
    /// </summary>
    public long? TtftMs { get; set; }

    /// <summary>Reserved alongside <see cref="TtftMs"/>; never written in this iteration.</summary>
    public double? Tps { get; set; }

    /// <summary>
    /// Reserved for Plan D (multi-provider fallback): the provider this request
    /// degraded away from. Deliberately never written in this iteration — the
    /// column exists so the fallback feature can land without another migration.
    /// </summary>
    public string? SwitchedFromProviderId { get; set; }
}

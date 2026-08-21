using System.Diagnostics;
using System.Text.Json;

namespace WishfulClaw.Agent;

/// <summary>
/// 429 backoff strategy for GoalOrchestrator.
/// Handles rate-limit (429) errors with adaptive backoff:
/// - Fast backoff: 2s → 4s → 8s → 16s (handles transient overload/RPM limits)
/// - Minute polling: 600s fixed interval (handles daily quota limits)
/// - Timeout: 6 hours → pause Goal and notify user
/// </summary>
public static class GoalBackoffStrategy
{
    private const int FastBackoffMaxRetries = 4;
    private const int MinutePollingIntervalSeconds = 600; // 10 minutes
    private const int MinutePollingMaxHours = 6;
    /// <summary>Minute-poll attempts before giving up, derived from the constants above.</summary>
    private const int MinutePollingMaxAttempts = MinutePollingMaxHours * 3600 / MinutePollingIntervalSeconds;
    private static readonly int[] FastBackoffDelays = { 2, 4, 8, 16 };

    /// <summary>
    /// Calculate the wait time for the next backoff attempt.
    /// Returns (delaySeconds, phase) where phase is "fast" or "minute" or "timeout".
    /// </summary>
    public static (int delaySeconds, string phase) CalculateBackoff(
        int attempt,
        string? retryAfterHint)
    {
        // Retry-After header takes priority
        if (int.TryParse(retryAfterHint, out var retryAfter) && retryAfter > 0)
            return (retryAfter, "retry-after");

        if (attempt < FastBackoffMaxRetries)
        {
            return (FastBackoffDelays[attempt], "fast");
        }

        // attempt 4 = first minute poll, each takes 600s
        // 6 hours = 21600 seconds / 600 = 36 attempts (derived via MinutePollingMaxAttempts)
        var minuteAttempts = attempt - FastBackoffMaxRetries;
        if (minuteAttempts >= MinutePollingMaxAttempts)
            return (0, "timeout");

        return (MinutePollingIntervalSeconds, "minute");
    }

    /// <summary>
    /// Build a human-readable status message for the current backoff phase.
    /// </summary>
    public static string GetStatusMessage(int attempt, string phase, long totalWaitedSeconds)
    {
        return phase switch
        {
            "fast" => $"Rate limited, fast retry {attempt + 1}/{FastBackoffMaxRetries}, waiting {FastBackoffDelays[attempt]}s...",
            "minute" => $"Quota limit suspected, waiting for reset... {totalWaitedSeconds / 60} min elapsed, next attempt in {MinutePollingIntervalSeconds / 60} min",
            "retry-after" => $"Rate limited, waiting for Retry-After period... {totalWaitedSeconds / 60} min elapsed",
            "timeout" => $"Rate limit persisted for {MinutePollingMaxHours} hours, pausing Goal",
            _ => $"Waiting... {totalWaitedSeconds}s elapsed"
        };
    }
}

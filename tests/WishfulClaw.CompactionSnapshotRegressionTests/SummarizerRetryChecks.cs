using System.Net;
using WishfulClaw.Agent;

namespace WishfulClaw.CompactionSnapshotRegressionTests;

/// <summary>
/// S-269: the summarizer used to run its own retry loop — fixed 1.5 s / 3 s backoff,
/// honouring neither <c>Retry-After</c> nor the pre-existing provider policy, and
/// shrinking the input budget on a 429. Against an upstream that answers
/// "retry shortly (after 29 s)" that burned all three attempts inside one admission
/// window, so every multi-compaction pass degraded to a mechanical fold and told the
/// user the summarizer was unavailable when the channel was merely throttling.
///
/// These checks lock the two pure decisions that carry the fix: the backoff calculation
/// (<see cref="ProviderRetryPolicy"/>) and the failure classification
/// (<c>ContextCompression.ResolveSummaryFailurePolicy</c>). The network round-trip stays
/// a real-machine check.
/// </summary>
internal static class SummarizerRetryChecks
{
    private static int _passed;

    public static void Run()
    {
        RetryAfterOutlivesTheMainTurnCeiling();
        MainTurnCeilingIsUnchanged();
        RetryAfterIsCappedByTheSharedHeaderCeiling();
        ExponentialBackoffWithoutHeader();
        ZeroRetryAfterStillFallsBackToBackoff();
        SlowRetryInterval();
        RateLimitKeepsItsPayload();
        RateLimitWithoutHeaderUsesTheThirtySecondFallback();
        ServerErrorStaysRetryable();
        RealBadRequestGivesUp();
        OverflowShrinksTheInput();

        Console.WriteLine($"Compaction summarizer retry checks passed: {_passed}");
    }

    // ── Backoff: the summarizer's own ceiling ──────────────────────────────

    /// <summary>
    /// Judgment 4: <c>Retry-After: 29</c> must be honoured in full. The summarizer only
    /// gets three attempts, so clamping to the main turn's 15 s would land the retry
    /// inside the same window the upstream just refused.
    /// </summary>
    private static void RetryAfterOutlivesTheMainTurnCeiling()
    {
        Assert(ContextCompression.SummaryMaxBackoffMs > 15_000,
            "summarizer backoff ceiling sits above the main provider turn's 15 s");

        AssertEqual(29_000,
            ProviderRetryPolicy.ComputeDelayMs(1, TimeSpan.FromSeconds(29), ContextCompression.SummaryMaxBackoffMs),
            "a 29 s Retry-After is waited out in full by the summarizer");
    }

    /// <summary>Judgment 6: the main provider turn keeps its 15 s ceiling.</summary>
    private static void MainTurnCeilingIsUnchanged()
    {
        AssertEqual(15_000,
            ProviderRetryPolicy.ComputeDelayMs(1, TimeSpan.FromSeconds(29)),
            "the main provider turn still clamps Retry-After to 15 s");
    }

    private static void RetryAfterIsCappedByTheSharedHeaderCeiling()
    {
        // MaxRetryAfterMs (60 s) clamps the header first, then the caller's ceiling applies.
        AssertEqual(45_000,
            ProviderRetryPolicy.ComputeDelayMs(1, TimeSpan.FromSeconds(600), ContextCompression.SummaryMaxBackoffMs),
            "an oversized Retry-After is clamped to the summarizer ceiling");
        AssertEqual(15_000,
            ProviderRetryPolicy.ComputeDelayMs(1, TimeSpan.FromSeconds(600)),
            "an oversized Retry-After is clamped to the main turn's 15 s ceiling");
    }

    private static void ExponentialBackoffWithoutHeader()
    {
        var first = ProviderRetryPolicy.ComputeDelayMs(1, null, ContextCompression.SummaryMaxBackoffMs);
        var second = ProviderRetryPolicy.ComputeDelayMs(2, null, ContextCompression.SummaryMaxBackoffMs);
        var third = ProviderRetryPolicy.ComputeDelayMs(3, null, ContextCompression.SummaryMaxBackoffMs);

        AssertRange(first, 500, 750, "first header-less retry waits 500-750 ms");
        AssertRange(second, 1_000, 1_250, "second header-less retry waits 1000-1250 ms");
        AssertRange(third, 2_000, 2_250, "third header-less retry waits 2000-2250 ms");
    }

    private static void ZeroRetryAfterStillFallsBackToBackoff()
    {
        // A `Retry-After: 0` header must not turn into an immediate hammering loop.
        AssertRange(ProviderRetryPolicy.ComputeDelayMs(1, TimeSpan.Zero, ContextCompression.SummaryMaxBackoffMs),
            500, 750, "a zero Retry-After falls back to exponential backoff");
    }

    private static void SlowRetryInterval()
    {
        AssertEqual(60_000, ProviderRetryPolicy.ComputeDelayMs(11, null, ContextCompression.SummaryMaxBackoffMs),
            "attempts past the slow-retry threshold use the fixed one-minute interval");
    }

    // ── Classification: what a failure means ───────────────────────────────

    /// <summary>
    /// Judgments 2 and 5: a 429 must resend the same payload and report
    /// <c>rate_limited</c>. <c>ShrinkBudget</c> is the only action that touches the input,
    /// so "not ShrinkBudget" is the regression guard against the old behaviour.
    /// </summary>
    private static void RateLimitKeepsItsPayload()
    {
        var policy = ContextCompression.ResolveSummaryFailurePolicy(
            HttpError(HttpStatusCode.TooManyRequests, "{\"error\":\"too many requests\"}", TimeSpan.FromSeconds(29)));

        AssertEqual(ContextCompression.SummaryFailureAction.WaitUpstream, policy.Action,
            "a 429 waits for the upstream instead of shrinking the payload");
        Assert(policy.Action != ContextCompression.SummaryFailureAction.ShrinkBudget,
            "a 429 never shrinks the summarizer input budget");
        AssertEqual(ContextCompression.SummarizerFailureRateLimited, policy.Reason,
            "a 429 reports the rate_limited reason");
        AssertEqual<TimeSpan?>(TimeSpan.FromSeconds(29), policy.Wait, "a 429 carries the Retry-After wait");
    }

    /// <summary>
    /// The production incident: <c>ttft_admission_refused</c> said "retry shortly (after
    /// 29 s)" in the body with no header. The old fixed 1.5 s was guaranteed to fail.
    /// </summary>
    private static void RateLimitWithoutHeaderUsesTheThirtySecondFallback()
    {
        var policy = ContextCompression.ResolveSummaryFailurePolicy(
            HttpError(HttpStatusCode.TooManyRequests, "{\"error\":\"ttft_admission_refused\"}", null));

        AssertEqual(ContextCompression.SummaryFailureAction.WaitUpstream, policy.Action,
            "a header-less 429 still waits instead of retrying at once");
        AssertEqual<TimeSpan?>(TimeSpan.FromMilliseconds(ContextCompression.SummaryRateLimitFallbackMs), policy.Wait,
            "a header-less 429 falls back to the 30 s admission window");
        Assert(ContextCompression.SummaryRateLimitFallbackMs >= 3_000,
            "the header-less fallback is far above the old 1.5 s that always lost the race");
    }

    private static void ServerErrorStaysRetryable()
    {
        var policy = ContextCompression.ResolveSummaryFailurePolicy(
            HttpError(HttpStatusCode.ServiceUnavailable, "{\"error\":\"upstream down\"}", TimeSpan.FromSeconds(5)));

        AssertEqual(ContextCompression.SummaryFailureAction.WaitUpstream, policy.Action,
            "a 503 waits for the upstream instead of giving up");
        AssertEqual(ContextCompression.SummarizerFailureServerError, policy.Reason,
            "a 503 reports the server_error reason");
    }

    /// <summary>
    /// Judgment 3: a real 400 is not retried. 2026-10-27 already settled that 400 stays
    /// out of the retryable set; the summarizer now inherits that decision instead of
    /// inventing its own.
    /// </summary>
    private static void RealBadRequestGivesUp()
    {
        var policy = ContextCompression.ResolveSummaryFailurePolicy(
            HttpError(HttpStatusCode.BadRequest, "{\"error\":{\"message\":\"unknown field \\\"thinking\\\"\"}}", null));

        AssertEqual(ContextCompression.SummaryFailureAction.GiveUp, policy.Action,
            "a genuine 400 is not retried");
        AssertEqual(ContextCompression.SummarizerFailureOther, policy.Reason,
            "a genuine 400 reports the other reason");
        Assert(policy.Detail is { Length: > 0 } && policy.Detail.Contains("unknown field", StringComparison.Ordinal),
            "a genuine 400 keeps the provider's own message for diagnostics");
    }

    /// <summary>Judgment 2 counterweight: shrinking is reserved for a real overflow.</summary>
    private static void OverflowShrinksTheInput()
    {
        var policy = ContextCompression.ResolveSummaryFailurePolicy(
            HttpError(HttpStatusCode.BadRequest, "{\"error\":\"context_length_exceeded\"}", null));

        AssertEqual(ContextCompression.SummaryFailureAction.ShrinkBudget, policy.Action,
            "a context-window overflow shrinks the input budget");
        AssertEqual(ContextCompression.SummarizerFailureContextOverflow, policy.Reason,
            "a context-window overflow reports the context_overflow reason");
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private static ProviderHttpException HttpError(HttpStatusCode status, string body, TimeSpan? retryAfter) =>
        new("test-provider", status, body, retryAfter);

    private static void Assert(bool condition, string name)
    {
        if (!condition)
            throw new InvalidOperationException(name);
        _passed++;
        Console.WriteLine($"PASS: {name}");
    }

    private static void AssertEqual<T>(T expected, T actual, string name)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new InvalidOperationException($"{name}: expected={expected}, actual={actual}");
        Assert(true, name);
    }

    private static void AssertRange(int actual, int minInclusive, int maxInclusive, string name)
    {
        if (actual < minInclusive || actual > maxInclusive)
            throw new InvalidOperationException($"{name}: expected {minInclusive}-{maxInclusive}, actual={actual}");
        Assert(true, name);
    }
}

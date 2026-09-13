using System.Net;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Agent;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.ProviderHeaderRegressionTests;

/// <summary>
/// Read-side checks for the request usage log: the five <c>db/usage-*</c> endpoints and the
/// payloads they serialize. Split out of <c>UsageLogChecks</c> because the two halves assert on
/// different contracts — one on what a single row must carry, one on what a window aggregates to —
/// and a failure in either should point at its own file.
/// </summary>
internal static partial class UsageLogChecks
{
    private static void RunOverviewQuerySuite()
    {
        Reset();
        SeedRequest("model-a", "success", 1000, 0, attemptIndex: 1);
        SeedRequest("model-a", "success", 2000, 0, attemptIndex: 1);
        SeedRequest("model-a", "error", 500, 0, attemptIndex: 2, errorKind: "http_429");

        var json = Invoke(DbUsageLogQueryTools.Overview, new { });
        Assert(json.GetProperty("success").GetBoolean(), "usagequery: overview reports success");
        Assert(json.GetProperty("requestCount").GetInt32() == 3,
            $"usagequery: overview counts every attempt (got {json.GetProperty("requestCount").GetInt32()})");
        Assert(json.GetProperty("successCount").GetInt32() == 2, "usagequery: overview splits successes");
        Assert(json.GetProperty("errorCount").GetInt32() == 1, "usagequery: overview splits errors");

        // attemptIndex > 1 on exactly one row — that is the retry count.
        Assert(json.GetProperty("retryCount").GetInt32() == 1,
            $"usagequery: overview counts retried attempts (got {json.GetProperty("retryCount").GetInt32()})");
        Assert(json.GetProperty("billableInputTokens").GetInt64() == 3500,
            "usagequery: overview sums billable input across attempts");
    }

    /// <summary>
    /// A 24h window must yield a continuous hourly series — 24 buckets even when only
    /// a couple of hours carry traffic. Bucket gaps left empty would misrepresent the
    /// time axis in the chart.
    /// </summary>
    private static void RunBucketGapFillSuite()
    {
        Reset();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        SeedRequest("model-a", "success", 100, now - 2 * 3_600_000, attemptIndex: 1);
        SeedRequest("model-a", "success", 200, now - 5 * 3_600_000, attemptIndex: 1);

        var json = Invoke(DbUsageLogQueryTools.Buckets, new { range = "24h" });
        var buckets = json.GetProperty("buckets");
        Assert(json.GetProperty("interval").GetString() == "hour",
            "usagequery: a 24h window buckets by hour");

        var count = buckets.GetArrayLength();
        Assert(count is 24 or 25, $"usagequery: a 24h window gap-fills to 24 hourly buckets (got {count})");

        var withTraffic = 0;
        var empty = 0;
        foreach (var bucket in buckets.EnumerateArray())
        {
            if (bucket.GetProperty("requestCount").GetInt32() > 0) withTraffic++;
            else empty++;
        }
        Assert(withTraffic == 2, $"usagequery: exactly two buckets carry traffic (got {withTraffic})");
        Assert(empty == count - 2, "usagequery: quiet hours are emitted as zero buckets, not omitted");

        // A zero bucket must still expose every field, so the chart can read it blindly.
        var zero = buckets.EnumerateArray().First(b => b.GetProperty("requestCount").GetInt32() == 0);
        Assert(zero.TryGetProperty("billableInputTokens", out _),
            "usagequery: an empty bucket still exposes billableInputTokens");
    }

    /// <summary>
    /// Daily bars must break at the viewer's midnight, not UTC midnight. These two
    /// requests are 23:00 and 04:00 for a UTC+8 viewer — different days for them, the
    /// same UTC day. Grouping them together would silently split every bar at 08:00.
    /// </summary>
    private static void RunBucketTimezoneSuite()
    {
        Reset();
        var beforeLocalMidnight = new DateTimeOffset(2026, 9, 11, 15, 0, 0, TimeSpan.Zero);
        var afterLocalMidnight = new DateTimeOffset(2026, 9, 11, 20, 0, 0, TimeSpan.Zero);
        SeedRequest("model-a", "success", 100, beforeLocalMidnight.ToUnixTimeMilliseconds(), attemptIndex: 1);
        SeedRequest("model-a", "success", 200, afterLocalMidnight.ToUnixTimeMilliseconds(), attemptIndex: 1);

        var from = new DateTimeOffset(2026, 9, 10, 0, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds();
        var to = new DateTimeOffset(2026, 9, 13, 0, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds();

        var local = Invoke(DbUsageLogQueryTools.Buckets,
            new { from, to, interval = "day", timezoneOffsetMinutes = 480 });
        var populated = local.GetProperty("buckets").EnumerateArray()
            .Where(b => b.GetProperty("requestCount").GetInt32() > 0)
            .ToList();
        Assert(populated.Count == 2,
            $"usagequery: the caller's offset splits requests across local days (got {populated.Count})");

        // 本地 9/11 与 9/12 的零点，即 UTC 前一日 16:00。
        var expectedStarts = new[]
        {
            new DateTimeOffset(2026, 9, 10, 16, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds(),
            new DateTimeOffset(2026, 9, 11, 16, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds()
        };
        var actualStarts = populated.Select(b => b.GetProperty("bucketStart").GetInt64()).ToArray();
        Assert(actualStarts.SequenceEqual(expectedStarts),
            $"usagequery: day buckets start at local midnight (got {string.Join(",", actualStarts)})");
        Assert(populated[0].GetProperty("billableInputTokens").GetInt64() == 100,
            "usagequery: tokens follow the request's own local day");
        Assert(populated[1].GetProperty("billableInputTokens").GetInt64() == 200,
            "usagequery: the other half of the UTC day lands in the next local bucket");

        var utc = Invoke(DbUsageLogQueryTools.Buckets, new { from, to, interval = "day" });
        var utcPopulated = utc.GetProperty("buckets").EnumerateArray()
            .Where(b => b.GetProperty("requestCount").GetInt32() > 0)
            .ToList();
        Assert(utcPopulated.Count == 1 && utcPopulated[0].GetProperty("requestCount").GetInt32() == 2,
            "usagequery: omitting the offset keeps UTC day grouping for other callers");
    }

    private static void RunByModelQuerySuite()
    {
        Reset();
        SeedRequest("model-a", "success", 100, 0, attemptIndex: 1);
        SeedRequest("model-b", "success", 300, 0, attemptIndex: 1);
        SeedRequest("model-b", "error", 300, 0, attemptIndex: 1, errorKind: "http_5xx");

        var json = Invoke(DbUsageLogQueryTools.ByModel, new { });
        var rows = json.GetProperty("rows");
        Assert(rows.GetArrayLength() == 2, $"usagequery: by-model groups per model (got {rows.GetArrayLength()})");

        // Ordered by request volume: model-b (2) ahead of model-a (1).
        var first = rows.EnumerateArray().First();
        Assert(first.GetProperty("modelId").GetString() == "model-b",
            "usagequery: by-model orders by request volume");
        Assert(first.GetProperty("requestCount").GetInt32() == 2,
            $"usagequery: by-model counts requests (got {first.GetProperty("requestCount").GetInt32()})");
        Assert(first.GetProperty("errorCount").GetInt32() == 1, "usagequery: by-model counts errors");
        Assert(first.GetProperty("billableInputTokens").GetInt64() == 600,
            "usagequery: by-model sums billable input per model");
    }

    private static void RunBySourceQuerySuite()
    {
        Reset();
        SeedRequest("model-a", "success", 100, 0, attemptIndex: 1,
            runtimeRole: "sessionAgent", scope: "project", collaborationMode: "chat");

        var json = Invoke(DbUsageLogQueryTools.BySource, new { });
        var rows = json.GetProperty("rows");
        Assert(rows.GetArrayLength() == 1, "usagequery: by-source groups by origin");
        var row = rows.EnumerateArray().First();
        Assert(row.GetProperty("runtimeRole").GetString() == "sessionAgent",
            "usagequery: by-source surfaces the runtime role");
        Assert(row.GetProperty("collaborationMode").GetString() == "chat",
            "usagequery: by-source surfaces the collaboration mode");
    }

    private static void RunDetailQuerySuite()
    {
        Reset();
        SeedRequest("model-a", "success", 100, 0, attemptIndex: 1);
        SeedRequest("model-a", "error", 0, 0, attemptIndex: 1, errorKind: "http_429", httpStatus: 429);

        var json = Invoke(DbUsageLogQueryTools.Logs, new { limit = 10 });
        Assert(json.GetProperty("total").GetInt32() == 2, "usagequery: detail reports the unpaged total");
        Assert(json.GetProperty("limit").GetInt32() == 10, "usagequery: detail echoes the page size");

        var rows = json.GetProperty("rows");
        Assert(rows.GetArrayLength() == 2, "usagequery: detail returns the page");
        foreach (var row in rows.EnumerateArray())
        {
            Assert(row.TryGetProperty("switchedFromProviderId", out _) || row.TryGetProperty("modelId", out _),
                "usagequery: detail rows expose the entity columns");
        }

        // Paging: limit=1 must shrink the page but not the total.
        var paged = Invoke(DbUsageLogQueryTools.Logs, new { limit = 1 });
        Assert(paged.GetProperty("rows").GetArrayLength() == 1, "usagequery: detail honours the limit");
        Assert(paged.GetProperty("total").GetInt32() == 2, "usagequery: detail total ignores the limit");

        // The limit is clamped, so an absurd request cannot pull the whole table.
        var clamped = Invoke(DbUsageLogQueryTools.Logs, new { limit = 100000 });
        Assert(clamped.GetProperty("limit").GetInt32() == 500,
            $"usagequery: detail clamps the limit (got {clamped.GetProperty("limit").GetInt32()})");
    }

    /// <summary>
    /// An empty window must return zeroed totals and empty arrays, never null and
    /// never an error — otherwise the panel renders a failure where it should show
    /// an empty state on a fresh install.
    /// </summary>
    private static void RunEmptyWindowSuite()
    {
        Reset();

        var overview = Invoke(DbUsageLogQueryTools.Overview, new { });
        Assert(overview.GetProperty("success").GetBoolean(), "usagequery: an empty window is not an error");
        Assert(overview.GetProperty("requestCount").GetInt32() == 0, "usagequery: an empty window counts zero");
        // WhenWritingNull is on for this context, so a null cost is an ABSENT key
        // rather than an explicit null. Either way the renderer must not see 0 —
        // "no price configured" is unknown, not free.
        Assert(!overview.TryGetProperty("totalCostUsd", out _),
            "usagequery: an empty window omits cost rather than reporting 0");

        var byModel = Invoke(DbUsageLogQueryTools.ByModel, new { });
        Assert(byModel.GetProperty("rows").GetArrayLength() == 0, "usagequery: an empty window has no model rows");

        var bySource = Invoke(DbUsageLogQueryTools.BySource, new { });
        Assert(bySource.GetProperty("rows").GetArrayLength() == 0, "usagequery: an empty window has no source rows");

        var logs = Invoke(DbUsageLogQueryTools.Logs, new { });
        Assert(logs.GetProperty("total").GetInt32() == 0, "usagequery: an empty window has no detail rows");

        var buckets = Invoke(DbUsageLogQueryTools.Buckets, new { range = "24h" });
        Assert(buckets.GetProperty("buckets").GetArrayLength() is 24 or 25,
            "usagequery: an empty window still yields a full bucket series");
    }
}

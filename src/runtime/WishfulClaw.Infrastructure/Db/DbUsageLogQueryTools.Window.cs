using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

public static partial class DbUsageLogQueryTools
{
    private const int DefaultBucketCount24h = 24;
    private const int DefaultBucketCount7d = 7;
    private const int DefaultBucketCount30d = 30;
    private const long HourMs = 3_600_000L;
    private const long DayMs = 86_400_000L;
    private const int MaxTimezoneOffsetMinutes = 840;

    // ── Window / bucket helpers ──

    /// <summary>
    /// Resolve [from, to) in Unix ms. Accepts either an explicit `from`/`to` pair or
    /// a `range` shorthand (24h / 7d / 30d) defaulting to 24h; the panel sends the
    /// shorthand and the detail view sends an explicit pair when the user drills in.
    /// </summary>
    private static (long From, long To) ResolveWindow(JsonElement parameters)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var from = JsonHelpers.GetLongNullable(parameters, "from");
        var to = JsonHelpers.GetLongNullable(parameters, "to");
        if (from.HasValue && to.HasValue && to.Value > from.Value)
        {
            return (from.Value, to.Value);
        }

        var range = JsonHelpers.GetString(parameters, "range");
        var span = range switch
        {
            "7d" => 7 * DayMs,
            "30d" => 30 * DayMs,
            _ => 24 * HourMs
        };
        return (now - span, now);
    }

    /// <summary>
    /// Pick the bucket size: explicit `interval` wins, otherwise infer from the
    /// window span so a 24h view is hourly and a 7d/30d view is daily.
    /// </summary>
    private static string ResolveInterval(JsonElement parameters, (long From, long To) window)
    {
        var explicitInterval = JsonHelpers.GetString(parameters, "interval");
        if (explicitInterval is "hour" or "day")
        {
            return explicitInterval;
        }

        var span = window.To - window.From;
        return span <= DefaultBucketCount24h * HourMs ? "hour" : "day";
    }

    private static long FloorTo(long value, long step) => value - (value % step);

    /// <summary>
    /// Caller's local-minus-UTC offset in minutes (UTC+8 => 480). Absent means 0, so
    /// an unnamed caller keeps the UTC boundaries.
    /// </summary>
    private static int ResolveTimezoneOffsetMinutes(JsonElement parameters)
        => Math.Clamp(
            JsonHelpers.GetInt(parameters, "timezoneOffsetMinutes", 0),
            -MaxTimezoneOffsetMinutes,
            MaxTimezoneOffsetMinutes);

    /// <summary>
    /// Emit a contiguous series: every step between origin and `to` gets a row, with
    /// zeroes where the query returned nothing. Without this the chart collapses
    /// quiet periods and misrepresents the time axis.
    /// </summary>
    private static List<UsageBucketRow> GapFill(
        List<UsageBucketRow> rows, long origin, long to, long step)
    {
        var byStart = new Dictionary<long, UsageBucketRow>(rows.Count);
        foreach (var row in rows)
        {
            byStart[row.BucketStart] = row;
        }

        var result = new List<UsageBucketRow>();
        for (var start = origin; start < to; start += step)
        {
            result.Add(byStart.TryGetValue(start, out var found)
                ? found
                : new UsageBucketRow(start, 0, 0, 0, 0, 0, null));
        }

        return result;
    }

    private static List<UsageModelBucketRow> GapFillModel(
        List<ModelBucketQueryRow> rows, long origin, long to, long step)
    {
        var byStart = new Dictionary<long, int>(rows.Count);
        foreach (var row in rows)
        {
            byStart[row.BucketStart] = row.RequestCount;
        }

        var result = new List<UsageModelBucketRow>();
        for (var start = origin; start < to; start += step)
        {
            result.Add(new UsageModelBucketRow(
                start,
                byStart.TryGetValue(start, out var count) ? count : 0));
        }

        return result;
    }
}

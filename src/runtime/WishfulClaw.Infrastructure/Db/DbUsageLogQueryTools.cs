using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Read access for the request-level usage log (#1, iteration 28).
///
/// This is a NEW, self-contained statistic built on the per-request log table. It
/// reads nothing from, and writes nothing to, the existing turn-level session
/// statistics (messages.usage / db/messages-usage-stats) — those are untouched and
/// keep working exactly as before.
///
/// All five entry points return named DTOs (never anonymous types) so Native AOT
/// can serialize them; each DTO is registered in InfrastructureJsonContext.
/// Every endpoint tolerates an empty window: zeroed totals and empty lists, never
/// null, so the panel shows an empty state instead of an error.
/// </summary>
public static partial class DbUsageLogQueryTools
{
    private const int DefaultBucketCount24h = 24;
    private const int DefaultBucketCount7d = 7;
    private const int DefaultBucketCount30d = 30;
    private const long HourMs = 3_600_000L;
    private const long DayMs = 86_400_000L;
    private const int MaxDetailLimit = 500;
    private const int DefaultDetailLimit = 50;
    private const int MaxTimezoneOffsetMinutes = 840;

    // ── Public endpoints ──

    /// <summary>Headline totals for the window: volume, success/error split, tokens, cost, retries.</summary>
    public static WorkerResponse Overview(JsonElement parameters)
    {
        var window = ResolveWindow(parameters);
        try
        {
            var db = DbClient.GetClient(parameters);
            if (db is null) return Error<UsageOverviewResult>("Database not initialized");

            var row = db.QueryFirstOrDefault(
                @"SELECT
                    COUNT(*)                                                          AS request_count,
                    COALESCE(SUM(status = 'success'), 0)                              AS success_count,
                    COALESCE(SUM(status = 'error'), 0)                                AS error_count,
                    COALESCE(SUM(input_tokens), 0)                                    AS input_tokens,
                    COALESCE(SUM(billable_input_tokens), 0)                           AS billable_input_tokens,
                    COALESCE(SUM(output_tokens), 0)                                   AS output_tokens,
                    COALESCE(SUM(cache_read_tokens), 0)                               AS cache_read_tokens,
                    COALESCE(SUM(cache_creation_tokens), 0)                           AS cache_creation_tokens,
                    COALESCE(SUM(reasoning_tokens), 0)                                AS reasoning_tokens,
                    SUM(total_cost_usd)                                               AS total_cost_usd,
                    AVG(duration_ms)                                                  AS avg_duration_ms,
                    COALESCE(SUM(attempt_index > 1), 0)                               AS retry_count
                  FROM request_usage_logs
                  WHERE started_at >= $from AND started_at < $to;",
                OverviewRow.Read,
                new SqliteParameter("$from", window.From),
                new SqliteParameter("$to", window.To));

            // An empty window still returns COUNT(*)=0 with SUM(...) NULL, so the
            // projection above already normalizes to zeros.
            var dto = row is null
                ? new UsageOverviewResult(true, window.From, window.To, 0, 0, 0, 0, 0, 0, 0, 0, 0, null, null, 0, null)
                : new UsageOverviewResult(
                    true, window.From, window.To,
                    row.RequestCount, row.SuccessCount, row.ErrorCount,
                    row.InputTokens, row.BillableInputTokens, row.OutputTokens,
                    row.CacheReadTokens, row.CacheCreationTokens, row.ReasoningTokens,
                    row.TotalCostUsd, row.AvgDurationMs, row.RetryCount, null);

            return WorkerResponse.Json(dto, InfrastructureJsonContext.Default.UsageOverviewResult);
        }
        catch (Exception ex)
        {
            return Error<UsageOverviewResult>(ex.Message);
        }
    }

    /// <summary>
    /// Time series for the chart. Buckets are gap-filled (empty periods emit a zero
    /// row) so the x-axis stays continuous. 24h buckets hourly, 7d/30d bucket daily.
    /// </summary>
    public static WorkerResponse Buckets(JsonElement parameters)
    {
        var window = ResolveWindow(parameters);
        var interval = ResolveInterval(parameters, window);
        var step = interval == "hour" ? HourMs : DayMs;
        var offsetMs = ResolveTimezoneOffsetMinutes(parameters) * 60_000L;
        try
        {
            var db = DbClient.GetClient(parameters);
            if (db is null) return Error<UsageBucketsResult>("Database not initialized");

            // Bucket origin: the caller's wall-clock hour/day containing `from`, so
            // labels line up with boundaries they actually experience instead of
            // drifting off the query time or splitting at UTC midnight.
            var origin = FloorTo(window.From + offsetMs, step) - offsetMs;

            var rows = db.Query(
                @"SELECT
                    (((started_at + $offset) / $step) * $step) - $offset              AS bucket_start,
                    COUNT(*)                                                            AS request_count,
                    COALESCE(SUM(status = 'success'), 0)                                AS success_count,
                    COALESCE(SUM(status = 'error'), 0)                                  AS error_count,
                    COALESCE(SUM(billable_input_tokens), 0)                             AS billable_input_tokens,
                    COALESCE(SUM(output_tokens), 0)                                     AS output_tokens,
                    SUM(total_cost_usd)                                                 AS total_cost_usd
                  FROM request_usage_logs
                  WHERE started_at >= $from AND started_at < $to
                  GROUP BY bucket_start
                  ORDER BY bucket_start;",
                reader => new UsageBucketRow(
                    reader.GetInt64(0),
                    reader.GetInt32(1),
                    reader.GetInt32(2),
                    reader.GetInt32(3),
                    reader.GetInt64(4),
                    reader.GetInt64(5),
                    reader.IsDBNull(6) ? null : reader.GetDouble(6)),
                new SqliteParameter("$step", step),
                new SqliteParameter("$offset", offsetMs),
                new SqliteParameter("$from", window.From),
                new SqliteParameter("$to", window.To));

            var buckets = GapFill(rows, origin, window.To, step);
            var dto = new UsageBucketsResult(true, interval, window.From, window.To, buckets, null);
            return WorkerResponse.Json(dto, InfrastructureJsonContext.Default.UsageBucketsResult);
        }
        catch (Exception ex)
        {
            return Error<UsageBucketsResult>(ex.Message);
        }
    }

    /// <summary>
    /// Time series split by model. Every model receives the same gap-filled bucket
    /// sequence as the aggregate chart, so the renderer can draw one line/bar series
    /// per model without inferring missing time points from request detail rows.
    /// </summary>
    public static WorkerResponse ModelBuckets(JsonElement parameters)
    {
        var window = ResolveWindow(parameters);
        var interval = ResolveInterval(parameters, window);
        var step = interval == "hour" ? HourMs : DayMs;
        var offsetMs = ResolveTimezoneOffsetMinutes(parameters) * 60_000L;
        try
        {
            var db = DbClient.GetClient(parameters);
            if (db is null) return Error<UsageModelBucketsResult>("Database not initialized");

            var origin = FloorTo(window.From + offsetMs, step) - offsetMs;
            var rows = db.Query(
                @"SELECT
                    COALESCE(provider_id, '(unknown)')                                  AS provider_id,
                    COALESCE(model_id, '(unknown)')                                     AS model_id,
                    MIN(provider_type)                                                  AS provider_type,
                    (((started_at + $offset) / $step) * $step) - $offset              AS bucket_start,
                    COUNT(*)                                                            AS request_count
                  FROM request_usage_logs
                  WHERE started_at >= $from AND started_at < $to
                  GROUP BY provider_id, model_id, bucket_start
                  ORDER BY provider_id, model_id, bucket_start;",
                reader => new ModelBucketQueryRow(
                    reader.GetString(0),
                    reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2),
                    reader.GetInt64(3),
                    reader.GetInt32(4)),
                new SqliteParameter("$step", step),
                new SqliteParameter("$offset", offsetMs),
                new SqliteParameter("$from", window.From),
                new SqliteParameter("$to", window.To));

            var grouped = new Dictionary<(string ProviderId, string ModelId), (string? ProviderType, List<ModelBucketQueryRow> Rows)>();
            foreach (var row in rows)
            {
                var key = (row.ProviderId, row.ModelId);
                if (!grouped.TryGetValue(key, out var group))
                {
                    group = (row.ProviderType, []);
                    grouped[key] = group;
                }
                group.Rows.Add(row);
            }

            var series = new List<UsageModelSeries>(grouped.Count);
            foreach (var pair in grouped)
            {
                series.Add(new UsageModelSeries(
                    pair.Key.ProviderId == "(unknown)" ? null : pair.Key.ProviderId,
                    pair.Key.ModelId,
                    pair.Value.ProviderType,
                    GapFillModel(pair.Value.Rows, origin, window.To, step)));
            }

            var dto = new UsageModelBucketsResult(true, interval, window.From, window.To, series, null);
            return WorkerResponse.Json(dto, InfrastructureJsonContext.Default.UsageModelBucketsResult);
        }
        catch (Exception ex)
        {
            return Error<UsageModelBucketsResult>(ex.Message);
        }
    }

    /// <summary>Per-model rollup, ordered by request volume.</summary>
    public static WorkerResponse ByModel(JsonElement parameters)
    {
        var window = ResolveWindow(parameters);
        try
        {
            var db = DbClient.GetClient(parameters);
            if (db is null) return Error<UsageByModelResult>("Database not initialized");

            var rows = db.Query(
                @"SELECT
                    COALESCE(provider_id, '(unknown)')                                  AS provider_id,
                    COALESCE(model_id, '(unknown)')                                     AS model_id,
                    MIN(provider_type)                                                  AS provider_type,
                    COUNT(*)                                                            AS request_count,
                    COALESCE(SUM(status = 'error'), 0)                                  AS error_count,
                    COALESCE(SUM(billable_input_tokens), 0)                             AS billable_input_tokens,
                    COALESCE(SUM(output_tokens), 0)                                     AS output_tokens,
                    SUM(total_cost_usd)                                                 AS total_cost_usd
                  FROM request_usage_logs
                  WHERE started_at >= $from AND started_at < $to
                  GROUP BY provider_id, model_id
                  ORDER BY request_count DESC;",
                reader => new UsageModelRow(
                    reader.GetString(0) == "(unknown)" ? null : reader.GetString(0),
                    reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2),
                    reader.GetInt32(3),
                    reader.GetInt32(4),
                    reader.GetInt64(5),
                    reader.GetInt64(6),
                    reader.IsDBNull(7) ? null : reader.GetDouble(7)),
                new SqliteParameter("$from", window.From),
                new SqliteParameter("$to", window.To));

            var dto = new UsageByModelResult(true, window.From, window.To, rows, null);
            return WorkerResponse.Json(dto, InfrastructureJsonContext.Default.UsageByModelResult);
        }
        catch (Exception ex)
        {
            return Error<UsageByModelResult>(ex.Message);
        }
    }

    /// <summary>Rollup by caller origin (runtime role / scope / collaboration mode).</summary>
    public static WorkerResponse BySource(JsonElement parameters)
    {
        var window = ResolveWindow(parameters);
        try
        {
            var db = DbClient.GetClient(parameters);
            if (db is null) return Error<UsageBySourceResult>("Database not initialized");

            var rows = db.Query(
                @"SELECT
                    runtime_role, scope, collaboration_mode,
                    COUNT(*)                                                            AS request_count,
                    COALESCE(SUM(status = 'error'), 0)                                  AS error_count,
                    COALESCE(SUM(billable_input_tokens), 0)                             AS billable_input_tokens,
                    COALESCE(SUM(output_tokens), 0)                                     AS output_tokens,
                    SUM(total_cost_usd)                                                 AS total_cost_usd
                  FROM request_usage_logs
                  WHERE started_at >= $from AND started_at < $to
                  GROUP BY runtime_role, scope, collaboration_mode
                  ORDER BY request_count DESC;",
                reader => new UsageSourceRow(
                    reader.IsDBNull(0) ? null : reader.GetString(0),
                    reader.IsDBNull(1) ? null : reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2),
                    reader.GetInt32(3),
                    reader.GetInt32(4),
                    reader.GetInt64(5),
                    reader.GetInt64(6),
                    reader.IsDBNull(7) ? null : reader.GetDouble(7)),
                new SqliteParameter("$from", window.From),
                new SqliteParameter("$to", window.To));

            var dto = new UsageBySourceResult(true, window.From, window.To, rows, null);
            return WorkerResponse.Json(dto, InfrastructureJsonContext.Default.UsageBySourceResult);
        }
        catch (Exception ex)
        {
            return Error<UsageBySourceResult>(ex.Message);
        }
    }

    /// <summary>
    /// Paged detail lines, newest first. `total` is the unpaged match count so the
    /// UI can render "showing X of Y" without a second request.
    /// </summary>
    public static WorkerResponse Logs(JsonElement parameters)
    {
        var window = ResolveWindow(parameters);
        var offset = Math.Max(0, JsonHelpers.GetInt(parameters, "offset", 0));
        var limit = Math.Clamp(
            JsonHelpers.GetInt(parameters, "limit", DefaultDetailLimit), 1, MaxDetailLimit);
        try
        {
            var db = DbClient.GetClient(parameters);
            if (db is null) return Error<UsageLogsResult>("Database not initialized");

            var total = db.QueryScalar<long>(
                @"SELECT COUNT(*) FROM request_usage_logs
                  WHERE started_at >= $from AND started_at < $to;",
                new SqliteParameter("$from", window.From),
                new SqliteParameter("$to", window.To));

            var rows = db.Query(
                @"SELECT
                    id, session_id, runtime_role, scope, collaboration_mode,
                    provider_id, provider_type, model_id,
                    status, error_kind, error_message, http_status_code,
                    attempt_index, total_attempts,
                    input_tokens, billable_input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens, reasoning_tokens,
                    input_cost, output_cost, cache_creation_cost, cache_hit_cost, total_cost_usd,
                    started_at, completed_at, duration_ms, ttft_ms, tps,
                    switched_from_provider_id
                  FROM request_usage_logs
                  WHERE started_at >= $from AND started_at < $to
                  ORDER BY started_at DESC, attempt_index ASC
                  LIMIT $limit OFFSET $offset;",
                MapDetailRow,
                new SqliteParameter("$from", window.From),
                new SqliteParameter("$to", window.To),
                new SqliteParameter("$limit", limit),
                new SqliteParameter("$offset", offset));

            var dto = new UsageLogsResult(true, window.From, window.To, (int)total, offset, limit, rows, null);
            return WorkerResponse.Json(dto, InfrastructureJsonContext.Default.UsageLogsResult);
        }
        catch (Exception ex)
        {
            return Error<UsageLogsResult>(ex.Message);
        }
    }

    // ── Mapping ──

    /// <summary>
    /// Projection carrier for the overview aggregate. A named class (rather than an
    /// anonymous type) because DbService.QueryFirstOrDefault constrains T to a
    /// reference type.
    /// </summary>
    private sealed class OverviewRow
    {
        public int RequestCount { get; init; }
        public int SuccessCount { get; init; }
        public int ErrorCount { get; init; }
        public long InputTokens { get; init; }
        public long BillableInputTokens { get; init; }
        public long OutputTokens { get; init; }
        public long CacheReadTokens { get; init; }
        public long CacheCreationTokens { get; init; }
        public long ReasoningTokens { get; init; }
        public double? TotalCostUsd { get; init; }
        public double? AvgDurationMs { get; init; }
        public int RetryCount { get; init; }

        public static OverviewRow Read(SqliteDataReader r) => new()
        {
            RequestCount = r.GetInt32(0),
            SuccessCount = r.GetInt32(1),
            ErrorCount = r.GetInt32(2),
            InputTokens = r.GetInt64(3),
            BillableInputTokens = r.GetInt64(4),
            OutputTokens = r.GetInt64(5),
            CacheReadTokens = r.GetInt64(6),
            CacheCreationTokens = r.GetInt64(7),
            ReasoningTokens = r.GetInt64(8),
            // SUM over an empty window is NULL (not 0) — keep it NULL so the UI can
            // distinguish "nothing priced" from "costs summed to zero".
            TotalCostUsd = r.IsDBNull(9) ? null : r.GetDouble(9),
            AvgDurationMs = r.IsDBNull(10) ? null : r.GetDouble(10),
            RetryCount = r.GetInt32(11)
        };
    }

    private sealed record ModelBucketQueryRow(
        string ProviderId,
        string ModelId,
        string? ProviderType,
        long BucketStart,
        int RequestCount);

    private static UsageLogDetailRow MapDetailRow(SqliteDataReader r) => new(
        r.GetString(0),
        Str(r, 1), Str(r, 2), Str(r, 3), Str(r, 4),
        Str(r, 5), Str(r, 6), Str(r, 7),
        r.GetString(8),
        Str(r, 9), Str(r, 10),
        NullableInt(r, 11),
        r.GetInt32(12),
        NullableInt(r, 13),
        r.GetInt64(14), r.GetInt64(15), r.GetInt64(16),
        r.GetInt64(17), r.GetInt64(18), r.GetInt64(19),
        NullableDouble(r, 20), NullableDouble(r, 21), NullableDouble(r, 22),
        NullableDouble(r, 23), NullableDouble(r, 24),
        r.GetInt64(25),
        NullableLong(r, 26),
        r.GetInt64(27),
        NullableLong(r, 28),
        NullableDouble(r, 29),
        Str(r, 30));

    private static string? Str(SqliteDataReader r, int i) => r.IsDBNull(i) ? null : r.GetString(i);
    private static int? NullableInt(SqliteDataReader r, int i) => r.IsDBNull(i) ? null : r.GetInt32(i);
    private static long? NullableLong(SqliteDataReader r, int i) => r.IsDBNull(i) ? null : r.GetInt64(i);
    private static double? NullableDouble(SqliteDataReader r, int i) => r.IsDBNull(i) ? null : r.GetDouble(i);

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

    private static WorkerResponse Error<T>(string message)
    {
        // Reuse the per-type error constructor via a switch: WorkerResponse.Json
        // needs a concrete JsonTypeInfo, so the empty result doubles as the error
        // carrier (Success=false + Error), keeping the endpoint shape stable for
        // the renderer instead of switching it to a different DTO on failure.
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        object dto = typeof(T).Name switch
        {
            nameof(UsageOverviewResult) =>
                new UsageOverviewResult(false, 0, now, 0, 0, 0, 0, 0, 0, 0, 0, 0, null, null, 0, message),
            nameof(UsageBucketsResult) =>
                new UsageBucketsResult(false, "hour", 0, now, [], message),
            nameof(UsageModelBucketsResult) =>
                new UsageModelBucketsResult(false, "hour", 0, now, [], message),
            nameof(UsageByModelResult) =>
                new UsageByModelResult(false, 0, now, [], message),
            nameof(UsageBySourceResult) =>
                new UsageBySourceResult(false, 0, now, [], message),
            nameof(UsageLogsResult) =>
                new UsageLogsResult(false, 0, now, 0, 0, DefaultDetailLimit, [], message),
            _ => throw new InvalidOperationException($"No error shape for {typeof(T).Name}")
        };

        return dto switch
        {
            UsageOverviewResult v => WorkerResponse.Json(v, InfrastructureJsonContext.Default.UsageOverviewResult),
            UsageBucketsResult v => WorkerResponse.Json(v, InfrastructureJsonContext.Default.UsageBucketsResult),
            UsageModelBucketsResult v => WorkerResponse.Json(v, InfrastructureJsonContext.Default.UsageModelBucketsResult),
            UsageByModelResult v => WorkerResponse.Json(v, InfrastructureJsonContext.Default.UsageByModelResult),
            UsageBySourceResult v => WorkerResponse.Json(v, InfrastructureJsonContext.Default.UsageBySourceResult),
            UsageLogsResult v => WorkerResponse.Json(v, InfrastructureJsonContext.Default.UsageLogsResult),
            _ => throw new InvalidOperationException($"No error shape for {dto.GetType().Name}")
        };
    }
}

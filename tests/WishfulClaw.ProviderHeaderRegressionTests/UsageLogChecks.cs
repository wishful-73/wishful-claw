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
/// Regression checks for the request-level usage log (#1, iteration 28).
///
/// Contract under test: ProviderRetryPolicy writes exactly ONE row per HTTP
/// request attempt — success or failure — so retry counts and failure
/// attribution stay observable. This is a new, self-contained statistic: it must
/// not read from or write to the existing turn-level session statistics.
///
/// Lives in this project (rather than a new one) because a local NuGet restore
/// fault blocks creating fresh csproj assets; Infrastructure is already a
/// transitive dependency here, so no project reference change is needed.
/// </summary>
internal static partial class UsageLogChecks
{
    private static string _dbPath = string.Empty;
    private static string _dataDir = string.Empty;

    public static void Run()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"wc-usage-log-{Guid.NewGuid():N}.db");
        _dataDir = Path.Combine(Path.GetTempPath(), $"wc-usage-provider-{Guid.NewGuid():N}");
        var previousDataDir = Environment.GetEnvironmentVariable(WishfulClawPaths.DataDirEnvVar);
        Environment.SetEnvironmentVariable(WishfulClawPaths.DataDirEnvVar, _dataDir);
        try
        {
            DbClient.Initialize(_dbPath);

            RunSuccessSuite();
            RunRetryThenSuccessSuite();
            RunExhaustedRetrySuite();
            RunNonRetryableSuite();
            RunCostSuite();
            RunBillableInputSuite();
            RunAuxiliaryUsageSuite();
            RunUsageSourceOverrideSuite();
            RunTableShapeSuite();
            RunOverviewQuerySuite();
            RunBucketGapFillSuite();
            RunBucketTimezoneSuite();
            RunByModelQuerySuite();
            RunBySourceQuerySuite();
            RunDetailQuerySuite();
            RunEmptyWindowSuite();
        }
        finally
        {
            Environment.SetEnvironmentVariable(WishfulClawPaths.DataDirEnvVar, previousDataDir);
            try { if (File.Exists(_dbPath)) File.Delete(_dbPath); } catch { /* best effort */ }
            try { if (Directory.Exists(_dataDir)) Directory.Delete(_dataDir, recursive: true); } catch { /* best effort */ }
        }
    }

    // ── Suites ──

    private static void RunSuccessSuite()
    {
        Reset();

        var turn = NewTurn(input: 100, output: 50, cacheRead: 20, cacheCreation: 10);
        var result = ProviderRetryPolicy.ExecuteAsync(
            () => Task.FromResult(turn), NewState(), NewContext(), ProviderJson()).GetAwaiter().GetResult();

        Assert(ReferenceEquals(result, turn), "usagelog: a successful attempt returns the provider turn");
        Assert(RowCount() == 1, $"usagelog: one successful request writes exactly one row (got {RowCount()})");
        Assert(Col("status") == "success", "usagelog: the row is marked success");
        Assert(Col("provider_id") == "prov-1", "usagelog: provider_id comes from the sidecar providerId payload");
        Assert(ColInt("attempt_index") == 1, "usagelog: the row records attempt_index=1");
        Assert(ColInt("total_attempts") == 1, "usagelog: the row records total_attempts=1");
        Assert(ColInt("input_tokens") == 100, "usagelog: input tokens are persisted");
        Assert(ColInt("output_tokens") == 50, "usagelog: output tokens are persisted");
        Assert(ColInt("cache_read_tokens") == 20, "usagelog: cache-read tokens are persisted");
        Assert(ColInt("cache_creation_tokens") == 10, "usagelog: cache-creation tokens are persisted");
        // 100 input - 20 cacheRead - 10 cacheCreation = 70
        Assert(ColInt("billable_input_tokens") == 70,
            $"usagelog: billable input subtracts cacheRead AND cacheCreation (got {ColInt("billable_input_tokens")})");
    }

    private static void RunRetryThenSuccessSuite()
    {
        Reset();

        var attempts = 0;
        var turn = NewTurn(input: 7, output: 3);
        EmittedEvents = 0;

        ProviderRetryPolicy.ExecuteAsync(
            () =>
            {
                attempts++;
                if (attempts < 3)
                {
                    throw new ProviderHttpException("test", HttpStatusCode.TooManyRequests, "rate limited", TimeSpan.Zero);
                }
                return Task.FromResult(turn);
            },
            NewState(), NewContext(), ProviderJson()).GetAwaiter().GetResult();

        Assert(attempts == 3, $"usagelog: the request retried until success (attempts={attempts})");
        Assert(EmittedEvents == 2, $"usagelog: each retried failure still emits a request_retry event (got {EmittedEvents})");
        Assert(RowCount() == 3, $"usagelog: two failures plus one success write three rows (got {RowCount()})");
        Assert(ErrorCount() == 2, $"usagelog: the two failed attempts are recorded as errors (got {ErrorCount()})");
        Assert(SuccessCount() == 1, "usagelog: the successful attempt is recorded as success");
        Assert(ColWhere("error_kind", "attempt_index=1") == "http_429",
            "usagelog: a 429 failure row records error_kind=http_429");
        Assert(ColIntWhere("http_status_code", "attempt_index=1") == 429,
            "usagelog: a 429 failure row records the HTTP status code");
        Assert(ColIsNullWhere("total_attempts", "attempt_index=1"),
            "usagelog: an intermediate failure row leaves total_attempts NULL (not terminal yet)");
    }

    private static void RunExhaustedRetrySuite()
    {
        Reset();

        var attempts = 0;
        var rethrew = false;
        try
        {
            ProviderRetryPolicy.ExecuteAsync(
                () =>
                {
                    attempts++;
                    throw new ProviderHttpException("test", HttpStatusCode.ServiceUnavailable, "down", TimeSpan.Zero);
                },
                NewState(), NewContext(), ProviderJson(maxRetries: 2)).GetAwaiter().GetResult();
        }
        catch (ProviderHttpException)
        {
            rethrew = true;
        }

        Assert(rethrew, "usagelog: an exhausted retry loop rethrows the provider error");
        Assert(attempts == 3, $"usagelog: maxRetries=2 means three total attempts (got {attempts})");
        Assert(RowCount() == 3, $"usagelog: an exhausted retry loop still writes every attempt (got {RowCount()})");
        Assert(ErrorCount() == 3, "usagelog: every attempt in an exhausted loop is an error row");
        Assert(ColIntWhere("total_attempts", "attempt_index=3") == 3,
            "usagelog: the terminal row records total_attempts so the final failure is attributable");
    }

    private static void RunNonRetryableSuite()
    {
        Reset();

        var attempts = 0;
        var rethrew = false;
        try
        {
            ProviderRetryPolicy.ExecuteAsync(
                () =>
                {
                    attempts++;
                    throw new ProviderHttpException("test", HttpStatusCode.Unauthorized, "bad key", TimeSpan.Zero);
                },
                NewState(), NewContext(), ProviderJson()).GetAwaiter().GetResult();
        }
        catch (ProviderHttpException)
        {
            rethrew = true;
        }

        Assert(rethrew, "usagelog: a non-retryable status propagates");
        Assert(attempts == 1, $"usagelog: a 401 is not retryable and runs once (got {attempts})");
        Assert(RowCount() == 1, "usagelog: a non-retryable failure still writes its row");
        Assert(Col("error_kind") == "http_401", "usagelog: the non-retryable failure records its kind");
    }

    private static void RunCostSuite()
    {
        Reset();

        // 1,000,000 billable input tokens at $3/M = $3.00; no output price configured.
        var turn = NewTurn(input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0);
        ProviderRetryPolicy.ExecuteAsync(
            () => Task.FromResult(turn), NewState(), NewContext(), ProviderJson(inputPrice: 3.0)).GetAwaiter().GetResult();

        Assert(Math.Abs(ColDouble("input_cost") - 3.0) < 1e-9,
            $"usagelog: input cost is price x tokens (got {ColDouble("input_cost")})");
        Assert(Math.Abs(ColDouble("total_cost_usd") - 3.0) < 1e-9,
            "usagelog: total cost sums the non-null components");
        Assert(ColIsNull("output_cost"),
            "usagelog: a missing price leaves its cost NULL rather than 0");
    }

    private static void RunBillableInputSuite()
    {
        var both = DbUsageLogTools.ComputeBillableInput(1000, 300, 200);
        Assert(both == 500, $"usagelog: billable input subtracts cacheRead AND cacheCreation (got {both})");

        var clamped = DbUsageLogTools.ComputeBillableInput(100, 500, 500);
        Assert(clamped == 0, "usagelog: billable input clamps at zero");
    }

    /// <summary>
    /// Auxiliary chains (prompt optimizer, persona generation, provider/complete) bypass
    /// ProviderRetryPolicy, so R-1 logs them through AuxiliaryUsageLog instead.
    /// </summary>
    private static void RunAuxiliaryUsageSuite()
    {
        Reset();

        var anthropic = AuxiliaryUsageLog.ReadUsage(
            """{"id":"msg_1","usage":{"input_tokens":800,"output_tokens":120,"cache_read_input_tokens":500,"cache_creation_input_tokens":100}}""",
            "anthropic");
        Assert(anthropic?.InputTokens == 800 && anthropic?.OutputTokens == 120 &&
               anthropic?.CacheReadTokens == 500 && anthropic?.CacheCreationTokens == 100 &&
               anthropic?.ReasoningTokens == 0,
            $"auxusage: the anthropic usage block is parsed (got {anthropic})");

        var openAi = AuxiliaryUsageLog.ReadUsage(
            """{"usage":{"prompt_tokens":900,"completion_tokens":200,"prompt_tokens_details":{"cached_tokens":600},"completion_tokens_details":{"reasoning_tokens":64}}}""",
            "openai-chat");
        Assert(openAi?.InputTokens == 900 && openAi?.OutputTokens == 200 &&
               openAi?.CacheReadTokens == 600 && openAi?.CacheCreationTokens == 0 &&
               openAi?.ReasoningTokens == 64,
            $"auxusage: the openai usage block is parsed including nested details (got {openAi})");

        Assert(AuxiliaryUsageLog.ReadUsage("""{"choices":[]}""", "openai-chat") is null,
            "auxusage: a body without a usage block yields null instead of invented tokens");
        Assert(AuxiliaryUsageLog.ReadUsage("not json", "openai-chat") is null,
            "auxusage: a malformed body yields null instead of throwing");

        var provider = new ResolvedProviderConfig(
            "prov-1", "anthropic", "https://example.test", "test-key", "model-1", "configured");
        var startedAt = DateTimeOffset.UtcNow.AddSeconds(-3).ToUnixTimeMilliseconds();
        AuxiliaryUsageLog.Record(provider, "promptOptimizer", true, startedAt, usage: openAi);

        Assert(RowCount() == 1, $"auxusage: one auxiliary request writes exactly one row (got {RowCount()})");
        Assert(Col("runtime_role") == "promptOptimizer",
            "auxusage: the request source is stored in runtime_role so the usage UI can group by it");
        Assert(Col("status") == "success", "auxusage: a successful auxiliary request is marked success");
        Assert(ColInt("input_tokens") == 900, "auxusage: auxiliary input tokens are persisted");
        Assert(ColInt("reasoning_tokens") == 64, "auxusage: auxiliary reasoning tokens are persisted");
        // 900 prompt_tokens - 600 cached_tokens = 300
        Assert(ColInt("billable_input_tokens") == 300,
            $"auxusage: auxiliary billable input subtracts cache-read tokens (got {ColInt("billable_input_tokens")})");
        Assert(ColInt("total_attempts") == 1,
            "auxusage: an auxiliary chain that retried nothing records a single attempt");
        Assert(ColWhere("scope", "status='success'") == "unknown",
            "auxusage: an auxiliary row has no session, so scope is unknown rather than inherited");
        Assert(ColWhere("collaboration_mode", "status='success'") == "unknown",
            "auxusage: an auxiliary row is not a chat turn, so it must not claim collaboration mode chat");

        AuxiliaryUsageLog.Record(provider, "personaGenerator", false, startedAt, error: "HTTP 500: upstream");
        Assert(RowCount() == 2, $"auxusage: a failed auxiliary request still writes a row (got {RowCount()})");
        Assert(ErrorCount() == 1, "auxusage: the failed auxiliary request is the only error row");
        Assert(ColWhere("runtime_role", "status='error'") == "personaGenerator",
            "auxusage: the failure row keeps its own source");
        Assert(ColWhere("error_kind", "status='error'") == "auxiliary",
            "auxusage: auxiliary failures are attributed to error_kind=auxiliary");
        Assert(ColIntWhere("input_tokens", "status='error'") == 0,
            "auxusage: a failure row without a usage block keeps zero tokens");
        Assert(!ColIsNullWhere("total_attempts", "status='error'"),
            "auxusage: a failure row is terminal, so total_attempts is filled in");

        // The auxiliary chains retry inside their own loop and still write one row, so
        // the real attempt count has to ride on that row instead of being hardcoded to 1.
        AuxiliaryUsageLog.Record(
            provider, "providerCompletion", false, startedAt, error: "HTTP 429: slow down", totalAttempts: 7);
        Assert(ColIntWhere("total_attempts", "runtime_role='providerCompletion'") == 7,
            "auxusage: the caller's retry count is recorded, not a fixed 1");
        Assert(ColIntWhere("attempt_index", "runtime_role='providerCompletion'") == 1,
            "auxusage: a retried auxiliary request stays one row with attempt_index 1");
    }

    /// <summary>
    /// R-1.8: automation runs share runtimeRole with interactive sessions, so the renderer
    /// supplies a usageSource to name the real origin. It must win over the run-context role,
    /// and must not swallow it when absent.
    /// </summary>
    private static void RunUsageSourceOverrideSuite()
    {
        Reset();
        ProviderRetryPolicy.ExecuteAsync(
            () => Task.FromResult(NewTurn(input: 10, output: 5)),
            NewState("automationBackground"), NewContext(), ProviderJson()).GetAwaiter().GetResult();
        Assert(Col("runtime_role") == "automationBackground",
            $"usagesource: the renderer-supplied usageSource becomes runtime_role (got {Col("runtime_role")})");

        Reset();
        ProviderRetryPolicy.ExecuteAsync(
            () => Task.FromResult(NewTurn(input: 10, output: 5)),
            NewState(), NewContext(), ProviderJson()).GetAwaiter().GetResult();
        Assert(Col("runtime_role") == "sessionagent",
            $"usagesource: without usageSource the canonical run-context role is kept (got {Col("runtime_role")})");
    }

    private static void RunTableShapeSuite()
    {
        // 31 columns: guards against a migration and the entity drifting apart.
        using var conn = new SqliteConnection($"Data Source={_dbPath}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "PRAGMA table_info(request_usage_logs);";
        using var reader = cmd.ExecuteReader();
        var columns = new List<string>();
        while (reader.Read()) columns.Add(reader.GetString(1));

        Assert(columns.Count == 31, $"usagelog: the table has 31 columns (got {columns.Count})");
        foreach (var required in new[]
                 {
                     "switched_from_provider_id", "runtime_role", "scope", "collaboration_mode",
                     "attempt_index", "total_attempts", "error_kind", "billable_input_tokens",
                     "total_cost_usd", "ttft_ms", "tps"
                 })
        {
            Assert(columns.Contains(required), $"usagelog: the table exposes the '{required}' column");
        }
    }

    // ── Query-layer suites (P2) ──
    //
    // These drive the five db/usage-* endpoints through WorkerResponse and assert
    // on the serialized JSON. Serializing is part of the contract: it proves the
    // DTOs are registered in InfrastructureJsonContext, which compiles fine when
    // missing and only blows up at runtime.

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

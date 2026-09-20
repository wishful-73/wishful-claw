/*
 * Regression suite for the agent timeline (iter-29 / S-25).
 *
 * Asserts the retention policy (plan S-25.5) in a decidable way: rows older
 * than the cutoff disappear, rows inside the window survive, and the row-count
 * ceiling trims the oldest entries. Also covers the write-path invariants of
 * DbAgentTimelineTools.Log (best-effort: bad input must not throw) and the
 * ListPage cursor contract. The `sln` membership is the contract — an unslotted
 * suite silently leaks (see CronRegressionTests history).
 */
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.TestSupport;

namespace WishfulClaw.AgentTimelineRegressionTests;

internal static class Program
{
    private static int _passed;
    private static int _failed;

    public static int Main(string[] args)
    {
        RetentionTrimsByAge();
        RetentionTrimsByCount();
        LogIsBestEffort();
        ListPagePaginatesNewestFirst();
        MetadataEscapesValues();

        Console.WriteLine(
            _failed == 0
                ? $"ALL PASS ({_passed} assertion{(_passed == 1 ? string.Empty : "s")})"
                : $"{_failed} FAILED of {_passed}");
        return _failed == 0 ? 0 : 1;
    }

    private static void Assert(bool condition, string message)
    {
        if (condition)
        {
            _passed++;
            return;
        }
        _failed++;
        Console.WriteLine($"  FAIL: {message}");
    }

    /// <summary>Fresh temp DB with the timeline table created.</summary>
    private static (DbService Db, string Path) NewDb()
    {
        var path = Path.Combine(TestOutputRoot.Resolve(), $"timeline-regression-{Guid.NewGuid():N}.db");
        var db = new DbService($"Data Source={path}");
        db.Execute(
            """
            CREATE TABLE IF NOT EXISTS agent_timeline_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                project_id TEXT,
                event_type TEXT NOT NULL,
                message TEXT,
                metadata_json TEXT,
                created_at INTEGER NOT NULL
            );
            """);
        return (db, path);
    }

    private static long Insert(DbService db, long createdAt, string eventType = "todo_created", string? session = "s1")
    {
        db.Execute(
            "INSERT INTO agent_timeline_events (session_id, project_id, event_type, message, metadata_json, created_at) " +
            "VALUES (@sid, NULL, @et, NULL, NULL, @ca)",
            new SqliteParameter("@sid", (object?)session ?? DBNull.Value),
            new SqliteParameter("@et", eventType),
            new SqliteParameter("@ca", createdAt));
        // NOTE: last_insert_rowid() is per-connection and DbService opens a fresh
        // connection per call — use MAX(id) (monotonic AUTOINCREMENT) instead.
        return db.QueryScalar<long>("SELECT MAX(id) FROM agent_timeline_events");
    }

    private static long Count(DbService db)
        => db.QueryScalar<long>("SELECT COUNT(*) FROM agent_timeline_events");

    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // ── S-25.5: by-age retention ──

    private static void RetentionTrimsByAge()
    {
        var (db, path) = NewDb();
        try
        {
            var cutoff = Now - DbAgentTimelineTools.RetentionDays * 86_400_000L;
            var oldRow = Insert(db, cutoff - 1_000);
            var freshRow = Insert(db, Now - 1_000);
            var edgeRow = Insert(db, cutoff + 1_000);

            DbAgentTimelineTools.Prune(db);

            Assert(Count(db) == 2, $"retention by age: expected 2 survivors, got {Count(db)}");
            Assert(CountRow(db, oldRow) == 0, "retention by age: row older than cutoff must be pruned");
            Assert(CountRow(db, freshRow) == 1, "retention by age: row inside window must survive");
            Assert(CountRow(db, edgeRow) == 1, "retention by age: row at cutoff boundary must survive");
        }
        finally { TryDelete(path); }
    }

    // ── S-25.5: row-count ceiling ──

    private static void RetentionTrimsByCount()
    {
        var (db, path) = NewDb();
        try
        {
            // Insert RetentionMaxRows + 10 rows, oldest first (ascending created_at).
            // Park them mid-window (-15d): the insert loop takes real time, so a
            // row exactly at the -30d boundary would race the prune's cutoff.
            var baseTime = Now - 15L * 86_400_000;
            long firstRowId = 0;
            for (var i = 0; i < DbAgentTimelineTools.RetentionMaxRows + 10; i++)
            {
                var id = Insert(db, baseTime + i);
                if (i == 0) firstRowId = id;
            }

            var insertedCount = Count(db);
            Assert(insertedCount == DbAgentTimelineTools.RetentionMaxRows + 10,
                $"insert count: expected {DbAgentTimelineTools.RetentionMaxRows + 10}, got {insertedCount}");

            DbAgentTimelineTools.Prune(db);

            Assert(Count(db) == DbAgentTimelineTools.RetentionMaxRows,
                $"retention by count: expected {DbAgentTimelineTools.RetentionMaxRows} rows, got {Count(db)}");
            Assert(CountRow(db, firstRowId) == 0, "retention by count: oldest row must be trimmed");
            var newestId = db.QueryScalar<long>("SELECT MAX(id) FROM agent_timeline_events");
            Assert(CountRow(db, newestId) == 1, "retention by count: newest row must survive");
        }
        finally { TryDelete(path); }
    }

    // ── Log best-effort contract ──

    private static void LogIsBestEffort()
    {
        var (db, path) = NewDb();
        try
        {
            // Valid write lands.
            DbAgentTimelineTools.Log(db, "s1", null, "todo_created", "subject", "{\"task_id\":\"t1\"}");
            Assert(Count(db) == 1, "log: valid write must land");

            // Blank event type is a no-op, not a throw.
            DbAgentTimelineTools.Log(db, "s1", null, "", "x", null);
            Assert(Count(db) == 1, "log: blank eventType must be ignored");

            // Null session is allowed (app-level event).
            DbAgentTimelineTools.Log(db, null, null, "cron_fired", null, null);
            Assert(Count(db) == 2, "log: null session must be allowed");
            var appLevel = db.QueryScalar<long>("SELECT COUNT(*) FROM agent_timeline_events WHERE session_id IS NULL");
            Assert(appLevel == 1, "log: null session row must be queryable");
        }
        finally { TryDelete(path); }
    }

    // ── ListPage cursor pagination ──

    private static void ListPagePaginatesNewestFirst()
    {
        var (db, path) = NewDb();
        try
        {
            // Real time window: DbClient.Initialize runs Prune, which would wipe
            // rows dated outside the 30-day retention window (e.g. epoch ~1970).
            var baseTime = Now - 10L * 86_400_000;
            for (var i = 0; i < 5; i++) Insert(db, baseTime + i);

            // The ListPage endpoint resolves its own connection via DbClient —
            // point it at the temp db explicitly, never at the app data dir.
            var page1 = ParseResult(DbAgentTimelineTools.ListPage(BuildParams(
                ("dbPath", path), ("sessionId", "s1"), ("limit", 3))));
            Assert(page1.Count == 3, $"list: first page expected 3 rows, got {page1.Count}");
            Assert(page1.HasMore, "list: first page must report hasMore=true");
            // Newest-first: page 1 = the 3 newest rows; cursor tail = 3rd newest.
            Assert(page1.CreatedAtDesc == baseTime + 2 && page1.FirstId > page1.LastId,
                "list: first page must be newest-first");
            Assert(!page1.ContainsDuplicateIds, "list: first page must not contain duplicate ids");

            // 5 rows, page size 3: page 2 = remaining 2 rows, hasMore=false.
            var page2 = ParseResult(DbAgentTimelineTools.ListPage(BuildParams(
                ("dbPath", path), ("sessionId", "s1"), ("limit", 3),
                ("beforeCreatedAt", page1.CreatedAtDesc), ("beforeId", page1.NextId))));
            Assert(page2.Count == 2, $"list: second page expected 2 rows, got {page2.Count}");
            Assert(!page2.HasMore, "list: second page must report hasMore=false");

            var overlap = page1.Ids.Concat(page2.Ids).ToList();
            Assert(overlap.Count == 5 && overlap.Distinct().Count() == 5,
                "list: pages must tile all rows without overlap or duplicates");
        }
        finally { TryDelete(path); }
    }

    /// <summary>
    /// Metadata is built through <c>Utf8JsonWriter</c>, so a value containing a quote or
    /// a backslash cannot produce invalid JSON. Call sites used to interpolate values
    /// into a JSON string by hand, and nothing parses the column today — which is exactly
    /// why this needs a test instead of waiting for a bug report.
    /// </summary>
    private static void MetadataEscapesValues()
    {
        const string nasty = "quote \" and backslash \\ and end";
        var json = DbAgentTimelineTools.Metadata(
            ("task_id", "t-1"),
            ("reason", nasty),
            ("missing", null),
            ("blank", string.Empty),
            ("tool_calls", 7));

        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        Assert(root.ValueKind == JsonValueKind.Object, "metadata: must be a JSON object");
        Assert(root.GetProperty("task_id").GetString() == "t-1", "metadata: a plain value must round-trip");
        Assert(root.GetProperty("reason").GetString() == nasty,
            "metadata: a value with quotes/backslashes must round-trip");
        Assert(!root.TryGetProperty("missing", out _), "metadata: null values must be omitted");
        Assert(!root.TryGetProperty("blank", out _), "metadata: blank values must be omitted");
        Assert(root.GetProperty("tool_calls").GetInt32() == 7, "metadata: a number must stay a number");
    }

    private static JsonElement BuildParams(params (string Key, object? Value)[] items)
        => WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            foreach (var (key, value) in items)
            {
                w.WritePropertyName(key);
                switch (value)
                {
                    case null: w.WriteNullValue(); break;
                    case string s: w.WriteStringValue(s); break;
                    case int i: w.WriteNumberValue(i); break;
                    case long l: w.WriteNumberValue(l); break;
                    default: w.WriteStringValue(value.ToString()); break;
                }
            }
            w.WriteEndObject();
        });

    private sealed record PageResult(
        int Count, bool HasMore, long CreatedAtDesc, long FirstId, long LastId, long NextId,
        List<long> Ids, bool ContainsDuplicateIds);

    /// <summary>Extract the "result" envelope and map the page fields.</summary>
    private static PageResult ParseResult(WorkerResponse response)
    {
        var json = Encoding.UTF8.GetString(response.ToJsonBytes(null));
        using var doc = JsonDocument.Parse(json);
        var result = doc.RootElement.GetProperty("result");
        if (!result.TryGetProperty("items", out var items))
        {
            Console.WriteLine($"  DIAG result json: {json}");
        }
        var ids = items.EnumerateArray().Select(e => e.GetProperty("id").GetInt64()).ToList();
        long? nextCreatedAt = result.TryGetProperty("nextCreatedAt", out var nca) && nca.ValueKind == JsonValueKind.Number
            ? nca.GetInt64() : null;
        long? nextId = result.TryGetProperty("nextId", out var nid) && nid.ValueKind == JsonValueKind.Number
            ? nid.GetInt64() : null;
        return new PageResult(
            Count: ids.Count,
            HasMore: result.GetProperty("hasMore").GetBoolean(),
            CreatedAtDesc: nextCreatedAt ?? 0,
            FirstId: ids.Count > 0 ? ids[0] : 0,
            LastId: ids.Count > 0 ? ids[^1] : 0,
            NextId: nextId ?? 0,
            Ids: ids,
            ContainsDuplicateIds: ids.Count != ids.Distinct().Count());
    }

    private static long CountRow(DbService db, long id)
        => db.QueryScalar<long>("SELECT COUNT(*) FROM agent_timeline_events WHERE id = @id",
            new SqliteParameter("@id", id));

    private static void TryDelete(string path)
    {
        try { File.Delete(path); } catch { /* best effort */ }
    }
}

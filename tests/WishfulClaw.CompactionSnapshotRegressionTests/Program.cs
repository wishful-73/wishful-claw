using System.Diagnostics;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Agent;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.CompactionSnapshotRegressionTests;

internal static class Program
{
    private static int _passed;

    public static int Main(string[] args)
    {
        WorkerJsonHelper.ConfigureAotResolver(InfrastructureJsonContext.Default);
        try
        {
            if (args.Length == 2)
                return RunChildMode(args[0], args[1]);
            if (args.Length == 1 && string.Equals(args[0], "--schema-only", StringComparison.Ordinal))
                return RunSchemaOnlyMode();

            var testRoot = Path.Combine(Path.GetTempPath(), $"wishful-compaction-regression-{Guid.NewGuid():N}");
            Directory.CreateDirectory(testRoot);
            try
            {
                var legacyDbPath = Path.Combine(testRoot, "legacy.db");
                var newDbPath = Path.Combine(testRoot, "new.db");
                SeedLegacyDatabase(legacyDbPath);
                RunChild("--suite-legacy", legacyDbPath);
                RunChild("--suite-new", newDbPath);
            }
            finally
            {
                TryDeleteDirectory(testRoot);
            }

            Console.WriteLine($"Compaction snapshot regression parent checks passed: {_passed}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Compaction snapshot regression test failed: {ex}");
            return 1;
        }
    }

    private static int RunSchemaOnlyMode()
    {
        var testRoot = Path.Combine(Path.GetTempPath(), $"wishful-compaction-schema-{Guid.NewGuid():N}");
        Directory.CreateDirectory(testRoot);
        try
        {
            var legacyDbPath = Path.Combine(testRoot, "legacy.db");
            var newDbPath = Path.Combine(testRoot, "new.db");
            SeedLegacyDatabase(legacyDbPath);
            RunChild("--schema-legacy", legacyDbPath);
            RunChild("--schema-new", newDbPath);
            Console.WriteLine($"Compaction snapshot schema checks passed: {_passed}");
            return 0;
        }
        finally
        {
            TryDeleteDirectory(testRoot);
        }
    }

    private static int RunChildMode(string mode, string dbPath)
    {
        try
        {
            WorkerJsonHelper.ConfigureAotResolver(InfrastructureJsonContext.Default);
            switch (mode)
            {
                case "--suite-legacy":
                    RunLegacySuite(dbPath);
                    break;
                case "--suite-new":
                    RunNewDatabaseSuite(dbPath);
                    break;
                case "--schema-legacy":
                    RunLegacySchemaSuite(dbPath);
                    break;
                case "--schema-new":
                    RunNewSchemaSuite(dbPath);
                    break;
                default:
                    throw new InvalidOperationException($"Unknown child mode: {mode}");
            }

            Console.WriteLine($"Compaction snapshot regression child checks passed ({mode}): {_passed}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Compaction snapshot regression child failed ({mode}): {ex}");
            return 1;
        }
    }

    private static void RunLegacySchemaSuite(string dbPath)
    {
        var initialization = DbClient.Initialize(dbPath);
        Assert(initialization.Success, $"legacy schema initializes: {initialization.Error}");
        var db = DbClient.GetClient();
        AssertEqual("legacy-legacy-session-v1", db.QueryScalar<string>(
                "SELECT current_snapshot_id FROM sessions WHERE id = 'legacy-session'"),
            "legacy schema backfills current snapshot pointer");
        AssertEqual("legacy-wire", db.QueryScalar<string>(
                "SELECT wire_conversation FROM session_compaction_snapshots " +
                "WHERE snapshot_id = 'legacy-legacy-session-v1'"),
            "legacy schema preserves payload");
        AssertEqual(1L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM session_compaction_snapshots"),
            "legacy schema preserves one migrated row");

        var secondInitialization = DbClient.Initialize(dbPath);
        Assert(secondInitialization.Success, $"legacy schema second initialization: {secondInitialization.Error}");
        AssertEqual(1L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM session_compaction_snapshots"),
            "legacy schema second initialization is idempotent");
    }

    private static void RunNewSchemaSuite(string dbPath)
    {
        var initialization = DbClient.Initialize(dbPath);
        Assert(initialization.Success, $"new schema initializes: {initialization.Error}");
        var db = DbClient.GetClient();
        var columns = db.Query("PRAGMA table_info(session_compaction_snapshots);", reader => reader.GetString("name"));
        AssertEqual(ExpectedSnapshotColumns().Length, columns.Count, "new schema has the complete snapshot column set");
        foreach (var column in ExpectedSnapshotColumns())
            Assert(columns.Contains(column, StringComparer.OrdinalIgnoreCase), $"new schema has column {column}");
        var sessionColumns = db.Query("PRAGMA table_info(sessions);", reader => reader.GetString("name"));
        Assert(sessionColumns.Contains("current_snapshot_id", StringComparer.OrdinalIgnoreCase), "new schema has current_snapshot_id");
        Assert(sessionColumns.Contains("context_revision", StringComparer.OrdinalIgnoreCase), "new schema has context_revision");

        var secondInitialization = DbClient.Initialize(dbPath);
        Assert(secondInitialization.Success, $"new schema second initialization: {secondInitialization.Error}");
        RunAtomicCommitSuite(dbPath, "schema");
    }

    private static void RunAtomicCommitSuite(string dbPath, string prefix)
    {
        var sessionId = $"{prefix}-atomic-session";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", sessionId);
            writer.WriteString("title", "Atomic Snapshot Session");
        })), "atomic snapshot session is created");
        AddMessage(dbPath, sessionId, $"{prefix}-atomic-message", 5000, 0);

        var db = DbClient.GetClient();
        var first = DbCompactionSnapshotStore.CommitSnapshot(
            db,
            sessionId,
            DbCompactionSnapshotStore.SupportedVersion,
            "auto",
            "[{\"role\":\"user\",\"content\":\"first\"}]",
            "[{\"id\":\"artifact-1\"}]",
            null,
            null,
            1,
            1,
            0,
            false,
            expectedRevision: 0);
        Assert(first.Success, "first snapshot commit succeeds");
        Assert(first.SnapshotId is { Length: > 0 }, "first snapshot commit returns a snapshot id");
        AssertEqual(1L, first.ContextRevision, "first snapshot commit advances context revision");

        var stale = DbCompactionSnapshotStore.CommitSnapshot(
            db,
            sessionId,
            DbCompactionSnapshotStore.SupportedVersion,
            "manual",
            "[{\"role\":\"user\",\"content\":\"stale\"}]",
            "[{\"id\":\"artifact-stale\"}]",
            null,
            null,
            1,
            1,
            0,
            false,
            expectedRevision: 0);
        Assert(!stale.Success, "stale snapshot commit is rejected");
        AssertEqual(DbCompactionSnapshotStore.CommitConflictError, stale.Error,
            "stale snapshot commit returns snapshot_commit_conflict");

        AssertEqual(1L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM session_compaction_snapshots WHERE session_id = @sid",
                new SqliteParameter("@sid", sessionId)),
            "stale snapshot commit rolls back the new snapshot row");
        AssertEqual(first.SnapshotId, db.QueryScalar<string>(
                "SELECT current_snapshot_id FROM sessions WHERE id = @sid",
                new SqliteParameter("@sid", sessionId)),
            "stale snapshot commit preserves the old pointer");
        AssertEqual(1L, db.QueryScalar<long>(
                "SELECT context_revision FROM sessions WHERE id = @sid",
                new SqliteParameter("@sid", sessionId)),
            "stale snapshot commit preserves context revision");
        AssertEqual("[{\"role\":\"user\",\"content\":\"first\"}]", db.QueryScalar<string>(
                "SELECT wire_conversation FROM session_compaction_snapshots WHERE snapshot_id = @snapshotId",
                new SqliteParameter("@snapshotId", first.SnapshotId)),
            "stale snapshot commit preserves the old payload");

        var invalid = DbCompactionSnapshotStore.CommitSnapshot(
            db,
            sessionId,
            DbCompactionSnapshotStore.SupportedVersion,
            "manual",
            "{invalid",
            "[]",
            null,
            null,
            1,
            1,
            0,
            false,
            expectedRevision: 1);
        Assert(!invalid.Success, "invalid snapshot payload is rejected");
        AssertEqual(DbCompactionSnapshotStore.InvalidPayloadError, invalid.Error,
            "invalid snapshot payload returns a named error");
        AssertEqual(1L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM session_compaction_snapshots WHERE session_id = @sid",
                new SqliteParameter("@sid", sessionId)),
            "invalid snapshot payload leaves no extra row");
    }

    // ─── Suite: legacy (0.2.22) database migration ───

    private static void RunLegacySuite(string dbPath)
    {
        var initialization = DbClient.Initialize(dbPath);
        Assert(initialization.Success, $"legacy database migrates: {initialization.Error}");
        var db = DbClient.GetClient();

        AssertEqual(1L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='session_compaction_snapshots'"),
            "legacy migration adds session_compaction_snapshots");
        AssertEqual(1L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_session_compaction_updated'"),
            "legacy migration adds snapshot index");
        AssertEqual(3L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM messages WHERE session_id = 'legacy-session'"),
            "legacy messages survive migration");
        AssertEqual("Legacy Session", db.QueryScalar<string>(
                "SELECT title FROM sessions WHERE id = 'legacy-session'"),
            "legacy session survives migration");
        AssertEqual("legacy-legacy-session-v1", db.QueryScalar<string>(
                "SELECT current_snapshot_id FROM sessions WHERE id = 'legacy-session'"),
            "legacy migration backfills the current snapshot pointer");
        AssertEqual("legacy-wire", db.QueryScalar<string>(
                "SELECT wire_conversation FROM session_compaction_snapshots " +
                "WHERE snapshot_id = 'legacy-legacy-session-v1'"),
            "legacy migration preserves snapshot payload");
        AssertEqual(1L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM session_compaction_snapshots"),
            "legacy migration preserves the snapshot row count");

        var secondInitialization = DbClient.Initialize(dbPath);
        Assert(secondInitialization.Success, $"legacy database second initialization: {secondInitialization.Error}");
        AssertEqual(1L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM session_compaction_snapshots"),
            "second initialization does not duplicate migrated snapshots");
        AssertEqual("legacy-legacy-session-v1", db.QueryScalar<string>(
                "SELECT current_snapshot_id FROM sessions WHERE id = 'legacy-session'"),
            "second initialization preserves the current snapshot pointer");
        AssertEqual("legacy-wire", db.QueryScalar<string>(
                "SELECT wire_conversation FROM session_compaction_snapshots " +
                "WHERE snapshot_id = 'legacy-legacy-session-v1'"),
            "second initialization preserves the migrated payload");

        RunSnapshotSuite(dbPath, "legacy");
    }

    // ─── Suite: new database schema ───

    private static void RunNewDatabaseSuite(string dbPath)
    {
        var initialization = DbClient.Initialize(dbPath);
        Assert(initialization.Success, $"new database initializes: {initialization.Error}");
        var db = DbClient.GetClient();

        AssertEqual(1L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='session_compaction_snapshots'"),
            "new database creates session_compaction_snapshots");
        AssertEqual(1L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_session_compaction_updated'"),
            "new database creates snapshot index");
        var columns = db.Query("PRAGMA table_info(session_compaction_snapshots);", reader => reader.GetString("name"));
        AssertEqual(ExpectedSnapshotColumns().Length, columns.Count, "snapshot table contains the complete column set");
        foreach (var column in ExpectedSnapshotColumns())
            Assert(columns.Contains(column, StringComparer.OrdinalIgnoreCase), $"snapshot table has column {column}");

        RunSnapshotSuite(dbPath, "new");
    }

    // ─── Shared snapshot suite ───

    private static void RunSnapshotSuite(string dbPath, string prefix)
    {
        var db = DbClient.GetClient();
        var sessionA = $"{prefix}-session-a";

        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", sessionA);
            writer.WriteString("title", "Snapshot Session A");
        })), "session for snapshot tests is created");

        // Upsert refuses a session without persisted messages.
        var emptySession = $"{prefix}-session-empty";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", emptySession);
            writer.WriteString("title", "Empty Session");
        })), "empty session is created");
        var refused = ResultObject(DbCompactionSnapshotTools.Upsert(UpsertParams(dbPath, emptySession)));
        Assert(!refused.GetProperty("success").GetBoolean(), "upsert refuses a session without messages");

        // Seed messages m0..m4 with distinct created_at/sort_order.
        AddBatchMessages(dbPath, sessionA, prefix, startIndex: 0, count: 5, baseCreatedAt: 1000, baseSortOrder: 0);

        // ── CRUD roundtrip ──
        AssertMutationSuccess(DbCompactionSnapshotTools.Upsert(UpsertParams(dbPath, sessionA, trigger: "auto",
            originalCount: 5, newCount: 2, messagesSummarized: 3)),
            "upsert persists the first snapshot");

        var snapshot = ReadSnapshot(dbPath, sessionA);
        AssertEqual(1, snapshot.GetProperty("version").GetInt32(), "snapshot stores format version 1");
        AssertEqual("auto", snapshot.GetProperty("trigger").GetString(), "snapshot stores trigger");
        AssertEqual(1004L, snapshot.GetProperty("throughCreatedAt").GetInt64(), "cursor uses newest message created_at");
        AssertEqual(4, snapshot.GetProperty("throughSortOrder").GetInt32(), "cursor uses newest message sort_order");
        AssertEqual(5, snapshot.GetProperty("originalCount").GetInt32(), "snapshot stores original count");
        AssertEqual(2, snapshot.GetProperty("newCount").GetInt32(), "snapshot stores new count");
        AssertEqual(3, snapshot.GetProperty("messagesSummarized").GetInt32(), "snapshot stores summarized count");
        Assert(!snapshot.GetProperty("summarizerFailed").GetBoolean(), "snapshot stores summarizer success");
        AssertNullProperty(snapshot, "summaryMessage", "summaryMessage stays null when omitted");
        AssertNullProperty(snapshot, "summaryText", "summaryText stays null when omitted");

        // Upsert replaces the previous row atomically.
        AssertMutationSuccess(DbCompactionSnapshotTools.Upsert(UpsertParams(dbPath, sessionA, trigger: "manual",
            originalCount: 5, newCount: 1, messagesSummarized: 4, summarizerFailed: true,
            summaryMessage: "{\"id\":\"summary\"}", summaryText: "compressed body")),
            "upsert replaces an existing snapshot");
        var replaced = ReadSnapshot(dbPath, sessionA);
        AssertEqual("manual", replaced.GetProperty("trigger").GetString(), "replace updates trigger");
        Assert(replaced.GetProperty("summarizerFailed").GetBoolean(), "replace updates degraded flag");
        AssertEqual("compressed body", replaced.GetProperty("summaryText").GetString(), "replace stores summary text");
        Assert(replaced.TryGetProperty("summaryMessage", out var summaryMessage)
                && summaryMessage.ValueKind == JsonValueKind.String
                && IsJsonObjectText(summaryMessage.GetString()),
            "replace stores summary message JSON");
        AssertEqual(1L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM session_compaction_snapshots WHERE session_id = @sid",
                new SqliteParameter("@sid", sessionA)),
            "upsert keeps a single snapshot row per session");

        // ── Incremental query after cursor ──
        AddMessage(dbPath, sessionA, $"{prefix}-m5", 1005, 5);
        AddMessage(dbPath, sessionA, $"{prefix}-m6", 1005, 6);
        var incremental = ResultArray(DbMessageTools.ListAfterCursor(Params(dbPath, writer =>
        {
            writer.WriteString("sessionId", sessionA);
            writer.WriteNumber("afterCreatedAt", 1004);
            writer.WriteNumber("afterSortOrder", 4);
        })));
        AssertEqual(2, incremental.Count, "after-cursor query returns only messages past the cursor");
        AssertEqual($"{prefix}-m5", incremental[0].GetProperty("id").GetString(), "after-cursor query preserves order (first)");
        AssertEqual($"{prefix}-m6", incremental[1].GetProperty("id").GetString(), "after-cursor query preserves order (second)");
        var tieBreak = ResultArray(DbMessageTools.ListAfterCursor(Params(dbPath, writer =>
        {
            writer.WriteString("sessionId", sessionA);
            writer.WriteNumber("afterCreatedAt", 1005);
            writer.WriteNumber("afterSortOrder", 5);
        })));
        AssertEqual(1, tieBreak.Count, "after-cursor query breaks equal-timestamp ties via sort_order");
        AssertEqual($"{prefix}-m6", tieBreak[0].GetProperty("id").GetString(), "tie-break returns the later sort_order");

        // ── Delete endpoint ──
        var deleted = ResultObject(DbCompactionSnapshotTools.Delete(Params(dbPath, writer => writer.WriteString("sessionId", sessionA))));
        Assert(deleted.GetProperty("success").GetBoolean(), "delete endpoint succeeds");
        Assert(deleted.GetProperty("deleted").GetBoolean(), "delete removes an existing snapshot");
        AssertNoSnapshot(dbPath, sessionA, "get after delete returns no snapshot");
        var deleteAgain = ResultObject(DbCompactionSnapshotTools.Delete(Params(dbPath, writer => writer.WriteString("sessionId", sessionA))));
        Assert(!deleteAgain.GetProperty("deleted").GetBoolean(), "delete reports absence for missing snapshot");

        // ── Safety validation fallbacks (raw rows) ──
        RunValidationFallbackSuite(dbPath, $"{prefix}-session-g");

        // ── Invalidation rules ──
        RunInvalidationSuite(dbPath, prefix, sessionA);

        // ── Automatic compression usage recovery and overflow classification ──
        RunAutomaticCompressionUsageSuite(dbPath, prefix);

        // ── Summarizer input budget and tool-content truncation ──
        RunSummaryInputBudgetSuite();

        // ── Restore filtering (summary/artifact rows never enter model context) ──
        RunRestoreFilterSuite(dbPath, prefix);

        // ── Compression snapshot persistence failure semantics ──
        RunPersistenceFailureSuite(dbPath, prefix);

        // ── fork/duplicate does not inherit snapshots ──
        RunForkSuite(dbPath, prefix);

        // ── ClearAll removes snapshots with the sessions ──
        var sessionD = $"{prefix}-session-d";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", sessionD);
            writer.WriteString("title", "Session D");
        })), "session D is created");
        AddMessage(dbPath, sessionD, $"{prefix}-d1", 2000, 0);
        UpsertSnapshot(dbPath, sessionD);
        var clearAll = ResultObject(DbSessionTools.ClearAll(Params(dbPath)));
        Assert(clearAll.GetProperty("success").GetBoolean(), "clear-all succeeds");
        AssertEqual(0L, db.QueryScalar<long>("SELECT COUNT(*) FROM session_compaction_snapshots"),
            "clear-all removes every snapshot together with the sessions");
    }

    private static void RunValidationFallbackSuite(string dbPath, string sessionId)
    {
        var db = DbClient.GetClient();
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", sessionId);
            writer.WriteString("title", "Validation Session");
        })), "validation session is created");
        AddMessage(dbPath, sessionId, $"{sessionId}-m0", 3000, 0);
        UpsertSnapshot(dbPath, sessionId);

        db.Execute(
            "UPDATE session_compaction_snapshots SET version = 99 WHERE session_id = @sid",
            new SqliteParameter("@sid", sessionId));
        var unsupported = ResultObject(DbCompactionSnapshotTools.Get(Params(dbPath, writer => writer.WriteString("sessionId", sessionId))));
        Assert(unsupported.GetProperty("success").GetBoolean(), "unsupported version read still succeeds");
        AssertNullProperty(unsupported, "snapshot", "unsupported version downgrades to no snapshot");
        AssertEqual("unsupported_version", unsupported.GetProperty("reason").GetString(), "unsupported version reports reason");

        db.Execute(
            "UPDATE session_compaction_snapshots SET version = 1, wire_conversation = '{corrupt' WHERE session_id = @sid",
            new SqliteParameter("@sid", sessionId));
        var corrupt = ResultObject(DbCompactionSnapshotTools.Get(Params(dbPath, writer => writer.WriteString("sessionId", sessionId))));
        Assert(corrupt.GetProperty("success").GetBoolean(), "corrupt payload read still succeeds");
        AssertNullProperty(corrupt, "snapshot", "corrupt payload downgrades to no snapshot");
        AssertEqual("corrupt", corrupt.GetProperty("reason").GetString(), "corrupt payload reports reason");

        db.Execute(
            "UPDATE session_compaction_snapshots SET wire_conversation = '[{\"role\":\"user\"}]', " +
            "through_created_at = 999999, through_sort_order = 999 WHERE session_id = @sid",
            new SqliteParameter("@sid", sessionId));
        var dangling = ResultObject(DbCompactionSnapshotTools.Get(Params(dbPath, writer => writer.WriteString("sessionId", sessionId))));
        Assert(dangling.GetProperty("success").GetBoolean(), "dangling cursor read still succeeds");
        AssertNullProperty(dangling, "snapshot", "dangling cursor downgrades to no snapshot");
        AssertEqual("invalid_cursor", dangling.GetProperty("reason").GetString(), "dangling cursor reports reason");

        AssertEqual(1L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM session_compaction_snapshots WHERE session_id = @sid",
                new SqliteParameter("@sid", sessionId)),
            "invalid snapshots are retained for diagnostics instead of auto-deleted");

        AssertMutationSuccess(DbCompactionSnapshotTools.Delete(Params(dbPath, writer => writer.WriteString("sessionId", sessionId))),
            "validation session snapshot is cleaned up");
    }

    private static void RunInvalidationSuite(string dbPath, string prefix, string sessionA)
    {
        var db = DbClient.GetClient();

        // Usage-only persistence updates are display metadata and must keep the snapshot.
        var usageSession = $"{prefix}-session-usage";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", usageSession);
            writer.WriteString("title", "Usage Session");
        })), "usage session is created");
        AddMessage(dbPath, usageSession, $"{prefix}-usage-message", 2500, 0);
        UpsertSnapshot(dbPath, usageSession);
        AssertMutationSuccess(DbMessageTools.Upsert(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-usage-message");
            writer.WriteString("sessionId", usageSession);
            writer.WriteString("role", "user");
            writer.WriteString("content", $"message {prefix}-usage-message");
            writer.WriteNumber("createdAt", 2500);
            writer.WriteNumber("sortOrder", 0);
            writer.WriteString("usage", "{\"contextTokens\":123}");
        })), "usage-only upsert succeeds");
        AssertHasSnapshot(dbPath, usageSession, "usage-only upsert keeps the snapshot");

        AssertMutationSuccess(DbMessageTools.Upsert(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-usage-message");
            writer.WriteString("sessionId", usageSession);
            writer.WriteString("role", "user");
            writer.WriteString("content", "edited content");
            writer.WriteNumber("createdAt", 2500);
            writer.WriteNumber("sortOrder", 0);
            writer.WriteString("usage", "{\"contextTokens\":456}");
        })), "content-changing upsert succeeds");
        AssertNoSnapshot(dbPath, usageSession, "content-changing upsert invalidates the snapshot");

        var updateSession = $"{prefix}-session-update";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", updateSession);
            writer.WriteString("title", "Update Session");
        })), "update session is created");
        AddMessage(dbPath, updateSession, $"{prefix}-update-message", 2600, 0);
        UpsertSnapshot(dbPath, updateSession);
        AssertMutationSuccess(DbMessageTools.Update(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-update-message");
            writer.WriteStartObject("patch");
            writer.WriteString("usage", "{\"contextTokens\":789}");
            writer.WriteEndObject();
        })), "usage-only message update succeeds");
        AssertHasSnapshot(dbPath, updateSession, "usage-only message update keeps the snapshot");

        AssertMutationSuccess(DbMessageTools.Update(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-update-message");
            writer.WriteStartObject("patch");
            writer.WriteString("meta", "{\"toolResult\":true}");
            writer.WriteEndObject();
        })), "meta-changing message update succeeds");
        AssertNoSnapshot(dbPath, updateSession, "meta-changing message update invalidates the snapshot");

        // Chat-only display artifacts (compression status card / compact boundary)
        // never reach the model context — meta-only lifecycle updates must keep the
        // snapshot (snapshot-contract.md §7.4), while content rewrites still
        // invalidate it. Regression for the "snapshot deleted the moment compression
        // completes" defect: the status card is inserted before PersistSnapshot, so
        // the snapshot cursor anchors on it, and the completion-state merge used to
        // delete the snapshot it was reporting on.
        var artifactSession = $"{prefix}-session-artifact";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", artifactSession);
            writer.WriteString("title", "Artifact Session");
        })), "artifact session is created");
        AddMessage(dbPath, artifactSession, $"{prefix}-artifact-message", 2700, 0);
        AssertMutationSuccess(DbMessageTools.Add(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-artifact-status");
            writer.WriteString("sessionId", artifactSession);
            writer.WriteString("role", "system");
            writer.WriteString("content", "");
            writer.WriteString("meta", "{\"compressionStatus\":{\"operationId\":\"op-1\",\"state\":\"compressing\",\"startedAt\":2700}}");
            writer.WriteNumber("createdAt", 2700);
            writer.WriteNumber("sortOrder", 1);
        })), "compression status card is inserted");
        UpsertSnapshot(dbPath, artifactSession);
        AssertMutationSuccess(DbMessageTools.Upsert(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-artifact-status");
            writer.WriteString("sessionId", artifactSession);
            writer.WriteString("role", "system");
            writer.WriteString("content", "");
            writer.WriteString("meta", "{\"compressionStatus\":{\"operationId\":\"op-1\",\"state\":\"compressed\",\"startedAt\":2700,\"completedAt\":2701}}");
            writer.WriteNumber("createdAt", 2700);
            writer.WriteNumber("sortOrder", 1);
        })), "status card completion-state upsert succeeds");
        AssertHasSnapshot(dbPath, artifactSession, "status card meta-only upsert keeps the snapshot");

        AssertMutationSuccess(DbMessageTools.Add(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-artifact-boundary");
            writer.WriteString("sessionId", artifactSession);
            writer.WriteString("role", "system");
            writer.WriteString("content", "");
            writer.WriteString("meta", "{\"compactBoundary\":{\"trigger\":\"auto\"}}");
            writer.WriteNumber("createdAt", 2700);
            writer.WriteNumber("sortOrder", 2);
        })), "compact boundary row is inserted");
        UpsertSnapshot(dbPath, artifactSession);
        AssertMutationSuccess(DbMessageTools.Upsert(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-artifact-boundary");
            writer.WriteString("sessionId", artifactSession);
            writer.WriteString("role", "system");
            writer.WriteString("content", "");
            writer.WriteString("meta", "{\"compactBoundary\":{\"trigger\":\"manual\",\"preTokens\":123}}");
            writer.WriteNumber("createdAt", 2700);
            writer.WriteNumber("sortOrder", 2);
        })), "boundary meta-only upsert succeeds");
        AssertHasSnapshot(dbPath, artifactSession, "boundary meta-only upsert keeps the snapshot");

        AssertMutationSuccess(DbMessageTools.Upsert(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-artifact-status");
            writer.WriteString("sessionId", artifactSession);
            writer.WriteString("role", "system");
            writer.WriteString("content", "rewritten artifact content");
            writer.WriteString("meta", "{\"compressionStatus\":{\"operationId\":\"op-1\",\"state\":\"compressed\",\"startedAt\":2700,\"completedAt\":2701}}");
            writer.WriteNumber("createdAt", 2700);
            writer.WriteNumber("sortOrder", 1);
        })), "artifact content rewrite upsert succeeds");
        AssertNoSnapshot(dbPath, artifactSession, "artifact content rewrite still invalidates the snapshot");

        UpsertSnapshot(dbPath, artifactSession);
        AssertMutationSuccess(DbMessageTools.Upsert(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-artifact-message");
            writer.WriteString("sessionId", artifactSession);
            writer.WriteString("role", "user");
            writer.WriteString("content", $"message {prefix}-artifact-message");
            writer.WriteString("meta", "{\"toolResult\":true}");
            writer.WriteNumber("createdAt", 2700);
            writer.WriteNumber("sortOrder", 0);
        })), "regular message meta-only upsert succeeds");
        AssertNoSnapshot(dbPath, artifactSession, "regular message meta-only upsert still invalidates the snapshot");

        // Deleting a covered message removes the snapshot.
        UpsertSnapshot(dbPath, sessionA);
        AssertMutationSuccess(DbMessageTools.Delete(Params(dbPath, writer =>
        {
            writer.WriteString("sessionId", sessionA);
            writer.WriteString("messageId", $"{prefix}-m2");
        })), "covered message can be deleted");
        AssertNoSnapshot(dbPath, sessionA, "deleting a covered message invalidates the snapshot");

        // Deleting a message after the cursor keeps the snapshot.
        UpsertSnapshot(dbPath, sessionA);
        AddMessage(dbPath, sessionA, $"{prefix}-m7", 1006, 7);
        AssertMutationSuccess(DbMessageTools.Delete(Params(dbPath, writer =>
        {
            writer.WriteString("sessionId", sessionA);
            writer.WriteString("messageId", $"{prefix}-m7");
        })), "tail message can be deleted");
        AssertHasSnapshot(dbPath, sessionA, "deleting a post-cursor message keeps the snapshot");

        // DeleteLast: the anchor message is covered, a fresh tail message is not.
        AssertMutationSuccess(DbMessageTools.DeleteLast(Params(dbPath, writer =>
        {
            writer.WriteString("sessionId", sessionA);
        })), "delete-last removes the anchor message");
        AssertNoSnapshot(dbPath, sessionA, "delete-last of the covered anchor invalidates the snapshot");
        UpsertSnapshot(dbPath, sessionA);
        AddMessage(dbPath, sessionA, $"{prefix}-m8", 1007, 8);
        AssertMutationSuccess(DbMessageTools.DeleteLast(Params(dbPath, writer =>
        {
            writer.WriteString("sessionId", sessionA);
        })), "delete-last removes the tail message");
        AssertHasSnapshot(dbPath, sessionA, "delete-last of a post-cursor message keeps the snapshot");

        // TruncateFrom: overlap removes, pure tail truncation keeps.
        UpsertSnapshot(dbPath, sessionA);
        AssertMutationSuccess(DbMessageTools.TruncateFrom(Params(dbPath, writer =>
        {
            writer.WriteString("sessionId", sessionA);
            writer.WriteNumber("fromSortOrder", 4);
        })), "truncate removes covered tail including the anchor");
        AssertNoSnapshot(dbPath, sessionA, "truncate overlapping the coverage invalidates the snapshot");

        UpsertSnapshot(dbPath, sessionA);
        AddMessage(dbPath, sessionA, $"{prefix}-m9", 1008, 9);
        AddMessage(dbPath, sessionA, $"{prefix}-m10", 1009, 10);
        AssertMutationSuccess(DbMessageTools.TruncateFrom(Params(dbPath, writer =>
        {
            writer.WriteString("sessionId", sessionA);
            writer.WriteNumber("fromSortOrder", 9);
        })), "truncate removes only post-cursor messages");
        AssertHasSnapshot(dbPath, sessionA, "truncate limited to post-cursor messages keeps the snapshot");

        // Clearing messages removes the snapshot.
        AssertMutationSuccess(DbMessageTools.Clear(Params(dbPath, writer => writer.WriteString("sessionId", sessionA))),
            "messages clear succeeds");
        AssertNoSnapshot(dbPath, sessionA, "clearing messages removes the snapshot");

        // Reset conversation removes the snapshot.
        var sessionB = $"{prefix}-session-b";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", sessionB);
            writer.WriteString("title", "Session B");
        })), "session B is created");
        AddMessage(dbPath, sessionB, $"{prefix}-b1", 2100, 0);
        UpsertSnapshot(dbPath, sessionB);
        var reset = ResultObject(DbSessionTools.ResetConversation(Params(dbPath, writer => writer.WriteString("sessionId", sessionB))));
        Assert(reset.GetProperty("success").GetBoolean(), "reset conversation succeeds");
        AssertNoSnapshot(dbPath, sessionB, "reset conversation removes the snapshot");

        // Deleting the session removes the snapshot.
        var sessionC = $"{prefix}-session-c";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", sessionC);
            writer.WriteString("title", "Session C");
        })), "session C is created");
        AddMessage(dbPath, sessionC, $"{prefix}-c1", 2200, 0);
        UpsertSnapshot(dbPath, sessionC);
        AssertMutationSuccess(DbSessionTools.Delete(Params(dbPath, writer => writer.WriteString("id", sessionC))),
            "session delete succeeds");
        AssertNoSnapshot(dbPath, sessionC, "deleting the session removes the snapshot");

        // Project delete cascade removes the snapshot.
        var projectId = $"{prefix}-project";
        db.Execute(
            "INSERT INTO projects (id, name, created_at, updated_at) VALUES (@id, @name, 1, 1)",
            new SqliteParameter("@id", projectId),
            new SqliteParameter("@name", "Snapshot Project"));
        var sessionE = $"{prefix}-session-e";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", sessionE);
            writer.WriteString("title", "Session E");
            writer.WriteString("projectId", projectId);
        })), "project session is created");
        AddMessage(dbPath, sessionE, $"{prefix}-e1", 2300, 0);
        UpsertSnapshot(dbPath, sessionE);
        var projectDelete = ResultObject(DbProjectTools.Delete(Params(dbPath, writer => writer.WriteString("id", projectId))));
        Assert(projectDelete.GetProperty("success").GetBoolean(), "project delete succeeds");
        AssertNoSnapshot(dbPath, sessionE, "project cascade delete removes the snapshot");
    }

    // ─── Suite: automatic compression usage recovery ───

    private static void RunAutomaticCompressionUsageSuite(string dbPath, string prefix)
    {
        var wireMessages = new List<JsonElement>
        {
            Json(@"{""role"":""assistant"",""content"":""first"",""usage"":{""contextTokens"":111}}"),
            Json(@"{""role"":""user"",""content"":""next""}"),
            Json(@"{""role"":""assistant"",""content"":""second"",""usage"":{""contextTokens"":222}}"),
            Json(@"{""role"":""assistant"",""content"":""invalid"",""usage"":""malformed""}")
        };
        AssertEqual(222, AgentLoop.FindRecentContextUsage(wireMessages),
            "recent context usage scans backward to the latest valid provider usage");
        AssertEqual(0, AgentLoop.FindRecentContextUsage(
            [Json(@"{""role"":""user"",""content"":""none""}"), Json(@"{""usage"":null}")]),
            "recent context usage returns zero when no valid usage exists");
        AssertEqual(0, AgentLoop.FindRecentContextUsage(
            [Json(@"{""usage"":{""contextTokens"":""not-a-number""}}")]),
            "recent context usage ignores malformed context token values");

        var sessionId = $"{prefix}-restore-usage";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", sessionId);
            writer.WriteString("title", "Restore Usage Session");
        })), "restore usage session is created");
        AssertMutationSuccess(DbMessageTools.AddBatch(Params(dbPath, writer =>
        {
            writer.WriteStartArray("messages");
            writer.WriteStartObject();
            writer.WriteString("id", $"{prefix}-usage-valid");
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("role", "assistant");
            writer.WriteString("content", "valid usage");
            writer.WriteString("usage", "{\"contextTokens\":654,\"inputTokens\":600}");
            writer.WriteNumber("createdAt", 3300);
            writer.WriteNumber("sortOrder", 0);
            writer.WriteEndObject();
            writer.WriteStartObject();
            writer.WriteString("id", $"{prefix}-usage-non-object");
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("role", "user");
            writer.WriteString("content", "non-object usage");
            writer.WriteString("usage", "[]");
            writer.WriteNumber("createdAt", 3301);
            writer.WriteNumber("sortOrder", 1);
            writer.WriteEndObject();
            writer.WriteStartObject();
            writer.WriteString("id", $"{prefix}-usage-corrupt");
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("role", "assistant");
            writer.WriteString("content", "corrupt usage");
            writer.WriteString("usage", "{corrupt");
            writer.WriteNumber("createdAt", 3302);
            writer.WriteNumber("sortOrder", 2);
            writer.WriteEndObject();
            writer.WriteEndArray();
        })), "messages with persisted usage are inserted");

        var restored = SessionRestoreTools.RestoreFromDb(DbClient.GetClient(), sessionId);
        AssertEqual(3, restored.WireMessages.Count, "usage restore keeps every regular message");
        Assert(restored.WireMessages[0].TryGetProperty("usage", out var restoredUsage) &&
               restoredUsage.ValueKind == JsonValueKind.Object &&
               restoredUsage.GetProperty("contextTokens").GetInt32() == 654 &&
               restoredUsage.GetProperty("inputTokens").GetInt32() == 600,
            "database restore writes the persisted usage object back to the wire message");
        Assert(!restored.WireMessages[1].TryGetProperty("usage", out _),
            "database restore ignores non-object usage JSON");
        Assert(!restored.WireMessages[2].TryGetProperty("usage", out _),
            "database restore ignores malformed usage JSON");
        AssertEqual(654, AgentLoop.FindRecentContextUsage(restored.WireMessages),
            "restored wire conversation exposes the latest persisted context usage");

        Assert(ContextCompression.IsContextWindowExceededError(
                new InvalidOperationException("maximum context length exceeded")),
            "context overflow classifier recognizes a direct provider error");
        Assert(ContextCompression.IsContextWindowExceededError(
                new InvalidOperationException("outer", new Exception("INPUT TOKEN COUNT EXCEEDS the model limit"))),
            "context overflow classifier recognizes an inner provider error case-insensitively");
        Assert(!ContextCompression.IsContextWindowExceededError(
                new InvalidOperationException("HTTP 400 invalid request payload")),
            "context overflow classifier does not misclassify an ordinary provider error");

        var providerCalls = 0;
        using var retryState = new AgentRuntimeRunState("overflow-retry-test", sessionId);
        var overflowError = new ProviderHttpException(
            "test-provider",
            System.Net.HttpStatusCode.BadRequest,
            "{\"error\":\"context_length_exceeded\"}",
            null);
        try
        {
            ProviderRetryPolicy.ExecuteAsync(
                    () =>
                    {
                        providerCalls++;
                        return Task.FromException<AgentRuntimeProviderTurnResult>(overflowError);
                    },
                    retryState,
                    SilentRequestContext.Instance)
                .GetAwaiter()
                .GetResult();
            throw new InvalidOperationException("provider retry policy unexpectedly swallowed context overflow");
        }
        catch (ProviderHttpException ex)
        {
            Assert(ReferenceEquals(overflowError, ex),
                "provider retry policy propagates the original context overflow error");
        }
        AssertEqual(1, providerCalls,
            "provider retry policy skips ordinary HTTP retry for context overflow");
    }

    private static void RunSummaryInputBudgetSuite()
    {
        var older = AgentRuntimeChatMessage.User("older:" + new string('o', 900));
        var middle = AgentRuntimeChatMessage.User("middle:" + new string('m', 900));
        var recent = AgentRuntimeChatMessage.User("recent-working-state:" + new string('r', 300));
        var budgeted = ContextCompression.BuildSummaryRequestBody([older, middle, recent], 1_024);
        Assert(budgeted.Length <= 1_024,
            "summary input never exceeds the requested character budget");
        Assert(!budgeted.Contains("older:", StringComparison.Ordinal) &&
               budgeted.Contains("recent-working-state:", StringComparison.Ordinal),
            "summary input drops complete oldest messages and preserves the recent working state");
        Assert(budgeted.Contains("older message(s) omitted", StringComparison.Ordinal),
            "summary input reports when older messages were omitted");

        var single = ContextCompression.BuildSummaryRequestBody(
            [AgentRuntimeChatMessage.User("single:" + new string('s', 2_000))], 1_024);
        Assert(single.Length <= 1_024 && single.Contains("[truncated]", StringComparison.Ordinal),
            "a single oversized message is truncated within the final budget");

        using var toolInputDoc = JsonDocument.Parse("{\"payload\":\"" + new string('i', 1_000) + "\"}");
        using var toolResultDoc = JsonDocument.Parse("\"" + new string('r', 1_200) + "\"");
        var toolMessage = new AgentRuntimeChatMessage(
            "assistant",
            string.Empty,
            [new AgentRuntimeChatToolUse("tool-1", "demo_tool", toolInputDoc.RootElement.Clone())],
            []);
        var resultMessage = AgentRuntimeChatMessage.UserToolResults(
            [new AgentRuntimeToolResult("tool-1", toolResultDoc.RootElement.Clone())]);
        var toolTranscript = ContextCompression.BuildSummaryRequestBody(
            [toolMessage, resultMessage], 10_000);
        var callLine = toolTranscript.Split('\n').First(line => line.StartsWith("[assistant calls", StringComparison.Ordinal));
        var resultLines = toolTranscript.Split('\n');
        var resultHeaderIndex = Array.FindIndex(resultLines,
            line => line.StartsWith("[tool tool-1 result", StringComparison.Ordinal));
        Assert(callLine.Length <= "[assistant calls demo_tool] ".Length + 500,
            "summary tool-call input is capped at 500 characters");
        Assert(resultHeaderIndex >= 0 && resultHeaderIndex + 1 < resultLines.Length &&
               resultLines[resultHeaderIndex + 1].Length <= 800,
            "summary tool result is capped at 800 characters");
    }

    // ─── Suite: restore filtering (artifacts never enter model context) ───

    private static void RunRestoreFilterSuite(string dbPath, string prefix)
    {
        // Full recovery path: summary/boundary/status rows stay out of the wire.
        var fullSession = $"{prefix}-restore-full";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", fullSession);
            writer.WriteString("title", "Restore Full Session");
        })), "restore (full) session is created");
        AddMessage(dbPath, fullSession, $"{prefix}-rf-m1", 3100, 0);
        AddMessage(dbPath, fullSession, $"{prefix}-rf-m2", 3101, 1);
        AddMetaMessage(dbPath, fullSession, $"{prefix}-rf-summary", 3102, 2, "user",
            "<compaction-summary>old history summary</compaction-summary>",
            @"{""compactSummary"":{""text"":""old history summary""}}");
        AddMetaMessage(dbPath, fullSession, $"{prefix}-rf-boundary", 3102, 3, "system", "",
            @"{""compactBoundary"":{""trigger"":""auto""}}");
        AddMetaMessage(dbPath, fullSession, $"{prefix}-rf-status", 3102, 4, "system", "",
            @"{""compressionStatus"":{""operationId"":""op-r1"",""state"":""compressed""}}");
        AddMetaMessage(dbPath, fullSession, $"{prefix}-rf-legacy-summary", 3103, 5, "user",
            "   <compaction-summary>legacy summary</compaction-summary>", null);
        AddMessage(dbPath, fullSession, $"{prefix}-rf-m3", 3104, 6);

        var fullRestore = ResultObject(SessionRestoreTools.RestoreSession(Params(dbPath, writer =>
            writer.WriteString("sessionId", fullSession))));
        Assert(fullRestore.GetProperty("restored").GetBoolean(), "full-path restore succeeds");
        AssertEqual(3, fullRestore.GetProperty("messageCount").GetInt32(),
            "full-path restore filters summary/boundary/status rows out of the model context");
        Assert(!fullRestore.TryGetProperty("fromSnapshot", out var fullFromSnapshot)
                || fullFromSnapshot.ValueKind == JsonValueKind.Null,
            "full-path restore reports no snapshot");

        // Snapshot path: snapshot wire + only the regular post-cursor messages.
        var snapSession = $"{prefix}-restore-snap";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", snapSession);
            writer.WriteString("title", "Restore Snapshot Session");
        })), "restore (snapshot) session is created");
        AddMessage(dbPath, snapSession, $"{prefix}-rs-m0", 3200, 0);
        UpsertSnapshot(dbPath, snapSession);
        AddMetaMessage(dbPath, snapSession, $"{prefix}-rs-summary", 3201, 1, "user",
            "<compaction-summary>post-cursor summary</compaction-summary>",
            @"{""compactSummary"":{""text"":""post-cursor summary""}}");
        AddMetaMessage(dbPath, snapSession, $"{prefix}-rs-boundary", 3201, 2, "system", "",
            @"{""compactBoundary"":{""trigger"":""auto""}}");
        AddMessage(dbPath, snapSession, $"{prefix}-rs-m1", 3202, 3);

        var snapRestore = ResultObject(SessionRestoreTools.RestoreSession(Params(dbPath, writer =>
            writer.WriteString("sessionId", snapSession))));
        Assert(snapRestore.GetProperty("restored").GetBoolean(), "snapshot-path restore succeeds");
        AssertEqual(2, snapRestore.GetProperty("messageCount").GetInt32(),
            "snapshot-path restore keeps the snapshot wire plus only regular post-cursor messages");
        Assert(snapRestore.TryGetProperty("fromSnapshot", out var snapFromSnapshot)
                && snapFromSnapshot.ValueKind == JsonValueKind.True,
            "snapshot-path restore reports the snapshot source");
        AssertHasSnapshot(dbPath, snapSession, "restore does not disturb the snapshot");

        // A second restore must not clobber the live conversation.
        var repeatRestore = ResultObject(SessionRestoreTools.RestoreSession(Params(dbPath, writer =>
            writer.WriteString("sessionId", snapSession))));
        Assert(repeatRestore.GetProperty("restored").GetBoolean(), "repeat restore succeeds");
        Assert(repeatRestore.TryGetProperty("skipped", out var skipped) && skipped.GetBoolean(),
            "repeat restore skips an already-initialized session");
        AssertEqual(2, repeatRestore.GetProperty("messageCount").GetInt32(),
            "repeat restore keeps the original message count");
    }

    private static void RunPersistenceFailureSuite(string dbPath, string prefix)
    {
        var outcome = new ContextCompression.CompactionOutcome(
            [AgentRuntimeChatMessage.User("compressed")],
            [Json(@"{""id"":""summary"",""role"":""user"",""content"":""compressed""}")],
            true,
            false,
            1,
            2,
            "summary");
        var invalidArtifacts = new[] { default(JsonElement) };

        var retainedSession = $"{prefix}-persist-retained";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", retainedSession);
            writer.WriteString("title", "Retained Snapshot Session");
        })), "retained snapshot session is created");
        AddMessage(dbPath, retainedSession, $"{prefix}-persist-retained-message", 3400, 0);
        UpsertSnapshot(dbPath, retainedSession);
        var oldSnapshot = ReadSnapshot(dbPath, retainedSession);

        var retainedFailure = ContextCompression.PersistSnapshot(
            outcome, invalidArtifacts, retainedSession, "manual", 123);
        Assert(!retainedFailure.Success && !retainedFailure.Skipped && retainedFailure.Error is not null,
            "snapshot persistence returns a structured failure");

        var afterFailure = ReadSnapshot(dbPath, retainedSession);
        AssertEqual(oldSnapshot.GetProperty("updatedAt").GetInt64(), afterFailure.GetProperty("updatedAt").GetInt64(),
            "failed snapshot persistence keeps the previous snapshot row");
        AssertEqual(oldSnapshot.GetProperty("wireConversation").GetString(), afterFailure.GetProperty("wireConversation").GetString(),
            "failed snapshot persistence keeps the previous snapshot payload");

        var fallbackSession = $"{prefix}-persist-fallback";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", fallbackSession);
            writer.WriteString("title", "Fallback Snapshot Session");
        })), "fallback snapshot session is created");
        AddMessage(dbPath, fallbackSession, $"{prefix}-persist-fallback-message-1", 3410, 0);
        AddMessage(dbPath, fallbackSession, $"{prefix}-persist-fallback-message-2", 3411, 1);

        var fallbackFailure = ContextCompression.PersistSnapshot(
            outcome, invalidArtifacts, fallbackSession, "auto", 456);
        Assert(!fallbackFailure.Success && !fallbackFailure.Skipped,
            "snapshot persistence failure is reported without an existing snapshot");
        AssertNoSnapshot(dbPath, fallbackSession,
            "failed first snapshot persistence does not create a snapshot");

        var restored = SessionRestoreTools.RestoreFromDb(DbClient.GetClient(), fallbackSession);
        AssertEqual(2, restored.WireMessages.Count,
            "session restore falls back to complete regular message history without a snapshot");
        Assert(!restored.FromSnapshot,
            "no snapshot after persistence failure reports full-history source");
    }

    private static void RunForkSuite(string dbPath, string prefix)
    {
        var source = $"{prefix}-fork-source";
        var forked = $"{prefix}-fork-target";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", source);
            writer.WriteString("title", "Fork Source");
        })), "fork source session is created");
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", forked);
            writer.WriteString("title", "Fork Target");
        })), "fork target session is created");

        AddBatchMessages(dbPath, source, $"{prefix}-fork-src", startIndex: 0, count: 3, baseCreatedAt: 2400, baseSortOrder: 0);
        UpsertSnapshot(dbPath, source);

        // Fork copies messages under new ids into the target session.
        AddBatchMessages(dbPath, forked, $"{prefix}-fork-tgt", startIndex: 0, count: 3, baseCreatedAt: 2400, baseSortOrder: 0);
        AssertNoSnapshot(dbPath, forked, "forked session does not inherit the source snapshot");
        AssertHasSnapshot(dbPath, source, "fork leaves the source snapshot untouched");
    }

    // ─── Helpers ───

    private static void AddMessage(string dbPath, string sessionId, string id, long createdAt, int sortOrder)
    {
        AssertMutationSuccess(DbMessageTools.Add(Params(dbPath, writer =>
        {
            writer.WriteString("id", id);
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("role", sortOrder % 2 == 0 ? "user" : "assistant");
            writer.WriteString("content", $"message {id}");
            writer.WriteNumber("createdAt", createdAt);
            writer.WriteNumber("sortOrder", sortOrder);
        })), $"message {id} is inserted");
    }

    private static void AddMetaMessage(string dbPath, string sessionId, string id, long createdAt, int sortOrder, string role, string content, string? meta)
    {
        AssertMutationSuccess(DbMessageTools.Add(Params(dbPath, writer =>
        {
            writer.WriteString("id", id);
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("role", role);
            writer.WriteString("content", content);
            if (meta is not null) writer.WriteString("meta", meta);
            writer.WriteNumber("createdAt", createdAt);
            writer.WriteNumber("sortOrder", sortOrder);
        })), $"message {id} is inserted");
    }

    private static void AddBatchMessages(string dbPath, string sessionId, string idPrefix, int startIndex, int count, long baseCreatedAt, int baseSortOrder)
    {
        AssertMutationSuccess(DbMessageTools.AddBatch(Params(dbPath, writer =>
        {
            writer.WriteStartArray("messages");
            for (var index = 0; index < count; index++)
            {
                writer.WriteStartObject();
                writer.WriteString("id", $"{idPrefix}-m{startIndex + index}");
                writer.WriteString("sessionId", sessionId);
                writer.WriteString("role", index % 2 == 0 ? "user" : "assistant");
                writer.WriteString("content", $"message {index}");
                writer.WriteNumber("createdAt", baseCreatedAt + index);
                writer.WriteNumber("sortOrder", baseSortOrder + index);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
        })), $"batch of {count} messages is inserted");
    }

    private static void UpsertSnapshot(string dbPath, string sessionId)
    {
        AssertMutationSuccess(DbCompactionSnapshotTools.Upsert(UpsertParams(dbPath, sessionId)),
            $"snapshot is upserted for {sessionId}");
    }

    private static JsonElement ReadSnapshot(string dbPath, string sessionId)
    {
        var result = ResultObject(DbCompactionSnapshotTools.Get(Params(dbPath, writer => writer.WriteString("sessionId", sessionId))));
        Assert(result.GetProperty("success").GetBoolean(), $"snapshot read succeeds for {sessionId}");
        Assert(result.TryGetProperty("snapshot", out var snapshot) && snapshot.ValueKind == JsonValueKind.Object,
            $"snapshot exists for {sessionId}");
        return result.GetProperty("snapshot");
    }

    private static void AssertHasSnapshot(string dbPath, string sessionId, string name)
    {
        var result = ResultObject(DbCompactionSnapshotTools.Get(Params(dbPath, writer => writer.WriteString("sessionId", sessionId))));
        Assert(result.GetProperty("success").GetBoolean(), name);
        Assert(result.TryGetProperty("snapshot", out var snapshot) && snapshot.ValueKind == JsonValueKind.Object, name);
    }

    private static void AssertNoSnapshot(string dbPath, string sessionId, string name)
    {
        var result = ResultObject(DbCompactionSnapshotTools.Get(Params(dbPath, writer => writer.WriteString("sessionId", sessionId))));
        Assert(result.GetProperty("success").GetBoolean(), name);
        Assert(!result.TryGetProperty("snapshot", out var snapshot) || snapshot.ValueKind == JsonValueKind.Null, name);
    }

    private static JsonElement UpsertParams(
        string dbPath,
        string sessionId,
        string trigger = "auto",
        int originalCount = 5,
        int newCount = 2,
        int messagesSummarized = 3,
        bool summarizerFailed = false,
        string? summaryMessage = null,
        string? summaryText = null)
        => Params(dbPath, writer =>
        {
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("trigger", trigger);
            writer.WriteString("wireConversation", "[{\"role\":\"user\",\"content\":\"compressed\"}]");
            writer.WriteString("compactArtifacts", "[{\"id\":\"compact-boundary\"}]");
            writer.WriteNumber("originalCount", originalCount);
            writer.WriteNumber("newCount", newCount);
            writer.WriteNumber("messagesSummarized", messagesSummarized);
            writer.WriteBoolean("summarizerFailed", summarizerFailed);
            if (summaryMessage is not null) writer.WriteString("summaryMessage", summaryMessage);
            if (summaryText is not null) writer.WriteString("summaryText", summaryText);
        });

    private static JsonElement Json(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private sealed class SilentRequestContext : IWorkerRequestContext
    {
        public static SilentRequestContext Instance { get; } = new();
        public CancellationToken CancellationToken => CancellationToken.None;
        public CancellationToken ConnectionCancellationToken => CancellationToken.None;
        public IWorkerRequestContext ForBackgroundOperation() => this;
        public ValueTask EmitEventAsync<T>(string eventName, T parameters, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo)
            => ValueTask.CompletedTask;
        public ValueTask EmitEventIgnoringCancellationAsync<T>(string eventName, T parameters, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo)
            => ValueTask.CompletedTask;
        public ValueTask EmitMessagePackEventAsync(string eventName, ReadOnlyMemory<byte> payload)
            => ValueTask.CompletedTask;
    }

    private static JsonElement Params(string dbPath, Action<Utf8JsonWriter>? writeProperties = null)
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("dbPath", dbPath);
            writeProperties?.Invoke(writer);
            writer.WriteEndObject();
        });

    private static JsonElement ResultObject(WorkerResponse response)
    {
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        return document.RootElement.GetProperty("result").Clone();
    }

    private static List<JsonElement> ResultArray(WorkerResponse response)
    {
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        return document.RootElement.GetProperty("result").EnumerateArray().Select(item => item.Clone()).ToList();
    }

    private static void AssertMutationSuccess(WorkerResponse response, string name)
    {
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        var result = document.RootElement.GetProperty("result");
        if (!result.GetProperty("success").GetBoolean())
            throw new InvalidOperationException($"{name}: {result.GetRawText()}");
        Assert(true, name);
    }

    private static void AssertNullProperty(JsonElement element, string propertyName, string name)
    {
        Assert(!element.TryGetProperty(propertyName, out var value) || value.ValueKind == JsonValueKind.Null, name);
    }

    private static bool IsJsonObjectText(string? text)
    {
        if (string.IsNullOrEmpty(text)) return false;
        try
        {
            using var document = JsonDocument.Parse(text);
            return document.RootElement.ValueKind == JsonValueKind.Object;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static string[] ExpectedSnapshotColumns() =>
    [
        "snapshot_id", "session_id", "version", "trigger", "wire_conversation", "compact_artifacts",
        "summary_message", "summary_text", "through_created_at", "through_sort_order", "original_count",
        "new_count", "messages_summarized", "summarizer_failed", "created_at", "updated_at"
    ];

    private static void SeedLegacyDatabase(string dbPath)
    {
        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL DEFAULT '', working_folder TEXT, " +
            "pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);" +
            "CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'chat', " +
            "created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, message_count INTEGER NOT NULL DEFAULT 0, " +
            "project_id TEXT, pinned INTEGER NOT NULL DEFAULT 0);" +
            "CREATE TABLE messages (id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, role TEXT NOT NULL, " +
            "content TEXT NOT NULL DEFAULT '', meta TEXT, created_at INTEGER NOT NULL);" +
            "CREATE TABLE session_compaction_snapshots (" +
            "session_id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL, \"trigger\" TEXT NOT NULL, " +
            "wire_conversation TEXT NOT NULL, compact_artifacts TEXT NOT NULL, summary_message TEXT, " +
            "summary_text TEXT, through_created_at INTEGER NOT NULL, through_sort_order INTEGER NOT NULL, " +
            "original_count INTEGER NOT NULL, new_count INTEGER NOT NULL, messages_summarized INTEGER NOT NULL, " +
            "summarizer_failed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);" +
            "INSERT INTO sessions (id, title, mode, created_at, updated_at, message_count) " +
            "VALUES ('legacy-session', 'Legacy Session', 'chat', 1000, 1000, 3);" +
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES " +
            "('legacy-orig-1', 'legacy-session', 'user', 'hello', 1001)," +
            "('legacy-orig-2', 'legacy-session', 'assistant', 'hi', 1002)," +
            "('legacy-orig-3', 'legacy-session', 'user', 'next', 1003);" +
            "INSERT INTO session_compaction_snapshots (session_id, version, \"trigger\", wire_conversation, " +
            "compact_artifacts, summary_message, summary_text, through_created_at, through_sort_order, " +
            "original_count, new_count, messages_summarized, summarizer_failed, created_at, updated_at) " +
            "VALUES ('legacy-session', 1, 'legacy', 'legacy-wire', 'legacy-artifacts', NULL, NULL, " +
            "1003, 2, 3, 3, 0, 0, 1004, 1004);";
        command.ExecuteNonQuery();
    }

    private static void RunChild(string mode, string dbPath)
    {
        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Current process path is unavailable");
        var startInfo = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        if (string.Equals(Path.GetFileNameWithoutExtension(executable), "dotnet", StringComparison.OrdinalIgnoreCase))
            startInfo.ArgumentList.Add(Environment.GetCommandLineArgs()[0]);
        startInfo.ArgumentList.Add(mode);
        startInfo.ArgumentList.Add(dbPath);

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException($"Failed to start child mode {mode}");
        var stdout = process.StandardOutput.ReadToEnd();
        var stderr = process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (!string.IsNullOrWhiteSpace(stdout)) Console.Write(stdout);
        if (!string.IsNullOrWhiteSpace(stderr)) Console.Error.Write(stderr);
        AssertEqual(0, process.ExitCode, $"child mode {mode} exits successfully");
    }

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

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path))
                Directory.Delete(path, true);
        }
        catch
        {
            // Best-effort cleanup for temporary regression data.
        }
    }
}

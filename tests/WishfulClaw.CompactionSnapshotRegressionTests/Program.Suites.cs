// 压缩快照回归：schema 建立、legacy 库、新库、校验回退、恢复过滤、覆盖边界漂移。
// 拆分自原单文件 Program.cs（S-252，2026-10-28），方法体逐字平移。
using System.Diagnostics;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Agent;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.TestSupport;

namespace WishfulClaw.CompactionSnapshotRegressionTests;

internal static partial class Program
{
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
        RunColdWorkerCompressionSuite(dbPath, "new");
    }

    // ─── Shared snapshot suite ───

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
        AssertEqual("corrupt_payload", corrupt.GetProperty("reason").GetString(), "corrupt payload reports reason");

        db.Execute(
            "UPDATE session_compaction_snapshots SET wire_conversation = '[{\"role\":\"user\"}]', " +
            "through_created_at = 999999, through_sort_order = 999 WHERE session_id = @sid",
            new SqliteParameter("@sid", sessionId));
        var driftedCursor = ResultObject(DbCompactionSnapshotTools.Get(Params(dbPath, writer => writer.WriteString("sessionId", sessionId))));
        Assert(driftedCursor.GetProperty("success").GetBoolean(), "drifted diagnostic cursor read still succeeds");
        Assert(driftedCursor.TryGetProperty("snapshot", out var driftedSnapshot) &&
               driftedSnapshot.ValueKind == JsonValueKind.Object,
            "a stale through_* tuple no longer blocks restore: the boundary is the snapshot commit time");

        AssertEqual(1L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM session_compaction_snapshots WHERE session_id = @sid",
                new SqliteParameter("@sid", sessionId)),
            "invalid snapshots are retained for diagnostics instead of auto-deleted");

        AssertMutationSuccess(DbCompactionSnapshotTools.Delete(Params(dbPath, writer => writer.WriteString("sessionId", sessionId))),
            "validation session snapshot is cleaned up");
    }

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
        // Post-snapshot rows need timestamps after the snapshot commit wall clock,
        // otherwise the boundary rule treats them as already covered.
        var afterSnapshot = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 1000;
        AddMetaMessage(dbPath, snapSession, $"{prefix}-rs-summary", afterSnapshot, 1, "user",
            "<compaction-summary>post-cursor summary</compaction-summary>",
            @"{""compactSummary"":{""text"":""post-cursor summary""}}");
        AddMetaMessage(dbPath, snapSession, $"{prefix}-rs-boundary", afterSnapshot, 2, "system", "",
            @"{""compactBoundary"":{""trigger"":""auto""}}");
        AddMessage(dbPath, snapSession, $"{prefix}-rs-m1", afterSnapshot + 1, 3);

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

    // ─── Suite: coverage boundary vs transcript-index drift ───

    /// <summary>
    /// Reproduces the 2026-09-04 incident: the renderer persists sort_order as its
    /// in-memory transcript index, so finishing a compression (which inserts the
    /// boundary + summary pair mid-transcript) rewrites the index of rows the snapshot
    /// already covers, and cancelling an empty assistant message deletes one of them.
    /// Neither may lock the session anymore, because the boundary is the snapshot row's
    /// own commit timestamp.
    /// </summary>
    private static void RunCoverageBoundarySuite(string dbPath, string prefix)
    {
        var sessionId = $"{prefix}-boundary";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", sessionId);
            writer.WriteString("title", "Coverage Boundary Session");
        })), "coverage boundary session is created");

        // Three rows written in the same millisecond: the old tuple cursor resolved the
        // anchor as (sharedCreatedAt, 48), which the next transcript re-index would lose.
        var sharedCreatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 60_000;
        AddMessage(dbPath, sessionId, $"{prefix}-bd-a", sharedCreatedAt, 46);
        AddMessage(dbPath, sessionId, $"{prefix}-bd-b", sharedCreatedAt, 47);
        AddMessage(dbPath, sessionId, $"{prefix}-bd-c", sharedCreatedAt, 48);

        UpsertSnapshot(dbPath, sessionId);

        AssertMutationSuccess(DbMessageTools.Upsert(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-bd-c");
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("role", "user");
            writer.WriteString("content", $"message {prefix}-bd-c");
            writer.WriteString("usage", "{\"contextTokens\":120}");
            writer.WriteNumber("createdAt", sharedCreatedAt);
            writer.WriteNumber("sortOrder", 46);
        })), "covered message can be re-saved with a shifted transcript index");

        AssertHasSnapshot(dbPath, sessionId, "a shifted transcript index keeps the snapshot readable");

        var drifted = SessionRestoreTools.RestoreFromDb(DbClient.GetClient(), sessionId);
        Assert(drifted.Failure is null, "drift never blocks the restore path");
        Assert(drifted.FromSnapshot, "drifted session still restores from the snapshot");
        AssertEqual(1, drifted.WireMessages.Count, "covered rows stay in the snapshot prefix");
        Assert(!drifted.WireMessages.Any(message =>
                message.TryGetProperty("id", out var id) &&
                id.GetString() is { } value &&
                value.StartsWith($"{prefix}-bd-", StringComparison.Ordinal)),
            "covered history does not flow back into the model context");

        AssertMutationSuccess(DbMessageTools.Delete(Params(dbPath, writer =>
        {
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("messageId", $"{prefix}-bd-a");
        })), "covered message can be deleted (cancelled empty assistant row)");
        AssertHasSnapshot(dbPath, sessionId, "deleting a covered row keeps the snapshot readable");

        // Post-commit rows are the increment: each must appear exactly once, in order.
        var tailCreatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 1000;
        AddMessage(dbPath, sessionId, $"{prefix}-bd-tail-1", tailCreatedAt, 49);
        AddMessage(dbPath, sessionId, $"{prefix}-bd-tail-2", tailCreatedAt, 50);
        var withTail = SessionRestoreTools.RestoreFromDb(DbClient.GetClient(), sessionId);
        Assert(withTail.Failure is null, "restart after compression restores without blocking");
        Assert(withTail.FromSnapshot, "restart after compression keeps the snapshot as the prefix");
        AssertEqual(3, withTail.WireMessages.Count, "snapshot prefix plus the post-commit increment is restored");
        AssertEqual($"{prefix}-bd-tail-1",
            withTail.WireMessages[1].GetProperty("id").GetString(),
            "same-millisecond increment keeps transcript order via sort_order");
        AssertEqual($"{prefix}-bd-tail-2",
            withTail.WireMessages[2].GetProperty("id").GetString(),
            "same-millisecond increment restores the later row second");

        // The commit time is clamped strictly above the newest covered message, so a turn
        // written in the same millisecond can never fall silently into the covered range.
        var skewedSession = $"{prefix}-boundary-skew";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", skewedSession);
            writer.WriteString("title", "Coverage Boundary Skew Session");
        })), "coverage boundary skew session is created");
        var skewedCreatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 5000;
        AddMessage(dbPath, skewedSession, $"{prefix}-bd-skew", skewedCreatedAt, 0);
        UpsertSnapshot(dbPath, skewedSession);
        var skewSnapshot = ReadSnapshot(dbPath, skewedSession);
        Assert(skewSnapshot.GetProperty("createdAt").GetInt64() > skewedCreatedAt,
            "snapshot commit time stays strictly above the newest covered message");
        var skewRestore = SessionRestoreTools.RestoreFromDb(DbClient.GetClient(), skewedSession);
        AssertEqual(1, skewRestore.WireMessages.Count,
            "the covered same-clock row is summarized once instead of being lost or duplicated");
    }
}

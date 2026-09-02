using Microsoft.Data.Sqlite;
using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Internal compaction snapshot helpers shared by destructive message/session mutations.
/// Contract: snapshot deletion must happen in the same DB transaction as the destructive
/// message mutation (docs/plans/iter-v2-23/snapshot-contract.md §7 / §10).
/// </summary>
public static class DbCompactionSnapshotStore
{
    /// <summary>Snapshot format version this build writes and reads.</summary>
    public const int SupportedVersion = 1;

    /// <summary>Message position in the canonical (created_at, sort_order) order.</summary>
    public sealed record MessagePosition(long CreatedAt, int SortOrder);

    /// <summary>Snapshot coverage cursor — the last persisted message included in the snapshot.</summary>
    public sealed record SnapshotCursor(long ThroughCreatedAt, int ThroughSortOrder);

    /// <summary>True when the position falls inside the snapshot coverage (position &lt;= cursor).</summary>
    public static bool PositionIsCovered(SnapshotCursor cursor, long createdAt, int sortOrder)
    {
        return createdAt < cursor.ThroughCreatedAt ||
               (createdAt == cursor.ThroughCreatedAt && sortOrder <= cursor.ThroughSortOrder);
    }

    /// <summary>Read the snapshot coverage cursor for a session; null when no snapshot exists.</summary>
    public static SnapshotCursor? GetCursor(DbService db, SqliteConnection conn, SqliteTransaction tx, string sessionId)
    {
        return db.QueryFirstOrDefault(
            conn, tx,
            "SELECT snapshot.through_created_at, snapshot.through_sort_order " +
            "FROM sessions session " +
            "JOIN session_compaction_snapshots snapshot ON snapshot.snapshot_id = session.current_snapshot_id " +
            "WHERE session.id = @sid",
            r => new SnapshotCursor(r.GetInt64("through_created_at"), r.GetInt32("through_sort_order")),
            new SqliteParameter("@sid", sessionId));
    }

    /// <summary>Delete the session snapshot (inside an open transaction).</summary>
    public static void DeleteForSession(DbService db, SqliteConnection conn, SqliteTransaction tx, string sessionId)
    {
        db.Execute(conn, tx,
            "DELETE FROM session_compaction_snapshots WHERE session_id = @sid",
            new SqliteParameter("@sid", sessionId));
        db.Execute(conn, tx,
            "UPDATE sessions SET current_snapshot_id = NULL WHERE id = @sid",
            new SqliteParameter("@sid", sessionId));
    }

    /// <summary>Delete snapshots for a set of sessions (inside an open transaction).</summary>
    public static void DeleteForSessions(DbService db, SqliteConnection conn, SqliteTransaction tx, IReadOnlyList<string> sessionIds)
    {
        if (sessionIds.Count == 0) return;
        var placeholders = string.Join(",", sessionIds.Select((_, i) => $"@cs{i}"));
        var sqlParams = sessionIds.Select((sid, i) => new SqliteParameter($"@cs{i}", sid)).ToArray();
        db.Execute(conn, tx, $"DELETE FROM session_compaction_snapshots WHERE session_id IN ({placeholders})", sqlParams);
        db.Execute(
            conn,
            tx,
            $"UPDATE sessions SET current_snapshot_id = NULL WHERE id IN ({placeholders})",
            sessionIds.Select((sid, i) => new SqliteParameter($"@cs{i}", sid)).ToArray());
    }

    /// <summary>
    /// Conditional invalidation: drop the snapshot when the removed/modified position lies
    /// inside its coverage. Positions after the cursor keep the snapshot valid.
    /// </summary>
    public static void InvalidateIfCovered(DbService db, SqliteConnection conn, SqliteTransaction tx, string sessionId, MessagePosition? position)
    {
        if (position is null) return;
        var cursor = GetCursor(db, conn, tx, sessionId);
        if (cursor is null) return;
        if (PositionIsCovered(cursor, position.CreatedAt, position.SortOrder))
        {
            DeleteForSession(db, conn, tx, sessionId);
        }
    }

    /// <summary>
    /// Conditional invalidation for mutations that cannot localize the change (e.g. content
    /// compaction of historical messages): drop the snapshot when any message at or before
    /// the given position is covered.
    /// </summary>
    public static void InvalidateForCoveredPosition(DbService db, string sessionId, MessagePosition? position)
    {
        if (position is null) return;
        db.ExecuteInTransaction((conn, tx) =>
        {
            InvalidateIfCovered(db, conn, tx, sessionId, position);
        });
    }

    /// <summary>
    /// Drop the snapshot when a message upsert rewrote a covered position (content/order change).
    /// Fresh inserts (no pre-existing row) append after the cursor and never invalidate.
    /// </summary>
    public static void InvalidateIfUpsertCovered(DbService db, string sessionId, MessagePosition? existingPosition)
    {
        if (existingPosition is null) return;
        db.ExecuteInTransaction((conn, tx) =>
        {
            InvalidateIfCovered(db, conn, tx, sessionId, existingPosition);
        });
    }

    /// <summary>
    /// Insert a new immutable snapshot revision and move the session pointer to it.
    /// Strict revision conflict handling is added by the context-manifest execution step;
    /// this compatibility writer keeps the new schema runnable while preserving old rows.
    /// </summary>
    public static void UpsertSnapshot(
        DbService db,
        string sessionId,
        int version,
        string trigger,
        string wireConversationJson,
        string compactArtifactsJson,
        string? summaryMessageJson,
        string? summaryText,
        int originalCount,
        int newCount,
        int messagesSummarized,
        bool summarizerFailed)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var snapshotId = Guid.NewGuid().ToString("N");
        db.ExecuteInTransaction((conn, tx) =>
        {
            var boundary = GetMaxMessagePosition(db, conn, tx, sessionId)
                ?? throw new InvalidOperationException("Cannot snapshot a session without persisted messages");

            db.Execute(conn, tx,
                "INSERT INTO session_compaction_snapshots (snapshot_id, session_id, version, \"trigger\", wire_conversation, " +
                "compact_artifacts, summary_message, summary_text, through_created_at, through_sort_order, " +
                "original_count, new_count, messages_summarized, summarizer_failed, created_at, updated_at) " +
                "VALUES (@snapshotId, @sid, @version, @trigger, @wire, @artifacts, @summaryMessage, @summaryText, " +
                "@tca, @tso, @originalCount, @newCount, @messagesSummarized, @summarizerFailed, @ca, @ua)",
                new SqliteParameter("@snapshotId", snapshotId),
                new SqliteParameter("@sid", sessionId),
                new SqliteParameter("@version", version),
                new SqliteParameter("@trigger", trigger),
                new SqliteParameter("@wire", wireConversationJson),
                new SqliteParameter("@artifacts", compactArtifactsJson),
                new SqliteParameter("@summaryMessage", (object?)summaryMessageJson ?? DBNull.Value),
                new SqliteParameter("@summaryText", (object?)summaryText ?? DBNull.Value),
                new SqliteParameter("@tca", boundary.CreatedAt),
                new SqliteParameter("@tso", boundary.SortOrder),
                new SqliteParameter("@originalCount", originalCount),
                new SqliteParameter("@newCount", newCount),
                new SqliteParameter("@messagesSummarized", messagesSummarized),
                new SqliteParameter("@summarizerFailed", summarizerFailed ? 1 : 0),
                new SqliteParameter("@ca", now),
                new SqliteParameter("@ua", now));

            var pointerChanged = db.Execute(
                conn,
                tx,
                "UPDATE sessions SET current_snapshot_id = @snapshotId WHERE id = @sid",
                new SqliteParameter("@snapshotId", snapshotId),
                new SqliteParameter("@sid", sessionId));
            if (pointerChanged != 1)
            {
                throw new InvalidOperationException($"Session not found while committing snapshot: {sessionId}");
            }
        });
    }

    /// <summary>Query the newest message position of a session; null when the session has no messages.</summary>
    public static MessagePosition? GetMaxMessagePosition(DbService db, SqliteConnection conn, SqliteTransaction tx, string sessionId)
    {
        return db.QueryFirstOrDefault(
            conn, tx,
            "SELECT created_at, sort_order FROM messages WHERE session_id = @sid " +
            "ORDER BY created_at DESC, sort_order DESC LIMIT 1",
            r => new MessagePosition(r.GetInt64("created_at"), r.GetInt32("sort_order")),
            new SqliteParameter("@sid", sessionId));
    }

    /// <summary>
    /// True when the message meta marks a chat-window display artifact (compression
    /// status card / compact boundary divider). These rows never enter the model
    /// context, so meta-only lifecycle updates (e.g. compressing → compressed) must
    /// not invalidate the snapshot (snapshot-contract.md §7.4).
    /// </summary>
    public static bool IsChatOnlyArtifactMeta(string? metaJson)
    {
        if (string.IsNullOrEmpty(metaJson)) return false;
        try
        {
            using var doc = JsonDocument.Parse(metaJson);
            var meta = doc.RootElement;
            return meta.ValueKind == JsonValueKind.Object &&
                   (meta.TryGetProperty("compressionStatus", out _) ||
                    meta.TryGetProperty("compactBoundary", out _));
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Log a snapshot problem without leaking summary content or sensitive parameters.
    /// </summary>
    public static void LogSnapshotIssue(string stage, string sessionId, string reason)
    {
        WorkerLog.Warn($"CompactionSnapshot: {stage} sessionId={sessionId} reason={reason}");
    }
}

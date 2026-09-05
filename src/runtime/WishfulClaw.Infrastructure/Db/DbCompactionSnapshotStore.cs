using Microsoft.Data.Sqlite;
using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Internal compaction snapshot helpers shared by session-level context operations.
/// Contract: a committed snapshot is an immutable baseline. Ordinary message mutations
/// never invalidate it — the restore boundary is the snapshot row's own commit timestamp,
/// which no later code path rewrites. Only explicit context-root operations (reset, clear,
/// rebuild) detach the pointer, and pointer detachment must share the transaction with the
/// mutation that triggered it. Physical deletion of snapshot rows stays behind the explicit
/// cleanup endpoint (docs/plans/iter-v2-24/plan-context-manifest/plan.md §5).
/// </summary>
public static class DbCompactionSnapshotStore
{
    /// <summary>Snapshot format version this build writes and reads.</summary>
    public const int SupportedVersion = 1;

    /// <summary>Message position in the canonical (created_at, sort_order) order.</summary>
    public sealed record MessagePosition(long CreatedAt, int SortOrder);

    /// <summary>Detach the current snapshot pointer while retaining immutable snapshot history.</summary>
    public static void DetachForSession(DbService db, SqliteConnection conn, SqliteTransaction tx, string sessionId)
    {
        db.Execute(conn, tx,
            "UPDATE sessions SET current_snapshot_id = NULL, context_revision = context_revision + 1 WHERE id = @sid",
            new SqliteParameter("@sid", sessionId));
    }

    /// <summary>Detach current snapshot pointers for a set of sessions (inside an open transaction).</summary>
    public static void DetachForSessions(DbService db, SqliteConnection conn, SqliteTransaction tx, IReadOnlyList<string> sessionIds)
    {
        if (sessionIds.Count == 0) return;
        var placeholders = string.Join(",", sessionIds.Select((_, i) => $"@cs{i}"));
        db.Execute(
            conn,
            tx,
            $"UPDATE sessions SET current_snapshot_id = NULL, context_revision = context_revision + 1 WHERE id IN ({placeholders})",
            sessionIds.Select((sid, i) => new SqliteParameter($"@cs{i}", sid)).ToArray());
    }

    /// <summary>Delete all snapshots for a session and detach its current pointer.</summary>
    public static void DeleteForSession(DbService db, SqliteConnection conn, SqliteTransaction tx, string sessionId)
    {
        db.Execute(conn, tx,
            "DELETE FROM session_compaction_snapshots WHERE session_id = @sid",
            new SqliteParameter("@sid", sessionId));
        DetachForSession(db, conn, tx, sessionId);
    }

    /// <summary>Delete all snapshots for a set of sessions and detach their current pointers.</summary>
    public static void DeleteForSessions(DbService db, SqliteConnection conn, SqliteTransaction tx, IReadOnlyList<string> sessionIds)
    {
        if (sessionIds.Count == 0) return;
        var placeholders = string.Join(",", sessionIds.Select((_, i) => $"@cs{i}"));
        var sqlParams = sessionIds.Select((sid, i) => new SqliteParameter($"@cs{i}", sid)).ToArray();
        db.Execute(conn, tx, $"DELETE FROM session_compaction_snapshots WHERE session_id IN ({placeholders})", sqlParams);
        DetachForSessions(db, conn, tx, sessionIds);
    }

    public const string CommitConflictError = "snapshot_commit_conflict";
    public const string SessionNotFoundError = "session_not_found";
    public const string InvalidPayloadError = "invalid_snapshot_payload";
    public const string NoMessagesError = "no_persisted_messages";

    public sealed record SnapshotCommitResult(
        bool Success,
        string? SnapshotId,
        long? ContextRevision,
        string? Error);

    private sealed record SessionRevisionRow(long ContextRevision);

    /// <summary>Read the current context revision before a long-running compression pass.</summary>
    public static long? GetContextRevision(DbService db, string sessionId)
    {
        var row = db.QueryFirstOrDefault(
            "SELECT context_revision FROM sessions WHERE id = @sid",
            r => new SessionRevisionRow(r.GetInt64("context_revision")),
            new SqliteParameter("@sid", sessionId));
        return row?.ContextRevision;
    }

    /// <summary>
    /// Insert an immutable snapshot and conditionally advance the session pointer.
    /// When <paramref name="expectedRevision"/> is supplied, a stale compression result
    /// fails with <see cref="CommitConflictError"/> and the transaction rolls back.
    /// </summary>
    public static SnapshotCommitResult CommitSnapshot(
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
        bool summarizerFailed,
        long? expectedRevision = null)
    {
        try
        {
            return db.ExecuteInTransaction((conn, tx) =>
            {
                var session = db.QueryFirstOrDefault(
                    conn,
                    tx,
                    "SELECT context_revision FROM sessions WHERE id = @sid",
                    r => new SessionRevisionRow(r.GetInt64("context_revision")),
                    new SqliteParameter("@sid", sessionId));
                if (session is null)
                {
                    return new SnapshotCommitResult(false, null, null, SessionNotFoundError);
                }

                if (expectedRevision.HasValue && session.ContextRevision != expectedRevision.Value)
                {
                    return new SnapshotCommitResult(false, null, session.ContextRevision, CommitConflictError);
                }

                if (version != SupportedVersion ||
                    !IsJsonArray(wireConversationJson) ||
                    !IsJsonArray(compactArtifactsJson) ||
                    (summaryMessageJson is not null && !IsJsonObject(summaryMessageJson)))
                {
                    return new SnapshotCommitResult(false, null, session.ContextRevision, InvalidPayloadError);
                }

                var boundary = GetMaxMessagePosition(db, conn, tx, sessionId);
                if (boundary is null)
                {
                    return new SnapshotCommitResult(false, null, session.ContextRevision, NoMessagesError);
                }

                // The snapshot row's created_at IS the restore boundary: messages created after
                // it are recovered as the increment. Clamp it strictly above the newest covered
                // message, otherwise a turn committed in the same millisecond would be excluded
                // by the "created_at >" predicate and silently dropped from the model context.
                var commitTime = Math.Max(
                    DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    boundary.CreatedAt + 1);
                var snapshotId = Guid.NewGuid().ToString("N");
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
                    new SqliteParameter("@ca", commitTime),
                    new SqliteParameter("@ua", commitTime));

                var inserted = db.QueryFirstOrDefault(
                    conn,
                    tx,
                    "SELECT * FROM session_compaction_snapshots WHERE snapshot_id = @snapshotId",
                    EntityMappers.MapCompactionSnapshot,
                    new SqliteParameter("@snapshotId", snapshotId));
                if (inserted is null ||
                    !string.Equals(inserted.SessionId, sessionId, StringComparison.Ordinal) ||
                    inserted.Version != version ||
                    inserted.ThroughCreatedAt != boundary.CreatedAt ||
                    inserted.ThroughSortOrder != boundary.SortOrder ||
                    !IsJsonArray(inserted.WireConversation) ||
                    !IsJsonArray(inserted.CompactArtifacts) ||
                    (inserted.SummaryMessage is not null && !IsJsonObject(inserted.SummaryMessage)))
                {
                    throw new SnapshotCommitException(
                        new SnapshotCommitResult(false, null, session.ContextRevision, InvalidPayloadError));
                }

                var pointerChanged = db.Execute(
                    conn,
                    tx,
                    "UPDATE sessions SET current_snapshot_id = @snapshotId, " +
                    "context_revision = context_revision + 1 " +
                    "WHERE id = @sid AND context_revision = @expectedRevision",
                    new SqliteParameter("@snapshotId", snapshotId),
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@expectedRevision", session.ContextRevision));
                if (pointerChanged != 1)
                {
                    throw new SnapshotCommitException(
                        new SnapshotCommitResult(false, null, session.ContextRevision, CommitConflictError));
                }

                return new SnapshotCommitResult(
                    true,
                    snapshotId,
                    session.ContextRevision + 1,
                    null);
            });
        }
        catch (SnapshotCommitException ex)
        {
            return ex.Result;
        }
        catch (Exception ex)
        {
            LogSnapshotIssue("commit", sessionId, $"{ex.GetType().Name}: {ex.Message}");
            return new SnapshotCommitResult(false, null, null, "snapshot_commit_failed");
        }
    }

    private sealed class SnapshotCommitException : Exception
    {
        public SnapshotCommitResult Result { get; }

        public SnapshotCommitException(SnapshotCommitResult result)
        {
            Result = result;
        }
    }

    private static bool IsJsonArray(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.ValueKind == JsonValueKind.Array;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool IsJsonObject(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.ValueKind == JsonValueKind.Object;
        }
        catch (JsonException)
        {
            return false;
        }
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
    /// Log a snapshot problem without leaking summary content or sensitive parameters.
    /// </summary>
    public static void LogSnapshotIssue(string stage, string sessionId, string reason)
    {
        WorkerLog.Warn($"CompactionSnapshot: {stage} sessionId={sessionId} reason={reason}");
    }
}

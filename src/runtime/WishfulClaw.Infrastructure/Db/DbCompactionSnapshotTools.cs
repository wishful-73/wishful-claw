using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Worker endpoints for session compaction snapshots
/// (docs/plans/iter-v2-23/snapshot-contract.md).
/// Each session keeps a single latest snapshot; the coverage cursor is derived from the
/// persisted messages inside the write transaction, never from in-memory Worker state.
/// </summary>
public static class DbCompactionSnapshotTools
{
    /// <summary>Read reason: unsupported snapshot format version.</summary>
    public const string ReasonUnsupportedVersion = "unsupported_version";

    /// <summary>Read reason: snapshot JSON payload is corrupt or structurally invalid.</summary>
    public const string ReasonCorrupt = "corrupt";

    /// <summary>Read reason: coverage cursor no longer matches persisted messages.</summary>
    public const string ReasonInvalidCursor = "invalid_cursor";

    /// <summary>
    /// Read the session snapshot with safety validation. Any problem (unsupported version,
    /// corrupt JSON, dangling cursor) downgrades to <c>Snapshot = null</c> plus a reason so
    /// the restore path falls back to full message recovery; corrupt rows are kept for
    /// diagnostics and never auto-deleted. Read failures never block opening a session.
    /// </summary>
    public static WorkerResponse Get(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var entity = db.QueryFirstOrDefault(
                "SELECT * FROM session_compaction_snapshots WHERE session_id = @sid",
                EntityMappers.MapCompactionSnapshot,
                new SqliteParameter("@sid", sessionId));
            if (entity is null)
            {
                return Result(null, null);
            }

            if (entity.Version != DbCompactionSnapshotStore.SupportedVersion)
            {
                DbCompactionSnapshotStore.LogSnapshotIssue("get", sessionId, $"{ReasonUnsupportedVersion} version={entity.Version}");
                return Result(null, ReasonUnsupportedVersion);
            }

            if (!IsPayloadWellFormed(entity))
            {
                DbCompactionSnapshotStore.LogSnapshotIssue("get", sessionId, ReasonCorrupt);
                return Result(null, ReasonCorrupt);
            }

            if (!IsCursorConsistent(db, sessionId, entity))
            {
                DbCompactionSnapshotStore.LogSnapshotIssue("get", sessionId, ReasonInvalidCursor);
                return Result(null, ReasonInvalidCursor);
            }

            return Result(CompactionSnapshotRow.FromEntity(entity), null);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(
                new CompactionSnapshotGetResult(false, null, null, ex.Message),
                InfrastructureJsonContext.Default.CompactionSnapshotGetResult);
        }
    }

    /// <summary>
    /// Structural payload check: wire conversation and compact artifacts must be JSON arrays;
    /// the optional summary message must be a JSON object when present.
    /// </summary>
    private static bool IsPayloadWellFormed(CompactionSnapshotEntity entity)
    {
        if (!IsJsonArray(entity.WireConversation)) return false;
        if (!IsJsonArray(entity.CompactArtifacts)) return false;
        if (entity.SummaryMessage is not null && !IsJsonObject(entity.SummaryMessage)) return false;
        return true;
    }

    /// <summary>
    /// Cursor consistency: the anchor message at the cursor position must still exist, and the
    /// session's newest persisted message must not predate the cursor (deleted/truncated
    /// history makes the snapshot unsafe to reuse).
    /// </summary>
    private static bool IsCursorConsistent(DbService db, string sessionId, CompactionSnapshotEntity entity)
    {
        var anchorExists = db.Exists(
            "SELECT 1 FROM messages WHERE session_id = @sid AND created_at = @ca AND sort_order = @so LIMIT 1",
            new SqliteParameter("@sid", sessionId),
            new SqliteParameter("@ca", entity.ThroughCreatedAt),
            new SqliteParameter("@so", entity.ThroughSortOrder));
        if (!anchorExists) return false;

        var newest = db.QueryFirstOrDefault(
            "SELECT created_at, sort_order FROM messages WHERE session_id = @sid " +
            "ORDER BY created_at DESC, sort_order DESC LIMIT 1",
            r => new DbCompactionSnapshotStore.MessagePosition(r.GetInt64("created_at"), r.GetInt32("sort_order")),
            new SqliteParameter("@sid", sessionId));
        if (newest is null) return false;

        return newest.CreatedAt > entity.ThroughCreatedAt ||
               (newest.CreatedAt == entity.ThroughCreatedAt && newest.SortOrder >= entity.ThroughSortOrder);
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

    private static WorkerResponse Result(CompactionSnapshotRow? snapshot, string? reason)
    {
        return WorkerResponse.Json(
            new CompactionSnapshotGetResult(true, snapshot, reason, null),
            InfrastructureJsonContext.Default.CompactionSnapshotGetResult);
    }

    /// <summary>
    /// Atomically replace the session snapshot. The coverage cursor is computed from the
    /// newest persisted message inside the same transaction as the upsert; a session without
    /// messages cannot hold a snapshot. The previous row is replaced, never deleted first.
    /// </summary>
    public static WorkerResponse Upsert(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            var version = JsonHelpers.GetInt(parameters, "version", DbCompactionSnapshotStore.SupportedVersion);
            var trigger = RequireString(parameters, "trigger");
            var wireConversation = RequireString(parameters, "wireConversation");
            var compactArtifacts = RequireString(parameters, "compactArtifacts");
            var summaryMessage = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "summaryMessage"));
            var summaryText = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "summaryText"));
            var originalCount = JsonHelpers.GetInt(parameters, "originalCount", 0);
            var newCount = JsonHelpers.GetInt(parameters, "newCount", 0);
            var messagesSummarized = JsonHelpers.GetInt(parameters, "messagesSummarized", 0);
            var summarizerFailed = JsonHelpers.GetBool(parameters, "summarizerFailed", false);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var createdAt = JsonHelpers.GetLong(parameters, "createdAt", now);
            var updatedAt = JsonHelpers.GetLong(parameters, "updatedAt", now);

            db.ExecuteInTransaction((conn, tx) =>
            {
                var boundary = DbCompactionSnapshotStore.GetMaxMessagePosition(db, conn, tx, sessionId)
                    ?? throw new InvalidOperationException("Cannot snapshot a session without persisted messages");

                db.Execute(conn, tx,
                    "INSERT INTO session_compaction_snapshots (session_id, version, \"trigger\", wire_conversation, " +
                    "compact_artifacts, summary_message, summary_text, through_created_at, through_sort_order, " +
                    "original_count, new_count, messages_summarized, summarizer_failed, created_at, updated_at) " +
                    "VALUES (@sid, @version, @trigger, @wire, @artifacts, @summaryMessage, @summaryText, " +
                    "@tca, @tso, @originalCount, @newCount, @messagesSummarized, @summarizerFailed, @ca, @ua) " +
                    "ON CONFLICT(session_id) DO UPDATE SET " +
                    "version = @version, \"trigger\" = @trigger, wire_conversation = @wire, " +
                    "compact_artifacts = @artifacts, summary_message = @summaryMessage, summary_text = @summaryText, " +
                    "through_created_at = @tca, through_sort_order = @tso, " +
                    "original_count = @originalCount, new_count = @newCount, " +
                    "messages_summarized = @messagesSummarized, summarizer_failed = @summarizerFailed, " +
                    "updated_at = @ua",
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@version", version),
                    new SqliteParameter("@trigger", trigger),
                    new SqliteParameter("@wire", wireConversation),
                    new SqliteParameter("@artifacts", compactArtifacts),
                    new SqliteParameter("@summaryMessage", (object?)summaryMessage ?? DBNull.Value),
                    new SqliteParameter("@summaryText", (object?)summaryText ?? DBNull.Value),
                    new SqliteParameter("@tca", boundary.CreatedAt),
                    new SqliteParameter("@tso", boundary.SortOrder),
                    new SqliteParameter("@originalCount", originalCount),
                    new SqliteParameter("@newCount", newCount),
                    new SqliteParameter("@messagesSummarized", messagesSummarized),
                    new SqliteParameter("@summarizerFailed", summarizerFailed ? 1 : 0),
                    new SqliteParameter("@ca", createdAt),
                    new SqliteParameter("@ua", updatedAt));
            });

            return Mutation(1);
        }
        catch (Exception ex)
        {
            return MutationError(ex.Message);
        }
    }

    public static WorkerResponse Delete(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var deleted = db.Execute(
                "DELETE FROM session_compaction_snapshots WHERE session_id = @sid",
                new SqliteParameter("@sid", sessionId)) > 0;
            return WorkerResponse.Json(
                new CompactionSnapshotDeleteResult(true, deleted, null),
                InfrastructureJsonContext.Default.CompactionSnapshotDeleteResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(
                new CompactionSnapshotDeleteResult(false, false, ex.Message),
                InfrastructureJsonContext.Default.CompactionSnapshotDeleteResult);
        }
    }

    private static string RequireString(JsonElement parameters, string name)
    {
        return JsonHelpers.GetString(parameters, name) is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException($"Missing required field: {name}");
    }

    private static WorkerResponse Mutation(int changed)
    {
        return WorkerResponse.Json(new CompactionSnapshotMutationResult(true, changed, null), InfrastructureJsonContext.Default.CompactionSnapshotMutationResult);
    }

    private static WorkerResponse MutationError(string error)
    {
        return WorkerResponse.Json(new CompactionSnapshotMutationResult(false, 0, error), InfrastructureJsonContext.Default.CompactionSnapshotMutationResult);
    }
}

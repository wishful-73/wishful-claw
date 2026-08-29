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

            var entity = TryGetValidSnapshot(db, sessionId, out var reason);
            if (entity is null)
            {
                return Result(null, reason);
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
    /// Shared validated read used by the endpoint and the agent restore path
    /// (snapshot-contract.md §六): version check, payload well-formedness and cursor
    /// consistency. Returns null plus a downgrade reason on any problem; problems are
    /// logged and never thrown — callers fall back to full message recovery.
    /// </summary>
    public static CompactionSnapshotEntity? TryGetValidSnapshot(DbService db, string sessionId, out string? reason)
    {
        reason = null;
        var entity = db.QueryFirstOrDefault(
            "SELECT * FROM session_compaction_snapshots WHERE session_id = @sid",
            EntityMappers.MapCompactionSnapshot,
            new SqliteParameter("@sid", sessionId));
        if (entity is null)
        {
            return null;
        }

        if (entity.Version != DbCompactionSnapshotStore.SupportedVersion)
        {
            DbCompactionSnapshotStore.LogSnapshotIssue("get", sessionId, $"{ReasonUnsupportedVersion} version={entity.Version}");
            reason = ReasonUnsupportedVersion;
            return null;
        }

        if (!IsPayloadWellFormed(entity))
        {
            DbCompactionSnapshotStore.LogSnapshotIssue("get", sessionId, ReasonCorrupt);
            reason = ReasonCorrupt;
            return null;
        }

        if (!IsCursorConsistent(db, sessionId, entity))
        {
            DbCompactionSnapshotStore.LogSnapshotIssue("get", sessionId, ReasonInvalidCursor);
            reason = ReasonInvalidCursor;
            return null;
        }

        return entity;
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
    /// Atomically replace the session snapshot. Delegates to the shared writer
    /// (<see cref="DbCompactionSnapshotStore.UpsertSnapshot"/>), which derives the
    /// coverage cursor from the newest persisted message inside the same transaction.
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

            DbCompactionSnapshotStore.UpsertSnapshot(
                db, sessionId, version, trigger,
                wireConversation, compactArtifacts,
                summaryMessage, summaryText,
                originalCount, newCount, messagesSummarized, summarizerFailed);

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

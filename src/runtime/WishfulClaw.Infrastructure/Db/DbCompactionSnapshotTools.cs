using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Worker endpoints for session compaction snapshots
/// (docs/plans/iter-v2-23/snapshot-contract.md).
/// Each session points to one current immutable snapshot revision. The restore increment is
/// every message created after the snapshot row's commit timestamp; through_created_at and
/// through_sort_order are still persisted but act only as diagnostics for the covered boundary.
/// </summary>
public static class DbCompactionSnapshotTools
{
    /// <summary>Read reason: the session points to a missing snapshot row.</summary>
    public const string ReasonSnapshotNotFound = "snapshot_not_found";

    /// <summary>Read reason: snapshot format version is not supported.</summary>
    public const string ReasonUnsupportedVersion = "unsupported_version";

    /// <summary>Read reason: snapshot JSON payload is corrupt or structurally invalid.</summary>
    public const string ReasonCorrupt = "corrupt_payload";

    /// <summary>Read reason: snapshot belongs to a different session.</summary>
    public const string ReasonSessionMismatch = "session_mismatch";

    /// <summary>
    /// Read the session's pointed snapshot with safety validation. Any problem (unsupported
    /// version, corrupt JSON) returns <c>Snapshot = null</c> plus a reason;
    /// the restore layer decides whether the pointed session must be blocked. Corrupt rows
    /// are kept for diagnostics and never auto-deleted.
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
    /// (snapshot-contract.md §六): version check and payload well-formedness.
    /// The coverage boundary is the snapshot row's own commit timestamp, which no
    /// later code path rewrites, so ordinary message writes can never invalidate it.
    /// Returns null plus a downgrade reason on real corruption; problems are
    /// logged and never thrown — callers decide whether to block.
    /// </summary>
    public static CompactionSnapshotEntity? TryGetValidSnapshot(DbService db, string sessionId, out string? reason)
    {
        return TryGetValidSnapshot(db, sessionId, out reason, out _, out _);
    }

    public static CompactionSnapshotEntity? TryGetValidSnapshot(
        DbService db,
        string sessionId,
        out string? reason,
        out string? currentSnapshotId,
        out long contextRevision)
    {
        reason = null;
        currentSnapshotId = null;
        contextRevision = 0;
        var session = db.QueryFirstOrDefault(
            "SELECT id, current_snapshot_id, context_revision FROM sessions WHERE id = @sid",
            r => new SessionSnapshotPointer(
                r.GetString("id"),
                r.GetNullableString("current_snapshot_id"),
                r.GetInt64("context_revision")),
            new SqliteParameter("@sid", sessionId));
        if (session is null)
        {
            return null;
        }

        currentSnapshotId = session.CurrentSnapshotId;
        contextRevision = session.ContextRevision;
        if (string.IsNullOrWhiteSpace(currentSnapshotId))
        {
            return null;
        }

        var entity = db.QueryFirstOrDefault(
            "SELECT * FROM session_compaction_snapshots WHERE snapshot_id = @snapshotId",
            EntityMappers.MapCompactionSnapshot,
            new SqliteParameter("@snapshotId", currentSnapshotId));
        if (entity is null)
        {
            DbCompactionSnapshotStore.LogSnapshotIssue("get", sessionId, $"{ReasonSnapshotNotFound} snapshotId={currentSnapshotId}");
            reason = ReasonSnapshotNotFound;
            return null;
        }

        if (!string.Equals(entity.SessionId, sessionId, StringComparison.Ordinal))
        {
            DbCompactionSnapshotStore.LogSnapshotIssue("get", sessionId, $"{ReasonSessionMismatch} snapshotId={entity.SnapshotId}");
            reason = ReasonSessionMismatch;
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
            DbCompactionSnapshotStore.LogSnapshotIssue("get", sessionId, $"{ReasonCorrupt} snapshotId={entity.SnapshotId}");
            reason = ReasonCorrupt;
            return null;
        }

        return entity;
    }

    private sealed record SessionSnapshotPointer(string Id, string? CurrentSnapshotId, long ContextRevision);

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
    /// Commit a new immutable session snapshot through the shared writer, which derives
    /// the coverage cursor from the newest persisted message inside the same transaction.
    /// </summary>
    public static WorkerResponse Upsert(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            var version = JsonHelpers.GetInt(parameters, "version", DbCompactionSnapshotStore.SupportedVersion);
            var expectedRevision = parameters.TryGetProperty("expectedRevision", out var revisionElement) &&
                revisionElement.ValueKind == JsonValueKind.Number &&
                revisionElement.TryGetInt64(out var parsedRevision)
                ? parsedRevision
                : (long?)null;
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

            var commit = DbCompactionSnapshotStore.CommitSnapshot(
                db, sessionId, version, trigger,
                wireConversation, compactArtifacts,
                summaryMessage, summaryText,
                originalCount, newCount, messagesSummarized, summarizerFailed,
                expectedRevision);

            return commit.Success
                ? Mutation(1, commit.SnapshotId, commit.ContextRevision)
                : MutationError(commit.Error ?? "snapshot_commit_failed", commit.ContextRevision);
        }
        catch (Exception ex)
        {
            return MutationError(ex.Message);
        }
    }

    public static WorkerResponse GetContextManifest(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var session = db.QueryFirstOrDefault(
                "SELECT id, current_snapshot_id, context_revision FROM sessions WHERE id = @sid",
                r => new SessionManifestSession(
                    r.GetString("id"),
                    r.GetNullableString("current_snapshot_id"),
                    r.GetInt64("context_revision")),
                new SqliteParameter("@sid", sessionId));
            if (session is null)
            {
                return ManifestError($"Session not found: {sessionId}");
            }

            var snapshot = string.IsNullOrWhiteSpace(session.CurrentSnapshotId)
                ? null
                : db.QueryFirstOrDefault(
                    "SELECT * FROM session_compaction_snapshots WHERE snapshot_id = @snapshotId",
                    EntityMappers.MapCompactionSnapshot,
                    new SqliteParameter("@snapshotId", session.CurrentSnapshotId));

            if (string.IsNullOrWhiteSpace(session.CurrentSnapshotId))
            {
                var fullCount = db.QueryScalar<int>(
                    "SELECT COUNT(*) FROM messages WHERE session_id = @sid",
                    new SqliteParameter("@sid", sessionId));
                return Manifest(new SessionContextManifestRow(
                    sessionId,
                    null,
                    session.ContextRevision,
                    false,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    0,
                    fullCount,
                    "full",
                    "no-current-snapshot",
                    null));
            }

            var validated = TryGetValidSnapshot(db, sessionId, out var reason);
            var failure = validated is null
                ? new SessionRestoreFailure(
                    sessionId,
                    session.CurrentSnapshotId,
                    reason ?? ReasonSnapshotNotFound,
                    Recoverable: true,
                    RequiresUserAction: true)
                : null;
            var prefixCount = validated is null ? 0 : JsonArrayLength(validated.WireConversation);
            var incrementalCount = validated is null
                ? 0
                : db.QueryScalar<int>(
                    "SELECT COUNT(*) FROM messages WHERE session_id = @sid AND created_at > @snapshotCreatedAt",
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@snapshotCreatedAt", validated.CreatedAt));

            var manifest = new SessionContextManifestRow(
                sessionId,
                session.CurrentSnapshotId,
                session.ContextRevision,
                snapshot is not null,
                snapshot?.Version,
                snapshot?.CreatedAt,
                snapshot?.UpdatedAt,
                snapshot?.ThroughCreatedAt,
                snapshot?.ThroughSortOrder,
                snapshot?.OriginalCount,
                snapshot?.NewCount,
                snapshot?.MessagesSummarized,
                snapshot?.SummarizerFailed,
                prefixCount,
                incrementalCount,
                failure is null ? "snapshot" : "blocked",
                failure?.Reason,
                failure);
            return Manifest(manifest);
        }
        catch (Exception ex)
        {
            return ManifestError(ex.Message);
        }
    }

    private static int JsonArrayLength(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.ValueKind == JsonValueKind.Array
                ? document.RootElement.GetArrayLength()
                : 0;
        }
        catch (JsonException)
        {
            return 0;
        }
    }

    private static WorkerResponse Manifest(SessionContextManifestRow manifest)
    {
        return WorkerResponse.Json(
            new SessionContextManifestResult(true, manifest, null),
            InfrastructureJsonContext.Default.SessionContextManifestResult);
    }

    private static WorkerResponse ManifestError(string error)
    {
        return WorkerResponse.Json(
            new SessionContextManifestResult(false, null, error),
            InfrastructureJsonContext.Default.SessionContextManifestResult);
    }

    private sealed record SessionManifestSession(string Id, string? CurrentSnapshotId, long ContextRevision);

    public static WorkerResponse Delete(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var deleted = db.ExecuteInTransaction((conn, tx) =>
            {
                var changed = db.Execute(
                    conn,
                    tx,
                    "DELETE FROM session_compaction_snapshots WHERE session_id = @sid",
                    new SqliteParameter("@sid", sessionId));
                db.Execute(
                    conn,
                    tx,
                    "UPDATE sessions SET current_snapshot_id = NULL, context_revision = context_revision + 1 WHERE id = @sid",
                    new SqliteParameter("@sid", sessionId));
                return changed > 0;
            });
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

    private static WorkerResponse Mutation(int changed, string? snapshotId = null, long? contextRevision = null)
    {
        return WorkerResponse.Json(
            new CompactionSnapshotMutationResult(true, changed, null, snapshotId, contextRevision),
            InfrastructureJsonContext.Default.CompactionSnapshotMutationResult);
    }

    private static WorkerResponse MutationError(string error, long? contextRevision = null)
    {
        return WorkerResponse.Json(
            new CompactionSnapshotMutationResult(false, 0, error, null, contextRevision),
            InfrastructureJsonContext.Default.CompactionSnapshotMutationResult);
    }
}

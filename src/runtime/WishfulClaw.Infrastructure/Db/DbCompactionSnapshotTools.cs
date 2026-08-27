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
            return WorkerResponse.Json(
                new CompactionSnapshotGetResult(true, entity is null ? null : CompactionSnapshotRow.FromEntity(entity), null, null),
                InfrastructureJsonContext.Default.CompactionSnapshotGetResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(
                new CompactionSnapshotGetResult(false, null, null, ex.Message),
                InfrastructureJsonContext.Default.CompactionSnapshotGetResult);
        }
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

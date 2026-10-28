using System.Buffers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using Microsoft.Data.Sqlite;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Result of the DB restore core (<see cref="SessionRestoreTools.RestoreFromDb"/>):
/// the wire messages, their parsed conversation, and whether a compaction
/// snapshot supplied the prefix. Internal-only; never serialized.
/// </summary>
internal sealed record SessionRestoreCoreResult(
    List<JsonElement> WireMessages,
    List<AgentRuntimeChatMessage> Conversation,
    bool FromSnapshot,
    SessionRestoreFailure? Failure = null)
{
    public bool IsBlocked => Failure is not null;
}

/// <summary>
/// Session restore: load messages from DB and rebuild SessionConversation.
/// Backs both the agent/restore-session endpoint and the agent loop's lazy
/// first-turn initialization (the backend conversation is rebuilt on the first
/// agent/run after a restart or session switch, not when the user merely
/// opens the session). Mirrors Reasonix's LoadSession(path) + SetSession(loaded)
/// pattern.
///
/// Strategy (snapshot-contract.md §六): a valid compaction snapshot restores
/// the compressed wire conversation plus the messages created after the
/// snapshot's own commit time; a corrupted snapshot (missing/unsupported
/// version/bad payload/wrong session) blocks the session until the user
/// explicitly rebuilds the context. Chat-only artifacts
/// (compact boundary / compression status cards) never enter the model context.
///
/// Reconciliation: the chat store keeps tool calls and their results in the
/// same assistant row (meta.toolCalls), but the wire conversation needs a
/// separate user tool_result message after every assistant tool_use message.
/// On restore those result messages are synthesized in memory from the stored
/// results (so completed results survive a crash) with a placeholder for any
/// call that never finished — nothing is re-executed and nothing is written
/// back to the DB, so no intermediate records accumulate.
/// </summary>
internal static partial class SessionRestoreTools
{
    /// <summary>
    /// Restore a session from the DB. Prefers the compaction snapshot + messages
    /// created after its commit time; falls back to loading all messages. Converts the result
    /// to wire-format JsonElements and calls SessionConversation.Initialize().
    /// </summary>
    public static WorkerResponse RestoreSession(JsonElement parameters)
    {
        var sessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim();
        if (string.IsNullOrEmpty(sessionId))
        {
            return WorkerResponse.Error("sessionId is required.");
        }

        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var restored = RestoreFromDb(db, sessionId);
            if (restored.Failure is { } failure)
            {
                WorkerLog.Warn(
                    $"agent restore-session blocked session={FormatLogValue(sessionId)} " +
                    $"snapshot={FormatLogValue(failure.SnapshotId)} reason={failure.Reason}");
                return WorkerResponse.Json(
                    new SessionRestoreResponse(false, sessionId, 0, Failure: failure),
                    AgentRuntimeJsonContext.Default.SessionRestoreResponse);
            }

            var wireMessages = restored.WireMessages;
            if (wireMessages.Count == 0)
            {
                // No messages in DB — nothing to restore, leave session empty
                WorkerLog.Info($"agent restore-session: no messages for session={FormatLogValue(sessionId)}");
                return WorkerResponse.Json(new SessionRestoreResponse(true, sessionId, 0), AgentRuntimeJsonContext.Default.SessionRestoreResponse);
            }

            // Initialize the SessionConversation - but only if it's empty.
            // If the session already has messages (e.g. agent loop is running
            // or a previous turn already populated it), skip to avoid
            // clobbering the live conversation state. The emptiness check and
            // the replacement happen atomically inside InitializeIfEmpty, so
            // concurrent restores (fire-and-forget + explicit) can't race a
            // newly started turn into losing its messages.
            var sessionConv = SessionConversationManager.GetOrCreate(sessionId);
            if (!sessionConv.InitializeIfEmpty(wireMessages, restored.Conversation))
            {
                WorkerLog.Info(
                    $"agent restore-session: skipped (session already has {sessionConv.MessageCount} messages) " +
                    $"session={FormatLogValue(sessionId)}");
                return WorkerResponse.Json(new SessionRestoreResponse(true, sessionId, sessionConv.MessageCount, Skipped: true), AgentRuntimeJsonContext.Default.SessionRestoreResponse);
            }
            if (restored.FromSnapshot)
            {
                // Mirrors the manual compression path: don't re-fold the restored
                // summary until new messages are appended beyond it.
                sessionConv.MarkCompactionWatermark(wireMessages.Count);
            }

            WorkerLog.Info(
                $"agent restore-session: loaded {wireMessages.Count} messages " +
                $"source={(restored.FromSnapshot ? "snapshot" : "full")} " +
                $"for session={FormatLogValue(sessionId)}");

            return WorkerResponse.Json(
                new SessionRestoreResponse(true, sessionId, wireMessages.Count,
                    FromSnapshot: restored.FromSnapshot ? true : null),
                AgentRuntimeJsonContext.Default.SessionRestoreResponse);
        }
        catch (Exception ex)
        {
            WorkerLog.Error(
                $"agent restore-session failed session={FormatLogValue(sessionId)} " +
                $"error={ex.GetType().Name}: {ex.Message}");
            return WorkerResponse.Error($"Restore failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Restore core shared by the agent/restore-session endpoint and the agent
    /// loop's lazy first-turn initialization: snapshot + post-commit increment,
    /// full-history fallback, and tool-result reconciliation (snapshot-contract.md
    /// §六). Pure DB read — never touches SessionConversation and returns no
    /// WorkerResponse; the caller decides how to apply the result. An empty
    /// WireMessages list means the session has no persisted messages.
    /// </summary>
    internal static SessionRestoreCoreResult RestoreFromDb(DbService db, string sessionId)
    {
        CompactionSnapshotEntity? snapshot;
        string? reason;
        string? currentSnapshotId;
        try
        {
            snapshot = DbCompactionSnapshotTools.TryGetValidSnapshot(
                db,
                sessionId,
                out reason,
                out currentSnapshotId,
                out _);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn(
                $"agent restore: snapshot read failed session={FormatLogValue(sessionId)} " +
                $"error={ex.GetType().Name}: {ex.Message}");
            var readFailure = new SessionRestoreFailure(
                sessionId,
                null,
                DbCompactionSnapshotTools.ReasonCorrupt,
                Recoverable: true,
                RequiresUserAction: true);
            return new SessionRestoreCoreResult([], [], false, readFailure);
        }

        if (currentSnapshotId is not null && snapshot is null)
        {
            var failure = new SessionRestoreFailure(
                sessionId,
                currentSnapshotId,
                reason ?? DbCompactionSnapshotTools.ReasonSnapshotNotFound,
                Recoverable: true,
                RequiresUserAction: true);
            return new SessionRestoreCoreResult([], [], false, failure);
        }

        var wireMessages = new List<JsonElement>();

        // Tool-call ids already covered by a stored tool_result row (legacy
        // split format) — pre-scanned so the synthesized results for the
        // preceding assistant rows don't duplicate them.
        var providedResultIds = new HashSet<string>(StringComparer.Ordinal);

        if (snapshot is not null)
        {
            // S-141: the snapshot's wire was copied verbatim out of the context that
            // was folded, so any `usage` it carries reports the *pre-compression*
            // token count — a number the restored wire no longer matches. Left in
            // place, ConversationCodec.FindRecentContextUsage seeds the compression
            // gate with it (AgentLoop.cs:263) and the first turn after a restart
            // compresses a context that is nowhere near the limit (measured case:
            // 144083 vs an actual ≈35K). Strip it here; the incremental messages
            // appended below keep theirs, because their usage describes exactly the
            // restored context.
            var snapshotWire = JsonSerializer.Deserialize(
                snapshot.WireConversation,
                AgentRuntimeJsonContext.Default.ListJsonElement) ?? [];
            foreach (var message in snapshotWire)
            {
                wireMessages.Add(ContextCompression.StripUsage(message));
            }

            // Ids already covered by the snapshot — dedupes the summary row whose
            // timestamp was relocated into the covered range by the chat store.
            // Measured on production data, this dedupe is a weak net, not a boundary
            // guard: the prefix carries an id on only 9 of 31 wire entries, and those
            // ids are wc_* provider-side ids from a different namespace than DB message
            // ids. So the boundary below must stay exact — loosening it cannot be
            // compensated by id matching.
            var snapshotIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var message in wireMessages)
            {
                if (message.ValueKind == JsonValueKind.Object &&
                    message.TryGetProperty("id", out var idProperty) &&
                    idProperty.ValueKind == JsonValueKind.String &&
                    idProperty.GetString() is { Length: > 0 } id)
                {
                    snapshotIds.Add(id);
                }
            }

            // Incremental messages: everything created after the snapshot commit time.
            // The snapshot row's own created_at is a wall clock written once and never
            // rewritten, so ordinary message saves can never move the boundary. Do not
            // compare against through_created_at/through_sort_order: sort_order is the
            // renderer's transcript index (messages.indexOf) and shifts when compression
            // inserts the boundary+summary pair mid-transcript, which used to raise a
            // false "invalid_cursor" and block the session permanently.
            // sort_order stays a pure tie-break inside ORDER BY.
            var incremental = db.Query(
                "SELECT * FROM messages WHERE session_id = @sid AND created_at > @snapshotCreatedAt " +
                "ORDER BY created_at ASC, sort_order ASC",
                EntityMappers.MapMessage,
                new SqliteParameter("@sid", sessionId),
                new SqliteParameter("@snapshotCreatedAt", snapshot.CreatedAt));

            // Tool-call ids already covered by a stored tool_result row
            // (legacy split format) — suppresses duplicate synthesized results.
            var filteredIncremental = incremental
                .Where(entity => !snapshotIds.Contains(entity.Id) && !IsChatOnlyArtifact(entity))
                .ToList();

            CollectProvidedResultIds(filteredIncremental, providedResultIds);

            foreach (var entity in filteredIncremental)
            {
                AddEntityWireMessages(wireMessages, entity, providedResultIds);
            }
        }
        else
        {
            // Full recovery: load all messages ordered by (created_at, sort_order)
            var entities = db.Query(
                "SELECT * FROM messages WHERE session_id = @sid ORDER BY created_at ASC, sort_order ASC",
                EntityMappers.MapMessage, new SqliteParameter("@sid", sessionId));

            if (entities.Count == 0)
            {
                return new SessionRestoreCoreResult(wireMessages, [], false);
            }

            var filteredEntities = entities
                .Where(entity => !IsChatOnlyArtifact(entity))
                .ToList();

            CollectProvidedResultIds(filteredEntities, providedResultIds);

            foreach (var entity in filteredEntities)
            {
                AddEntityWireMessages(wireMessages, entity, providedResultIds);
            }
        }

        return new SessionRestoreCoreResult(wireMessages, ParseWireMessages(wireMessages), snapshot is not null);
    }
}

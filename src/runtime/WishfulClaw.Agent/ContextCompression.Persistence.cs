using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Persists the compression result as the session's durable compaction snapshot so a
/// Worker restart can recover the compressed context (snapshot-contract.md). The
/// snapshot derives from the same <see cref="CompactionOutcome"/> that feeds the
/// in-memory SessionConversation and the chat artifacts, keeping all three consumers
/// semantically identical (contract: compression-contract.md §四).
/// </summary>
public static partial class ContextCompression
{
    public sealed record CompactionSnapshotPersistResult(
        bool Success,
        bool Skipped,
        string? Error = null);

    /// <summary>
    /// Writes the session snapshot after a successful compression. Skips outcomes with
    /// no summary (nothing compacted) and degraded mechanical truncation (no artifacts).
    /// Returns a structured result so callers can decide whether the compressed state is
    /// safe to expose as durable session state. The old snapshot (or none) is kept on
    /// failure because the database writer replaces snapshots atomically.
    /// </summary>
    public static CompactionSnapshotPersistResult PersistSnapshot(
        CompactionOutcome outcome,
        IReadOnlyList<JsonElement> compactArtifacts,
        string sessionId,
        string trigger,
        int preTokens,
        long? expectedRevision = null)
    {
        if (!outcome.Compacted || string.IsNullOrEmpty(sessionId))
        {
            return new CompactionSnapshotPersistResult(true, true);
        }

        if (compactArtifacts.Count == 0)
        {
            // Degraded truncation fallback carries no summary — a snapshot without
            // artifacts would be unusable on restore; keep the previous state.
            return new CompactionSnapshotPersistResult(true, true);
        }

        try
        {
            var wireConversationJson = BuildJsonArrayString(outcome.WireConversation);
            var compactArtifactsJson = BuildJsonArrayString(compactArtifacts);
            var (summaryMessageJson, summaryText) = ExtractSummary(outcome);

            DbClient.EnsureInitialized();
            var db = DbClient.GetClient();
            var commit = DbCompactionSnapshotStore.CommitSnapshot(
                db,
                sessionId,
                DbCompactionSnapshotStore.SupportedVersion,
                trigger,
                wireConversationJson,
                compactArtifactsJson,
                summaryMessageJson,
                summaryText,
                outcome.OriginalCount,
                outcome.WireConversation.Count,
                outcome.MessagesSummarized,
                outcome.SummarizerFailed,
                expectedRevision);
            if (!commit.Success)
            {
                throw new InvalidOperationException(commit.Error ?? "snapshot_commit_failed");
            }

            WorkerLog.Info(
                $"compaction snapshot persisted session={AgentLoop.FormatSessionId(sessionId)} " +
                $"trigger={trigger} original={outcome.OriginalCount} new={outcome.WireConversation.Count} " +
                $"summarizerFailed={outcome.SummarizerFailed}");
            return new CompactionSnapshotPersistResult(true, false);
        }
        catch (Exception ex)
        {
            // Keep the old snapshot; restore falls back to full message recovery.
            var error = $"{ex.GetType().Name}: {ex.Message}";
            DbCompactionSnapshotStore.LogSnapshotIssue("persist", sessionId, error);
            return new CompactionSnapshotPersistResult(false, false, error);
        }
    }

    /// <summary>Serializes a list of raw JSON messages as a JSON array string (AOT-safe).</summary>
    private static string BuildJsonArrayString(IReadOnlyList<JsonElement> elements)
    {
        return WorkerJsonHelper.BuildJsonString(w =>
        {
            w.WriteStartArray();
            foreach (var element in elements)
            {
                element.WriteTo(w);
            }
            w.WriteEndArray();
        });
    }

    /// <summary>
    /// Locates the summary message inside the compressed wire conversation by its stable id.
    /// Returns the raw message JSON plus its plain-text content for diagnostics/restore hints.
    /// </summary>
    private static (string? SummaryMessageJson, string? SummaryText) ExtractSummary(CompactionOutcome outcome)
    {
        if (outcome.SummaryMessageId is null)
        {
            return (null, null);
        }

        foreach (var message in outcome.WireConversation)
        {
            if (message.ValueKind != JsonValueKind.Object ||
                !message.TryGetProperty("id", out var idProperty) ||
                idProperty.ValueKind != JsonValueKind.String ||
                idProperty.GetString() != outcome.SummaryMessageId)
            {
                continue;
            }

            string? text = null;
            if (message.TryGetProperty("content", out var content) &&
                content.ValueKind == JsonValueKind.String)
            {
                var trimmed = content.GetString()?.Trim();
                text = string.IsNullOrEmpty(trimmed) ? null : trimmed;
            }

            return (message.GetRawText(), text);
        }

        return (null, null);
    }
}

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
    /// <summary>
    /// Writes the session snapshot after a successful compression. Skips outcomes with
    /// no summary (nothing compacted) and degraded mechanical truncation (no artifacts).
    /// Failures are logged and never propagate — the old snapshot (or none) is kept and
    /// the restore path falls back to full message recovery.
    /// </summary>
    public static void PersistSnapshot(
        CompactionOutcome outcome,
        string sessionId,
        string trigger,
        int preTokens)
    {
        if (!outcome.Compacted || string.IsNullOrEmpty(sessionId))
        {
            return;
        }

        var compactArtifacts = BuildCompactArtifacts(outcome, trigger, preTokens);
        if (compactArtifacts is null)
        {
            // Degraded truncation fallback carries no summary — a snapshot without
            // artifacts would be unusable on restore; keep the previous state.
            return;
        }

        try
        {
            var wireConversationJson = BuildJsonArrayString(outcome.WireConversation);
            var compactArtifactsJson = BuildJsonArrayString(compactArtifacts);
            var (summaryMessageJson, summaryText) = ExtractSummary(outcome);

            DbClient.EnsureInitialized();
            var db = DbClient.GetClient();
            DbCompactionSnapshotStore.UpsertSnapshot(
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
                outcome.SummarizerFailed);

            WorkerLog.Info(
                $"compaction snapshot persisted session={AgentLoop.FormatSessionId(sessionId)} " +
                $"trigger={trigger} original={outcome.OriginalCount} new={outcome.WireConversation.Count} " +
                $"summarizerFailed={outcome.SummarizerFailed}");
        }
        catch (Exception ex)
        {
            // Keep the old snapshot; restore falls back to full message recovery.
            DbCompactionSnapshotStore.LogSnapshotIssue(
                "persist", sessionId, $"{ex.GetType().Name}: {ex.Message}");
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

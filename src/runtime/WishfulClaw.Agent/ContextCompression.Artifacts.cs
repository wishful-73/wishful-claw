using System.Text.Json;
using WishfulClaw.Contracts;

namespace WishfulClaw.Agent;

/// <summary>
/// Builds the chat-display artifacts (compact boundary + summary message) for a
/// completed compression pass. Both artifacts derive from the single
/// <see cref="CompactionOutcome"/> so the chat window, the persistence snapshot
/// and restore share one semantic source (contract: compression-contract.md §四).
/// </summary>
public static partial class ContextCompression
{
    /// <summary>
    /// Returns [boundaryMessage, summaryMessage] for the chat window.
    /// The summary message is the same instance that lives inside the compressed
    /// wire conversation (matched by id), so UI and model context never diverge.
    /// Returns null when the outcome carries no summary (nothing was compacted).
    /// </summary>
    public static JsonElement[]? BuildCompactArtifacts(
        CompactionOutcome outcome,
        string trigger,
        int preTokens)
    {
        if (!outcome.Compacted || outcome.SummaryMessageId is null)
        {
            return null;
        }

        JsonElement? summaryMessage = null;
        string? preservedHeadId = null;

        for (var i = 0; i < outcome.WireConversation.Count; i++)
        {
            var message = outcome.WireConversation[i];
            if (!TryGetId(message, out var id) || id != outcome.SummaryMessageId)
            {
                continue;
            }

            summaryMessage = message;
            // The first message after the summary is the preserved tail's head —
            // the UI inserts the boundary/summary pair right before it.
            if (i + 1 < outcome.WireConversation.Count &&
                TryGetId(outcome.WireConversation[i + 1], out var tailHeadId))
            {
                preservedHeadId = tailHeadId;
            }
            break;
        }

        if (!summaryMessage.HasValue)
        {
            return null;
        }

        var boundary = BuildCompactBoundaryMessage(
            trigger, preTokens, outcome.MessagesSummarized, preservedHeadId);

        return [boundary, summaryMessage.Value];
    }

    private static JsonElement BuildCompactBoundaryMessage(
        string trigger,
        int preTokens,
        int messagesSummarized,
        string? preservedHeadId)
    {
        var json = WorkerJsonHelper.BuildJsonString(w =>
        {
            w.WriteStartObject();
            w.WriteString("id", $"compact-boundary-{Guid.NewGuid():N}");
            w.WriteString("role", "system");
            w.WriteString("content", "");
            w.WriteNumber("createdAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            w.WritePropertyName("meta");
            w.WriteStartObject();
            w.WritePropertyName("compactBoundary");
            w.WriteStartObject();
            w.WriteString("trigger", trigger);
            w.WriteNumber("preTokens", preTokens);
            w.WriteNumber("messagesSummarized", messagesSummarized);
            if (preservedHeadId is not null)
            {
                w.WritePropertyName("preservedSegment");
                w.WriteStartObject();
                w.WriteString("headId", preservedHeadId);
                w.WriteEndObject();
            }
            w.WriteEndObject();
            w.WriteEndObject();
            w.WriteEndObject();
        });
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static bool TryGetId(JsonElement message, out string id)
    {
        id = "";
        if (message.ValueKind == JsonValueKind.Object &&
            message.TryGetProperty("id", out var idProperty) &&
            idProperty.ValueKind == JsonValueKind.String)
        {
            id = idProperty.GetString() ?? "";
            return id.Length > 0;
        }
        return false;
    }
}

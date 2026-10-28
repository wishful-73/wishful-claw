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
/// Collapsed long-paste chip expansion on restore. Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
internal static partial class SessionRestoreTools
{
    /// <summary>
    /// Restore a collapsed long-paste chip
    /// (<c>&lt;pasted-block&gt;{"label":…,"text":…}&lt;/pasted-block&gt;</c>) to its verbatim text.
    /// The renderer keeps the tag so the transcript can render a chip, but the model has to
    /// receive the plain body — mirrors the renderer's <c>expandPastedBlocks</c>. A payload
    /// that fails to parse is left untouched so a paste is never silently dropped.
    /// </summary>
    internal static string ExpandPastedBlocks(string? content)
    {
        if (string.IsNullOrEmpty(content)) return content ?? string.Empty;

        const string openTag = "<pasted-block>";
        const string closeTag = "</pasted-block>";
        if (content.IndexOf(openTag, StringComparison.OrdinalIgnoreCase) < 0) return content;

        var builder = new StringBuilder(content.Length);
        var cursor = 0;
        while (true)
        {
            var open = content.IndexOf(openTag, cursor, StringComparison.OrdinalIgnoreCase);
            if (open < 0) break;
            var close = content.IndexOf(closeTag, open + openTag.Length, StringComparison.OrdinalIgnoreCase);
            if (close < 0) break;

            builder.Append(content, cursor, open - cursor);
            var payload = content.Substring(open + openTag.Length, close - open - openTag.Length);
            var expanded = DecodePastedBlockPayload(payload);
            if (expanded is null)
            {
                // Unparsable chip: keep the tag verbatim rather than drop the paste.
                builder.Append(content, open, close + closeTag.Length - open);
            }
            else
            {
                builder.Append(expanded);
            }
            cursor = close + closeTag.Length;
        }

        builder.Append(content, cursor, content.Length - cursor);
        return builder.ToString();
    }

    /// <summary>
    /// Returns the verbatim body of a paste payload, or <c>null</c> when the payload is not
    /// a well-formed chip body (caller then keeps the tag as-is).
    /// </summary>
    private static string? DecodePastedBlockPayload(string payload)
    {
        // Mirrors the renderer's encodeTagText, reversed in the same order.
        var decoded = payload
            .Replace("&lt;", "<", StringComparison.Ordinal)
            .Replace("&gt;", ">", StringComparison.Ordinal)
            .Replace("&amp;", "&", StringComparison.Ordinal);
        try
        {
            using var doc = JsonDocument.Parse(decoded);
            if (doc.RootElement.ValueKind == JsonValueKind.Object &&
                doc.RootElement.TryGetProperty("text", out var text) &&
                text.ValueKind == JsonValueKind.String)
            {
                // An empty body is treated as malformed, matching the renderer.
                var body = text.GetString();
                if (!string.IsNullOrEmpty(body)) return body;
            }
        }
        catch (JsonException)
        {
            // Fall through: the caller keeps the chip verbatim.
        }
        return null;
    }

    private static string FormatLogValue(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "<empty>";
        return value.Length <= 12 ? value : value[..12] + "...";
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace WishfulClaw.Agent;

/// <summary>
/// Transcript rendering for context compression.
/// </summary>
public static partial class ContextCompression
{
    // ── Transcript rendering ──

    private const int SerializedToolUseInputLimit = 500;
    private const int SerializedToolResultLimit = 800;

    /// <summary>
    /// Flattens messages into a readable transcript and enforces the independent
    /// summarizer character budget by dropping complete oldest entries first.
    /// </summary>
    internal static string RenderTranscript(
        IReadOnlyList<AgentRuntimeChatMessage> messages,
        int charBudget = int.MaxValue)
    {
        var entries = messages
            .Select(RenderMessage)
            .Where(entry => entry.Length > 0)
            .ToList();
        if (entries.Count == 0)
            return string.Empty;

        var omitted = 0;
        while (entries.Count > 1 && JoinedLength(entries) > charBudget)
        {
            entries.RemoveAt(0);
            omitted++;
        }

        var note = omitted == 0
            ? string.Empty
            : $"[note: {omitted} older message(s) omitted to fit the summarizer budget]";
        while (entries.Count > 1 && JoinedLength(entries, note) > charBudget)
        {
            entries.RemoveAt(0);
            omitted++;
            note = $"[note: {omitted} older message(s) omitted to fit the summarizer budget]";
        }

        if (JoinedLength(entries, note) > charBudget && entries.Count == 1)
        {
            var available = Math.Max(1, charBudget - note.Length - 2);
            entries[0] = Truncate(entries[0], available);
        }

        return note.Length == 0
            ? string.Join("\n\n", entries)
            : string.Join("\n\n", new[] { note }.Concat(entries));
    }

    private static string RenderMessage(AgentRuntimeChatMessage message)
    {
        var sb = new StringBuilder();
        switch (message.Role)
        {
            case "user" when message.ToolResults.Count > 0:
                foreach (var tr in message.ToolResults)
                {
                    sb.AppendLine($"[tool {tr.ToolUseId} result{(tr.IsError == true ? " error" : string.Empty)}]");
                    sb.AppendLine(Truncate(GetJsonText(tr.Content), SerializedToolResultLimit));
                    sb.AppendLine();
                }
                break;

            case "user":
                sb.AppendLine("[user]");
                sb.AppendLine(message.Text);
                sb.AppendLine();
                break;

            case "assistant":
                if (!string.IsNullOrEmpty(message.Text))
                {
                    sb.AppendLine("[assistant]");
                    sb.AppendLine(message.Text);
                }
                foreach (var tu in message.ToolUses)
                {
                    sb.AppendLine($"[assistant calls {tu.Name}] {Truncate(tu.Input.GetRawText(), SerializedToolUseInputLimit)}");
                }
                sb.AppendLine();
                break;

            case "system":
                sb.AppendLine("[system]");
                sb.AppendLine(message.Text);
                sb.AppendLine();
                break;
        }

        return sb.ToString().TrimEnd();
    }

    private static int JoinedLength(IReadOnlyList<string> entries, string note = "")
    {
        var total = note.Length;
        if (note.Length > 0 && entries.Count > 0)
            total += 2;
        for (var i = 0; i < entries.Count; i++)
        {
            if (i > 0) total += 2;
            total += entries[i].Length;
        }
        return total;
    }

    private static string GetJsonText(JsonElement value)
    {
        return value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? string.Empty
            : value.GetRawText();
    }

    private static string Truncate(string value, int maxChars)
    {
        if (value.Length <= maxChars)
            return value;
        const string marker = " …[truncated]";
        if (maxChars <= marker.Length)
            return marker[..maxChars];
        return value[..(maxChars - marker.Length)] + marker;
    }


}

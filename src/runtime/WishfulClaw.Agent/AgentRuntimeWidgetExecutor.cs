/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Buffers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Widget tool executor — renders inline UI widgets.
/// Ported from WishfulClaw AgentRuntimeWidgetExecutor.
/// </summary>
public static class AgentRuntimeWidgetExecutor
{
    private const string WidgetToolName = "visualize_show_widget";

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static bool IsWidgetTool(string toolName)
    {
        return string.Equals(toolName, WidgetToolName, StringComparison.Ordinal);
    }

    public static string Execute(AgentRuntimeNativeToolCall call)
    {
        var title = JsonHelpers.GetString(call.Input, "title")?.Trim() ?? string.Empty;
        if (title.Length == 0)
        {
            return EncodeError("title is required");
        }

        // Fail-soft: models do not always honor the schema's minItems/maxItems, and a
        // malformed loading_messages (missing, wrong type, empty array, blank strings)
        // must not abort the widget render. A single string is accepted as one message;
        // anything unresolvable falls back to a default; more than 4 entries are trimmed.
        var loadingMessages = ReadLoadingMessages(call.Input, title);

        var widgetCode = JsonHelpers.GetString(call.Input, "widget_code") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(widgetCode))
        {
            return EncodeError("widget_code is empty");
        }

        return EncodeJsonObject(writer =>
        {
            writer.WriteBoolean("success", true);
            writer.WriteString("title", title);
            writer.WriteString("message", $"Widget \"{title}\" rendered inline");
        });
    }

    private static List<string> ReadLoadingMessages(JsonElement input, string title)
    {
        var result = new List<string>();

        if (input.ValueKind == JsonValueKind.Object &&
            input.TryGetProperty("loading_messages", out var messages))
        {
            if (messages.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in messages.EnumerateArray())
                {
                    var text = item.ValueKind == JsonValueKind.String ? item.GetString()?.Trim() : null;
                    if (!string.IsNullOrEmpty(text))
                    {
                        result.Add(text);
                        if (result.Count >= 4)
                        {
                            break;
                        }
                    }
                }
            }
            else if (messages.ValueKind == JsonValueKind.String)
            {
                var text = messages.GetString()?.Trim();
                if (!string.IsNullOrEmpty(text))
                {
                    result.Add(text);
                }
            }
        }

        if (result.Count == 0)
        {
            result.Add($"Rendering {title}…");
        }

        return result;
    }

    private static string EncodeError(string message)
    {
        return EncodeJsonObject(writer => writer.WriteString("error", message));
    }

    private static string EncodeJsonObject(Action<Utf8JsonWriter> writeProperties)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            writeProperties(writer);
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }
}

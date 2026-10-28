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
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// JSON encoding and result-shaping helpers for <see cref="AgentRuntimeDesktopExecutor"/>.
/// Split out of the executor per AGENTS.md 大文件拆分 (2026-10-28): same static class,
/// method bodies moved verbatim, no behaviour change.
/// </summary>
public static partial class AgentRuntimeDesktopExecutor
{
    private static JsonElement CreateJsonObject(Action<Utf8JsonWriter> writeProperties)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            writeProperties(writer);
            writer.WriteEndObject();
        }
        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    private static JsonElement CreateScreenshotContent(JsonElement response, string data)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartArray();
            writer.WriteStartObject();
            writer.WriteString("type", "image");
            writer.WritePropertyName("source");
            writer.WriteStartObject();
            writer.WriteString("type", "base64");
            writer.WriteString("mediaType", JsonHelpers.GetString(response, "mediaType") ?? "image/png");
            writer.WriteString("data", data);
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteStartObject();
            writer.WriteString("type", "text");
            writer.WriteString("text",
                $"Captured desktop screenshot {JsonHelpers.GetInt(response, "width", 0)}x{JsonHelpers.GetInt(response, "height", 0)} across {JsonHelpers.GetInt(response, "displayCount", 1)} display(s).");
            writer.WriteEndObject();
            writer.WriteEndArray();
        }
        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    /// <summary>
    /// Image block plus a plain-language line stating where the file landed. The line
    /// matters: without it the model has to guess whether the path it was handed was
    /// actually written, and a missing extension means the file may not be named exactly
    /// what it asked for.
    /// </summary>
    private static JsonElement CreateAppWindowCaptureContent(JsonElement response, string data)
    {
        var filePath = JsonHelpers.GetString(response, "filePath");
        var width = JsonHelpers.GetInt(response, "width", 0);
        var height = JsonHelpers.GetInt(response, "height", 0);

        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartArray();
            writer.WriteStartObject();
            writer.WriteString("type", "image");
            writer.WritePropertyName("source");
            writer.WriteStartObject();
            writer.WriteString("type", "base64");
            writer.WriteString("mediaType", "image/png");
            writer.WriteString("data", data);
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteStartObject();
            writer.WriteString("type", "text");
            writer.WriteString("text",
                string.IsNullOrEmpty(filePath)
                    ? $"Captured the Wishful Claw window ({width}x{height}). No `path` was given, so nothing was written to disk."
                    : $"Captured the Wishful Claw window ({width}x{height}) and wrote it to {filePath}.");
            writer.WriteEndObject();
            writer.WriteEndArray();
        }
        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    private static RendererToolResult StringResult(string content, bool isError = false)
    {
        return new RendererToolResult(AgentRuntimeProviderSupport.CreateStringElement(content), isError, null);
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

    private static bool IsSupportedSingleKey(string value)
    {
        if (value.Length == 1 && char.IsLetterOrDigit(value[0])) return true;
        if (value.Length is 2 or 3 && value[0] == 'F' && int.TryParse(value[1..], out var functionKey))
        {
            return functionKey is >= 1 and <= 12;
        }
        return false;
    }

    private static List<string> ReadStringArray(JsonElement input, string name)
    {
        if (input.ValueKind != JsonValueKind.Object ||
            !input.TryGetProperty(name, out var property) ||
            property.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var result = new List<string>();
        foreach (var item in property.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && item.GetString() is { } value)
            {
                result.Add(value);
            }
        }
        return result;
    }

    private static string BuildTypeMessage(
        string mode, int textLength, string? key,
        IReadOnlyList<string> resultHotkey, IReadOnlyList<string> fallbackHotkey)
    {
        return mode switch
        {
            "text" => $"Typed {textLength} characters into the desktop target.",
            "key" => $"Pressed key {key}.",
            _ => $"Pressed hotkey {string.Join(" + ", resultHotkey.Count > 0 ? resultHotkey : fallbackHotkey)}."
        };
    }

    private static void WriteNullableString(Utf8JsonWriter writer, string name, string? value)
    {
        if (string.IsNullOrEmpty(value)) { writer.WriteNull(name); }
        else { writer.WriteString(name, value); }
    }

    private static void WriteOptionalNumber(Utf8JsonWriter writer, string name, double? value)
    {
        if (value.HasValue) { writer.WriteNumber(name, value.Value); }
    }

    private static void WriteStringArrayOrNull(Utf8JsonWriter writer, IReadOnlyList<string> values)
    {
        if (values.Count == 0) { writer.WriteNullValue(); return; }
        writer.WriteStartArray();
        foreach (var value in values) { writer.WriteStringValue(value); }
        writer.WriteEndArray();
    }
}

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
        // S-284：落盘路径必须进 image block 的 source，不能只写在文字行里。
        // 渲染层剥 base64 的条件是「source.filePath 非空」—— 路径只存在于 text 块时，
        // 剥离器看不见它，那张图就以 base64 形态一字不落进了 messages.meta。
        var filePath = JsonHelpers.GetString(response, "filePath");

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
            if (!string.IsNullOrEmpty(filePath))
            {
                writer.WriteString("filePath", filePath);
            }
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteStartObject();
            writer.WriteString("type", "text");
            writer.WriteString("text", DescribeScreenshot(response));
            writer.WriteEndObject();
            writer.WriteEndArray();
        }
        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    /// <summary>
    /// 截图那一行文字。
    ///
    /// S-272 ①③：以前只有 `WxH`，模型手里等于一张没有坐标轴的图 —— 它能看见按钮，但没有任何
    /// 依据去报 `DesktopClick` 的 x/y。现在把**参照系**一起给出：原点、缩放比、每块屏的物理矩形。
    /// 末尾那句「坐标就是这张图里的像素」是给模型的直接指令，因为上游会缩放输入图，而工具收的
    /// 是不缩放的原始像素 —— 这两者之间的换算，模型自己不做就会偏。
    /// </summary>
    private static string DescribeScreenshot(JsonElement response)
    {
        var width = JsonHelpers.GetInt(response, "width", 0);
        var height = JsonHelpers.GetInt(response, "height", 0);
        var originX = JsonHelpers.GetInt(response, "originX", 0);
        var originY = JsonHelpers.GetInt(response, "originY", 0);
        var scaleFactor = JsonHelpers.GetDoubleNullable(response, "scaleFactor");
        var displayCount = JsonHelpers.GetInt(response, "displayCount", 1);

        var scalePart = scaleFactor.HasValue ? $", scale {FormatScale(scaleFactor.Value)}" : string.Empty;
        var text = $"Captured desktop screenshot {width}x{height} (origin {originX},{originY}{scalePart}) " +
                   $"across {displayCount} display(s)";

        var displays = DescribeDisplays(response);
        if (!string.IsNullOrEmpty(displays))
        {
            text += $": {displays}";
        }

        text += ". Click coordinates are pixel positions in THIS image — do not rescale them.";

        // S-283：落盘路径必须说出来。压缩把 image 块占位化（S-275）之后，模型唯一
        // 能拿到这张图的途径就是回读这个路径 —— 不给它，占位文案那句「可重新 Read
        // 查看」就是空话。
        var filePath = JsonHelpers.GetString(response, "filePath");
        if (!string.IsNullOrEmpty(filePath))
        {
            text += $" Saved to {filePath}.";
        }

        return text;
    }

    private static string DescribeDisplays(JsonElement response)
    {
        if (!response.TryGetProperty("displays", out var displays) ||
            displays.ValueKind != JsonValueKind.Array)
        {
            return string.Empty;
        }

        var parts = new List<string>();
        foreach (var display in displays.EnumerateArray())
        {
            var id = JsonHelpers.GetInt(display, "id", 0);
            var primary = JsonHelpers.GetBool(display, "primary", false);
            var x = JsonHelpers.GetInt(display, "x", 0);
            var y = JsonHelpers.GetInt(display, "y", 0);
            var width = JsonHelpers.GetInt(display, "width", 0);
            var height = JsonHelpers.GetInt(display, "height", 0);
            parts.Add($"{(primary ? "primary " : "#")}{id} at ({x},{y}) {width}x{height}");
        }

        return string.Join("; ", parts);
    }

    private static string FormatScale(double value)
    {
        return Math.Abs(value - Math.Round(value)) < 0.01
            ? Math.Round(value).ToString(System.Globalization.CultureInfo.InvariantCulture)
            : value.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Image block plus a plain-language line stating where the file landed. The line
    /// matters: without it the model has to guess whether the path it was handed was
    /// actually written, and a missing extension means the file may not be named exactly
    /// what it asked for.
    ///
    /// S-272 ①：这里还必须带上**窗口在屏幕上的位置**。`CaptureAppWindow` 常被用来代替
    /// `DesktopScreenshot`（它不含别的窗口，更干净），但如果只回尺寸不回位置，模型看到按钮
    /// 之后算不出它落在屏幕哪一点 —— 那次 dev 实例点自己页面正是卡在这里。
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
            // S-284：同 CreateScreenshotContent —— 路径必须进 source，剥离器才认得出来。
            if (!string.IsNullOrEmpty(filePath))
            {
                writer.WriteString("filePath", filePath);
            }
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteStartObject();
            writer.WriteString("type", "text");
            writer.WriteString("text", DescribeAppWindowCapture(response, width, height, filePath));
            writer.WriteEndObject();
            writer.WriteEndArray();
        }
        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    private static string DescribeAppWindowCapture(
        JsonElement response, int width, int height, string? filePath)
    {
        var text = $"Captured the Wishful Claw window ({width}x{height}).";

        if (response.TryGetProperty("bounds", out var bounds) &&
            bounds.ValueKind == JsonValueKind.Object)
        {
            var x = JsonHelpers.GetInt(bounds, "x", 0);
            var y = JsonHelpers.GetInt(bounds, "y", 0);
            var dipWidth = JsonHelpers.GetInt(bounds, "width", 0);
            var dipHeight = JsonHelpers.GetInt(bounds, "height", 0);
            var scaleFactor = JsonHelpers.GetDoubleNullable(response, "scaleFactor");

            text += $" Its content area sits at DIP ({x},{y}), {dipWidth}x{dipHeight}";
            if (scaleFactor.HasValue)
            {
                var scale = scaleFactor.Value > 0 ? scaleFactor.Value : 1;
                var pixelX = (int)Math.Round(x * scale);
                var pixelY = (int)Math.Round(y * scale);
                var pixelWidth = (int)Math.Round(dipWidth * scale);
                var pixelHeight = (int)Math.Round(dipHeight * scale);
                text += $" — at scale {FormatScale(scale)} that is screen pixels " +
                        $"({pixelX},{pixelY}), {pixelWidth}x{pixelHeight}";
            }

            text += ". DesktopClick takes screen pixels: screen position = window pixel origin + offset in this image.";
        }

        // S-283：落盘已改成默认行为，所以「没给 path」不再是没写盘的原因 ——
        // 还留在这句上说明写盘本身失败了，别让模型误以为是自己没传参数。
        return string.IsNullOrEmpty(filePath)
            ? text + " Nothing was written to disk."
            : text + $" Saved to {filePath}.";
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

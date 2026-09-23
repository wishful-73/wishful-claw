using System;

using System.Buffers;

using System.Globalization;

using System.IO;

using System.Text;

using System.Text.Json;

using System.Threading.Tasks;

using WishfulClaw.Core.Tools;



namespace WishfulClaw.Agent.Tools.FileTools;



using static WishfulClaw.Agent.Tools.ToolHelpers;



/// <summary>

/// Read file contents with optional line range.

/// Adapted from WishfulClaw AgentRuntimeNativeToolExecutor.ReadAsync.

/// </summary>

public sealed class FileReadTool : IToolExecutor

{

    private const int DefaultLimit = 2_000;

    /// <summary>单张图内联上限（S-145）：超限只回路径与尺寸，不塞 base64。</summary>
    private const long MaxInlineImageBytes = 5 * 1024 * 1024;



    public string Name => "Read";



    public string Description => "Read the contents of a file. Supports line range via offset and limit parameters. Returns content with line numbers. Image files (.png/.jpg/.jpeg/.webp/.gif/.bmp) are returned as an image you can see directly; offset/limit do not apply to them.";



    public string[]? VisibleScopes => ToolVisibilityScopes.Everywhere;

    public bool IsCore => true;

    public JsonElement InputSchema { get; } = ParseSchema(

        """{"type":"object","properties":{"file_path":{"type":"string","description":"The path to the file to read"},"offset":{"type":"integer","description":"Line number to start reading from (1-based)","default":1},"limit":{"type":"integer","description":"Maximum number of lines to read","default":2000}},"required":["file_path"]}""");



    public async Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)

    {

        var path = ResolveFilePath(input, context);

        if (string.IsNullOrWhiteSpace(path))

        {

            return new ToolResult("Read requires a non-empty file_path", true);

        }



        if (Directory.Exists(path))

        {

            return new ToolResult($"Read expected a file but found a directory. Use LS for: {path}", true);

        }



        if (!File.Exists(path))

        {

            return new ToolResult($"File not found: {path}", true);

        }

        // S-145: 图像走 base64 分支 —— 模型直接看到像素，而不是把 PNG 当 UTF-8 读出乱码。
        var imageMediaType = ImageFileProbe.MediaTypeFor(path);
        if (imageMediaType is not null)
        {
            return ReadImage(path, imageMediaType, context.SupportsVision);
        }



        try

        {

            var offset = Math.Max(1, GetInt(input, "offset", 1));

            var limit = Math.Max(1, Math.Min(GetInt(input, "limit", DefaultLimit), DefaultLimit));

            // TL-4: stream the file line-by-line instead of ReadAllText so a
            // huge file doesn't get fully loaded into memory — only the
            // requested [offset, offset+limit) window is retained.
            var builder = new StringBuilder();

            var width = Math.Max(6, (offset + limit - 1).ToString(CultureInfo.InvariantCulture).Length);

            using (var reader = new StreamReader(path, Encoding.UTF8))
            {
                string? line;
                var lineNumber = 0;

                while ((line = reader.ReadLine()) is not null)
                {
                    lineNumber++;

                    if (lineNumber < offset)
                    {
                        continue;
                    }

                    if (lineNumber >= offset + limit)
                    {
                        break;
                    }

                    if (builder.Length > 0)
                    {
                        builder.Append('\n');
                    }

                    builder.Append(lineNumber.ToString(CultureInfo.InvariantCulture).PadLeft(width));
                    builder.Append('\t');
                    builder.Append(line);
                }
            }

            return new ToolResult(builder.ToString());

        }

        catch (Exception ex) when (ex is not OperationCanceledException)

        {

            return new ToolResult($"Failed to read file: {ex.Message}", true, ex.Message);

        }

    }



    /// <summary>
    /// 图像分支（S-145）：产出 [text, image] content 数组。文本那行说清「读到的是哪张图、多大、
    /// 什么格式」并给事件/日志当摘要，图像块才是模型看到的像素。
    ///
    /// 两种降级都退回纯文本，但都要说明为什么没有像素 —— 静默降级会让模型以为这张图是空的，
    /// 然后开始猜内容，比直接说「没看到」糟糕得多。
    /// </summary>
    private static ToolResult ReadImage(string path, string mediaType, bool supportsVision)
    {
        var hasSize = ImageFileProbe.TryReadSize(path, out var width, out var height);
        var sizeText = hasSize ? $"{width}x{height}" : "size unavailable";
        var byteLength = new FileInfo(path).Length;

        if (!supportsVision)
        {
            return new ToolResult(
                $"Read image: {path} ({sizeText}, {mediaType}). " +
                "The current model is not marked as vision-capable, so the pixels were not attached.");
        }

        if (byteLength > MaxInlineImageBytes)
        {
            return new ToolResult(
                $"Read image: {path} ({sizeText}, {mediaType}). " +
                $"The file is {FormatMegabytes(byteLength)}, over the {MaxInlineImageBytes / (1024 * 1024)} MB " +
                "inline limit, so the pixels were not attached. Ask the user for a downscaled copy.");
        }

        var data = Convert.ToBase64String(File.ReadAllBytes(path));
        var summary = $"Read image: {path} ({sizeText}, {mediaType})";
        return new ToolResult(summary, false, null, BuildImageContent(summary, path, mediaType, data));
    }

    private static string FormatMegabytes(long bytes) =>
        (bytes / (1024.0 * 1024.0)).ToString("0.0", CultureInfo.InvariantCulture) + " MB";

    private static JsonElement BuildImageContent(string summary, string path, string mediaType, string data)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartArray();
            writer.WriteStartObject();
            writer.WriteString("type", "text");
            writer.WriteString("text", summary);
            writer.WriteEndObject();
            writer.WriteStartObject();
            writer.WriteString("type", "image");
            writer.WritePropertyName("source");
            writer.WriteStartObject();
            writer.WriteString("type", "base64");
            writer.WriteString("mediaType", mediaType);
            writer.WriteString("data", data);
            // 路径必须带：渲染端按它重新 hydrate 出图像（visual-context），
            // DB 侧也按它把 base64 换成 [image: <path> …] 占位（S-145 §3.3）。
            writer.WriteString("filePath", path);
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteEndArray();
        }

        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    public static JsonElement WriteSchema { get; } = ParseSchema(

        """{"type":"object","properties":{"file_path":{"type":"string","description":"The path to the file to write"},"content":{"type":"string","description":"The content to write to the file"}},"required":["file_path","content"]}""");



    public static JsonElement EditSchema { get; } = ParseSchema(

        """{"type":"object","properties":{"file_path":{"type":"string","description":"The path to the file to edit"},"old_string":{"type":"string","description":"The exact text to find and replace"},"new_string":{"type":"string","description":"The replacement text"},"replace_all":{"type":"boolean","description":"Replace all occurrences. Default: false","default":false}},"required":["file_path","old_string","new_string"]}""");

}


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



    public string Description => "Read the contents of a file. Supports line range via offset and limit parameters. Returns content with line numbers. Image files (.png/.jpg/.jpeg/.webp/.gif/.bmp) are returned as an image you can see directly. Video files (.mp4/.webm/.mov/.mkv/.avi/.ogv/.m4v/...) are sampled into a few frames spread across their duration and returned as images. offset/limit do not apply to images or videos.";



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

        // S-145 §六: 视频走抽帧分支 —— 解码器只在渲染端，帧靠反向请求取回来。
        var videoMediaType = VideoFileProbe.MediaTypeFor(path);
        if (videoMediaType is not null)
        {
            return await ReadVideoAsync(path, videoMediaType, context);
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

    /// <summary>
    /// 视频分支（S-145 §六）：把整段视频取样成几张静态帧交给模型。
    ///
    /// 为什么要抽帧而不是把视频给模型：本条链路（以及当前所有 provider 协议）只认图像块，
    /// 没有视频输入通道。抽帧是唯一能让模型「看见」视频内容的办法。
    ///
    /// 四种降级全都退回纯文本，并且都必须说清原因（不支持视觉 / 没有抽帧通路 / 文件超限 /
    /// 渲染端抽帧失败）—— 让模型以为看过了是比看不到更坏的结果。
    /// </summary>
    private static async Task<ToolResult> ReadVideoAsync(
        string path,
        string mediaType,
        ToolExecutionContext context)
    {
        var byteLength = new FileInfo(path).Length;
        var sizeText = FormatMegabytes(byteLength);

        if (!context.SupportsVision)
        {
            return new ToolResult(
                $"Read video: {path} ({sizeText}, {mediaType}). " +
                "The current model is not marked as vision-capable, so frames were not extracted.");
        }

        if (context.VideoFrameExtractor is null)
        {
            return new ToolResult(
                $"Read video: {path} ({sizeText}, {mediaType}). " +
                "Frame extraction is not available in this run, so only this summary is returned.");
        }

        if (byteLength > VideoFileProbe.MaxBytes)
        {
            return new ToolResult(
                $"Read video: {path} ({sizeText}, {mediaType}). " +
                $"The file is over the {FormatMegabytes(VideoFileProbe.MaxBytes)} limit for frame extraction, " +
                "so frames were not extracted. Ask the user for a shorter clip or for still frames.");
        }

        var extraction = await context.VideoFrameExtractor(path, context.CancellationToken);
        if (extraction.Error is not null || extraction.Frames is null || extraction.Frames.Count == 0)
        {
            var reason = extraction.Error ?? "no frame was returned";
            return new ToolResult(
                $"Read video: {path} ({sizeText}, {mediaType}). " +
                $"Frames could not be extracted: {reason}. " +
                "Tell the user the video could not be viewed instead of guessing what is in it.");
        }

        var dimensions = extraction.Width > 0 && extraction.Height > 0
            ? $"{extraction.Width}x{extraction.Height}, "
            : string.Empty;

        var builder = new StringBuilder();
        for (var index = 0; index < extraction.Frames.Count; index++)
        {
            if (index > 0) builder.Append(", ");
            builder.Append(FormatSeconds(extraction.Frames[index].TimestampSec));
        }

        var summary =
            $"Read video: {path} ({dimensions}{FormatSeconds(extraction.DurationSec)}s, {mediaType}, {sizeText}) — " +
            $"{extraction.Frames.Count} frames sampled at {builder}s, attached below in time order.";

        return new ToolResult(summary, false, null, BuildVideoContent(summary, extraction.Frames));
    }

    private static string FormatSeconds(double seconds) =>
        seconds.ToString("0.##", CultureInfo.InvariantCulture);

    /// <summary>
    /// 与 <see cref="BuildImageContent"/> 同形：[text, image, image, …]。
    ///
    /// 帧一律不带 <c>filePath</c> —— 它不是「某个图片文件」，而是视频的一帧。带上路径会让
    /// 持久化把 base64 换成只留路径的图像引用，重新加载时又拿那个路径去当图片读（读回来的是
    /// 整段视频），预览面板也会渲染出一个打不开的图。宁可让大帧在历史里落成
    /// `[image data omitted, N base64 chars]` 这句文本，也不留一个指向视频的假图像引用。
    /// </summary>
    private static JsonElement BuildVideoContent(string summary, IReadOnlyList<VideoFrame> frames)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartArray();
            writer.WriteStartObject();
            writer.WriteString("type", "text");
            writer.WriteString("text", summary);
            writer.WriteEndObject();

            foreach (var frame in frames)
            {
                writer.WriteStartObject();
                writer.WriteString("type", "image");
                writer.WritePropertyName("source");
                writer.WriteStartObject();
                writer.WriteString("type", "base64");
                writer.WriteString("mediaType", frame.MediaType);
                writer.WriteString("data", frame.Data);
                writer.WriteEndObject();
                writer.WriteEndObject();
            }

            writer.WriteEndArray();
        }

        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
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


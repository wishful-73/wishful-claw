using System;

using System.Buffers;

using System.Globalization;

using System.IO;

using System.Text;

using System.Text.Json;

using System.Threading.Tasks;

using WishfulClaw.Core.Protocol;
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



    public string Description => "Read the contents of a file. Supports line range via offset and limit parameters. Returns content with line numbers. Image files (.png/.jpg/.jpeg/.webp/.gif) are returned as an image you can see directly; .bmp/.tiff/.ico are described by path, size and format only, because upstream model APIs do not accept them — convert them to png/jpeg first if the pixels matter. .svg is read as text. Video files (.mp4/.webm/.mov/.mkv/.avi/.ogv/.m4v/...) are sampled into a few frames spread across their duration and returned as images. offset/limit do not apply to images or videos.";



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
            return ReadImage(path, imageMediaType);
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
    /// S-236（2026-10-27）：**不再看 supportsVision 拒图**。那张本地能力表追不上新模型、反代渠道、
    /// 用户自定义模型，也压不住跨 provider 同名 id 的串号（同一个 glm-5.3 在四个渠道里标法不一），
    /// 于是「截图能识图、Read 不能」这种自相矛盾的现场反复出现。
    /// 现在一律附像素，能不能收由上游回答；上游若回「不支持图像」，
    /// <c>ImageInputErrors</c> 认出来后在 AgentLoop 剥图重试（档 2）。
    ///
    /// 唯一还留着的降级是「文件太大」，那是传输与计费边界，不是能力判断。
    ///
    /// S-264（2026-10-29）：**按真实签名判，不信扩展名。** 修前这条路径只看扩展名：
    /// `foo.png` 里装着 svg / html / 半截数据时，`MediaTypeFor` 照样给 `image/png`，
    /// 过完白名单闸就贴上标签送上游，换回 400 `unsupported image`，坏块留历史每轮重发。
    /// 现在先问 <see cref="ImageFileProbe.DetectMediaTypeFromFile"/>「字节实际是什么」，
    /// 按五档分流 —— 只有「认不出」才判读图失败，扩展名骗人要按真实格式**纠正**后照发
    /// （用户截图后手动改名是常事，报「读图失败」才是误报）。
    ///
    /// S-266（2026-10-29）：补上第五档「签名对但没写完」。签名在文件开头，截断的文件照样合法，
    /// 所以前一档判据天生够不着它 —— 这类脏图以前一路内联出去再换 400，
    /// 现在由 <see cref="ImageFileProbe.HasCompleteContainer"/> 按尾部结束标记拦下，判读图失败。
    ///
    /// 判据只认签名不认尺寸：`TryReadSize` 返回 false 只代表「SOF 不在前 4 KB」，
    /// 一张带大 EXIF 的合法 JPEG 就会落到那里 —— 拿它当脏图判据必误杀。
    /// </summary>
    private static ToolResult ReadImage(string path, string mediaType)
    {
        var hasSize = ImageFileProbe.TryReadSize(path, out var width, out var height);
        var sizeText = hasSize ? $"{width}x{height}" : "size unavailable";
        var byteLength = new FileInfo(path).Length;

        var detected = ImageFileProbe.DetectMediaTypeFromFile(path);

        // ── 档 4（认不出）—— 损坏 / 半截 / 根本不是图，判读图失败 ──
        //
        // 这一档必须失败。把这样的字节贴上 image/png 送上去只会换回 400
        // `unsupported image`，而那个坏块会留在历史里每轮重发（S-246 / S-261 的现场）。
        // 说「读不了」比让模型以为自己看过这张图好得多。
        if (detected is null)
        {
            WorkerLog.Warn(
                $"read image rejected: no recognizable image signature (path={path} " +
                $"declared={mediaType} bytes={byteLength})");

            return new ToolResult(
                $"Read image failed: {path} ({sizeText}). " +
                "The file does not start with any recognizable image signature " +
                "(png / jpeg / webp / gif / bmp / tiff / ico / svg), so no pixels were attached. " +
                "It is most likely corrupted, truncated, or not an image file at all. " +
                "Verify the file, or convert it to png or jpeg and read it again.",
                true,
                "image signature not recognized");
        }

        // ── 档 2（扩展名骗人）—— 按真实格式纠正后照发，不判失败 ──
        var declared = mediaType;
        if (!string.Equals(detected, declared, StringComparison.OrdinalIgnoreCase))
        {
            mediaType = detected;
            WorkerLog.Debug(
                $"read image media type corrected from extension " +
                $"(path={path} declared={declared} detected={detected})");
        }

        // ── 档 3（上游不收）—— bmp / tiff / ico 只回元信息 ──
        //
        // S-246 的既有行为不变。不这样做的话，一张 bmp 就会给请求体塞进
        // `data:image/bmp;base64,…` —— OpenAI 系只收 png/jpeg/webp/gif，必然回 400，
        // 块留历史每轮重发，会话在清空历史前不可用。
        // 组包层（ProviderContentHelpers.ResolveSupportedImageMediaType）是最后一道闸，
        // 这里先拦一次：省掉一次白烧的往返，也让模型立刻知道「要转格式」。
        if (!ProviderContentHelpers.SupportedImageMediaTypes.Contains(mediaType))
        {
            return new ToolResult(
                $"Read image: {path} ({sizeText}, {mediaType}). " +
                "Upstream model APIs only accept png/jpeg/webp/gif, so the pixels were not attached. " +
                "Convert the file to png or jpeg first if you need to see it.");
        }

        if (byteLength > MaxInlineImageBytes)
        {
            return new ToolResult(
                $"Read image: {path} ({sizeText}, {mediaType}). " +
                $"The file is {FormatMegabytes(byteLength)}, over the {MaxInlineImageBytes / (1024 * 1024)} MB " +
                "inline limit, so the pixels were not attached. Ask the user for a downscaled copy.");
        }

        // ── 档 5（签名对但没写完）—— 判读图失败 ──
        //
        // S-266：前四档都拦不住这一种 —— 下载到一半的截图、被中断的保存、拷贝到一半的 U 盘文件。
        // 它们的头 8 字节完全合法，所以档 4 认得出格式、档 3 也让它过白名单，最终内联出去，
        // 上游回 400 `invalid image`，坏块留在历史里每轮重发 —— 和 S-246 是同一个现场，
        // 只是触发条件从「格式不收」换成了「数据不全」。
        //
        // 这里不把它降级成「只回路径」：截断的图本来就没有可用像素，
        // 让模型以为「看过但没收获」比直接说「这张图是坏的，去重新弄一张」更糟。
        if (!ImageFileProbe.HasCompleteContainer(path, mediaType))
        {
            WorkerLog.Warn(
                $"read image rejected: container incomplete (path={path} media={mediaType} bytes={byteLength})");

            return new ToolResult(
                $"Read image failed: {path} ({sizeText}, {mediaType}). " +
                "The file has a valid image header but is incomplete — its end marker is missing, " +
                "so the pixels were not attached. It was most likely truncated by an interrupted " +
                "download, save, or copy. Fetch the file again (or re-take the screenshot), " +
                "then read it again.",
                true,
                "image container incomplete");
        }

        // ── 档 1（有效且格式可用）—— 照常附像素 ──
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
    /// 三种降级全都退回纯文本，并且都必须说清原因（没有抽帧通路 / 文件超限 /
    /// 渲染端抽帧失败）—— 让模型以为看过了是比看不到更坏的结果。
    ///
    /// S-236：与图像分支同批摘掉 <c>SupportsVision</c> 拦截 —— 同一张能力表不该在两条路上
    /// 得出相反结论。剩下两道都是真实边界（通路缺失、体积超限），保留。
    /// </summary>
    private static async Task<ToolResult> ReadVideoAsync(
        string path,
        string mediaType,
        ToolExecutionContext context)
    {
        var byteLength = new FileInfo(path).Length;
        var sizeText = FormatMegabytes(byteLength);

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
            // DB 侧按它剥掉 base64、只留路径（serializeMessage → stripImagePayloads，S-224）。
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

    public static JsonElement SaveImageSchema { get; } = ParseSchema(

        """{"type":"object","properties":{"source_path":{"type":"string","description":"Path of the image file to copy — a generated image or a screenshot."},"file_path":{"type":"string","description":"Destination path in the workspace."},"overwrite":{"type":"boolean","description":"Replace the target if it already exists. Default: false.","default":false}},"required":["source_path","file_path"]}""");

}


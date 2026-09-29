// S-145 §六 回归：Read 读视频 —— 扩展名表、抽帧请求/响应契约、四种降级、文本与图像路径不受影响，
// 以及与渲染端 `media-file-types.ts` 清单的一致性。
//
// 约定：失败断言打 FAIL，最后一行打 "passed: N, failed: M"，非零退出码表示失败
// （scripts/run-tests.mjs 按退出码判定，按 "passed: N" 取计数）。

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using WishfulClaw.Agent.Tools.FileTools;
using WishfulClaw.Core.Tools;

var passed = 0;
var failed = 0;

void Check(bool condition, string label)
{
    if (condition)
    {
        passed++;
        return;
    }
    failed++;
    Console.WriteLine($"FAIL {label}");
}

var root = Path.Combine(Path.GetTempPath(), "wc-read-video-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);

try
{
    // ── 扩展名 / mediaType ──
    Check(VideoFileProbe.MediaTypeFor("a.mp4") == "video/mp4", "mp4 maps to video/mp4");
    Check(VideoFileProbe.MediaTypeFor("a.webm") == "video/webm", "webm maps to video/webm");
    Check(VideoFileProbe.MediaTypeFor("a.MOV") == "video/quicktime", "uppercase .MOV maps to video/quicktime");
    Check(VideoFileProbe.MediaTypeFor("a.mkv") == "video/x-matroska", "mkv maps to video/x-matroska");
    Check(VideoFileProbe.MediaTypeFor("a.m2ts") == "video/mp2t", "m2ts maps to video/mp2t");
    Check(VideoFileProbe.IsVideoPath("a.MP4"), "extension match is case-insensitive");
    Check(!VideoFileProbe.IsVideoPath("shot.png"), "images stay out of the video branch");
    Check(!VideoFileProbe.IsVideoPath("notes.txt"), "text is not a video");
    Check(!VideoFileProbe.IsVideoPath("noextension"), "a name without extension is not a video");

    // ── 与渲染端清单逐项一致（跨语言没法共用代码，只能在这里钉住） ──
    var rendererTable = ReadRendererVideoMimeTypes(out var rendererError);
    Check(rendererError is null, rendererError ?? "renderer video MIME table parsed");

    if (rendererError is null)
    {
        foreach (var pair in rendererTable)
        {
            Check(
                VideoFileProbe.MediaTypes.TryGetValue(pair.Key, out var csMediaType) && csMediaType == pair.Value,
                $"renderer {pair.Key} → {pair.Value} also recognised by the worker");
        }

        foreach (var pair in VideoFileProbe.MediaTypes)
        {
            Check(
                rendererTable.TryGetValue(pair.Key, out var tsMediaType) && tsMediaType == pair.Value,
                $"worker {pair.Key} → {pair.Value} also recognised by the renderer");
        }

        Check(
            rendererTable.Count == VideoFileProbe.MediaTypes.Count,
            "both sides declare the same number of extensions");
    }

    // ── Read 工具：视频走抽帧分支，帧变成 image 块 ──
    var tool = new FileReadTool();
    var video = Path.Combine(root, "clip.mp4");
    File.WriteAllBytes(video, new byte[4096]);

    var frames = new List<VideoFrame>
    {
        new("QUJD", "image/jpeg", 0),
        new("REVG", "image/jpeg", 2.5)
    };
    var extractorCalls = new List<string>();
    var extracted = await tool.ExecuteAsync(
        Input(video),
        new ToolExecutionContext(
            WorkingFolder: root,
            VideoFrameExtractor: (path, _) =>
            {
                extractorCalls.Add(path);
                return Task.FromResult(new VideoFrameExtraction(frames, 5, 1920, 1080));
            }));

    Check(!extracted.IsError, "video read is not an error");
    Check(extractorCalls.Count == 1 && extractorCalls[0] == video, "extractor is called once with the resolved path");
    Check(extracted.Content.StartsWith("Read video:", StringComparison.Ordinal), "summary starts with 'Read video:'");
    Check(extracted.Content.Contains("1920x1080", StringComparison.Ordinal), "summary carries the video dimensions");
    Check(extracted.Content.Contains("2.5s", StringComparison.Ordinal), "summary lists frame timestamps");
    Check(extracted.Content.Contains("2 frames", StringComparison.Ordinal), "summary states the frame count");

    if (extracted.ContentBlocks is { } blocks)
    {
        Check(blocks.ValueKind == JsonValueKind.Array, "content blocks is an array");
        Check(blocks.GetArrayLength() == 3, "content blocks = text + 2 frames");

        if (blocks.GetArrayLength() == 3)
        {
            Check(blocks[0].GetProperty("type").GetString() == "text", "first block is text");
            Check(blocks[0].GetProperty("text").GetString() == extracted.Content, "text block repeats the summary");

            for (var index = 0; index < frames.Count; index++)
            {
                var block = blocks[index + 1];
                var source = block.GetProperty("source");
                Check(block.GetProperty("type").GetString() == "image", $"frame {index} is an image block");
                Check(source.GetProperty("type").GetString() == "base64", $"frame {index} source is base64");
                Check(source.GetProperty("mediaType").GetString() == "image/jpeg", $"frame {index} is a jpeg");
                Check(source.GetProperty("data").GetString() == frames[index].Data, $"frame {index} carries its own bytes");
                // 帧**不许**带 filePath：它是视频的一帧，不是某个图片文件。带上会让持久化只留路径、
                // 重新加载时把视频当图片读，预览面板也会渲染出一个打不开的图。
                Check(!source.TryGetProperty("filePath", out _), $"frame {index} carries no file path");
            }
        }
    }
    else
    {
        Check(false, "video read returns structured content");
    }

    // ── 降级 1：当前调用方没有抽帧通路 ──
    var noExtractor = await tool.ExecuteAsync(Input(video), new ToolExecutionContext(WorkingFolder: root));
    Check(noExtractor.ContentBlocks is null, "no extractor means no image blocks");
    Check(noExtractor.Content.Contains("not available in this run", StringComparison.Ordinal),
        "no extractor explains why nothing was extracted");

    // ── 降级 2：非 vision 模型 ──
    var blind = await tool.ExecuteAsync(
        Input(video),
        new ToolExecutionContext(
            WorkingFolder: root,
            SupportsVision: false,
            VideoFrameExtractor: (_, _) => Task.FromResult(new VideoFrameExtraction(frames, 5, 1920, 1080))));
    Check(blind.ContentBlocks is null, "non-vision video read carries no image block");
    Check(blind.Content.Contains("not marked as vision-capable", StringComparison.Ordinal),
        "non-vision video read explains why there are no frames");

    // ── 降级 3：超过体积上限（抽帧前就拒绝，不该白搬） ──
    var oversized = Path.Combine(root, "huge.mp4");
    File.WriteAllBytes(oversized, new byte[16]);
    using (var stream = new FileStream(oversized, FileMode.Open, FileAccess.Write))
    {
        stream.SetLength(VideoFileProbe.MaxBytes + 1);
    }

    var oversizeCalls = 0;
    var oversize = await tool.ExecuteAsync(
        Input(oversized),
        new ToolExecutionContext(
            WorkingFolder: root,
            VideoFrameExtractor: (_, _) =>
            {
                oversizeCalls++;
                return Task.FromResult(new VideoFrameExtraction(frames, 5, 1920, 1080));
            }));
    Check(oversize.ContentBlocks is null, "oversized video carries no image block");
    Check(oversize.Content.Contains("limit for frame extraction", StringComparison.Ordinal),
        "oversized video explains the limit");
    Check(oversizeCalls == 0, "oversized video never reaches the extractor");

    // ── 降级 4：渲染端抽帧失败 / 返回空帧表 ──
    var failure = await tool.ExecuteAsync(
        Input(video),
        new ToolExecutionContext(
            WorkingFolder: root,
            VideoFrameExtractor: (_, _) => Task.FromResult(new VideoFrameExtraction(Error: "this container is not supported"))));
    Check(failure.ContentBlocks is null, "failed extraction carries no image block");
    Check(failure.Content.Contains("this container is not supported", StringComparison.Ordinal),
        "failed extraction forwards the renderer's reason");
    Check(failure.Content.Contains("instead of guessing", StringComparison.Ordinal),
        "failed extraction tells the model not to guess");

    var emptyFrames = await tool.ExecuteAsync(
        Input(video),
        new ToolExecutionContext(
            WorkingFolder: root,
            VideoFrameExtractor: (_, _) => Task.FromResult(new VideoFrameExtraction(new List<VideoFrame>()))));
    Check(emptyFrames.ContentBlocks is null, "empty frame list carries no image block");
    Check(emptyFrames.Content.Contains("no frame was returned", StringComparison.Ordinal),
        "empty frame list is reported as a failure");

    // ── 文本与图像路径不受影响 ──
    var textFile = Path.Combine(root, "notes.txt");
    File.WriteAllText(textFile, "hello\nworld\n");
    var textResult = await tool.ExecuteAsync(Input(textFile), new ToolExecutionContext(WorkingFolder: root));
    Check(textResult.ContentBlocks is null, "plain text still returns string content");
    Check(textResult.Content.Contains("hello", StringComparison.Ordinal), "plain text content is returned");

    var imageFile = Path.Combine(root, "shot.png");
    File.WriteAllBytes(imageFile, BuildPng(24, 12));
    var imageResult = await tool.ExecuteAsync(
        Input(imageFile),
        new ToolExecutionContext(
            WorkingFolder: root,
            VideoFrameExtractor: (_, _) => Task.FromResult(new VideoFrameExtraction(frames, 5, 1920, 1080))));
    Check(imageResult.Content.StartsWith("Read image:", StringComparison.Ordinal), "images still take the image branch");

    // ── 不存在的视频仍走「文件不存在」，不会被抽帧分支截胡 ──
    var missing = await tool.ExecuteAsync(
        Input(Path.Combine(root, "nope.mp4")),
        new ToolExecutionContext(
            WorkingFolder: root,
            VideoFrameExtractor: (_, _) => Task.FromResult(new VideoFrameExtraction(frames, 5, 1920, 1080))));
    Check(missing.IsError, "missing video file is an error");
    Check(missing.ContentBlocks is null, "missing video file has no content blocks");
}
finally
{
    try
    {
        Directory.Delete(root, recursive: true);
    }
    catch
    {
        // 临时目录清不掉不影响断言结果。
    }
}

Console.WriteLine($"passed: {passed}, failed: {failed}");
return failed == 0 ? 0 : 1;

static JsonElement Input(string path)
{
    using var document = JsonDocument.Parse(JsonSerializer.Serialize(new { file_path = path }));
    return document.RootElement.Clone();
}

// 读渲染端那份清单：它就在仓库里，跨语言的重复靠逐项比对钉住。
static Dictionary<string, string> ReadRendererVideoMimeTypes(out string? error)
{
    error = null;
    var table = new Dictionary<string, string>(StringComparer.Ordinal);

    var file = FindRepoFile(Path.Combine("src", "renderer", "src", "lib", "media-file-types.ts"));
    if (file is null)
    {
        error = "could not locate src/renderer/src/lib/media-file-types.ts from the test binary path";
        return table;
    }

    var text = File.ReadAllText(file);
    var declaration = text.IndexOf("VIDEO_MIME_TYPES", StringComparison.Ordinal);
    if (declaration < 0)
    {
        error = "media-file-types.ts no longer exports VIDEO_MIME_TYPES";
        return table;
    }

    var open = text.IndexOf('{', declaration);
    var close = open < 0 ? -1 : text.IndexOf('}', open);
    if (open < 0 || close < 0)
    {
        error = "VIDEO_MIME_TYPES is no longer a plain object literal";
        return table;
    }

    foreach (Match match in Regex.Matches(text[(open + 1)..close], "'([^']+)'\\s*:\\s*'([^']+)'"))
    {
        table[match.Groups[1].Value] = match.Groups[2].Value;
    }

    if (table.Count == 0) error = "VIDEO_MIME_TYPES parsed to an empty table";
    return table;
}

static string? FindRepoFile(string relativePath)
{
    var directory = new DirectoryInfo(AppContext.BaseDirectory);
    while (directory is not null)
    {
        var candidate = Path.Combine(directory.FullName, relativePath);
        if (File.Exists(candidate)) return candidate;
        directory = directory.Parent;
    }

    return null;
}

// PNG: 8 字节签名 + IHDR 长度/类型 + 宽高（大端）。只为让 Read 认得出这是一张图。
static byte[] BuildPng(int width, int height)
{
    var buffer = new byte[33];
    new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }.CopyTo(buffer, 0);
    System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(buffer.AsSpan(8, 4), 13);
    Encoding.ASCII.GetBytes("IHDR").CopyTo(buffer, 12);
    System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(buffer.AsSpan(16, 4), width);
    System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(buffer.AsSpan(20, 4), height);
    return buffer;
}

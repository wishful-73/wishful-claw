// S-145 回归：Read 读图 —— 图像探测、content 数组形状、两种降级、文本不受影响。
//
// 约定：失败断言打 FAIL，最后一行打 "passed: N, failed: M"，非零退出码表示失败
// （scripts/run-tests.mjs 按退出码判定，按 "passed: N" 取计数）。

using System;
using System.Buffers.Binary;
using System.IO;
using System.Text;
using System.Text.Json;
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

var root = Path.Combine(Path.GetTempPath(), "wc-read-image-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);

try
{
    // ── 扩展名 / mediaType ──
    Check(ImageFileProbe.IsImagePath("a.png"), "png is an image");
    Check(ImageFileProbe.MediaTypeFor("a.JPG") == "image/jpeg", "uppercase .JPG maps to image/jpeg");
    Check(ImageFileProbe.MediaTypeFor("a.jpeg") == "image/jpeg", ".jpeg maps to image/jpeg");
    Check(ImageFileProbe.MediaTypeFor("a.webp") == "image/webp", ".webp maps to image/webp");
    Check(ImageFileProbe.MediaTypeFor("a.gif") == "image/gif", ".gif maps to image/gif");
    Check(ImageFileProbe.MediaTypeFor("a.bmp") == "image/bmp", ".bmp maps to image/bmp");
    Check(ImageFileProbe.MediaTypeFor("a.svg") is null, "svg stays out of scope");
    Check(!ImageFileProbe.IsImagePath("notes.txt"), "txt is not an image");

    // ── 尺寸解析：每种格式一条最小头 ──
    var png = Path.Combine(root, "shot.png");
    File.WriteAllBytes(png, BuildPng(24, 12));
    Check(ImageFileProbe.TryReadSize(png, out var pngW, out var pngH) && pngW == 24 && pngH == 12,
        "png size parsed (24x12)");

    var gif = Path.Combine(root, "anim.gif");
    File.WriteAllBytes(gif, BuildGif(7, 5));
    Check(ImageFileProbe.TryReadSize(gif, out var gifW, out var gifH) && gifW == 7 && gifH == 5,
        "gif size parsed (7x5)");

    var bmp = Path.Combine(root, "raw.bmp");
    File.WriteAllBytes(bmp, BuildBmp(33, 17));
    Check(ImageFileProbe.TryReadSize(bmp, out var bmpW, out var bmpH) && bmpW == 33 && bmpH == 17,
        "bmp size parsed (33x17)");

    var jpeg = Path.Combine(root, "photo.jpg");
    File.WriteAllBytes(jpeg, BuildJpeg(200, 100));
    Check(ImageFileProbe.TryReadSize(jpeg, out var jpgW, out var jpgH) && jpgW == 200 && jpgH == 100,
        "jpeg size parsed past APP0 (200x100)");

    var webp = Path.Combine(root, "wide.webp");
    File.WriteAllBytes(webp, BuildWebpVp8x(300, 150));
    Check(ImageFileProbe.TryReadSize(webp, out var webpW, out var webpH) && webpW == 300 && webpH == 150,
        "webp VP8X canvas size parsed (300x150)");

    // 头不完整时不能谎报尺寸。
    var truncated = Path.Combine(root, "truncated.png");
    File.WriteAllBytes(truncated, [0x89, 0x50, 0x4E, 0x47]);
    Check(!ImageFileProbe.TryReadSize(truncated, out _, out _), "truncated header reports no size");

    // ── Read 工具：图像走 image 块 ──
    var tool = new FileReadTool();
    var vision = await tool.ExecuteAsync(Input(png), new ToolExecutionContext(WorkingFolder: root));

    Check(vision.ContentBlocks is not null, "vision read returns structured content");
    Check(!vision.IsError, "vision read is not an error");
    Check(vision.Content.StartsWith("Read image:", StringComparison.Ordinal), "summary starts with 'Read image:'");

    if (vision.ContentBlocks is { } blocks)
    {
        Check(blocks.ValueKind == JsonValueKind.Array, "content blocks is an array");
        Check(blocks.GetArrayLength() == 2, "content blocks = text + image");
        var first = blocks[0];
        var second = blocks[1];
        Check(first.GetProperty("type").GetString() == "text", "first block is text");
        Check(second.GetProperty("type").GetString() == "image", "second block is image");

        var source = second.GetProperty("source");
        Check(source.GetProperty("type").GetString() == "base64", "image source is base64");
        Check(source.GetProperty("mediaType").GetString() == "image/png", "image mediaType is png");
        Check(source.GetProperty("data").GetString() is { Length: > 0 }, "image carries base64 data");
        // 路径必须在：渲染端按它 hydrate，DB 侧按它把 base64 换成占位。
        Check(source.GetProperty("filePath").GetString() == png, "image keeps the file path");
    }

    // ── 降级 1：非 vision 模型 ──
    var blind = await tool.ExecuteAsync(
        Input(png),
        new ToolExecutionContext(WorkingFolder: root, SupportsVision: false));
    Check(blind.ContentBlocks is null, "non-vision read carries no image block");
    Check(blind.Content.Contains("not marked as vision-capable", StringComparison.Ordinal),
        "non-vision read explains why there are no pixels");

    // ── 降级 2：超过内联上限 ──
    var oversized = Path.Combine(root, "huge.png");
    File.WriteAllBytes(oversized, BuildPng(4_000, 4_000));
    using (var stream = new FileStream(oversized, FileMode.Open, FileAccess.Write))
    {
        stream.SetLength(6L * 1024 * 1024);
    }
    var oversizeResult = await tool.ExecuteAsync(Input(oversized), new ToolExecutionContext(WorkingFolder: root));
    Check(oversizeResult.ContentBlocks is null, "oversized image carries no image block");
    Check(oversizeResult.Content.Contains("inline limit", StringComparison.Ordinal),
        "oversized image explains the limit");

    // ── 文本路径不受影响 ──
    var textFile = Path.Combine(root, "notes.txt");
    File.WriteAllText(textFile, "hello\nworld\n");
    var textResult = await tool.ExecuteAsync(Input(textFile), new ToolExecutionContext(WorkingFolder: root));
    Check(textResult.ContentBlocks is null, "plain text still returns string content");
    Check(textResult.Content.Contains("hello", StringComparison.Ordinal), "plain text content is returned");

    // ── 不存在的图像扩展名文件仍走"文件不存在" ──
    var missing = await tool.ExecuteAsync(
        Input(Path.Combine(root, "nope.png")),
        new ToolExecutionContext(WorkingFolder: root));
    Check(missing.IsError, "missing image file is an error");
    Check(missing.ContentBlocks is null, "missing image file has no content blocks");
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

// PNG: 8 字节签名 + IHDR 长度/类型 + 宽高（大端）。
static byte[] BuildPng(int width, int height)
{
    var buffer = new byte[33];
    new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }.CopyTo(buffer, 0);
    BinaryPrimitives.WriteInt32BigEndian(buffer.AsSpan(8, 4), 13);
    Encoding.ASCII.GetBytes("IHDR").CopyTo(buffer, 12);
    BinaryPrimitives.WriteInt32BigEndian(buffer.AsSpan(16, 4), width);
    BinaryPrimitives.WriteInt32BigEndian(buffer.AsSpan(20, 4), height);
    return buffer;
}

// GIF: "GIF89a" + 逻辑屏幕描述符（宽高各 2 字节小端）。
static byte[] BuildGif(int width, int height)
{
    var buffer = new byte[16];
    Encoding.ASCII.GetBytes("GIF89a").CopyTo(buffer, 0);
    BinaryPrimitives.WriteUInt16LittleEndian(buffer.AsSpan(6, 2), (ushort)width);
    BinaryPrimitives.WriteUInt16LittleEndian(buffer.AsSpan(8, 2), (ushort)height);
    return buffer;
}

// BMP: "BM" + 偏移 18/22 的宽高（4 字节小端，高度可为负）。
static byte[] BuildBmp(int width, int height)
{
    var buffer = new byte[30];
    buffer[0] = (byte)'B';
    buffer[1] = (byte)'M';
    BinaryPrimitives.WriteInt32LittleEndian(buffer.AsSpan(18, 4), width);
    BinaryPrimitives.WriteInt32LittleEndian(buffer.AsSpan(22, 4), height);
    return buffer;
}

// JPEG: SOI + 一个 APP0 段 + SOF0（高、宽各 2 字节大端），用来验证段跳读。
static byte[] BuildJpeg(int width, int height)
{
    var buffer = new byte[26];
    buffer[0] = 0xFF;
    buffer[1] = 0xD8;                                              // SOI
    buffer[2] = 0xFF;
    buffer[3] = 0xE0;                                              // APP0
    BinaryPrimitives.WriteUInt16BigEndian(buffer.AsSpan(4, 2), 4);  // 段长 4（含自身 2 字节）
    buffer[8] = 0xFF;
    buffer[9] = 0xC0;                                              // SOF0
    BinaryPrimitives.WriteUInt16BigEndian(buffer.AsSpan(10, 2), 11);
    buffer[12] = 8;                                                // 精度
    BinaryPrimitives.WriteUInt16BigEndian(buffer.AsSpan(13, 2), (ushort)height);
    BinaryPrimitives.WriteUInt16BigEndian(buffer.AsSpan(15, 2), (ushort)width);
    return buffer;
}

// WebP: RIFF/WEBP + VP8X 扩展块，画布尺寸存的是"实际值 - 1"（3 字节小端）。
static byte[] BuildWebpVp8x(int width, int height)
{
    var buffer = new byte[32];
    Encoding.ASCII.GetBytes("RIFF").CopyTo(buffer, 0);
    BinaryPrimitives.WriteInt32LittleEndian(buffer.AsSpan(4, 4), 24);
    Encoding.ASCII.GetBytes("WEBP").CopyTo(buffer, 8);
    Encoding.ASCII.GetBytes("VP8X").CopyTo(buffer, 12);
    BinaryPrimitives.WriteInt32LittleEndian(buffer.AsSpan(16, 4), 10);
    var w = width - 1;
    var h = height - 1;
    buffer[24] = (byte)(w & 0xFF);
    buffer[25] = (byte)((w >> 8) & 0xFF);
    buffer[26] = (byte)((w >> 16) & 0xFF);
    buffer[27] = (byte)(h & 0xFF);
    buffer[28] = (byte)((h >> 8) & 0xFF);
    buffer[29] = (byte)((h >> 16) & 0xFF);
    return buffer;
}

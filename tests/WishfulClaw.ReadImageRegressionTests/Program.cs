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
    // S-246 补刀：认不出就会掉进文本分支，二进制被当 UTF-8 读成乱码。
    Check(ImageFileProbe.MediaTypeFor("a.ico") == "image/x-icon", ".ico maps to image/x-icon (S-246 补刀)");
    Check(ImageFileProbe.MediaTypeFor("a.ICO") == "image/x-icon", "uppercase .ICO maps to image/x-icon");
    Check(ImageFileProbe.MediaTypeFor("a.tif") == "image/tiff", ".tif maps to image/tiff (S-246 补刀)");
    Check(ImageFileProbe.MediaTypeFor("a.tiff") == "image/tiff", ".tiff maps to image/tiff");
    Check(ImageFileProbe.MediaTypeFor("a.svg") is null, "svg stays out of scope");
    Check(!ImageFileProbe.IsImagePath("notes.txt"), "txt is not an image");

    // ── 尺寸解析：每种格式一条最小头 ──
    // S-266 起这张图必须是**真 PNG**：`png` 同时喂给 Read 工具（内联断言），
    // 而工具层现在会验尾部 IEND，只有头部 IHDR 的假图会被判「没写完」。
    var png = Path.Combine(root, "shot.png");
    File.WriteAllBytes(png, BuildRealPng(24, 12));
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

    var ico = Path.Combine(root, "app.ico");
    File.WriteAllBytes(ico, BuildIco(16, 16));
    Check(ImageFileProbe.TryReadSize(ico, out var icoW, out var icoH) && icoW == 16 && icoH == 16,
        "ico size parsed from the first directory entry (16x16)");

    // ICO 用 0 表示 256 —— 这是格式里唯一表达 256 的办法，别读成 0。
    var icoLarge = Path.Combine(root, "app-large.ico");
    File.WriteAllBytes(icoLarge, BuildIco(0, 0));
    Check(ImageFileProbe.TryReadSize(icoLarge, out var icoLW, out var icoLH) && icoLW == 256 && icoLH == 256,
        "ico byte 0 means 256, not zero");

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

    // ── S-246：上游不收的格式不内联像素 ──
    // bmp 能读尺寸、能认出格式，但 OpenAI 兼容通道只收 png/jpeg/webp/gif。
    // 修复前这里会内联 `data:image/bmp;base64,…`，上游回 400 unsupported image，
    // 而那个块留在会话历史里每轮重发 ⇒ 整个会话卡死。现在只回一行元信息。
    var bmpRead = await tool.ExecuteAsync(Input(bmp), new ToolExecutionContext(WorkingFolder: root));
    Check(bmpRead.ContentBlocks is null, "S-246: bmp carries no image block");
    Check(!bmpRead.IsError, "S-246: bmp read is not an error");
    Check(bmpRead.Content.Contains("image/bmp", StringComparison.Ordinal),
        "S-246: bmp read still reports the real format");
    Check(bmpRead.Content.Contains("only accept png/jpeg/webp/gif", StringComparison.Ordinal),
        "S-246: bmp read explains why the pixels were dropped");
    Check(!bmpRead.Content.Contains("inline limit", StringComparison.Ordinal),
        "S-246: bmp refusal is not confused with the size limit");

    // S-246 补刀：.ico 原先不在这张表里，于是被当文本读 —— 模型既看不到图，
    // 还吃进一屏乱码。现在走同一个闸门：无 image 块 + 一行元信息。
    var icoRead = await tool.ExecuteAsync(Input(ico), new ToolExecutionContext(WorkingFolder: root));
    Check(icoRead.ContentBlocks is null, "S-246 补刀: ico carries no image block");
    Check(!icoRead.IsError, "S-246 补刀: ico read is not an error");
    Check(icoRead.Content.StartsWith("Read image:", StringComparison.Ordinal),
        "S-246 补刀: ico goes through the image branch, not the text branch");
    Check(icoRead.Content.Contains("image/x-icon", StringComparison.Ordinal),
        "S-246 补刀: ico reports its real format");
    Check(icoRead.Content.Contains("16x16", StringComparison.Ordinal),
        "S-246 补刀: ico reports its size");
    Check(icoRead.Content.Contains("only accept png/jpeg/webp/gif", StringComparison.Ordinal),
        "S-246 补刀: ico explains why the pixels were dropped");
    Check(!icoRead.Content.Contains('\uFFFD'),
        "S-246 补刀: ico is not decoded as text (no replacement chars)");

    // ── S-236：非 vision 模型照常附图（配置不许替模型说「你不行」） ──
    // 旧行为是「判 false 就只回路径与尺寸，像素不附」，那张本地能力表追不上新模型/反代渠道/
    // 用户自定义模型，还会跨 provider 同名 id 串号，于是出现「截图能识图、Read 不能」。
    // 现在一律附像素，能不能收由上游回答；上游真不支持时由 ImageInputErrors 剥图重试（档 2）。
    var blind = await tool.ExecuteAsync(
        Input(png),
        new ToolExecutionContext(WorkingFolder: root, SupportsVision: false));
    Check(blind.ContentBlocks is not null, "S-236: a model marked non-vision still gets the pixels");
    Check(!blind.Content.Contains("not marked as vision-capable", StringComparison.Ordinal),
        "S-236: the old 'not marked as vision-capable' refusal is gone");

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

    // ── S-266：签名合法但没写完 —— 判读图失败，不许内联 ──
    // 签名在文件开头，截断的文件照样合法，所以档 4「认不出签名」天生够不着这一类：
    // 修复前它会过白名单、被贴上 image/png 送上游，换回 400 invalid image，
    // 坏块留在历史里每轮重发 —— 和 S-246 同一个现场，只是触发条件从「格式不收」变成「数据不全」。
    var realPngBytes = BuildRealPng(24, 12);
    var halfPng = Path.Combine(root, "half.png");
    File.WriteAllBytes(halfPng, realPngBytes[..^12]);         // 砍掉 12 字节 IEND 块
    var halfPngRead = await tool.ExecuteAsync(Input(halfPng), new ToolExecutionContext(WorkingFolder: root));
    Check(halfPngRead.IsError, "S-266: truncated png is an error");
    Check(halfPngRead.ContentBlocks is null, "S-266: truncated png carries no image block");
    Check(halfPngRead.Content.Contains("end marker is missing", StringComparison.Ordinal),
        "S-266: truncated png reports the missing end marker");
    Check(!halfPngRead.Content.Contains("signature not recognized", StringComparison.Ordinal),
        "S-266: a truncated file is not confused with an unrecognized signature");

    // 头还在、尺寸也读得出的截断图同样要拦 —— 尺寸解析成功不等于文件完整。
    Check(ImageFileProbe.TryReadSize(halfPng, out var halfW, out var halfH) && halfW == 24 && halfH == 12,
        "S-266: truncated png still has a readable header (that is why it slipped through)");

    // 截断的 jpeg / gif 走同一条判据。
    var halfJpeg = Path.Combine(root, "half.jpg");
    File.WriteAllBytes(halfJpeg, ClosedJpeg()[..^2]);          // 砍掉 EOI（FF D9）
    var halfJpegRead = await tool.ExecuteAsync(Input(halfJpeg), new ToolExecutionContext(WorkingFolder: root));
    Check(halfJpegRead.IsError, "S-266: truncated jpeg is an error");
    Check(halfJpegRead.ContentBlocks is null, "S-266: truncated jpeg carries no image block");

    var halfGif = Path.Combine(root, "half.gif");
    File.WriteAllBytes(halfGif, ClosedGif(7, 5)[..^1]);        // 砍掉 trailer（0x3B）
    var halfGifRead = await tool.ExecuteAsync(Input(halfGif), new ToolExecutionContext(WorkingFolder: root));
    Check(halfGifRead.IsError, "S-266: truncated gif is an error");
    Check(halfGifRead.ContentBlocks is null, "S-266: truncated gif carries no image block");

    // 空文件（0 字节）：一个字节的图都没有，同样不能用「认不出」以外的方式放行。
    var empty = Path.Combine(root, "empty.png");
    File.WriteAllBytes(empty, []);
    var emptyRead = await tool.ExecuteAsync(Input(empty), new ToolExecutionContext(WorkingFolder: root));
    Check(emptyRead.IsError, "S-266: zero-byte image is an error");
    Check(emptyRead.ContentBlocks is null, "S-266: zero-byte image carries no image block");

    // ── S-266 反例：完整的容器一个字都不许误伤 ──
    // 判据写宽了等于把看图能力砍掉，所以这几种「完整但非典型」的图必须照样内联。
    var closedPng = Path.Combine(root, "closed.png");
    File.WriteAllBytes(closedPng, realPngBytes);
    var closedPngRead = await tool.ExecuteAsync(Input(closedPng), new ToolExecutionContext(WorkingFolder: root));
    Check(!closedPngRead.IsError, "S-266: a complete png is not an error");
    Check(closedPngRead.ContentBlocks is not null, "S-266: a complete png keeps its pixels");

    // IEND 之后追加了私有数据（某些编辑器会这么干）仍算完整。
    var trailingPng = Path.Combine(root, "trailing.png");
    File.WriteAllBytes(trailingPng, [.. realPngBytes, .. new byte[8]]);
    var trailingPngRead = await tool.ExecuteAsync(Input(trailingPng), new ToolExecutionContext(WorkingFolder: root));
    Check(!trailingPngRead.IsError, "S-266: png with trailing bytes after IEND is still accepted");
    Check(trailingPngRead.ContentBlocks is not null, "S-266: png with trailing bytes keeps its pixels");

    var closedGif = Path.Combine(root, "closed.gif");
    File.WriteAllBytes(closedGif, ClosedGif(7, 5));
    var closedGifRead = await tool.ExecuteAsync(Input(closedGif), new ToolExecutionContext(WorkingFolder: root));
    Check(!closedGifRead.IsError, "S-266: a complete gif is not an error");
    Check(closedGifRead.ContentBlocks is not null, "S-266: a complete gif keeps its pixels");

    // WebP 用 RIFF 声明长度判定，不靠尾部标记 —— 声明值对得上就算完整。
    var closedWebpRead = await tool.ExecuteAsync(Input(webp), new ToolExecutionContext(WorkingFolder: root));
    Check(!closedWebpRead.IsError, "S-266: a complete webp is not an error");
    Check(closedWebpRead.ContentBlocks is not null, "S-266: a complete webp keeps its pixels");

    // ── S-264：同一判据的 base64 入口（组包层在用）──
    // Read 工具走 path；渲染层注入的历史块只以 base64 出现，组包时才是第一次见到字节。
    // 现场 18 条图像 400 里 13 条走微信渠道 —— 那条路根本不经过 Read 工具。
    var realPngB64 = Convert.ToBase64String(realPngBytes);
    Check(ImageFileProbe.HasCompleteContainerInBase64(realPngB64, "image/png"),
        "S-264: complete png base64 passes the container check");
    Check(!ImageFileProbe.HasCompleteContainerInBase64(Convert.ToBase64String(realPngBytes[..^12]), "image/png"),
        "S-264: truncated png base64 is rejected (the wechat path)");
    Check(ImageFileProbe.HasCompleteContainerInBase64(Convert.ToBase64String(ClosedJpeg()), "image/jpeg"),
        "S-264: complete jpeg base64 passes");
    Check(!ImageFileProbe.HasCompleteContainerInBase64(Convert.ToBase64String(ClosedJpeg()[..^2]), "image/jpeg"),
        "S-264: truncated jpeg base64 is rejected");
    Check(!ImageFileProbe.HasCompleteContainerInBase64(Convert.ToBase64String(ClosedGif(7, 5)[..^1]), "image/gif"),
        "S-264: truncated gif base64 is rejected");

    // 渲染层存的是整条 data URL，前缀必须能剥掉。
    Check(ImageFileProbe.HasCompleteContainerInBase64("data:image/png;base64," + realPngB64, "image/png"),
        "S-264: data URL prefix is stripped before the check");

    // 尾部追加字节仍算完整 —— 与 path 版同一容忍度，不许两版各有一套。
    var trailingPngBytes = realPngBytes.Concat(new byte[8]).ToArray();
    Check(ImageFileProbe.HasCompleteContainerInBase64(Convert.ToBase64String(trailingPngBytes), "image/png"),
        "S-264: png base64 with trailing bytes is still complete");
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
// 只造头，**不是**合法 PNG —— 只用于验证"尺寸解析"，别拿它喂 Read 工具的完整性判定。
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

// ICO: 6 字节头（reserved=0, type=1, 图像数）+ 首个目录项（宽高各 1 字节，0 表示 256）。
static byte[] BuildIco(int width, int height)
{
    var buffer = new byte[22];
    buffer[2] = 1;                       // type = icon
    buffer[4] = 1;                       // 1 帧
    buffer[6] = (byte)(width & 0xFF);
    buffer[7] = (byte)(height & 0xFF);
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

// ── S-266 素材：真正**完整**的容器 ──
// 上面那些"造头"的工厂只够骗过尺寸解析；容器完整性按尾部结束标记判，
// 所以下面这几个才带 IEND / EOI / trailer，才有资格断言"完整图不许误伤"。

// 最小合法 PNG：签名 + IHDR + IDAT（stored deflate，不压缩）+ IEND。
// 自己编码而不是内嵌 base64，是为了让尺寸可参数化、坏图可精确截断。
static byte[] BuildRealPng(int width, int height)
{
    var raw = new byte[height * (1 + width * 3)];   // 每行 1 字节 filter(=0) + RGB

    var ihdr = new byte[13];
    BinaryPrimitives.WriteInt32BigEndian(ihdr.AsSpan(0, 4), width);
    BinaryPrimitives.WriteInt32BigEndian(ihdr.AsSpan(4, 4), height);
    ihdr[8] = 8;    // 位深
    ihdr[9] = 2;    // 色彩类型 RGB
    ihdr[10] = 0;   // 压缩方法
    ihdr[11] = 0;   // 滤波方法
    ihdr[12] = 0;   // 非隔行

    using var stream = new MemoryStream();
    stream.Write([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    WritePngChunk(stream, "IHDR", ihdr);
    WritePngChunk(stream, "IDAT", ZlibStored(raw));
    WritePngChunk(stream, "IEND", []);
    return stream.ToArray();
}

static void WritePngChunk(Stream stream, string type, byte[] data)
{
    var length = new byte[4];
    BinaryPrimitives.WriteInt32BigEndian(length, data.Length);
    stream.Write(length);

    var typeBytes = Encoding.ASCII.GetBytes(type);
    stream.Write(typeBytes);
    stream.Write(data);

    var crcInput = new byte[typeBytes.Length + data.Length];
    typeBytes.CopyTo(crcInput, 0);
    data.CopyTo(crcInput, typeBytes.Length);

    var crc = new byte[4];
    BinaryPrimitives.WriteUInt32BigEndian(crc, Crc32(crcInput));
    stream.Write(crc);
}

// zlib 容器 + 只用 stored（不压缩）的 deflate 块 + Adler-32 校验。
// 够生成合法 PNG 即可，不追求压缩率。
static byte[] ZlibStored(byte[] raw)
{
    using var stream = new MemoryStream();
    stream.WriteByte(0x78);   // CMF: deflate, 32K 窗口
    stream.WriteByte(0x01);   // FLG: 无字典，最快

    var offset = 0;
    do
    {
        var size = Math.Min(65535, raw.Length - offset);
        var isFinal = offset + size >= raw.Length;
        stream.WriteByte((byte)(isFinal ? 1 : 0));          // BFINAL + BTYPE=00（stored）
        stream.WriteByte((byte)(size & 0xFF));
        stream.WriteByte((byte)(size >> 8));
        stream.WriteByte((byte)(~size & 0xFF));
        stream.WriteByte((byte)((~size >> 8) & 0xFF));
        stream.Write(raw, offset, size);
        offset += size;
    }
    while (offset < raw.Length);

    uint a = 1, b = 0;
    foreach (var value in raw)
    {
        a = (a + value) % 65521;
        b = (b + a) % 65521;
    }
    var adler = (b << 16) | a;
    stream.WriteByte((byte)(adler >> 24));
    stream.WriteByte((byte)(adler >> 16));
    stream.WriteByte((byte)(adler >> 8));
    stream.WriteByte((byte)adler);

    return stream.ToArray();
}

static uint Crc32(byte[] data)
{
    var crc = 0xFFFFFFFFu;
    foreach (var value in data)
    {
        crc ^= value;
        for (var bit = 0; bit < 8; bit++)
        {
            crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
        }
    }
    return crc ^ 0xFFFFFFFFu;
}

// 带 EOI 的最小 JPEG：SOI + SOF0（只为尺寸可读）+ EOI。数据段不是真熵编码，
// 但尾部标记齐全 —— S-266 判的就是这个。
static byte[] ClosedJpeg()
{
    var buffer = new byte[28];
    BuildJpeg(200, 100).CopyTo(buffer, 0);
    buffer[26] = 0xFF;
    buffer[27] = 0xD9;   // EOI
    return buffer;
}

// 带 trailer 的最小 GIF：GIF89a + 逻辑屏幕描述符 + ... + 0x3B。
static byte[] ClosedGif(int width, int height)
{
    var buffer = new byte[20];
    BuildGif(width, height).CopyTo(buffer, 0);
    buffer[19] = 0x3B;   // trailer
    return buffer;
}

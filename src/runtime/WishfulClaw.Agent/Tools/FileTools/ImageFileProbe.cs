using System;

using System.Buffers.Binary;

using System.IO;

namespace WishfulClaw.Agent.Tools.FileTools;

/// <summary>
/// 图像文件的最小探测（S-145）。只做两件事：按扩展名给出 mediaType、从文件头读出像素尺寸。
///
/// 为什么自己读头而不是引入图像库：尺寸只用于给模型写一行说明（"Read image: x.png (800x600, image/png)"），
/// 不参与任何渲染或布局计算。为这一行说明引入一个图像解码依赖，AOT 体积和攻击面都不划算。
/// 每种格式只读它在头里固定位置的那几个字节，读不到就返回 false —— 调用方退回"尺寸未知"，
/// 图像本身照旧按 base64 送出去。
/// </summary>
internal static class ImageFileProbe
{
    /// <summary>读取的文件头长度。JPEG 的 SOF 段可能排在 EXIF 之后，4 KB 足够覆盖常见情况。</summary>
    private const int HeaderBytes = 4096;

    /// <summary>
    /// 签名探测读多少字节。最长的签名是 RIFF-WEBP 的 12 字节；
    /// SVG 靠文本嗅探（<c>&lt;?xml version="1.0"?&gt;</c> + <c>&lt;svg</c> 约 25 字节）。
    /// 512 字节留足余量，代价可以忽略。
    /// </summary>
    private const int SignatureBytes = 512;

    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    /// <summary>
    /// 按扩展名判断是不是本工具认的图像；不是则返回 null。
    ///
    /// **这张表的语义是「这是图像文件」，不是「上游收这张图」。** 两者必须分开：
    /// 这里认出来的格式会走 <c>FileReadTool.ReadImage</c>，由那道闸门按上游白名单决定
    /// 附不附像素；认不出来的会掉进普通文本分支，被 <c>StreamReader</c> 当 UTF-8 逐行读 ——
    /// 一个二进制图标变成一屏 `�PNG���` 乱码塞进上下文（S-246 补刀：.ico 原先就是这么坏的）。
    ///
    /// 所以「上游不收」的格式（bmp / tiff / ico）更要在这张表里：认出来才能走对分支、
    /// 才能只回一行元信息。唯一刻意不列的是 .svg —— 它是文本，让模型读源码比给一行
    /// 「格式不接受」有用得多。
    /// </summary>
    public static string? MediaTypeFor(string path)
    {
        var extension = Path.GetExtension(path).ToLowerInvariant();
        return extension switch
        {
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            ".gif" => "image/gif",
            ".bmp" => "image/bmp",
            ".ico" => "image/x-icon",
            ".tif" or ".tiff" => "image/tiff",
            _ => null
        };
    }

    public static bool IsImagePath(string path) => MediaTypeFor(path) is not null;

    /// <summary>
    /// 按**文件头的真实签名**判断这是什么图（S-264），不信扩展名。
    ///
    /// 与 <see cref="MediaTypeFor"/> 的分工：那个回答「扩展名声称是什么」，这个回答「字节实际是什么」。
    /// 两者不一致是常见情况（截图后手动改名），此时以真实签名为准。
    ///
    /// 判据**不在这里重写一遍** —— 直接复用
    /// <see cref="ProviderContentHelpers.DetectImageMediaTypeFromBase64"/>，与组包层
    /// （<c>ResolveSupportedImageMediaType</c>）同源。两份魔数表迟早会漂，一份就不会。
    ///
    /// 返回 <c>null</c> 表示**认不出** —— 损坏、半截写入、非图像内容都属于这一类。
    /// 调用方据此判「读图失败」，不要当成「格式未知但图是好的」：脏图送上上游只会换回
    /// 400 <c>unsupported image</c>，而那个坏块会留在历史里每轮重发（S-246 / S-261 的现场）。
    /// </summary>
    public static string? DetectMediaTypeFromFile(string path)
    {
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            var buffer = new byte[SignatureBytes];
            var read = stream.ReadAtLeast(buffer, buffer.Length, throwOnEndOfStream: false);
            if (read <= 0) return null;

            return ProviderContentHelpers.DetectImageMediaTypeFromBase64(
                Convert.ToBase64String(buffer.AsSpan(0, read)));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // 读不到就当认不出：这一步的失败不能变成异常往上抛，调用方会把它当「读图失败」处理。
            return null;
        }
    }

    /// <summary>PNG 结束块固定 12 字节：长度 0 + "IEND" + 固定 CRC（AE 42 60 82）。</summary>
    private static readonly byte[] PngEndChunk = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82];

    /// <summary>读尾部判定结束标记时取的窗口。四种容器都只有几十字节的尾部特征。</summary>
    private const int TailBytes = 64;

    /// <summary>
    /// 容器完整性判定（S-266）：签名合法，但文件本身**写完了没有**。
    ///
    /// 与 <see cref="DetectMediaTypeFromFile"/> 的分工：那个只读前 512 字节，回答「这是什么格式」；
    /// 这个读尾部几十字节，回答「这格式的文件是不是完整的」。截断的文件签名永远合法 ——
    /// 下载到一半的 PNG、被中断的写入、坏扇区，头 8 字节照样是 `\x89PNG`，所以前一档拦不住。
    ///
    /// 判据只用各容器的**尾部结束标记**，不解码像素、不读全文，代价是常数级：
    ///   · PNG  —— 末尾必须是 IEND 块（12 字节定值，含 CRC）
    ///   · JPEG —— 末尾必须是 EOI（FF D9）
    ///   · GIF  —— 末尾必须是 trailer（0x3B）
    ///   · WebP —— RIFF 头里声明的长度必须覆盖到实际文件末尾
    ///
    /// 为什么不用「能不能解码」当判据：真解码要引入完整解码器（PNG 要 inflate + 反滤波，
    /// JPEG 要熵解码），AOT 体积和攻击面都远超一个「别把坏图发上去」的需求。
    /// 而现场绝大多数脏图是**截断**，结束标记缺失一条就够抓住了。
    ///
    /// BMP / TIFF / ICO 返回 true（不拦）：它们本来就不走内联像素，坏不坏都由档 3 处理。
    /// 结束标记之后容忍少量追加字节（见各档的 tolerance）：某些相机 / 编辑器会在文件尾
    /// 追加私有数据，为此误杀正常图不划算 —— 漏检的代价只是上游 400 一次（有 S-262 兜底），
    /// 误杀的代价是模型彻底看不到一张好图。
    /// </summary>
    public static bool HasCompleteContainer(string path, string mediaType)
    {
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            var length = stream.Length;
            if (length < 16) return false;

            var head = ReadWindow(stream, 0, (int)Math.Min(length, 16));
            var tail = ReadWindow(stream, Math.Max(0, length - TailBytes), (int)Math.Min(length, TailBytes));

            return JudgeContainer(head, tail, length, mediaType);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // 读不到就不拦。这一层是「别把明显的坏图发上去」，不是安全边界：
            // 判定本身失败时，上游的 400 仍有 S-261/S-262 的自愈与告知兜底。
            return true;
        }
    }

    /// <summary>
    /// base64 载荷版的容器完整性判定（S-264）。
    ///
    /// 为什么必须有这一版：S-266 把判据做成了 <c>path</c> 形态，于是只有 Read 工具能用。
    /// 而现场 18 条图像 400 里 13 条走微信渠道 —— 那条路的图从来不是 agent 用 Read 读出来的，
    /// 是渲染层注入的历史块，组包时才第一次见到字节。判据得活在**组包层**，
    /// 否则修完 Read 路径只治了一半，需求却已经关了。
    ///
    /// 只解头部 16 字符和尾部一个窗口，不解全量：一张 4 MB 的图不该为了看一眼尾巴就整段解码。
    /// 解不开（非标准 base64、长度不是 4 的倍数）一律放行，交给上游 400 + S-262 兜底 ——
    /// 与 path 版「读不到就不拦」是同一个取舍。
    /// </summary>
    public static bool HasCompleteContainerInBase64(string? base64, string mediaType)
    {
        try
        {
            var data = ProviderContentHelpers.StripDataUrlPrefix(base64);
            if (string.IsNullOrEmpty(data) || data.Length < 24) return false;

            // 总字节数只需精确到「WebP 声明的长度够不够」，padding 修正一下就够。
            var totalLength = (long)data.Length / 4 * 3;
            if (data.EndsWith("==", StringComparison.Ordinal)) totalLength -= 2;
            else if (data.EndsWith('=')) totalLength -= 1;

            var head = Convert.FromBase64String(data[..16]);

            // 尾部窗口：TailBytes 字节要 4/3 倍字符，先取整再对齐到 4 字符边界（多读几个字节无害）。
            var tailStart = Math.Max(0, data.Length - (TailBytes / 3 + 1) * 4);
            tailStart -= tailStart % 4;
            var tail = Convert.FromBase64String(data[tailStart..]);

            return JudgeContainer(head, tail, totalLength, mediaType);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return true;
        }
    }

    /// <summary>判据本体：头部 + 尾部窗口 + 总长 ⇒ 容器写完了没有。path 版与 base64 版共用这一份。</summary>
    private static bool JudgeContainer(
        ReadOnlySpan<byte> head, ReadOnlySpan<byte> tail, long totalLength, string mediaType)
    {
        return mediaType switch
        {
            // IEND 之后不允许有数据（规范严格），只留 16 字节余量给追加元信息的编辑器。
            "image/png" => HasTrailerInTail(tail, PngEndChunk, tolerance: 16),
            // JPEG 尾部追加比 PNG 常见（缩略图 / 水印 / MPF），放宽一档。
            "image/jpeg" => HasTrailerInTail(tail, [0xFF, 0xD9], tolerance: 32),
            // GIF trailer 是单字节，容忍放宽就会撞上压缩数据里的普通 0x3B，必须收紧。
            "image/gif" => HasTrailerInTail(tail, [0x3B], tolerance: 2),
            "image/webp" => HasWebpDeclaredLength(head, totalLength),
            _ => true
        };
    }

    /// <summary>从流里读一段固定窗口；偏移与长度由调用方裁到可用范围内。</summary>
    private static byte[] ReadWindow(FileStream stream, long offset, int count)
    {
        var buffer = new byte[count];
        stream.Seek(offset, SeekOrigin.Begin);
        stream.ReadExactly(buffer);
        return buffer;
    }

    /// <summary>
    /// 在尾部窗口里找结束标记，且要求它离末尾不超过 <paramref name="tolerance"/> 字节
    /// （即：标记之后最多追加了这么多字节）。
    /// </summary>
    private static bool HasTrailerInTail(ReadOnlySpan<byte> tail, ReadOnlySpan<byte> trailer, int tolerance)
    {
        // 从后往前找：只有最后一个命中才是真正的结束标记，压缩数据里可能恰好出现同样的字节。
        for (var i = tail.Length - trailer.Length; i >= 0; i--)
        {
            if (!tail.Slice(i, trailer.Length).SequenceEqual(trailer)) continue;
            return i + trailer.Length >= tail.Length - tolerance;
        }

        return false;
    }

    /// <summary>WebP: RIFF 头声明的容器长度（偏移 4，不含前 8 字节本身）必须够到文件末尾。</summary>
    private static bool HasWebpDeclaredLength(ReadOnlySpan<byte> head, long totalLength)
    {
        if (head.Length < 12) return false;
        if (!head[..4].SequenceEqual("RIFF"u8) || !head[8..12].SequenceEqual("WEBP"u8)) return false;

        var declared = BinaryPrimitives.ReadUInt32LittleEndian(head[4..8]);
        // 声明长度 + 8 字节头 = 容器应有的大小；写全了才够到文件末尾（允许尾部追加数据）。
        return declared >= 12 && 8L + declared <= totalLength;
    }

    /// <summary>读像素尺寸；格式不认或头不完整时返回 false（width/height 置 0）。</summary>
    public static bool TryReadSize(string path, out int width, out int height)
    {
        width = 0;
        height = 0;

        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            var buffer = new byte[HeaderBytes];
            var read = stream.ReadAtLeast(buffer, buffer.Length, throwOnEndOfStream: false);
            if (read < 16) return false;

            var head = buffer.AsSpan(0, read);

            if (head.Length >= 24 && head[..8].SequenceEqual(PngSignature)) return TryReadPngSize(head, out width, out height);
            if (head.Length >= 10 && (head[..6].SequenceEqual("GIF87a"u8) || head[..6].SequenceEqual("GIF89a"u8)))
                return TryReadGifSize(head, out width, out height);
            if (head.Length >= 26 && head[0] == (byte)'B' && head[1] == (byte)'M') return TryReadBmpSize(head, out width, out height);
            if (head.Length >= 8 && head[0] == 0 && head[1] == 0 && head[2] == 1 && head[3] == 0
                && (head[4] | (head[5] << 8)) > 0)
                return TryReadIcoSize(head, out width, out height);
            if (head.Length >= 4 && head[0] == 0xFF && head[1] == 0xD8) return TryReadJpegSize(head, out width, out height);
            if (head.Length >= 30 && head[..4].SequenceEqual("RIFF"u8) && head[8..12].SequenceEqual("WEBP"u8))
                return TryReadWebpSize(head, out width, out height);

            return false;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return false;
        }
    }

    /// <summary>
    /// ICO/CUR: 6 字节头（reserved=0、type=1 表示图标、图像数）之后是目录项，
    /// 首个目录项的宽高各占 1 字节，**0 表示 256**（这是 ICO 格式里唯一表达 256 的办法）。
    /// 只取第一帧尺寸：图标是多尺寸打包，给模型「16x16」比给「尺寸未知」有用。
    /// </summary>
    private static bool TryReadIcoSize(ReadOnlySpan<byte> head, out int width, out int height)
    {
        width = head[6] == 0 ? 256 : head[6];
        height = head[7] == 0 ? 256 : head[7];
        return width > 0 && height > 0;
    }

    /// <summary>PNG: 8 字节签名 + IHDR（宽高各 4 字节大端，起点固定）。</summary>
    private static bool TryReadPngSize(ReadOnlySpan<byte> head, out int width, out int height)
    {
        width = BinaryPrimitives.ReadInt32BigEndian(head[16..20]);
        height = BinaryPrimitives.ReadInt32BigEndian(head[20..24]);
        return width > 0 && height > 0;
    }

    /// <summary>GIF: 逻辑屏幕描述符在偏移 6，宽高各 2 字节小端。</summary>
    private static bool TryReadGifSize(ReadOnlySpan<byte> head, out int width, out int height)
    {
        width = BinaryPrimitives.ReadUInt16LittleEndian(head[6..8]);
        height = BinaryPrimitives.ReadUInt16LittleEndian(head[8..10]);
        return width > 0 && height > 0;
    }

    /// <summary>BMP: 偏移 18/22 是宽高（带符号 4 字节小端，高度可为负表示上下翻转）。</summary>
    private static bool TryReadBmpSize(ReadOnlySpan<byte> head, out int width, out int height)
    {
        width = BinaryPrimitives.ReadInt32LittleEndian(head[18..22]);
        height = Math.Abs(BinaryPrimitives.ReadInt32LittleEndian(head[22..26]));
        return width > 0 && height > 0;
    }

    /// <summary>
    /// JPEG: 从偏移 2 起逐段跳（每段 2 字节长度头），找到 SOFn（0xC0–0xCF，去掉 0xC4/0xC8/0xCC 这三个非 SOF）
    /// 后取高、宽各 2 字节大端。
    /// </summary>
    private static bool TryReadJpegSize(ReadOnlySpan<byte> head, out int width, out int height)
    {
        width = 0;
        height = 0;

        var offset = 2;
        while (offset + 4 <= head.Length)
        {
            if (head[offset] != 0xFF) return false;

            var marker = head[offset + 1];
            // 填充字节（0xFF 连续）与无负载标记直接跳过。
            if (marker == 0xFF) { offset++; continue; }
            if (marker is 0xD8 or 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { offset += 2; continue; }
            // 压缩数据起始之后不再有尺寸段（正常文件在此之前就已返回）。
            if (marker is 0xDA or 0xD9) return false;

            var segmentLength = BinaryPrimitives.ReadUInt16BigEndian(head[(offset + 2)..(offset + 4)]);
            if (segmentLength < 2) return false;

            var isStartOfFrame = marker >= 0xC0 && marker <= 0xCF && marker is not (0xC4 or 0xC8 or 0xCC);
            if (isStartOfFrame)
            {
                if (offset + 9 > head.Length) return false;
                height = BinaryPrimitives.ReadUInt16BigEndian(head[(offset + 5)..(offset + 7)]);
                width = BinaryPrimitives.ReadUInt16BigEndian(head[(offset + 7)..(offset + 9)]);
                return width > 0 && height > 0;
            }

            offset += 2 + segmentLength;
        }

        return false;
    }

    /// <summary>
    /// WebP: RIFF 容器，三种 payload ——
    /// VP8（有损）尺寸在帧头；VP8L（无损）尺寸是 14 位位打包；VP8X（扩展/动图）存画布尺寸减一。
    /// </summary>
    private static bool TryReadWebpSize(ReadOnlySpan<byte> head, out int width, out int height)
    {
        width = 0;
        height = 0;

        var chunk = head[12..16];

        if (chunk.SequenceEqual("VP8 "u8))
        {
            if (head.Length < 30) return false;
            width = BinaryPrimitives.ReadUInt16LittleEndian(head[26..28]) & 0x3FFF;
            height = BinaryPrimitives.ReadUInt16LittleEndian(head[28..30]) & 0x3FFF;
            return width > 0 && height > 0;
        }

        if (chunk.SequenceEqual("VP8L"u8))
        {
            if (head.Length < 25 || head[20] != 0x2F) return false;
            var bits = (uint)(head[21] | (head[22] << 8) | (head[23] << 16) | (head[24] << 24));
            width = (int)(bits & 0x3FFF) + 1;
            height = (int)((bits >> 14) & 0x3FFF) + 1;
            return width > 0 && height > 0;
        }

        if (chunk.SequenceEqual("VP8X"u8))
        {
            if (head.Length < 30) return false;
            width = (head[24] | (head[25] << 8) | (head[26] << 16)) + 1;
            height = (head[27] | (head[28] << 8) | (head[29] << 16)) + 1;
            return width > 0 && height > 0;
        }

        return false;
    }
}

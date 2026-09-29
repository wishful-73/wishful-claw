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

    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    /// <summary>按扩展名判断是不是本工具认的图像；不是则返回 null。</summary>
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
            _ => null
        };
    }

    public static bool IsImagePath(string path) => MediaTypeFor(path) is not null;

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

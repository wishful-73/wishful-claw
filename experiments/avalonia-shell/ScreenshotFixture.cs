using System.IO.Compression;
using System.Text;

namespace WishfulClaw.AvaloniaProbe;

/// <summary>
/// 生成一张 2520×1680 的 PNG 当测试图。
///
/// 为什么自己写 PNG 而不是引一张图进仓库：
/// · 仓库里塞一张 12 MB 的测试图，会一直跟着 clone 走；
/// · 也不能引 System.Drawing.Common —— 那会把原型的依赖面弄脏，
///   而「依赖面有多干净」正是这条评估要说明的事之一。
///
/// 尺寸对齐我们桌面截图工具的真实产出（2520×1680 @1.5x）。
/// </summary>
internal static class ScreenshotFixture
{
    public static void EnsurePng(string path, int width, int height)
    {
        var info = new FileInfo(path);
        if (info.Exists && info.Length > 0) return;

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        // 每行一个 filter 字节（0 = None）+ RGB 三通道。
        var stride = width * 3 + 1;
        var raw = new byte[stride * height];

        for (var y = 0; y < height; y++)
        {
            var rowStart = y * stride;
            raw[rowStart] = 0;

            for (var x = 0; x < width; x++)
            {
                var offset = rowStart + 1 + x * 3;

                // 渐变 + 一点网格线，让它看起来像一张真实截图而不是纯色块：
                // 纯色图的压缩率过于理想，解码后的位图行为会和真实截图有差。
                var r = (byte)(x * 255 / width);
                var g = (byte)(y * 255 / height);
                var b = (byte)(((x / 40) % 2 == 0 ^ (y / 40) % 2 == 0) ? 200 : 120);

                raw[offset] = r;
                raw[offset + 1] = g;
                raw[offset + 2] = b;
            }
        }

        using var file = File.Create(path);
        file.Write(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A });

        var header = new byte[13];
        WriteBigEndian(header, 0, (uint)width);
        WriteBigEndian(header, 4, (uint)height);
        header[8] = 8;   // bit depth
        header[9] = 2;   // color type: truecolour
        header[10] = 0;  // compression
        header[11] = 0;  // filter
        header[12] = 0;  // interlace
        WriteChunk(file, "IHDR", header);

        using (var compressed = new MemoryStream())
        {
            using (var zlib = new ZLibStream(compressed, CompressionLevel.Optimal, leaveOpen: true))
            {
                zlib.Write(raw, 0, raw.Length);
            }

            WriteChunk(file, "IDAT", compressed.ToArray());
        }

        WriteChunk(file, "IEND", Array.Empty<byte>());
    }

    private static void WriteChunk(Stream stream, string type, byte[] data)
    {
        var length = new byte[4];
        WriteBigEndian(length, 0, (uint)data.Length);
        stream.Write(length);

        var typeBytes = Encoding.ASCII.GetBytes(type);
        stream.Write(typeBytes);
        stream.Write(data);

        var crcInput = new byte[typeBytes.Length + data.Length];
        Buffer.BlockCopy(typeBytes, 0, crcInput, 0, typeBytes.Length);
        Buffer.BlockCopy(data, 0, crcInput, typeBytes.Length, data.Length);

        var crc = new byte[4];
        WriteBigEndian(crc, 0, Crc32(crcInput));
        stream.Write(crc);
    }

    private static void WriteBigEndian(byte[] target, int offset, uint value)
    {
        target[offset] = (byte)(value >> 24);
        target[offset + 1] = (byte)(value >> 16);
        target[offset + 2] = (byte)(value >> 8);
        target[offset + 3] = (byte)value;
    }

    private static readonly uint[] CrcTable = BuildCrcTable();

    private static uint[] BuildCrcTable()
    {
        var table = new uint[256];
        for (uint n = 0; n < 256; n++)
        {
            var c = n;
            for (var k = 0; k < 8; k++)
            {
                c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            }

            table[n] = c;
        }

        return table;
    }

    private static uint Crc32(byte[] data)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var b in data)
        {
            crc = CrcTable[(crc ^ b) & 0xFF] ^ (crc >> 8);
        }

        return crc ^ 0xFFFFFFFFu;
    }
}

using System.Buffers;
using System.Buffers.Binary;
using System.Text;
using System.Text.Json;

namespace WishfulClaw.Core.Protocol;

/// <summary>
/// Low-level MessagePack scalar writers: string, integer (signed/unsigned, all widths), double, bytes.
/// Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
internal static partial class MessagePackJsonWriter
{
    // ── Low-level MessagePack writers ──



    private static void WriteString(ArrayBufferWriter<byte> buffer, string value)

    {

        var byteCount = Encoding.UTF8.GetByteCount(value);

        WriteStringHeader(buffer, byteCount);



        var span = buffer.GetSpan(byteCount);

        var written = Encoding.UTF8.GetBytes(value, span);

        buffer.Advance(written);

    }

    private static void WriteStringHeader(ArrayBufferWriter<byte> buffer, int length)

    {

        if (length <= 31)

        {

            WriteByte(buffer, (byte)(0xa0 | length));

            return;

        }



        if (length <= byte.MaxValue)

        {

            WriteByte(buffer, 0xd9);

            WriteByte(buffer, (byte)length);

            return;

        }



        if (length <= ushort.MaxValue)

        {

            WriteByte(buffer, 0xda);

            WriteUInt16(buffer, (ushort)length);

            return;

        }



        WriteByte(buffer, 0xdb);

        WriteUInt32(buffer, checked((uint)length));

    }

    private static void WriteInt(ArrayBufferWriter<byte> buffer, long value)

    {

        if (value >= 0)

        {

            WriteUInt(buffer, (ulong)value);

            return;

        }



        if (value >= -32)

        {

            WriteByte(buffer, unchecked((byte)value));

            return;

        }



        if (value >= sbyte.MinValue)

        {

            WriteByte(buffer, 0xd0);

            WriteByte(buffer, unchecked((byte)(sbyte)value));

            return;

        }



        if (value >= short.MinValue)

        {

            WriteByte(buffer, 0xd1);

            WriteInt16(buffer, (short)value);

            return;

        }



        if (value >= int.MinValue)

        {

            WriteByte(buffer, 0xd2);

            WriteInt32(buffer, (int)value);

            return;

        }



        WriteByte(buffer, 0xd3);

        WriteInt64(buffer, value);

    }

    private static void WriteUInt(ArrayBufferWriter<byte> buffer, ulong value)

    {

        if (value <= 0x7f)

        {

            WriteByte(buffer, (byte)value);

            return;

        }



        if (value <= byte.MaxValue)

        {

            WriteByte(buffer, 0xcc);

            WriteByte(buffer, (byte)value);

            return;

        }



        if (value <= ushort.MaxValue)

        {

            WriteByte(buffer, 0xcd);

            WriteUInt16(buffer, (ushort)value);

            return;

        }



        if (value <= uint.MaxValue)

        {

            WriteByte(buffer, 0xce);

            WriteUInt32(buffer, (uint)value);

            return;

        }



        WriteByte(buffer, 0xcf);

        WriteUInt64(buffer, value);

    }

    private static void WriteDouble(ArrayBufferWriter<byte> buffer, double value)

    {

        if (!double.IsFinite(value))

        {

            throw new InvalidDataException("MessagePack JSON transcoder does not support non-finite numbers.");

        }



        WriteByte(buffer, 0xcb);

        Span<byte> bytes = stackalloc byte[sizeof(long)];

        BinaryPrimitives.WriteInt64BigEndian(bytes, BitConverter.DoubleToInt64Bits(value));

        WriteBytes(buffer, bytes);

    }

    private static void WriteByte(ArrayBufferWriter<byte> buffer, byte value)

    {

        var span = buffer.GetSpan(1);

        span[0] = value;

        buffer.Advance(1);

    }

    private static void WriteBytes(ArrayBufferWriter<byte> buffer, ReadOnlySpan<byte> value)

    {

        var span = buffer.GetSpan(value.Length);

        value.CopyTo(span);

        buffer.Advance(value.Length);

    }

    private static void WriteUInt16(ArrayBufferWriter<byte> buffer, ushort value)

    {

        Span<byte> bytes = stackalloc byte[sizeof(ushort)];

        BinaryPrimitives.WriteUInt16BigEndian(bytes, value);

        WriteBytes(buffer, bytes);

    }

    private static void WriteInt16(ArrayBufferWriter<byte> buffer, short value)

    {

        Span<byte> bytes = stackalloc byte[sizeof(short)];

        BinaryPrimitives.WriteInt16BigEndian(bytes, value);

        WriteBytes(buffer, bytes);

    }

    private static void WriteUInt32(ArrayBufferWriter<byte> buffer, uint value)

    {

        Span<byte> bytes = stackalloc byte[sizeof(uint)];

        BinaryPrimitives.WriteUInt32BigEndian(bytes, value);

        WriteBytes(buffer, bytes);

    }

    private static void WriteInt32(ArrayBufferWriter<byte> buffer, int value)

    {

        Span<byte> bytes = stackalloc byte[sizeof(int)];

        BinaryPrimitives.WriteInt32BigEndian(bytes, value);

        WriteBytes(buffer, bytes);

    }

    private static void WriteUInt64(ArrayBufferWriter<byte> buffer, ulong value)

    {

        Span<byte> bytes = stackalloc byte[sizeof(ulong)];

        BinaryPrimitives.WriteUInt64BigEndian(bytes, value);

        WriteBytes(buffer, bytes);

    }

    private static void WriteInt64(ArrayBufferWriter<byte> buffer, long value)

    {

        Span<byte> bytes = stackalloc byte[sizeof(long)];

        BinaryPrimitives.WriteInt64BigEndian(bytes, value);

        WriteBytes(buffer, bytes);

    }
}

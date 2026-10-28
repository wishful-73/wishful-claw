namespace WishfulClaw.Core.Protocol;



using System.Buffers;

using System.Buffers.Binary;

using System.Text;

using System.Text.Json;



/// <summary>

/// Writes JSON data as MessagePack binary.

/// Extracted from MessagePackJsonTranscoder to keep files focused.

/// </summary>

internal static partial class MessagePackJsonWriter

{


    private static void WriteArrayHeader(ArrayBufferWriter<byte> buffer, int length)

    {

        if (length <= 15)

        {

            WriteByte(buffer, (byte)(0x90 | length));

            return;

        }



        if (length <= ushort.MaxValue)

        {

            WriteByte(buffer, 0xdc);

            WriteUInt16(buffer, (ushort)length);

            return;

        }



        WriteByte(buffer, 0xdd);

        WriteUInt32(buffer, checked((uint)length));

    }

    private static void WriteMapHeader(ArrayBufferWriter<byte> buffer, int length)

    {

        if (length <= 15)

        {

            WriteByte(buffer, (byte)(0x80 | length));

            return;

        }



        if (length <= ushort.MaxValue)

        {

            WriteByte(buffer, 0xde);

            WriteUInt16(buffer, (ushort)length);

            return;

        }



        WriteByte(buffer, 0xdf);

        WriteUInt32(buffer, checked((uint)length));

    }
}

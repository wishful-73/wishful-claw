using System.Buffers;
using System.Buffers.Binary;
using System.Text;
using System.Text.Json;

namespace WishfulClaw.Core.Protocol;

/// <summary>
/// JSON token walking: transcoding from JsonElement / UTF-8 JSON into MessagePack tokens and
/// counting container sizes. Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
internal static partial class MessagePackJsonWriter
{
    public static byte[] FromJson(JsonElement element)

    {

        var buffer = new ArrayBufferWriter<byte>();

        WriteJsonElement(buffer, element);

        return buffer.WrittenMemory.ToArray();

    }

    public static byte[] FromJson(ReadOnlySpan<byte> json)

    {

        try

        {

            var reader = new Utf8JsonReader(json, isFinalBlock: true, state: default);

            if (!reader.Read())

            {

                throw new InvalidDataException("JSON response is empty.");

            }



            var writer = new WorkerMessagePackWriter();

            WriteJsonToken(ref reader, writer);

            if (reader.Read())

            {

                throw new InvalidDataException("JSON response contains trailing data.");

            }

            return writer.ToArray();

        }

        catch (Exception ex)

        {

            var jsonStr = System.Text.Encoding.UTF8.GetString(json);

            System.Console.Error.WriteLine($"[FromJson] PARSE ERROR: {ex.Message}");

            System.Console.Error.WriteLine($"[FromJson] JSON length={json.Length}");

            System.Console.Error.WriteLine($"[FromJson] JSON content: {jsonStr}");

            throw;

        }

    }

    private static void WriteJsonToken(

        ref Utf8JsonReader reader,

        WorkerMessagePackWriter writer)

    {

        switch (reader.TokenType)

        {

            case JsonTokenType.StartObject:

                writer.WriteMapHeader(CountContainerItems(reader, countProperties: true));

                while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)

                {

                    if (reader.TokenType != JsonTokenType.PropertyName)

                    {

                        throw new InvalidDataException("Invalid JSON object token sequence.");

                    }

                    writer.WriteString(reader.GetString() ?? string.Empty);

                    if (!reader.Read())

                    {

                        throw new InvalidDataException("JSON object ended before its property value.");

                    }

                    WriteJsonToken(ref reader, writer);

                }

                break;

            case JsonTokenType.StartArray:

                writer.WriteArrayHeader(CountContainerItems(reader, countProperties: false));

                while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)

                {

                    WriteJsonToken(ref reader, writer);

                }

                break;

            case JsonTokenType.String:

                writer.WriteString(reader.GetString() ?? string.Empty);

                break;

            case JsonTokenType.Number when reader.TryGetInt64(out var signed):

                writer.WriteInt64(signed);

                break;

            case JsonTokenType.Number when reader.TryGetUInt64(out var unsigned):

                writer.WriteUInt64(unsigned);

                break;

            case JsonTokenType.Number:

                writer.WriteDouble(reader.GetDouble());

                break;

            case JsonTokenType.True:

                writer.WriteBoolean(true);

                break;

            case JsonTokenType.False:

                writer.WriteBoolean(false);

                break;

            case JsonTokenType.Null:

                writer.WriteNil();

                break;

            default:

                throw new InvalidDataException($"Unsupported JSON token: {reader.TokenType}");

        }

    }

    private static int CountContainerItems(Utf8JsonReader start, bool countProperties)

    {

        var reader = start;

        var nestedDepth = 0;

        var count = 0;

        while (reader.Read())

        {

            if (nestedDepth == 0)

            {

                if (countProperties && reader.TokenType == JsonTokenType.PropertyName)

                {

                    count++;

                }

                else if (!countProperties && IsValueToken(reader.TokenType))

                {

                    count++;

                }

            }



            if (reader.TokenType is JsonTokenType.StartObject or JsonTokenType.StartArray)

            {

                nestedDepth++;

            }

            else if (reader.TokenType is JsonTokenType.EndObject or JsonTokenType.EndArray)

            {

                if (nestedDepth == 0)

                {

                    break;

                }

                nestedDepth--;

            }

        }

        return count;

    }

    private static bool IsValueToken(JsonTokenType tokenType)

    {

        return tokenType is

            JsonTokenType.StartObject or

            JsonTokenType.StartArray or

            JsonTokenType.String or

            JsonTokenType.Number or

            JsonTokenType.True or

            JsonTokenType.False or

            JsonTokenType.Null;

    }

    // ── JsonElement → MessagePack ──



    private static void WriteJsonElement(ArrayBufferWriter<byte> buffer, JsonElement element)

    {

        switch (element.ValueKind)

        {

            case JsonValueKind.Object:

                WriteMapHeader(buffer, CountProperties(element));

                foreach (var property in element.EnumerateObject())

                {

                    WriteString(buffer, property.Name);

                    WriteJsonElement(buffer, property.Value);

                }

                break;

            case JsonValueKind.Array:

                WriteArrayHeader(buffer, element.GetArrayLength());

                foreach (var item in element.EnumerateArray())

                {

                    WriteJsonElement(buffer, item);

                }

                break;

            case JsonValueKind.String:

                WriteString(buffer, element.GetString() ?? string.Empty);

                break;

            case JsonValueKind.Number:

                WriteNumber(buffer, element);

                break;

            case JsonValueKind.True:

                WriteByte(buffer, 0xc3);

                break;

            case JsonValueKind.False:

                WriteByte(buffer, 0xc2);

                break;

            case JsonValueKind.Null:

            case JsonValueKind.Undefined:

                WriteByte(buffer, 0xc0);

                break;

            default:

                throw new InvalidDataException($"Unsupported JSON value kind: {element.ValueKind}");

        }

    }

    private static void WriteNumber(ArrayBufferWriter<byte> buffer, JsonElement element)

    {

        if (element.TryGetInt64(out var signed))

        {

            WriteInt(buffer, signed);

            return;

        }



        if (element.TryGetUInt64(out var unsigned))

        {

            WriteUInt(buffer, unsigned);

            return;

        }



        WriteDouble(buffer, element.GetDouble());

    }

    private static int CountProperties(JsonElement element)

    {

        var count = 0;

        foreach (var _ in element.EnumerateObject())

        {

            count++;

        }



        return count;

    }
}

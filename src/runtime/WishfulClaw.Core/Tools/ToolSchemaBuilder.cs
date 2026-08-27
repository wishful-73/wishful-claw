using System.Buffers;
using System.Text.Json;

namespace WishfulClaw.Core.Tools;

/// <summary>
/// Helper to build JSON schemas for tool definitions.
/// Provides a fluent API for constructing JSON Schema objects.
/// AOT-safe: uses Utf8JsonWriter instead of JsonSerializer.Serialize.
/// </summary>
public static class ToolSchemaBuilder
{
    public static JsonElement Object(
        Dictionary<string, JsonElement>? properties = null,
        string[]? required = null)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("type", "object");
            writer.WritePropertyName("properties");
            if (properties is not null)
            {
                writer.WriteStartObject();
                foreach (var kvp in properties)
                {
                    writer.WritePropertyName(kvp.Key);
                    kvp.Value.WriteTo(writer);
                }
                writer.WriteEndObject();
            }
            else
            {
                writer.WriteStartObject();
                writer.WriteEndObject();
            }
            writer.WritePropertyName("required");
            writer.WriteStartArray();
            if (required is not null)
                foreach (var r in required)
                    writer.WriteStringValue(r);
            writer.WriteEndArray();
            writer.WriteEndObject();
        }
        using var doc = JsonDocument.Parse(buffer.WrittenMemory);
        return doc.RootElement.Clone();
    }

    public static JsonElement String(string description, string[]? enumValues = null)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("type", "string");
            writer.WriteString("description", description);
            if (enumValues is not null)
            {
                writer.WritePropertyName("enum");
                writer.WriteStartArray();
                foreach (var v in enumValues)
                    writer.WriteStringValue(v);
                writer.WriteEndArray();
            }
            writer.WriteEndObject();
        }
        using var doc = JsonDocument.Parse(buffer.WrittenMemory);
        return doc.RootElement.Clone();
    }

    public static JsonElement Number(string description)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("type", "number");
            writer.WriteString("description", description);
            writer.WriteEndObject();
        }
        using var doc = JsonDocument.Parse(buffer.WrittenMemory);
        return doc.RootElement.Clone();
    }

    public static JsonElement Integer(string description)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("type", "integer");
            writer.WriteString("description", description);
            writer.WriteEndObject();
        }
        using var doc = JsonDocument.Parse(buffer.WrittenMemory);
        return doc.RootElement.Clone();
    }

    public static JsonElement Boolean(string description)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("type", "boolean");
            writer.WriteString("description", description);
            writer.WriteEndObject();
        }
        using var doc = JsonDocument.Parse(buffer.WrittenMemory);
        return doc.RootElement.Clone();
    }

    public static JsonElement ArraySchema(string description, JsonElement? items = null)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("type", "array");
            writer.WriteString("description", description);
            if (items.HasValue)
            {
                writer.WritePropertyName("items");
                items.Value.WriteTo(writer);
            }
            writer.WriteEndObject();
        }
        using var doc = JsonDocument.Parse(buffer.WrittenMemory);
        return doc.RootElement.Clone();
    }
}

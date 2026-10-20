using System.Buffers;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace WishfulClaw.Contracts;

public sealed class WorkerResponse
{
    private readonly Action<Utf8JsonWriter> _resultWriter;

    private WorkerResponse(Action<Utf8JsonWriter> resultWriter)
    {
        _resultWriter = resultWriter;
    }

    public static WorkerResponse Json<T>(T result)
    {
        // Resolve JsonTypeInfo<T> from the source-generated context at runtime.
        // The Serialize<T>(Utf8JsonWriter, T, JsonTypeInfo<T>) overload has no AOT warnings.
        var typeInfo = WorkerJsonHelper.GetTypeInfo<T>();
        return new WorkerResponse(writer => JsonSerializer.Serialize(writer, result, typeInfo));
    }

    public static WorkerResponse Json<T>(T result, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo)
    {
        return new WorkerResponse(writer => JsonSerializer.Serialize(writer, result, typeInfo));
    }

    public static WorkerResponse String(string result)
    {
        return new WorkerResponse(writer => writer.WriteStringValue(result));
    }

    public static WorkerResponse FromWriter(Action<Utf8JsonWriter> writeResult)
    {
        return new WorkerResponse(writeResult);
    }

    public static WorkerResponse RawJson(string result)
    {
        return new WorkerResponse(writer =>
        {
            try
            {
                using var document = JsonDocument.Parse(result);
                document.RootElement.WriteTo(writer);
            }
            catch
            {
                writer.WriteStringValue(result);
            }
        });
    }

    public static WorkerResponse Error(string message)
    {
        return Json(new ErrorResult(message));
    }

    public byte[] ToJsonBytes(JsonElement? id)
    {
        return WorkerJsonHelper.WriteResponse(id, _resultWriter);
    }
}

public sealed record ErrorResult(string Error);
public sealed record StatusResult(bool Ok, int Pid);
public sealed record WorkerRoutesResult(string[] Methods);

public static class WorkerJsonHelper
{
    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static readonly JsonSerializerOptions IndentedJsonOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    public static void ConfigureAotResolver(System.Text.Json.Serialization.Metadata.IJsonTypeInfoResolver? resolver)
    {
        if (resolver != null)
        {
            JsonOptions.TypeInfoResolver = resolver;
            IndentedJsonOptions.TypeInfoResolver = resolver;
        }
    }

    /// <summary>
    /// Gets the source-generated <see cref="JsonTypeInfo{T}"/> for type <typeparamref name="T"/>.
    /// Use this instead of passing <see cref="JsonOptions"/> to <c>JsonSerializer.Serialize&lt;T&gt;</c>
    /// to avoid AOT trim warnings (IL2026/IL3050).
    /// </summary>
    public static System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> GetTypeInfo<T>()
    {
        return (System.Text.Json.Serialization.Metadata.JsonTypeInfo<T>)JsonOptions.GetTypeInfo(typeof(T))!;
    }

    public static byte[] WriteResponse(JsonElement? id, Action<Utf8JsonWriter> writeResult)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            WriteId(writer, id);
            writer.WritePropertyName("result");
            writeResult(writer);
            writer.WriteEndObject();
        }
        return buffer.WrittenMemory.ToArray();
    }

    public static byte[] WriteEvent(string eventName, Action<Utf8JsonWriter> writeParameters)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            writer.WriteString("event", eventName);
            writer.WritePropertyName("params");
            writeParameters(writer);
            writer.WriteEndObject();
        }
        return buffer.WrittenMemory.ToArray();
    }

    private static void WriteId(Utf8JsonWriter writer, JsonElement? id)
    {
        writer.WritePropertyName("id");
        if (id.HasValue)
            id.Value.WriteTo(writer);
        else
            writer.WriteNullValue();
    }

    /// <summary>
    /// Builds a JsonElement using Utf8JsonWriter - AOT-safe (no reflection).
    /// </summary>
    /// <remarks>
    /// The callback owns the *entire* document shape — this helper builds the writer and
    /// nothing else. It does NOT open an object or an array for you, so a callback that
    /// starts with <c>writer.WriteString(...)</c> or <c>writer.WritePropertyName(...)</c>
    /// throws <c>InvalidOperationException</c>: a property name cannot be the first token of
    /// a document. Always bracket the body with <c>WriteStartObject()</c> /
    /// <c>WriteEndObject()</c> (or the array pair) when you mean to build an object.
    ///
    /// In a published AOT build the framework's resource strings are trimmed away, so that
    /// exception degrades to <c>CannotWritePropertyWithinArray, None</c> — which names
    /// neither the offending method nor the cause. If you see that message, look for a
    /// callback here that forgot its wrapper.
    /// </remarks>
    public static JsonElement BuildJsonElement(Action<Utf8JsonWriter> write)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            write(writer);
        }
        using var doc = JsonDocument.Parse(buffer.WrittenMemory);
        return doc.RootElement.Clone();
    }

    /// <summary>
    /// Builds a JSON string using Utf8JsonWriter - AOT-safe (no reflection).
    /// </summary>
    public static string BuildJsonString(Action<Utf8JsonWriter> write)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            write(writer);
        }
        return System.Text.Encoding.UTF8.GetString(buffer.WrittenSpan);
    }
}

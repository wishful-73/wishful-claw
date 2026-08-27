using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Worker;

/// <summary>
/// Parsed worker request from a MessagePack frame.
/// Extracted from LocalIpcWorkerServer to keep files focused.
/// </summary>
internal sealed class ParsedWorkerRequest : IDisposable
{
    private readonly JsonDocument _document;

    private ParsedWorkerRequest(
        JsonDocument document,
        JsonElement? id,
        string method,
        JsonElement parameters,
        int frameLength)
    {
        _document = document;
        Id = id;
        Method = method;
        Parameters = parameters;
        FrameLength = frameLength;
    }

    public JsonElement? Id { get; }

    public string Method { get; }

    public JsonElement Parameters { get; }

    public int FrameLength { get; }

    public static ParsedWorkerRequest Parse(ReadOnlyMemory<byte> frame)
    {
        var document = MessagePackFrameProtocol.ConvertRequestToJsonDocument(frame);
        try
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                throw new InvalidDataException("Request root must be an object.");
            }

            JsonElement? id = root.TryGetProperty("id", out var idElement)
                ? idElement.Clone()
                : null;
            var method = JsonHelpers.GetString(root, "method") ??
                throw new InvalidOperationException("Missing method");
            var parameters = root.TryGetProperty("params", out var paramsElement)
                ? paramsElement
                : default;
            return new ParsedWorkerRequest(document, id, method, parameters, frame.Length);
        }
        catch
        {
            document.Dispose();
            throw;
        }
    }

    public void Dispose()
    {
        _document.Dispose();
    }
}

/// <summary>
/// Frame writing and request formatting helpers for IPC communication.
/// Extracted from LocalIpcWorkerServer.
/// </summary>
internal static class WorkerIpcHelpers
{
    public static async ValueTask WriteEventFrameAsync(
        Stream stream,
        SemaphoreSlim writeLock,
        string eventName,
        Action<Utf8JsonWriter> writeParameters,
        CancellationToken cancellationToken)
    {
        var encoded = MessagePackFrameProtocol.EncodeEvent(eventName, writeParameters);
        await WritePayloadAsync(stream, writeLock, encoded, cancellationToken);
    }

    public static async ValueTask WriteMessagePackEventFrameAsync(
        Stream stream,
        SemaphoreSlim writeLock,
        WorkerMessagePackEvent messagePackEvent,
        CancellationToken cancellationToken)
    {
        if (messagePackEvent.Payload.IsEmpty)
        {
            return;
        }
        await WritePayloadAsync(stream, writeLock, messagePackEvent.Payload, cancellationToken);
    }

    public static async ValueTask WritePayloadAsync(
        Stream stream,
        SemaphoreSlim writeLock,
        ReadOnlyMemory<byte> payload,
        CancellationToken cancellationToken)
    {
        await writeLock.WaitAsync(cancellationToken);
        try
        {
            await MessagePackFrameProtocol.WriteFrameAsync(stream, payload, cancellationToken);
        }
        finally
        {
            writeLock.Release();
        }
    }

    public static long GetElapsedMilliseconds(long startedAt)
    {
        return (long)Math.Round(Stopwatch.GetElapsedTime(startedAt).TotalMilliseconds);
    }

    public static string FormatRequestId(JsonElement? id)
    {
        if (!id.HasValue)
        {
            return "null";
        }

        var value = id.Value;
        return value.ValueKind switch
        {
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.String => value.GetString() ?? string.Empty,
            JsonValueKind.Null => "null",
            JsonValueKind.Undefined => "undefined",
            _ => value.GetRawText()
        };
    }

    public static string? FormatRequestKey(JsonElement? id)
    {
        if (!id.HasValue || id.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return $"{id.Value.ValueKind}:{id.Value.GetRawText()}";
    }

    public static void CancelRequest(
        JsonElement parameters,
        ConcurrentDictionary<string, CancellationTokenSource> activeRequests)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("requestId", out var requestId))
        {
            return;
        }

        var key = FormatRequestKey(requestId);
        if (key is not null && activeRequests.TryGetValue(key, out var requestCts))
        {
            requestCts.Cancel();
        }
        else
        {
            WorkerLog.Warn($"worker/cancel target not found key={key ?? "null"}");
        }
    }

    public static int ReadLimit(string variableName, int defaultValue, int minimum, int maximum)
    {
        var raw = Environment.GetEnvironmentVariable(variableName);
        return int.TryParse(raw, out var value)
            ? Math.Clamp(value, minimum, maximum)
            : Math.Clamp(defaultValue, minimum, maximum);
    }

    public static void TryDeleteSocketFile(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
            // Best effort cleanup; bind will surface any real failure.
        }
    }
}

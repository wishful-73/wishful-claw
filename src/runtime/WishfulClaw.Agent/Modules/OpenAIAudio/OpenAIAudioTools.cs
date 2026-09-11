/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Buffers;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Agent.Modules.OpenAIAudio;

/// <summary>
/// OpenAI audio tools — speech-to-text transcription and text-to-speech synthesis.
/// Calls OpenAI-compatible /audio/transcriptions and /audio/speech endpoints.
/// </summary>
public static class OpenAIAudioTools
{
    private const int MaxAudioInputBytes = 32 * 1024 * 1024;
    private const int MaxAudioResponseBytes = 64 * 1024 * 1024;
    private const int MaxTranscriptionResponseBytes = 4 * 1024 * 1024;
    private const int MaxSpeechInputChars = 20_000;

    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        PooledConnectionLifetime = TimeSpan.FromMinutes(5)
    })
    {
        Timeout = TimeSpan.FromMinutes(10)
    };

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    // ── Transcription (speech-to-text) ──

    public static async Task<WorkerResponse> TranscribeAsync(
        JsonElement parameters,
        IWorkerRequestContext context)
    {
        var provider = GetObject(parameters, "provider");
        ValidateProvider(provider);

        var file = GetObject(parameters, "file");
        var base64 = NormalizeBase64(JsonHelpers.GetString(file, "base64") ?? string.Empty);
        if (string.IsNullOrWhiteSpace(base64))
        {
            throw new InvalidOperationException("OpenAI audio transcription requires file.base64.");
        }

        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(base64);
        }
        catch (FormatException ex)
        {
            throw new InvalidOperationException("Invalid base64 audio data.", ex);
        }

        if (bytes.Length > MaxAudioInputBytes)
        {
            throw new InvalidOperationException(
                $"Audio input exceeds the {MaxAudioInputBytes} byte limit.");
        }

        var mediaType = NormalizeMediaType(JsonHelpers.GetString(file, "mediaType"));
        var fileName = NormalizeFileName(JsonHelpers.GetString(file, "fileName"), mediaType);

        var url = $"{GetBaseUrl(provider)}/audio/transcriptions";
        using var content = new MultipartFormDataContent();

        var fileContent = new ByteArrayContent(bytes);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(mediaType);
        content.Add(fileContent, "file", fileName);

        var model = JsonHelpers.GetString(provider, "model") ?? string.Empty;
        if (!string.IsNullOrEmpty(model))
        {
            content.Add(new StringContent(model), "model");
        }

        // Apply request overrides
        ApplyFormOverrides(content, provider);

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Content = content;
        ApplyOpenAIHeaders(request, provider);

        WorkerLog.Debug($"openai audio transcription model={model} url={url} bytes={bytes.Length}");

        using var response = await Http.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            context.CancellationToken);

        var responseBytes = await ReadResponseBytesAsync(
            response.Content, MaxTranscriptionResponseBytes, context.CancellationToken);
        var responseText = Encoding.UTF8.GetString(responseBytes);

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Audio transcription failed HTTP {(int)response.StatusCode}: {ExtractErrorMessage(responseText)}");
        }

        var text = ParseTranscriptionText(responseText);

        return WorkerResponse.FromWriter(w =>
        {
            w.WriteStartObject();
            w.WriteString("text", text);
            w.WriteEndObject();
        });
    }

    // ── Speech synthesis (text-to-speech) ──

    public static async Task<WorkerResponse> SpeechAsync(
        JsonElement parameters,
        IWorkerRequestContext context)
    {
        var provider = GetObject(parameters, "provider");
        ValidateProvider(provider);

        var input = (JsonHelpers.GetString(parameters, "input") ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(input))
        {
            throw new InvalidOperationException("Speech synthesis requires input text.");
        }
        if (input.Length > MaxSpeechInputChars)
        {
            throw new InvalidOperationException(
                $"Speech synthesis input exceeds {MaxSpeechInputChars} characters.");
        }

        var voice = JsonHelpers.GetString(parameters, "voice")?.Trim();
        var instruction = JsonHelpers.GetString(parameters, "instruction")?.Trim();
        var format = (JsonHelpers.GetString(parameters, "format") ?? "mp3").Trim().ToLowerInvariant();

        var url = $"{GetBaseUrl(provider)}/audio/speech";

        var model = JsonHelpers.GetString(provider, "model") ?? string.Empty;
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            if (!string.IsNullOrEmpty(model))
            {
                writer.WriteString("model", model);
            }
            writer.WriteString("input", input);
            if (!string.IsNullOrWhiteSpace(voice))
            {
                writer.WriteString("voice", voice);
            }
            writer.WriteString("response_format", format);
            if (!string.IsNullOrWhiteSpace(instruction))
            {
                writer.WriteString("instructions", instruction);
            }
            ApplyBodyOverrides(writer, provider);
            writer.WriteEndObject();
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Content = new ByteArrayContent(buffer.WrittenSpan.ToArray());
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        ApplyOpenAIHeaders(request, provider);

        WorkerLog.Debug($"openai audio speech model={model} url={url}");

        using var response = await Http.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            context.CancellationToken);

        var audioBytes = await ReadResponseBytesAsync(
            response.Content, MaxAudioResponseBytes, context.CancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var errorText = Encoding.UTF8.GetString(audioBytes);
            throw new InvalidOperationException(
                $"Speech synthesis failed HTTP {(int)response.StatusCode}: {ExtractErrorMessage(errorText)}");
        }

        // Persist audio to file
        var extension = format switch
        {
            "wav" or "pcm" or "pcm16" => ".wav",
            "opus" => ".opus",
            "aac" => ".aac",
            "flac" => ".flac",
            _ => ".mp3"
        };

        var audioMediaType = format switch
        {
            "mp3" => "audio/mpeg",
            "wav" or "pcm" or "pcm16" => "audio/wav",
            "opus" => "audio/ogg",
            "aac" => "audio/aac",
            "flac" => "audio/flac",
            _ => "audio/mpeg"
        };

        var mediaDir = WishfulClawDataDir.Resolve(
            "media", "audio",
            DateTime.UtcNow.ToString("yyyy-MM-dd"));
        Directory.CreateDirectory(mediaDir);

        var filePath = Path.Combine(mediaDir,
            $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Guid.NewGuid():N}{extension}");
        await File.WriteAllBytesAsync(filePath, audioBytes, context.CancellationToken);

        return WorkerResponse.FromWriter(w =>
        {
            w.WriteStartObject();
            w.WriteString("filePath", filePath);
            w.WriteString("mediaType", audioMediaType);
            w.WriteNumber("bytes", audioBytes.Length);
            w.WriteEndObject();
        });
    }

    // ── Helpers ──

    private static async Task<byte[]> ReadResponseBytesAsync(
        HttpContent content,
        int maxBytes,
        CancellationToken cancellationToken)
    {
        if (content.Headers.ContentLength is long len && len > maxBytes)
        {
            throw new InvalidOperationException($"Response exceeds the {maxBytes} byte limit.");
        }

        await using var stream = await content.ReadAsStreamAsync(cancellationToken);
        using var ms = new MemoryStream();
        var buffer = new byte[64 * 1024];
        int total = 0;
        while (true)
        {
            var read = await stream.ReadAsync(buffer, cancellationToken);
            if (read == 0) break;
            total += read;
            if (total > maxBytes)
            {
                throw new InvalidOperationException($"Response exceeds the {maxBytes} byte limit.");
            }
            ms.Write(buffer, 0, read);
        }
        return ms.ToArray();
    }

    private static string ParseTranscriptionText(string responseText)
    {
        if (string.IsNullOrWhiteSpace(responseText)) return string.Empty;
        try
        {
            using var doc = JsonDocument.Parse(responseText);
            if (JsonHelpers.GetString(doc.RootElement, "text") is { } text) return text;
        }
        catch (JsonException) { }
        return responseText.Trim();
    }

    private static void ApplyOpenAIHeaders(HttpRequestMessage request, JsonElement provider)
    {
        var apiKey = JsonHelpers.GetString(provider, "apiKey");
        if (!string.IsNullOrEmpty(apiKey))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        }
    }

    private static void ApplyBodyOverrides(Utf8JsonWriter writer, JsonElement provider)
    {
        if (!provider.TryGetProperty("requestOverrides", out var overrides) ||
            overrides.ValueKind != JsonValueKind.Object ||
            !overrides.TryGetProperty("body", out var body) ||
            body.ValueKind != JsonValueKind.Object)
        {
            return;
        }
        foreach (var prop in body.EnumerateObject())
        {
            prop.WriteTo(writer);
        }
    }

    private static void ApplyFormOverrides(MultipartFormDataContent content, JsonElement provider)
    {
        if (!provider.TryGetProperty("requestOverrides", out var overrides) ||
            overrides.ValueKind != JsonValueKind.Object ||
            !overrides.TryGetProperty("body", out var body) ||
            body.ValueKind != JsonValueKind.Object)
        {
            return;
        }
        foreach (var prop in body.EnumerateObject())
        {
            var val = prop.Value.ValueKind == JsonValueKind.String
                ? prop.Value.GetString()
                : prop.Value.GetRawText();
            if (!string.IsNullOrWhiteSpace(val))
            {
                content.Add(new StringContent(val), prop.Name);
            }
        }
    }

    private static string GetBaseUrl(JsonElement provider)
    {
        return (JsonHelpers.GetString(provider, "baseUrl") ?? "https://api.openai.com/v1")
            .Trim().TrimEnd('/');
    }

    private static void ValidateProvider(JsonElement provider)
    {
        if (string.IsNullOrWhiteSpace(JsonHelpers.GetString(provider, "apiKey")))
        {
            throw new InvalidOperationException("OpenAI audio requires apiKey.");
        }
        if (string.IsNullOrWhiteSpace(JsonHelpers.GetString(provider, "model")))
        {
            throw new InvalidOperationException("OpenAI audio requires model.");
        }
    }

    private static string NormalizeBase64(string data)
    {
        var trimmed = data.Trim();
        var comma = trimmed.IndexOf(',', StringComparison.Ordinal);
        if (trimmed.StartsWith("data:", StringComparison.OrdinalIgnoreCase) && comma >= 0)
        {
            trimmed = trimmed[(comma + 1)..];
        }
        return string.Concat(trimmed.Where(c => !char.IsWhiteSpace(c)));
    }

    private static string NormalizeMediaType(string? mediaType)
    {
        return string.IsNullOrWhiteSpace(mediaType) ? "application/octet-stream" : mediaType.Trim();
    }

    private static string NormalizeFileName(string? fileName, string mediaType)
    {
        var normalized = Path.GetFileName(fileName?.Trim() ?? string.Empty);
        if (string.IsNullOrWhiteSpace(normalized)) normalized = "audio";
        if (Path.HasExtension(normalized)) return normalized;
        return mediaType.ToLowerInvariant() switch
        {
            "audio/mpeg" or "audio/mp3" => $"{normalized}.mp3",
            "audio/mp4" or "audio/m4a" => $"{normalized}.m4a",
            "audio/wav" or "audio/x-wav" => $"{normalized}.wav",
            "audio/webm" => $"{normalized}.webm",
            "audio/ogg" => $"{normalized}.ogg",
            "audio/flac" => $"{normalized}.flac",
            _ => normalized
        };
    }

    private static string ExtractErrorMessage(string responseText)
    {
        if (string.IsNullOrWhiteSpace(responseText)) return "empty error response";
        try
        {
            using var doc = JsonDocument.Parse(responseText);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.String) return root.GetString() ?? responseText;
            if (root.ValueKind == JsonValueKind.Object)
            {
                foreach (var key in new[] { "message", "error" })
                {
                    if (root.TryGetProperty(key, out var val))
                    {
                        if (val.ValueKind == JsonValueKind.String) return val.GetString() ?? responseText;
                        if (val.ValueKind == JsonValueKind.Object)
                        {
                            if (JsonHelpers.GetString(val, "message") is { } msg) return msg;
                        }
                    }
                }
            }
        }
        catch (JsonException) { }
        return responseText;
    }

    private static JsonElement GetObject(JsonElement element, string propertyName)
    {
        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(propertyName, out var property) &&
            property.ValueKind == JsonValueKind.Object)
        {
            return property;
        }
        return default;
    }
}

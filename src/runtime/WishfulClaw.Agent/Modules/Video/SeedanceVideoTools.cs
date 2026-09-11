/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Net.Http.Headers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Agent;
using WishfulClaw.Infrastructure.Http;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Agent.Modules.Video;

/// <summary>
/// Seedance (Volcengine Ark) async video generation tools.
/// Ported from WishfulClaw, adapted for wishful-claw (no WorkerTaskQuotas, inline file save).
/// </summary>
public static class SeedanceVideoTools
{
    private const long MaxVideoDownloadBytes = 512L * 1024 * 1024;
    private static readonly HttpClient Http = WorkerHttpClientFactory.Create(
        timeout: TimeSpan.FromMinutes(10));

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static async Task<WorkerResponse> GenerateAsync(
        JsonElement parameters, IWorkerRequestContext context)
    {
        var provider = GetObject(parameters, "provider");
        ValidateProvider(provider);
        var prompt = JsonHelpers.GetString(parameters, "prompt") ?? string.Empty;
        var images = GetArray(parameters, "images");

        var body = BuildTaskBody(provider, prompt, images);
        var url = $"{GetBaseUrl(provider)}/contents/generations/tasks";
        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        ApplyHeaders(request, provider);

        WorkerLog.Debug($"seedance video generate model={JsonHelpers.GetString(provider, "model")} url={url}");
        using var response = await Http.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead, context.CancellationToken);
        var text = await response.Content.ReadAsStringAsync(context.CancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Seedance video generate failed HTTP {(int)response.StatusCode}: {ExtractError(text)}");
        }

        var id = ReadString(text, "id");
        if (string.IsNullOrWhiteSpace(id))
        {
            throw new InvalidOperationException("Seedance video generate returned no task id.");
        }

        return WorkerResponse.FromWriter(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("id", id);
            writer.WriteEndObject();
        });
    }

    public static async Task<WorkerResponse> StatusAsync(
        JsonElement parameters, IWorkerRequestContext context)
    {
        var provider = GetObject(parameters, "provider");
        ValidateProvider(provider);
        var taskId = JsonHelpers.GetString(parameters, "taskId");
        if (string.IsNullOrWhiteSpace(taskId))
        {
            throw new InvalidOperationException("Seedance status requires taskId.");
        }

        var url = $"{GetBaseUrl(provider)}/contents/generations/tasks/{taskId}";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        ApplyHeaders(request, provider);
        using var response = await Http.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead, context.CancellationToken);
        var text = await response.Content.ReadAsStringAsync(context.CancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Seedance video status failed HTTP {(int)response.StatusCode}: {ExtractError(text)}");
        }

        string status = "unknown";
        string? videoUrl = null;
        string? error = null;
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            status = JsonHelpers.GetString(root, "status") ?? "unknown";
            if (root.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Object)
            {
                videoUrl = JsonHelpers.GetString(content, "video_url");
            }
            error = ExtractError(root);
        }
        catch (JsonException) { }

        return WorkerResponse.FromWriter(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("status", status);
            if (videoUrl is { Length: > 0 }) writer.WriteString("videoUrl", videoUrl);
            if (error is { Length: > 0 }) writer.WriteString("error", error);
            writer.WriteEndObject();
        });
    }

    public static async Task<WorkerResponse> DownloadAsync(
        JsonElement parameters, IWorkerRequestContext context)
    {
        var videoUrl = JsonHelpers.GetString(parameters, "videoUrl");
        if (string.IsNullOrWhiteSpace(videoUrl))
        {
            throw new InvalidOperationException("Seedance download requires videoUrl.");
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, videoUrl);
        using var response = await Http.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead, context.CancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Seedance video download failed HTTP {(int)response.StatusCode}");
        }

        var mediaType = response.Content.Headers.ContentType?.MediaType ?? "video/mp4";
        var extension = mediaType.Contains("webm", StringComparison.OrdinalIgnoreCase) ? ".webm" : ".mp4";

        // Save to ~/.wishful-claw/video/
        var videoDir = WishfulClawDataDir.Resolve("video");
        Directory.CreateDirectory(videoDir);
        var filePath = Path.Combine(videoDir, $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Guid.NewGuid():N}{extension}");

        using (var fileStream = new FileStream(filePath, FileMode.Create, FileAccess.Write))
        {
            await response.Content.CopyToAsync(fileStream, context.CancellationToken);
        }

        var bytes = new FileInfo(filePath).Length;

        return WorkerResponse.FromWriter(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("filePath", filePath);
            writer.WriteString("mediaType", mediaType);
            writer.WriteNumber("bytes", bytes);
            writer.WriteEndObject();
        });
    }

    // ── Helpers ──

    private static string BuildTaskBody(JsonElement provider, string prompt, JsonElement images)
    {
        var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            writer.WriteString("model", JsonHelpers.GetString(provider, "model") ?? string.Empty);
            writer.WritePropertyName("content");
            writer.WriteStartArray();

            writer.WriteStartObject();
            writer.WriteString("type", "text");
            writer.WriteString("text", prompt);
            writer.WriteEndObject();

            if (images.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in images.EnumerateArray())
                {
                    var dataUrl = JsonHelpers.GetString(item, "dataUrl");
                    if (string.IsNullOrWhiteSpace(dataUrl)) continue;
                    writer.WriteStartObject();
                    writer.WriteString("type", "image_url");
                    writer.WritePropertyName("image_url");
                    writer.WriteStartObject();
                    writer.WriteString("url", dataUrl);
                    writer.WriteEndObject();
                    writer.WriteEndObject();
                }
            }

            writer.WriteEndArray();
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    private static void ApplyHeaders(HttpRequestMessage request, JsonElement provider)
    {
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer", JsonHelpers.GetString(provider, "apiKey") ?? string.Empty);
        ApiUserAgent.Apply(request, provider);
        ApiUserAgent.Ensure(request, provider);
    }

    private static string GetBaseUrl(JsonElement provider)
    {
        return (JsonHelpers.GetString(provider, "baseUrl") ?? "https://ark.cn-beijing.volces.com/api/v3")
            .Trim().TrimEnd('/');
    }

    private static void ValidateProvider(JsonElement provider)
    {
        if (string.IsNullOrWhiteSpace(JsonHelpers.GetString(provider, "apiKey")))
            throw new InvalidOperationException("Seedance video provider requires apiKey.");
        if (string.IsNullOrWhiteSpace(JsonHelpers.GetString(provider, "model")))
            throw new InvalidOperationException("Seedance video provider requires model.");
    }

    private static string? ReadString(string json, string property)
    {
        try { using var doc = JsonDocument.Parse(json); return JsonHelpers.GetString(doc.RootElement, property); }
        catch (JsonException) { return null; }
    }

    private static string ExtractError(string responseText)
    {
        if (string.IsNullOrWhiteSpace(responseText)) return "empty error response";
        try { using var doc = JsonDocument.Parse(responseText); return ExtractError(doc.RootElement) ?? responseText; }
        catch (JsonException) { return responseText; }
    }

    private static string? ExtractError(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.String) return element.GetString();
        if (element.ValueKind != JsonValueKind.Object) return null;
        if (element.TryGetProperty("error", out var error))
        {
            if (error.ValueKind == JsonValueKind.String) return error.GetString();
            if (error.ValueKind == JsonValueKind.Object &&
                JsonHelpers.GetString(error, "message") is { Length: > 0 } message)
                return message;
        }
        return null;
    }

    private static JsonElement GetObject(JsonElement element, string propertyName)
    {
        return element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(propertyName, out var property) &&
            property.ValueKind == JsonValueKind.Object ? property : default;
    }

    private static JsonElement GetArray(JsonElement element, string propertyName)
    {
        return element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(propertyName, out var property) &&
            property.ValueKind == JsonValueKind.Array ? property : default;
    }
}

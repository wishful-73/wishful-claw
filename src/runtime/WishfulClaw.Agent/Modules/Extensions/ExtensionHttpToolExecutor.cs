/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json.Serialization.Metadata;
﻿using System.Buffers;
using System.Net;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using WishfulClaw.Agent.Executors;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Agent;
using WishfulClaw.Infrastructure.Http;

namespace WishfulClaw.Agent.Modules.Extensions;

/// <summary>
/// Executes HTTP-based extension tools. Handles URL/header interpolation,
/// network permission checks, redirect following, and response normalization.
/// Ported from WishfulClaw, adapted for wishful-claw (WorkerHttpClientFactory, namespace).
/// </summary>
public static partial class ExtensionHttpToolExecutor
{
    private const int MaxExtensionFetchRedirects = 5;
    private static readonly HttpClient Http = WorkerHttpClientFactory.Create(
        timeout: TimeSpan.FromMinutes(2),
        allowAutoRedirect: false);

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static async Task<NativeExtensionToolExecutionResult> ExecuteAsync(
        string extensionId,
        string toolName,
        JsonElement input,
        CancellationToken cancellationToken)
    {
        try
        {
            var extension = ExtensionManifestStore.FindExtensionOrThrow(extensionId);
            if (!extension.Enabled)
            {
                throw new InvalidOperationException($"Extension \"{extensionId}\" is disabled");
            }

            var tool = extension.Manifest.Tools.FirstOrDefault(item =>
                string.Equals(item.Name, toolName, StringComparison.Ordinal));
            if (tool is null)
            {
                throw new InvalidOperationException($"Tool \"{toolName}\" not found in extension \"{extensionId}\"");
            }
            if (tool.Kind != "http" || tool.Http is null)
            {
                throw new InvalidOperationException($"Tool \"{toolName}\" is not an HTTP tool");
            }

            var normalizedInput = input.ValueKind == JsonValueKind.Object
                ? input
                : EmptyJsonObject();
            var request = BuildToolFetchRequest(extension, tool, normalizedInput);
            var response = await PerformFetchAsync(extension, request, cancellationToken);
            return new NativeExtensionToolExecutionResult(
                true,
                EncodeExtensionToolResult(NormalizeHttpToolResult(extension, tool, response)),
                null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return new NativeExtensionToolExecutionResult(false, null, ex.Message);
        }
    }

    public static async Task<WorkerResponse> ExecuteWorkerAsync(JsonElement parameters)
    {
        var extensionId = JsonHelpers.GetString(parameters, "extensionId")?.Trim() ?? string.Empty;
        var toolName = JsonHelpers.GetString(parameters, "toolName")?.Trim() ?? string.Empty;
        var input = parameters.TryGetProperty("input", out var inputElement)
            ? inputElement
            : EmptyJsonObject();
        var result = await ExecuteAsync(extensionId, toolName, input, CancellationToken.None);
        return WorkerResponse.Json(result, AgentRuntimeJsonContext.Default.NativeExtensionToolExecutionResult);
    }

    private static ExtensionFetchRequest BuildToolFetchRequest(
        NativeExtensionInstance extension,
        NativeExtensionToolDefinition tool,
        JsonElement input)
    {
        var http = tool.Http ?? throw new InvalidOperationException($"Tool \"{tool.Name}\" is not an HTTP tool");
        var headers = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var item in http.Headers)
        {
            headers[item.Key] = InterpolateString(item.Value, input, extension.Config);
        }

        return new ExtensionFetchRequest(
            http.Method,
            InterpolateString(http.Url, input, extension.Config),
            headers,
            http.Body.HasValue
                ? InterpolateValue(http.Body.Value, input, extension.Config).Clone()
                : null);
    }

    private static async Task<ExtensionFetchResponse> PerformFetchAsync(
        NativeExtensionInstance extension,
        ExtensionFetchRequest request,
        CancellationToken cancellationToken)
    {
        var url = request.Url;
        var method = string.IsNullOrWhiteSpace(request.Method)
            ? "GET"
            : request.Method.ToUpperInvariant();
        var headers = new Dictionary<string, string>(request.Headers, StringComparer.Ordinal);

        HttpResponseMessage? response = null;
        for (var redirectCount = 0; redirectCount <= MaxExtensionFetchRedirects; redirectCount++)
        {
            if (string.IsNullOrWhiteSpace(url) || !IsNetworkAllowed(extension.Manifest, url))
            {
                throw new InvalidOperationException($"Network access denied for {(string.IsNullOrWhiteSpace(url) ? "(empty url)" : url)}");
            }

            using var message = new HttpRequestMessage(new HttpMethod(method), url);
            using var bodyContent = CreateHttpContent(method, headers, request.Body);
            if (bodyContent is not null)
            {
                message.Content = bodyContent;
            }
            foreach (var header in headers)
            {
                if (!message.Headers.TryAddWithoutValidation(header.Key, header.Value))
                {
                    message.Content?.Headers.TryAddWithoutValidation(header.Key, header.Value);
                }
            }

            response = await Http.SendAsync(message, cancellationToken);
            var location = response.Headers.Location?.ToString();
            if (!response.IsSuccessStatusCode &&
                !IsRedirectStatus(response.StatusCode))
            {
                WorkerLog.Debug(
                    "extension fetch failed " +
                    $"extensionId={extension.Id} method={method} url={DescribeFetchUrl(url)} " +
                    $"status={(int)response.StatusCode} reason={response.ReasonPhrase ?? string.Empty}");
            }
            if (!IsRedirectStatus(response.StatusCode) || string.IsNullOrWhiteSpace(location))
            {
                break;
            }
            if (redirectCount == MaxExtensionFetchRedirects)
            {
                throw new InvalidOperationException("Extension fetch exceeded redirect limit");
            }

            var nextUrl = new Uri(new Uri(url), location).ToString();
            if (!IsNetworkAllowed(extension.Manifest, nextUrl))
            {
                throw new InvalidOperationException($"Network access denied for redirect to {nextUrl}");
            }

            WorkerLog.Debug(
                "extension fetch redirect " +
                $"extensionId={extension.Id} method={method} status={(int)response.StatusCode} " +
                $"from={DescribeFetchUrl(url)} to={DescribeFetchUrl(nextUrl)}");
            url = nextUrl;
            if (response.StatusCode == HttpStatusCode.SeeOther)
            {
                method = "GET";
                headers.Remove("Content-Type");
                headers.Remove("content-type");
            }
        }

        if (response is null)
        {
            throw new InvalidOperationException("Extension fetch failed");
        }

        using (response)
        {
            var text = await response.Content.ReadAsStringAsync(cancellationToken);
            return new ExtensionFetchResponse(
                response.IsSuccessStatusCode,
                (int)response.StatusCode,
                response.ReasonPhrase ?? string.Empty,
                ReadResponseHeaders(response),
                text,
                TryParseJson(text));
        }
    }

    private static string InterpolateString(
        string value,
        JsonElement input,
        IReadOnlyDictionary<string, string> config)
    {
        return InterpolationRegex().Replace(value, match =>
        {
            var scope = match.Groups[1].Value;
            var key = match.Groups[2].Value;
            JsonElement? resolved = scope == "input"
                ? GetNestedValue(input, key)
                : ConfigValueToJson(config, key);
            if (!resolved.HasValue ||
                resolved.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            {
                return string.Empty;
            }

            return resolved.Value.ValueKind == JsonValueKind.String
                ? resolved.Value.GetString() ?? string.Empty
                : resolved.Value.GetRawText();
        });
    }

    private static JsonElement InterpolateValue(
        JsonElement value,
        JsonElement input,
        IReadOnlyDictionary<string, string> config)
    {
        using var document = JsonDocument.Parse(WriteInterpolatedJson(value, input, config));
        return document.RootElement.Clone();
    }

    private static byte[] WriteInterpolatedJson(
        JsonElement value,
        JsonElement input,
        IReadOnlyDictionary<string, string> config)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using var writer = new Utf8JsonWriter(buffer, WriterOptions);
        WriteInterpolatedJsonValue(writer, value, input, config);
        writer.Flush();
        return buffer.WrittenMemory.ToArray();
    }

    private static void WriteInterpolatedJsonValue(
        Utf8JsonWriter writer,
        JsonElement value,
        JsonElement input,
        IReadOnlyDictionary<string, string> config)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.String:
                writer.WriteStringValue(InterpolateString(value.GetString() ?? string.Empty, input, config));
                break;
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in value.EnumerateObject())
                {
                    writer.WritePropertyName(property.Name);
                    WriteInterpolatedJsonValue(writer, property.Value, input, config);
                }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in value.EnumerateArray())
                {
                    WriteInterpolatedJsonValue(writer, item, input, config);
                }
                writer.WriteEndArray();
                break;
            default:
                value.WriteTo(writer);
                break;
        }
    }

    private static JsonElement? GetNestedValue(JsonElement source, string dottedPath)
    {
        var current = source;
        foreach (var part in dottedPath.Split('.', StringSplitOptions.RemoveEmptyEntries))
        {
            if (current.ValueKind != JsonValueKind.Object ||
                !current.TryGetProperty(part, out current))
            {
                return null;
            }
        }
        return current;
    }

    private static JsonElement? ConfigValueToJson(
        IReadOnlyDictionary<string, string> config,
        string key)
    {
        var parts = key.Split('.', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 1 || !config.TryGetValue(parts[0], out var value))
        {
            return null;
        }

        using var document = JsonDocument.Parse(
            JsonSerializer.Serialize(value, WorkerJsonHelper.GetTypeInfo<string>()));
        return document.RootElement.Clone();
    }

    private static JsonElement EmptyJsonObject()
    {
        using var document = JsonDocument.Parse("{}");
        return document.RootElement.Clone();
    }

    [GeneratedRegex("\\{\\{\\s*(input|config)\\.([A-Za-z0-9_.-]+)\\s*\\}\\}", RegexOptions.CultureInvariant)]
    private static partial Regex InterpolationRegex();

    private readonly record struct ExtensionFetchRequest(
        string Method,
        string Url,
        IReadOnlyDictionary<string, string> Headers,
        JsonElement? Body);

    private readonly record struct ExtensionFetchResponse(
        bool Ok,
        int Status,
        string StatusText,
        IReadOnlyDictionary<string, string> Headers,
        string Text,
        JsonElement? Json);

    private readonly record struct ExtensionToolResult(
        string ExtensionId,
        string ToolName,
        string Text,
        ExtensionFetchResponse Response);
}

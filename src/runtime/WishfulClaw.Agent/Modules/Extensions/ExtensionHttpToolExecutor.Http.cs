using System.Buffers;
using System.Net;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
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
    private static HttpContent? CreateHttpContent(
        string method,
        Dictionary<string, string> headers,
        JsonElement? body)
    {
        if (!body.HasValue || method is "GET" or "HEAD")
        {
            return null;
        }

        HttpContent content;
        if (body.Value.ValueKind == JsonValueKind.String)
        {
            content = new StringContent(body.Value.GetString() ?? string.Empty, Encoding.UTF8);
        }
        else
        {
            content = new StringContent(body.Value.GetRawText(), Encoding.UTF8, "application/json");
            if (!headers.Keys.Any(static key => string.Equals(key, "content-type", StringComparison.OrdinalIgnoreCase)))
            {
                headers["Content-Type"] = "application/json";
            }
        }

        return content;
    }

    private static string DescribeFetchUrl(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri))
        {
            return "(invalid url)";
        }
        return $"{uri.Scheme}://{uri.Host}{uri.AbsolutePath}";
    }

    private static Dictionary<string, string> ReadResponseHeaders(HttpResponseMessage response)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var header in response.Headers)
        {
            result[header.Key.ToLowerInvariant()] = string.Join(", ", header.Value);
        }
        foreach (var header in response.Content.Headers)
        {
            result[header.Key.ToLowerInvariant()] = string.Join(", ", header.Value);
        }
        return result;
    }

    private static JsonElement? TryParseJson(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(text);
            return document.RootElement.Clone();
        }
        catch
        {
            return null;
        }
    }

    private static string EncodeExtensionToolResult(ExtensionToolResult result)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, WriterOptions))
        {
            writer.WriteStartObject();
            writer.WriteBoolean("__wishfulClawExtensionResult", true);
            writer.WriteString("extensionId", result.ExtensionId);
            writer.WriteString("toolName", result.ToolName);
            writer.WriteString("text", result.Text);
            writer.WritePropertyName("data");
            WriteExtensionToolData(writer, result.Response);
            // S-305：插件把 UI 声明放在响应体里，主进程统一提升到顶层 —— 渲染端只认顶层 ui。
            if (TryReadExtensionUi(result.Response, out var ui))
            {
                writer.WritePropertyName("ui");
                ui.WriteTo(writer);
            }
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static ExtensionToolResult NormalizeHttpToolResult(
        NativeExtensionInstance extension,
        NativeExtensionToolDefinition tool,
        ExtensionFetchResponse response)
    {
        return new ExtensionToolResult(
            extension.Id,
            tool.Name,
            response.Ok
                ? $"HTTP {response.Status} {response.StatusText}".Trim()
                : $"HTTP request failed: {response.Status} {response.StatusText}".Trim(),
            response);
    }

    private static void WriteExtensionToolData(Utf8JsonWriter writer, ExtensionFetchResponse response)
    {
        writer.WriteStartObject();
        writer.WriteBoolean("ok", response.Ok);
        writer.WriteNumber("status", response.Status);
        writer.WriteString("statusText", response.StatusText);
        writer.WritePropertyName("headers");
        writer.WriteStartObject();
        foreach (var header in response.Headers.OrderBy(static item => item.Key, StringComparer.Ordinal))
        {
            writer.WriteString(header.Key, header.Value);
        }
        writer.WriteEndObject();
        writer.WritePropertyName("body");
        if (response.Json.HasValue)
        {
            response.Json.Value.WriteTo(writer);
        }
        else
        {
            writer.WriteStringValue(response.Text);
        }
        writer.WriteEndObject();
    }

    /// <summary>
    /// S-305：插件在响应体里放 <c>ui</c> 对象（必须带 kind），主进程把它提升到顶层。
    /// 只认这一种约定 —— 放在 body 其它位置对渲染端就只是业务数据，不会变成渲染指令。
    /// </summary>
    private static bool TryReadExtensionUi(ExtensionFetchResponse response, out JsonElement ui)
    {
        ui = default;
        if (!response.Json.HasValue)
        {
            return false;
        }

        var root = response.Json.Value;
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("ui", out var candidate)
            || candidate.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        ui = candidate.Clone();
        return true;
    }

    private static bool IsNetworkAllowed(NativeExtensionManifest manifest, string targetUrl)
    {
        if (!Uri.TryCreate(targetUrl, UriKind.Absolute, out var target))
        {
            return false;
        }
        if (target.Scheme is not ("http" or "https"))
        {
            return false;
        }

        var allowlist = manifest.NetworkPermissions;
        if (allowlist.Contains("*", StringComparer.Ordinal))
        {
            return true;
        }
        if (allowlist.Count == 0)
        {
            return false;
        }

        return allowlist.Any(allowed => IsAllowedUrl(target, allowed));
    }

    private static bool IsAllowedUrl(Uri target, string allowed)
    {
        var value = allowed.Trim();
        if (value.Length == 0)
        {
            return false;
        }

        if (value.EndsWith('*'))
        {
            return target.AbsoluteUri.StartsWith(value[..^1], StringComparison.Ordinal);
        }

        if (Uri.TryCreate(value, UriKind.Absolute, out var allowedUrl))
        {
            return string.Equals(target.GetLeftPart(UriPartial.Authority), allowedUrl.GetLeftPart(UriPartial.Authority), StringComparison.Ordinal) &&
                target.AbsoluteUri.StartsWith(allowedUrl.AbsoluteUri, StringComparison.Ordinal);
        }

        return string.Equals(target.GetLeftPart(UriPartial.Authority), value, StringComparison.Ordinal);
    }

    private static bool IsRedirectStatus(HttpStatusCode status)
    {
        return status is HttpStatusCode.MovedPermanently or
            HttpStatusCode.Found or
            HttpStatusCode.SeeOther or
            HttpStatusCode.TemporaryRedirect or
            HttpStatusCode.PermanentRedirect;
    }

}

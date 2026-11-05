/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent.Executors;

/// <summary>
/// Notify tool executor — sends desktop notifications via reverse-request to Main process.
/// Simplified port from WishfulClaw (no DeliveryGuard, no plugin redirect).
/// Ported from WishfulClaw AgentRuntimeNotifyExecutor.
/// </summary>
public static class AgentRuntimeNotifyExecutor
{
    private const string NotifyToolName = "Notify";
    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static bool IsNotifyTool(string toolName)
    {
        return string.Equals(toolName, NotifyToolName, StringComparison.Ordinal);
    }

    public static async Task<string> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var title = JsonHelpers.GetString(call.Input, "title")?.Trim() ?? string.Empty;
        var body = JsonHelpers.GetString(call.Input, "body")?.Trim() ?? string.Empty;
        var type = NormalizeType(JsonHelpers.GetString(call.Input, "type"));
        var duration = Math.Max(0, JsonHelpers.GetInt(call.Input, "duration", 5000));

        if (title.Length == 0 || body.Length == 0)
        {
            return EncodeError("title and body are required");
        }

        var notificationResult = await InvokeDesktopNotificationAsync(
            context,
            title,
            body,
            type,
            duration,
            cancellationToken);

        if (JsonHelpers.GetBool(notificationResult, "success", false))
        {
            return EncodeJsonObject(writer =>
            {
                writer.WriteBoolean("success", true);
                writer.WriteString("title", title);
                writer.WriteString("body", Truncate(body, 200));
            });
        }

        return EncodeJsonObject(writer =>
        {
            writer.WriteBoolean("success", false);
            writer.WriteString(
                "error",
                JsonHelpers.GetString(notificationResult, "error") ?? "Desktop notification failed.");
        });
    }

    private static async Task<JsonElement> InvokeDesktopNotificationAsync(
        IWorkerRequestContext context,
        string title,
        string body,
        string type,
        int duration,
        CancellationToken cancellationToken)
    {
        var request = CreateJsonObject(writer =>
        {
            writer.WriteString("title", title);
            writer.WriteString("body", body);
            writer.WriteString("type", type);
            writer.WriteNumber("duration", duration);
        });
        return await AgentRuntimeReverseRequests.RequestAsync(
            context,
            "notify:desktop",
            request,
            cancellationToken);
    }

    private static JsonElement CreateJsonObject(Action<Utf8JsonWriter> writeProperties)
    {
        var bytes = Encoding.UTF8.GetBytes(EncodeJsonObject(writeProperties));
        using var document = JsonDocument.Parse(bytes);
        return document.RootElement.Clone();
    }

    private static string NormalizeType(string? value)
    {
        return value is "success" or "warning" or "error" ? value : "info";
    }

    private static string EncodeError(string message)
    {
        return EncodeJsonObject(writer => writer.WriteString("error", message));
    }

    private static string EncodeJsonObject(Action<Utf8JsonWriter> writeProperties)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, WriterOptions))
        {
            writer.WriteStartObject();
            writeProperties(writer);
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static string Truncate(string value, int maxChars)
    {
        return value.Length <= maxChars ? value : value[..maxChars];
    }
}

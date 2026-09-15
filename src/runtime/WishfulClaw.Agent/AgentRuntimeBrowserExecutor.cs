/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Buffers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Browser tool executor that routes tool calls to the renderer via the reverse-request mechanism.
/// The actual browser operations (Navigate, Click, Type, etc.) are executed in the renderer
/// process by browser-native-ui.ts operating on the Electron webview.
/// Ported from WishfulClaw AgentRuntimeBrowserExecutor.
/// </summary>
public static class AgentRuntimeBrowserExecutor
{
    private static readonly HashSet<string> BrowserToolNames = new(StringComparer.Ordinal)
    {
        "BrowserNavigate",
        "BrowserGetContent",
        "BrowserScreenshot",
        "BrowserSnapshot",
        "BrowserClick",
        "BrowserType",
        "BrowserScroll",
        "BrowserEvaluate",
        "WebSearch"
    };

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static bool IsBrowserTool(string toolName)
    {
        return BrowserToolNames.Contains(toolName);
    }

    public static async Task<RendererToolResult> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        JsonElement parameters,
        string runId,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var request = CreateBrowserRequest(call, parameters, runId);
        try
        {
            var result = await AgentRuntimeReverseRequests.RequestAsync(
                context,
                "browser/tool-request",
                request,
                cancellationToken);
            return ParseBrowserResult(result);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return new RendererToolResult(
                AgentRuntimeProviderSupport.CreateStringElement(EncodeError(ex.Message)),
                true,
                ex.Message);
        }
    }

    private static JsonElement CreateBrowserRequest(
        AgentRuntimeNativeToolCall call,
        JsonElement parameters,
        string runId)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            writer.WriteString("runId", runId);
            writer.WriteString("agentRunId", runId);
            writer.WriteString("toolUseId", call.Id);
            writer.WriteString("toolName", call.Name);
            WriteNullableString(writer, "sessionId", JsonHelpers.GetString(parameters, "sessionId"));
            WriteNullableString(writer, "workingFolder", JsonHelpers.GetString(parameters, "workingFolder"));
            writer.WritePropertyName("input");
            call.Input.WriteTo(writer);
            writer.WriteEndObject();
        }

        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    private static RendererToolResult ParseBrowserResult(JsonElement result)
    {
        if (result.ValueKind != JsonValueKind.Object)
        {
            return new RendererToolResult(result.Clone(), false, null);
        }

        var content = result.TryGetProperty("content", out var contentElement)
            ? contentElement.Clone()
            : AgentRuntimeProviderSupport.CreateStringElement(string.Empty);
        var error = JsonHelpers.GetString(result, "error");
        var isError = JsonHelpers.GetBool(result, "isError", false) ||
            !string.IsNullOrEmpty(error);
        return new RendererToolResult(content, isError, error);
    }

    private static string EncodeError(string message)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, WriterOptions))
        {
            writer.WriteStartObject();
            writer.WriteString("error", message);
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static void WriteNullableString(Utf8JsonWriter writer, string name, string? value)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            writer.WriteString(name, value);
        }
    }
}

/// <summary>
/// Result from a renderer-executed tool (browser, desktop, etc.).
/// </summary>
public readonly record struct RendererToolResult(JsonElement Content, bool IsError, string? Error);

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

namespace WishfulClaw.Agent.Executors;

/// <summary>
/// Plugin tool executor — routes PluginSendMessage/ReplyMessage/etc to Main process.
/// Ported from WishfulClaw AgentRuntimePluginExecutor (simplified: no DeliveryGuard, no DB).
/// </summary>
public static class AgentRuntimePluginExecutor
{
    private static readonly HashSet<string> PluginToolNames = new(StringComparer.Ordinal)
    {
        "PluginSendMessage", "PluginReplyMessage", "PluginGetGroupMessages",
        "PluginListGroups", "PluginSummarizeGroup", "PluginGetCurrentChatMessages"
    };

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static bool IsPluginTool(string toolName) => PluginToolNames.Contains(toolName);

    public static bool RequiresApproval(string toolName) =>
        toolName is "PluginSendMessage" or "PluginReplyMessage";

    public static async Task<string> ExecuteAsync(
        AgentRuntimeNativeToolCall call, JsonElement parameters,
        IWorkerRequestContext context, CancellationToken cancellationToken)
    {
        return call.Name switch
        {
            "PluginSendMessage" => await ExecAsync(call, parameters, context, "sendMessage", "PluginSendMessage",
                w => { w.WriteString("chatId", ReadString(call.Input, "chat_id")); w.WriteString("content", ReadString(call.Input, "content")); }, cancellationToken),
            "PluginReplyMessage" => await ExecAsync(call, default, context, "replyMessage", "PluginReplyMessage",
                w => { w.WriteString("messageId", ReadString(call.Input, "message_id")); w.WriteString("content", ReadString(call.Input, "content")); }, cancellationToken),
            "PluginGetGroupMessages" => await ExecAsync(call, default, context, "getGroupMessages", call.Name,
                w => { w.WriteString("chatId", ReadString(call.Input, "chat_id")); w.WriteNumber("count", JsonHelpers.GetInt(call.Input, "count", 20)); }, cancellationToken),
            "PluginListGroups" => await ExecAsync(call, default, context, "listGroups", "PluginListGroups", _ => { }, cancellationToken),
            "PluginSummarizeGroup" => await ExecAsync(call, default, context, "getGroupMessages", call.Name,
                w => { w.WriteString("chatId", ReadString(call.Input, "chat_id")); w.WriteNumber("count", 50); }, cancellationToken),
            "PluginGetCurrentChatMessages" => EncodeError("PluginGetCurrentChatMessages requires DB session support (not yet available)"),
            _ => EncodeError($"Unsupported plugin tool: {call.Name}")
        };
    }

    private static async Task<string> ExecAsync(
        AgentRuntimeNativeToolCall call, JsonElement parameters,
        IWorkerRequestContext context, string action, string toolName,
        Action<Utf8JsonWriter> writeParams, CancellationToken cancellationToken)
    {
        var pluginId = ReadPluginId(call.Input, parameters);
        if (string.IsNullOrWhiteSpace(pluginId))
            return EncodeError("Missing or invalid plugin_id.");

        var request = CreateJsonObject(w =>
        {
            w.WriteString("pluginId", pluginId);
            w.WriteString("action", action);
            w.WriteString("toolName", toolName);
            w.WritePropertyName("params");
            w.WriteStartObject();
            writeParams(w);
            w.WriteEndObject();
        });

        var response = await AgentRuntimeReverseRequests.RequestAsync(context, "plugin:exec", request, cancellationToken);
        var error = JsonHelpers.GetString(response, "error") ?? string.Empty;
        return error.Length > 0 ? EncodeError($"Plugin action \"{action}\" failed: {error}") : response.GetRawText();
    }

    private static string ReadPluginId(JsonElement input, JsonElement parameters) =>
        (JsonHelpers.GetString(input, "plugin_id") ?? JsonHelpers.GetString(parameters, "pluginId") ?? string.Empty).Trim();

    private static string ReadString(JsonElement el, string name) =>
        JsonHelpers.GetString(el, name)?.Trim() ?? string.Empty;

    private static JsonElement CreateJsonObject(Action<Utf8JsonWriter> writeProperties)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        { writer.WriteStartObject(); writeProperties(writer); writer.WriteEndObject(); }
        using var doc = JsonDocument.Parse(buffer.WrittenMemory);
        return doc.RootElement.Clone();
    }

    private static string EncodeError(string message) =>
        EncodeJsonObject(w => w.WriteString("error", message));

    private static string EncodeJsonObject(Action<Utf8JsonWriter> writeProperties)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        { writer.WriteStartObject(); writeProperties(writer); writer.WriteEndObject(); }
        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }
}

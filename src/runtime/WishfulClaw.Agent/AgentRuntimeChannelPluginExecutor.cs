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
/// Channel plugin executor — Feishu/Weixin integration via reverse-request to Main process.
/// Ported from WishfulClaw AgentRuntimeChannelPluginExecutor.
/// </summary>
public static class AgentRuntimeChannelPluginExecutor
{
    private static readonly HashSet<string> ChannelPluginToolNames = new(StringComparer.Ordinal)
    {
        "FeishuSendImage", "FeishuSendFile", "FeishuListChatMembers", "FeishuAtMember",
        "FeishuSendUrgent", "FeishuBitableListApps", "FeishuBitableListTables",
        "FeishuBitableListFields", "FeishuBitableGetRecords", "FeishuBitableCreateRecords",
        "FeishuBitableUpdateRecords", "FeishuBitableDeleteRecords",
        "WeixinSendImage", "WeixinSendFile", "ChannelSendImage", "ChannelSendFile"
    };

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static bool IsChannelPluginTool(string toolName) => ChannelPluginToolNames.Contains(toolName);

    public static bool RequiresApproval(string toolName) =>
        toolName is "FeishuSendImage" or "FeishuSendFile" or "FeishuAtMember" or
                     "FeishuSendUrgent" or "WeixinSendImage" or "WeixinSendFile";

    public static async Task<string> ExecuteAsync(
        AgentRuntimeNativeToolCall call, JsonElement parameters,
        IWorkerRequestContext context, CancellationToken cancellationToken)
    {
        var pluginId = ReadPluginId(call.Input, parameters);
        if (string.IsNullOrWhiteSpace(pluginId))
            return EncodeError("plugin_id is required");

        var (channel, writeExtra) = ResolveRoute(call, parameters);
        if (channel is null)
            return EncodeError($"Unsupported channel plugin tool: {call.Name}");

        var request = CreateJsonObject(w =>
        {
            w.WriteString("toolName", call.Name);
            w.WriteString("pluginId", pluginId);
            writeExtra(w);
        });

        var response = await AgentRuntimeReverseRequests.RequestAsync(context, channel, request, cancellationToken);
        var error = JsonHelpers.GetString(response, "error") ?? string.Empty;
        return error.Length > 0 ? EncodeError(error) : response.GetRawText();
    }

    private static (string? channel, Action<Utf8JsonWriter> writeExtra) ResolveRoute(AgentRuntimeNativeToolCall call, JsonElement parameters)
    {
        return call.Name switch
        {
            "FeishuSendImage" => ("plugin:feishu:send-image", w => { w.WriteString("chatId", R(call, "chat_id")); w.WriteString("filePath", R(call, "file_path")); }),
            "FeishuSendFile" => ("plugin:feishu:send-file", w => { w.WriteString("chatId", R(call, "chat_id")); w.WriteString("filePath", R(call, "file_path")); WOpt(w, call, "file_type", "file_type"); }),
            "WeixinSendImage" => ("plugin:weixin:send-image", w => { w.WriteString("chatId", R(call, "chat_id")); w.WriteString("filePath", R(call, "file_path")); WOpt(w, call, "content", "content"); }),
            "WeixinSendFile" => ("plugin:weixin:send-file", w => { w.WriteString("chatId", R(call, "chat_id")); w.WriteString("filePath", R(call, "file_path")); WOpt(w, call, "content", "content"); }),
            "ChannelSendImage" => ResolveGenericRoute(call, parameters, "image"),
            "ChannelSendFile" => ResolveGenericRoute(call, parameters, "file"),
            "FeishuListChatMembers" => ("plugin:feishu:list-members", w => { w.WriteString("chatId", R(call, "chat_id")); WOptI(w, call, "page_size", "page_size"); WOpt(w, call, "page_token", "page_token"); }),
            "FeishuAtMember" => ("plugin:feishu:send-mention", w =>
            {
                w.WriteString("chatId", R(call, "chat_id"));
                w.WriteString("text", R(call, "text"));
                w.WriteStartArray("userIds");
                foreach (var uid in JsonHelpers.GetStringArray(call.Input, "user_ids")) w.WriteStringValue(uid);
                w.WriteEndArray();
                w.WriteBoolean("atAll", JsonHelpers.GetBool(call.Input, "at_all", false));
            }),
            "FeishuSendUrgent" => ("plugin:feishu:send-urgent", w =>
            {
                w.WriteString("messageId", R(call, "message_id"));
                w.WriteStartArray("userIds");
                foreach (var uid in JsonHelpers.GetStringArray(call.Input, "user_ids")) w.WriteStringValue(uid);
                w.WriteEndArray();
                w.WriteStartArray("urgentTypes");
                foreach (var t in JsonHelpers.GetStringArray(call.Input, "urgent_types").Where(x => x is "app" or "sms")) w.WriteStringValue(t);
                w.WriteEndArray();
            }),
            "FeishuBitableListApps" => ("plugin:feishu:bitable:list-apps", _ => { }),
            "FeishuBitableListTables" => ("plugin:feishu:bitable:list-tables", w => WReq(w, call, "app_token", "app_token")),
            "FeishuBitableListFields" => ("plugin:feishu:bitable:list-fields", w => { WReq(w, call, "app_token", "app_token"); WReq(w, call, "table_id", "table_id"); }),
            "FeishuBitableGetRecords" => ("plugin:feishu:bitable:get-records", w => { WReq(w, call, "app_token", "app_token"); WReq(w, call, "table_id", "table_id"); WOpt(w, call, "filter", "filter"); WOptI(w, call, "page_size", "page_size"); WOpt(w, call, "page_token", "page_token"); }),
            "FeishuBitableCreateRecords" => ("plugin:feishu:bitable:create-records", w => BitableMut(w, call, "records")),
            "FeishuBitableUpdateRecords" => ("plugin:feishu:bitable:update-records", w => BitableMut(w, call, "records")),
            "FeishuBitableDeleteRecords" => ("plugin:feishu:bitable:delete-records", w => BitableMut(w, call, "record_ids")),
            _ => (null, _ => { })
        };
    }

    private static (string? channel, Action<Utf8JsonWriter> writeExtra) ResolveGenericRoute(
        AgentRuntimeNativeToolCall call, JsonElement parameters, string kind)
    {
        var pluginType = (JsonHelpers.GetString(parameters, "pluginType") ??
                          JsonHelpers.GetString(parameters, "channelType") ?? string.Empty).ToLowerInvariant();
        var pluginId = JsonHelpers.GetString(parameters, "pluginId") ?? string.Empty;
        var route = pluginType.Contains("weixin") || pluginId.Contains("weixin", StringComparison.OrdinalIgnoreCase)
            ? $"plugin:weixin:send-{kind}"
            : pluginType.Contains("feishu") || pluginId.Contains("feishu", StringComparison.OrdinalIgnoreCase)
                ? $"plugin:feishu:send-{kind}"
                : null;
        return (route, w =>
        {
            w.WriteString("chatId", JsonHelpers.GetString(parameters, "externalChatId") ?? string.Empty);
            w.WriteString("filePath", R(call, "filePath"));
            WOpt(w, call, "fileType", "fileType");
        });
    }

    private static void BitableMut(Utf8JsonWriter w, AgentRuntimeNativeToolCall call, string arrayName)
    {
        WReq(w, call, "app_token", "app_token");
        WReq(w, call, "table_id", "table_id");
        w.WritePropertyName(arrayName == "record_ids" ? "recordIds" : "records");
        if (call.Input.TryGetProperty(arrayName, out var arr)) arr.WriteTo(w); else w.WriteStartArray(); w.WriteEndArray();
    }

    private static string R(AgentRuntimeNativeToolCall call, string name)
    {
        var value = JsonHelpers.GetString(call.Input, name)
            ?? (name.Contains('_', StringComparison.Ordinal)
                ? JsonHelpers.GetString(call.Input, ToCamelCase(name))
                : null);
        return value?.Trim() ?? string.Empty;
    }

    private static string ToCamelCase(string name)
    {
        var result = new StringBuilder(name.Length);
        var upperNext = false;
        foreach (var ch in name)
        {
            if (ch == '_')
            {
                upperNext = true;
                continue;
            }
            result.Append(upperNext ? char.ToUpperInvariant(ch) : ch);
            upperNext = false;
        }
        return result.ToString();
    }

    private static void WReq(Utf8JsonWriter w, AgentRuntimeNativeToolCall call, string outName, string inName) =>
        w.WriteString(outName, R(call, inName));

    private static void WOpt(Utf8JsonWriter w, AgentRuntimeNativeToolCall call, string outName, string inName)
    {
        var v = JsonHelpers.GetString(call.Input, inName);
        if (!string.IsNullOrWhiteSpace(v)) w.WriteString(outName, v);
    }

    private static void WOptI(Utf8JsonWriter w, AgentRuntimeNativeToolCall call, string outName, string inName)
    {
        if (JsonHelpers.GetIntNullable(call.Input, inName) is { } v) w.WriteNumber(outName, v);
    }

    private static string ReadPluginId(JsonElement input, JsonElement parameters) =>
        (JsonHelpers.GetString(input, "plugin_id") ?? JsonHelpers.GetString(parameters, "pluginId") ?? string.Empty).Trim();

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

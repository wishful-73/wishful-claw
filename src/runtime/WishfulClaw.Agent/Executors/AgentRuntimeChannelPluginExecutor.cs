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
/// Channel plugin executor — Feishu/Weixin integration via reverse-request to Main process.
/// Ported from WishfulClaw AgentRuntimeChannelPluginExecutor.
/// </summary>
public static class AgentRuntimeChannelPluginExecutor
{
    private static readonly HashSet<string> ChannelPluginToolNames = new(StringComparer.Ordinal)
    {
        "FeishuSendImage", "FeishuSendFile", "FeishuSendAudio",
        "FeishuListChatMembers", "FeishuAtMember",
        "FeishuSendUrgent", "FeishuBitableListApps", "FeishuBitableListTables",
        "FeishuBitableListFields", "FeishuBitableGetRecords", "FeishuBitableCreateRecords",
        "FeishuBitableUpdateRecords", "FeishuBitableDeleteRecords",
        "WeixinSendImage", "WeixinSendFile", "WeixinSendAudio",
        "ChannelSendImage", "ChannelSendFile", "ChannelSendAudio"
    };

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static bool IsChannelPluginTool(string toolName) => ChannelPluginToolNames.Contains(toolName);

    /// <summary>
    /// 三个「通用出站媒体」工具 —— 走 <see cref="ResolveGenericRoute"/>、渠道类型从 run 参数推的
    /// 那一批。<c>FeishuSendImage</c> 之类写死渠道的不算：它们在别的渠道可见本身就说不通，但
    /// 那是另一个问题，别混进这条判据。
    /// </summary>
    public static bool IsChannelMediaTool(string toolName) =>
        toolName is "ChannelSendImage" or "ChannelSendFile" or "ChannelSendAudio";

    public static bool RequiresApproval(string toolName) =>
        toolName is "FeishuSendImage" or "FeishuSendFile" or "FeishuSendAudio" or "FeishuAtMember" or
                     "FeishuSendUrgent" or "WeixinSendImage" or "WeixinSendFile" or "WeixinSendAudio";

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
            "WeixinSendAudio" => ("plugin:weixin:send-audio", w => { w.WriteString("chatId", R(call, "chat_id")); w.WriteString("filePath", R(call, "file_path")); WOpt(w, call, "content", "content"); WOptI(w, call, "durationMs", "durationMs"); }),
            "FeishuSendAudio" => ("plugin:feishu:send-audio", w => { w.WriteString("chatId", R(call, "chat_id")); w.WriteString("filePath", R(call, "file_path")); }),
            "ChannelSendImage" => ResolveGenericRoute(call, parameters, "image"),
            "ChannelSendFile" => ResolveGenericRoute(call, parameters, "file"),
            "ChannelSendAudio" => ResolveGenericRoute(call, parameters, "audio"),
            "FeishuListChatMembers" => ("plugin:feishu:list-members", w => { w.WriteString("chatId", R(call, "chat_id")); WOptI(w, call, "page_size", "page_size"); WOpt(w, call, "page_token", "page_token"); }),
            "FeishuAtMember" => ("plugin:feishu:send-mention", w =>
            {
                w.WriteString("chatId", R(call, "chat_id"));
                w.WriteString("text", R(call, "text"));
                w.WriteStartArray("userIds");
                foreach (var uid in RArray(call, "user_ids")) w.WriteStringValue(uid);
                w.WriteEndArray();
                w.WriteBoolean("atAll", RBool(call, "at_all", false));
            }),
            "FeishuSendUrgent" => ("plugin:feishu:send-urgent", w =>
            {
                w.WriteString("messageId", R(call, "message_id"));
                w.WriteStartArray("userIds");
                foreach (var uid in RArray(call, "user_ids")) w.WriteStringValue(uid);
                w.WriteEndArray();
                w.WriteStartArray("urgentTypes");
                foreach (var t in RArray(call, "urgent_types").Where(x => x is "app" or "sms")) w.WriteStringValue(t);
                w.WriteEndArray();
            }),
            "FeishuBitableListApps" => ("plugin:feishu:bitable:list-apps", w => WOptI(w, call, "page_size", "page_size")),
            "FeishuBitableListTables" => ("plugin:feishu:bitable:list-tables", w => WReq(w, call, "app_token", "app_token")),
            "FeishuBitableListFields" => ("plugin:feishu:bitable:list-fields", w => { WReq(w, call, "app_token", "app_token"); WReq(w, call, "table_id", "table_id"); }),
            "FeishuBitableGetRecords" => ("plugin:feishu:bitable:get-records", w => { WReq(w, call, "app_token", "app_token"); WReq(w, call, "table_id", "table_id"); WOpt(w, call, "filter", "filter"); WOptI(w, call, "page_size", "page_size"); WOpt(w, call, "page_token", "page_token"); }),
            "FeishuBitableCreateRecords" => ("plugin:feishu:bitable:create-records", w => BitableMut(w, call, "records")),
            "FeishuBitableUpdateRecords" => ("plugin:feishu:bitable:update-records", w => BitableMut(w, call, "records")),
            "FeishuBitableDeleteRecords" => ("plugin:feishu:bitable:delete-records", w => BitableMut(w, call, "record_ids")),
            _ => (null, _ => { })
        };
    }

    /// <summary>
    /// 这家渠道的 provider key —— <c>weixin</c> / <c>feishu</c>，认不出返回 null。
    ///
    /// 路由（<see cref="ResolveGenericRoute"/>）和工具可见性（<c>AgentRunContextPolicy</c>）共用
    /// 这一个判断，不各持一份能力表。S-352 的病根正是「注册期说支持、路由期说不认识」，两个
    /// 文件谁都没错，合起来错 —— 所以这里必须是唯一入口。
    /// </summary>
    public static string? ResolveProvider(string? pluginType, string? pluginId)
    {
        var type = (pluginType ?? string.Empty).Trim().ToLowerInvariant();
        if (type.Contains("weixin", StringComparison.Ordinal)) return "weixin";
        if (type.Contains("feishu", StringComparison.Ordinal)) return "feishu";

        var id = pluginId ?? string.Empty;
        if (id.Contains("weixin", StringComparison.OrdinalIgnoreCase)) return "weixin";
        if (id.Contains("feishu", StringComparison.OrdinalIgnoreCase)) return "feishu";

        return null;
    }

    /// <summary>
    /// 这家渠道能不能发出站媒体（image / file / audio）。
    ///
    /// 判据是「有没有 handler 路由」，不是另立一份 <c>supportedMediaKinds</c> 的副本 —— 那份
    /// 能力表的真源在 TS 侧（<c>FEISHU_SUPPORTED_MEDIA_KINDS</c> / <c>WEIXIN_SUPPORTED_MEDIA_KINDS</c>），
    /// C# 侧唯一能反映它的事实就是「这家有没有 send-image / send-file / send-audio 路由」。
    ///
    /// 目前两家三种形态都支持。哪天某家只能发图，先改能力表，再让这里按形态细分。
    /// </summary>
    public static bool SupportsOutboundMedia(string? provider) => provider is "weixin" or "feishu";

    private static (string? channel, Action<Utf8JsonWriter> writeExtra) ResolveGenericRoute(
        AgentRuntimeNativeToolCall call, JsonElement parameters, string kind)
    {
        var provider = ResolveProvider(
            JsonHelpers.GetString(parameters, "pluginType") ?? JsonHelpers.GetString(parameters, "channelType"),
            JsonHelpers.GetString(parameters, "pluginId"));
        var route = provider is null ? null : $"plugin:{provider}:send-{kind}";
        return (route, w =>
        {
            w.WriteString("chatId", JsonHelpers.GetString(parameters, "externalChatId") ??
                JsonHelpers.GetString(parameters, "pluginChatId") ?? string.Empty);
            w.WriteString("filePath", R(call, "filePath"));
            WOpt(w, call, "fileType", "fileType");
            if (kind == "audio") WOptI(w, call, "durationMs", "durationMs");
        });
    }

    private static void BitableMut(Utf8JsonWriter w, AgentRuntimeNativeToolCall call, string arrayName)
    {
        WReq(w, call, "app_token", "app_token");
        WReq(w, call, "table_id", "table_id");
        w.WritePropertyName(arrayName == "record_ids" ? "recordIds" : "records");
        // 原写法 `if (x) A; else B; C;` 里 C 是条件外无条件执行的，命中时会在对象里补一个 WriteEndArray 直接抛异常。
        if (TryGetProp(call.Input, arrayName, out var array) && array.ValueKind == JsonValueKind.Array)
        {
            array.WriteTo(w);
            return;
        }
        w.WriteStartArray();
        w.WriteEndArray();
    }

    /// <summary>
    /// 读入参：先按传入名精确命中，未命中再按驼峰 / 蛇形互换命中。
    /// </summary>
    /// <remarks>
    /// 工具 schema（<c>ChannelPluginToolProvider</c>）用驼峰（<c>filePath</c>），而路由代码历史上一律按蛇形读
    /// （<c>file_path</c>）。<c>JsonHelpers</c> 全是 <c>TryGetProperty</c> 精确匹配，早先只给必填字符串打了个
    /// 「名字含下划线才回落驼峰」的补丁（见旧 R），于是可选字段、数字、数组、布尔全都读不到 —— 模型照着
    /// schema 传了也白传，报错还像是模型没传（S-353）。这里把回落做成唯一入口，下面那些 helper 一律走它，
    /// 两套命名从此互通。
    /// </remarks>
    private static bool TryGetProp(JsonElement input, string name, out JsonElement value)
    {
        if (input.ValueKind == JsonValueKind.Object)
        {
            if (input.TryGetProperty(name, out value)) return true;
            var alternate = name.Contains('_', StringComparison.Ordinal) ? ToCamelCase(name) : ToSnakeCase(name);
            if (input.TryGetProperty(alternate, out value)) return true;
        }
        value = default;
        return false;
    }

    private static string R(AgentRuntimeNativeToolCall call, string name) =>
        (TryGetProp(call.Input, name, out var raw) ? JsonHelpers.AsString(raw) : null)?.Trim() ?? string.Empty;

    private static string[] RArray(AgentRuntimeNativeToolCall call, string name) =>
        TryGetProp(call.Input, name, out var raw) ? JsonHelpers.AsStringArray(raw) : Array.Empty<string>();

    private static bool RBool(AgentRuntimeNativeToolCall call, string name, bool fallback) =>
        TryGetProp(call.Input, name, out var raw) ? JsonHelpers.AsBool(raw, fallback) : fallback;

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

    private static string ToSnakeCase(string name)
    {
        var result = new StringBuilder(name.Length + 4);
        for (var i = 0; i < name.Length; i++)
        {
            var ch = name[i];
            if (!char.IsUpper(ch))
            {
                result.Append(ch);
                continue;
            }
            if (i > 0) result.Append('_');
            result.Append(char.ToLowerInvariant(ch));
        }
        return result.ToString();
    }

    private static void WReq(Utf8JsonWriter w, AgentRuntimeNativeToolCall call, string outName, string inName) =>
        w.WriteString(outName, R(call, inName));

    private static void WOpt(Utf8JsonWriter w, AgentRuntimeNativeToolCall call, string outName, string inName)
    {
        var value = TryGetProp(call.Input, inName, out var raw) ? JsonHelpers.AsString(raw) : null;
        if (!string.IsNullOrWhiteSpace(value)) w.WriteString(outName, value);
    }

    private static void WOptI(Utf8JsonWriter w, AgentRuntimeNativeToolCall call, string outName, string inName)
    {
        if (TryGetProp(call.Input, inName, out var raw) && JsonHelpers.AsIntNullable(raw) is { } v)
        {
            w.WriteNumber(outName, v);
        }
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

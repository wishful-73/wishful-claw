using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers channel-specific plugin tool definitions (Feishu, WeChat).
/// Execution: ToolDispatchRouter → AgentRuntimeChannelPluginExecutor (reverse-request to main process).
/// Available in normal, goal, global, and channel modes (not sub-agent).
/// </summary>
public sealed class ChannelPluginToolProvider : IToolProvider
{
    public string Category => "channel-plugin";

    public void RegisterTools(ToolRegistry registry)
    {
        var chatIdProp = ToolSchemaBuilder.String("Target chat ID.");

        // ── Generic current-channel messaging ──
        registry.Register(new ToolDefinitionPlaceholder(
            "ChannelSendImage",
            "Send an image to the current channel conversation. The channel is inferred from the current session.",
            ToolSchemaBuilder.Object(new() { ["filePath"] = ToolSchemaBuilder.String("Local path to the image file.") }, ["filePath"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "ChannelSendFile",
            "Send a file to the current channel conversation. The channel is inferred from the current session.",
            ToolSchemaBuilder.Object(new() { ["filePath"] = ToolSchemaBuilder.String("Local path to the file."), ["fileType"] = ToolSchemaBuilder.String("Optional file type.") }, ["filePath"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "ChannelSendAudio",
            "Send a voice/audio message to the current channel conversation. The channel is inferred from the current session. " +
            "If the channel does not support audio the text is sent instead.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["filePath"] = ToolSchemaBuilder.String("Local path to the audio file."),
                    ["durationMs"] = ToolSchemaBuilder.Number("Optional audio duration in milliseconds.")
                },
                ["filePath"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        // ── Feishu messaging ──
        registry.Register(new ToolDefinitionPlaceholder(
            "FeishuSendImage",
            "Send an image to a Feishu chat.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["chatId"] = chatIdProp,
                    ["filePath"] = ToolSchemaBuilder.String("Local path to the image file.")
                },
                ["chatId", "filePath"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "FeishuSendFile",
            "Send a file to a Feishu chat.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["chatId"] = chatIdProp,
                    ["filePath"] = ToolSchemaBuilder.String("Local path to the file.")
                },
                ["chatId", "filePath"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "FeishuSendAudio",
            "Send a voice message to a Feishu chat. Feishu only accepts opus audio (about 60s max); " +
            "other formats are rejected by the upload API rather than silently downgraded.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["chatId"] = chatIdProp,
                    ["filePath"] = ToolSchemaBuilder.String("Local path to the opus audio file.")
                },
                ["chatId", "filePath"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "FeishuListChatMembers",
            "List members in a Feishu chat. Page through with pageToken.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["chatId"] = chatIdProp,
                    ["pageSize"] = ToolSchemaBuilder.Integer("Page size. Defaults to Feishu's own page size."),
                    ["pageToken"] = ToolSchemaBuilder.String("Opaque cursor from a previous page.")
                },
                ["chatId"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "FeishuAtMember",
            "Mention one or more members in a Feishu message.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["chatId"] = chatIdProp,
                    ["userIds"] = ToolSchemaBuilder.ArraySchema("User IDs to mention.", ToolSchemaBuilder.String("User ID.")),
                    ["text"] = ToolSchemaBuilder.String("Message content."),
                    ["atAll"] = ToolSchemaBuilder.Boolean("Mention everyone in the chat instead of the listed user IDs.")
                },
                ["chatId", "text"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "FeishuSendUrgent",
            "Send an urgent message in Feishu.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["messageId"] = ToolSchemaBuilder.String("Message ID to mark as urgent."),
                    ["userIds"] = ToolSchemaBuilder.ArraySchema("User IDs to notify.", ToolSchemaBuilder.String("User ID.")),
                    ["urgentTypes"] = ToolSchemaBuilder.ArraySchema(
                        "Urgent notification kinds, any of app / sms. Defaults to app.",
                        ToolSchemaBuilder.String("Urgent type.", ["app", "sms"]))
                },
                ["messageId"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        // ── Feishu Bitable ──
        RegisterFeishuBitableTools(registry);

        // ── WeChat ──
        registry.Register(new ToolDefinitionPlaceholder(
            "WeixinSendImage",
            "Send an image to a WeChat chat.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["chatId"] = chatIdProp,
                    ["filePath"] = ToolSchemaBuilder.String("Local path to the image file.")
                },
                ["chatId", "filePath"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "WeixinSendFile",
            "Send a file to a WeChat chat.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["chatId"] = chatIdProp,
                    ["filePath"] = ToolSchemaBuilder.String("Local path to the file.")
                },
                ["chatId", "filePath"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "WeixinSendAudio",
            "Send a voice message to a WeChat chat. The encode_type is inferred from the file extension " +
            "(silk / mp3 / amr / speex / ogg / opus / wav / pcm), unknown extensions fall back to silk.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["chatId"] = chatIdProp,
                    ["filePath"] = ToolSchemaBuilder.String("Local path to the audio file."),
                    ["content"] = ToolSchemaBuilder.String("Optional caption sent together with the voice message."),
                    ["durationMs"] = ToolSchemaBuilder.Number("Optional audio duration in milliseconds.")
                },
                ["chatId", "filePath"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));
    }

    private static void RegisterFeishuBitableTools(ToolRegistry registry)
    {
        var appToken = ToolSchemaBuilder.String("Bitable app token.");
        var tableId = ToolSchemaBuilder.String("Bitable table ID.");

        registry.Register(new ToolDefinitionPlaceholder(
            "FeishuBitableListApps",
            "List Feishu Bitable (多维表格) apps.",
            ToolSchemaBuilder.Object(
                new() { ["pageSize"] = ToolSchemaBuilder.Number("Page size. Defaults to 50.") }),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "FeishuBitableListTables",
            "List tables in a Feishu Bitable app.",
            ToolSchemaBuilder.Object(
                new() { ["appToken"] = appToken },
                ["appToken"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "FeishuBitableListFields",
            "List fields in a Feishu Bitable table.",
            ToolSchemaBuilder.Object(
                new() { ["appToken"] = appToken, ["tableId"] = tableId },
                ["appToken", "tableId"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "FeishuBitableGetRecords",
            "Get records from a Feishu Bitable table.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["appToken"] = appToken,
                    ["tableId"] = tableId,
                    ["pageSize"] = ToolSchemaBuilder.Number("Page size. Defaults to 50."),
                    ["filter"] = ToolSchemaBuilder.String("Optional filter condition.")
                },
                ["appToken", "tableId"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "FeishuBitableCreateRecords",
            "Create records in a Feishu Bitable table.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["appToken"] = appToken,
                    ["tableId"] = tableId,
                    ["records"] = ToolSchemaBuilder.ArraySchema("Records to create.", ToolSchemaBuilder.String("Record JSON."))
                },
                ["appToken", "tableId", "records"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "FeishuBitableUpdateRecords",
            "Update records in a Feishu Bitable table.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["appToken"] = appToken,
                    ["tableId"] = tableId,
                    ["records"] = ToolSchemaBuilder.ArraySchema("Records to update.", ToolSchemaBuilder.String("Record JSON."))
                },
                ["appToken", "tableId", "records"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "FeishuBitableDeleteRecords",
            "Delete records from a Feishu Bitable table.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["appToken"] = appToken,
                    ["tableId"] = tableId,
                    ["recordIds"] = ToolSchemaBuilder.ArraySchema("Record IDs to delete.", ToolSchemaBuilder.String("Record ID."))
                },
                ["appToken", "tableId", "recordIds"]),
            availableModes: ["normal", "goal", "global", "channel"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly));
    }
}
using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers channel-agnostic plugin messaging tool definitions.
/// Execution: ToolDispatchRouter → AgentRuntimePluginExecutor (reverse-request to main process).
/// </summary>
public sealed class PluginToolProvider : IToolProvider
{
    public string Category => "plugin";

    public void RegisterTools(ToolRegistry registry)
    {
        var chatId = ToolSchemaBuilder.String("Target chat ID.");
        var content = ToolSchemaBuilder.String("Message content to send.");

        registry.Register(new ToolDefinitionPlaceholder(
            "PluginSendMessage",
            "Send a text message through a messaging channel (Feishu, WeChat, etc.).",
            ToolSchemaBuilder.Object(
                new() { ["chatId"] = chatId, ["content"] = content },
                ["chatId", "content"]
            ),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly
        ));

        registry.Register(new ToolDefinitionPlaceholder(
            "PluginReplyMessage",
            "Reply to a specific message through a messaging channel.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["messageId"] = ToolSchemaBuilder.String("The message ID to reply to."),
                    ["content"] = content
                },
                ["messageId", "content"]
            ),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly
        ));

        registry.Register(new ToolDefinitionPlaceholder(
            "PluginGetGroupMessages",
            "Get recent messages from a group chat.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["chatId"] = chatId,
                    ["count"] = ToolSchemaBuilder.Number("Number of messages to retrieve. Defaults to 20.")
                },
                ["chatId"]
            ),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly
        ));

        registry.Register(new ToolDefinitionPlaceholder(
            "PluginListGroups",
            "List all groups/chats the channel bot is in.",
            ToolSchemaBuilder.Object(),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly
        ));

        registry.Register(new ToolDefinitionPlaceholder(
            "PluginSummarizeGroup",
            "Summarize recent messages in a group chat.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["chatId"] = chatId,
                    ["count"] = ToolSchemaBuilder.Number("Number of recent messages to summarize. Defaults to 50.")
                },
                ["chatId"]
            ),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly
        ));

        registry.Register(new ToolDefinitionPlaceholder(
            "PluginGetCurrentChatMessages",
            "Get messages from the current chat context.",
            ToolSchemaBuilder.Object(
                new() { ["count"] = ToolSchemaBuilder.Number("Number of messages. Defaults to 20.") }
            ),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.ChannelOnly
        ));
    }
}
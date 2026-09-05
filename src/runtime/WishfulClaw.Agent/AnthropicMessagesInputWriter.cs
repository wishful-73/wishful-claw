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
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// Anthropic Messages request body builder.
/// System prompt and tools carry cache_control breakpoints for prefix caching.
    /// No sanitizer, no validation stats.
/// </summary>
internal static partial class AnthropicMessagesProvider
{
    internal static string BuildRequestBodyForTests(
        JsonElement parameters,
        JsonElement provider,
        IReadOnlyList<AgentRuntimeChatMessage> conversation,
        IReadOnlyList<ToolDefinition> toolDefs,
        AgentRuntimeRunState state) =>
        BuildRequestBody(parameters, provider, conversation, toolDefs, state);

    private static string BuildRequestBody(
        JsonElement parameters,
        JsonElement provider,
        IReadOnlyList<AgentRuntimeChatMessage> conversation,
        IReadOnlyList<ToolDefinition> toolDefs,
        AgentRuntimeRunState state)
    {
        var buffer = new ArrayBufferWriter<byte>();
        var omitted = ProviderRequestOverrides.GetOmittedBodyKeys(provider);

        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();

            writer.WriteString("model", JsonHelpers.GetString(provider, "model") ?? string.Empty);

            if (!omitted.Contains("max_tokens"))
            {
                writer.WriteNumber("max_tokens", ResolveMaxTokens(provider));
            }

            // System prompt (with cache_control breakpoint for prefix caching)
            if (JsonHelpers.GetString(provider, "systemPrompt") is { Length: > 0 } systemPrompt)
            {
                writer.WritePropertyName("system");
                writer.WriteStartArray();
                writer.WriteStartObject();
                writer.WriteString("type", "text");
                writer.WriteString("text", systemPrompt);
                // cache_control: ephemeral — marks this as a cache breakpoint
                writer.WritePropertyName("cache_control");
                writer.WriteStartObject();
                writer.WriteString("type", "ephemeral");
                writer.WriteEndObject();
                writer.WriteEndObject();
                writer.WriteEndArray();
            }

            // Messages
            writer.WritePropertyName("messages");
            WriteMessages(writer, conversation, state);

            // Tools (from backend registry — no JSON round-trip)
            WriteTools(writer, toolDefs);

            writer.WriteBoolean("stream", true);

            // Thinking config
            var wroteThinking = WriteThinkingConfig(writer, provider, omitted);
            if (!wroteThinking &&
                !omitted.Contains("temperature") &&
                JsonHelpers.GetDoubleNullable(provider, "temperature") is { } temperature)
            {
                writer.WriteNumber("temperature", temperature);
            }

            ProviderRequestOverrides.WriteBodyOverrides(writer, provider, omitted);

            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    private static void WriteMessages(Utf8JsonWriter writer, IReadOnlyList<AgentRuntimeChatMessage> conversation, AgentRuntimeRunState? state)
    {
        // Pre-compute which messages will be written (filter consecutive same-role).
        var messagesToWrite = new List<AgentRuntimeChatMessage>();
        string? lastRole = null;

        foreach (var message in conversation)
        {
            if (message.Role == "system") continue;
            var role = message.Role == "assistant" ? "assistant" : "user";
            if (role == lastRole) continue;
            messagesToWrite.Add(message);
            lastRole = role;
        }

        var needsContinueMessage = lastRole == "assistant";
        var count = messagesToWrite.Count;

        writer.WriteStartArray();

        // Breakpoint strategy (Reasonix-aligned, max 4, we use 2):
        // 1. System prompt (added in BuildRequestBody)
        // 2. Last real message (current turn — cached for next turn)
        // No breakpoint on second-to-last: it's already covered by the
        // previous turn's last-message breakpoint.
        for (var i = 0; i < count; i++)
        {
            var isLastReal = i == count - 1;

            // Memory recall, memory-update notes, and timestamp are already
            // injected into the conversation message by InjectTransientPrefix
            // and TryInjectMemoryRecallAsync. No write-time suffix injection
            // here - doing so would double-inject memory content.
            var msg = messagesToWrite[i];

            WriteSingleMessage(writer, msg, isLastReal);
        }

        if (needsContinueMessage)
        {
            writer.WriteStartObject();
            writer.WriteString("role", "user");
            writer.WritePropertyName("content");
            writer.WriteStartArray();
            writer.WriteStartObject();
            writer.WriteString("type", "text");
            writer.WriteString("text", "Continue.");
            writer.WriteEndObject();
            writer.WriteEndArray();
            writer.WriteEndObject();
        }

        writer.WriteEndArray();
    }

    /// <summary>
    /// Writes a single message. When <paramref name="addCacheControl"/> is true,
    /// cache_control: ephemeral is added to the last content block — this is the
    /// Reasonix-aligned breakpoint that ensures the entire conversation prefix
    /// is cached for subsequent turns.
    /// </summary>
    private static void WriteSingleMessage(Utf8JsonWriter writer, AgentRuntimeChatMessage message, bool addCacheControl)
    {
        var role = message.Role == "assistant" ? "assistant" : "user";

        writer.WriteStartObject();
        writer.WriteString("role", role);

        if (message.Role == "user" &&
            message.ToolResults.Count == 0 &&
            message.ToolUses.Count == 0 &&
            HasImageContent(message.ContentBlocks))
        {
            writer.WritePropertyName("content");
            WriteAnthropicContentBlocks(writer, message.ContentBlocks!, addCacheControl);
            writer.WriteEndObject();
            return;
        }

        if (message.ToolResults.Count > 0)
        {
            writer.WritePropertyName("content");
            writer.WriteStartArray();
            for (var j = 0; j < message.ToolResults.Count; j++)
            {
                var toolResult = message.ToolResults[j];
                var isLastBlock = addCacheControl && j == message.ToolResults.Count - 1 && string.IsNullOrEmpty(message.Text);
                writer.WriteStartObject();
                writer.WriteString("type", "tool_result");
                writer.WriteString("tool_use_id", toolResult.ToolUseId);
                writer.WritePropertyName("content");
                if (toolResult.Content.ValueKind == JsonValueKind.String)
                {
                    writer.WriteStringValue(toolResult.Content.GetString() ?? string.Empty);
                }
                else
                {
                    writer.WriteStringValue(ProviderContentHelpers.ToolResultToString(toolResult.Content));
                }
                if (toolResult.IsError.HasValue)
                {
                    writer.WriteBoolean("is_error", toolResult.IsError.Value);
                }
                if (isLastBlock) WriteCacheControl(writer);
                writer.WriteEndObject();
            }
            // Also include any text
            if (!string.IsNullOrEmpty(message.Text))
            {
                writer.WriteStartObject();
                writer.WriteString("type", "text");
                writer.WriteString("text", message.Text);
                if (addCacheControl) WriteCacheControl(writer);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
        }
        else if (message.ToolUses.Count > 0)
        {
            // Assistant with tool_use blocks
            writer.WritePropertyName("content");
            writer.WriteStartArray();
            if (!string.IsNullOrEmpty(message.Text))
            {
                writer.WriteStartObject();
                writer.WriteString("type", "text");
                writer.WriteString("text", message.Text);
                writer.WriteEndObject();
            }
            for (var j = 0; j < message.ToolUses.Count; j++)
            {
                var toolUse = message.ToolUses[j];
                var isLastBlock = addCacheControl && j == message.ToolUses.Count - 1;
                writer.WriteStartObject();
                writer.WriteString("type", "tool_use");
                writer.WriteString("id", toolUse.Id);
                writer.WriteString("name", toolUse.Name);
                writer.WritePropertyName("input");
                toolUse.Input.WriteTo(writer);
                if (isLastBlock) WriteCacheControl(writer);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
        }
        else
        {
            // Simple text message
            if (addCacheControl)
            {
                // Convert to array format to attach cache_control
                writer.WritePropertyName("content");
                writer.WriteStartArray();
                writer.WriteStartObject();
                writer.WriteString("type", "text");
                writer.WriteString("text", message.Text);
                WriteCacheControl(writer);
                writer.WriteEndObject();
                writer.WriteEndArray();
            }
            else
            {
                writer.WriteString("content", message.Text);
            }
        }

        writer.WriteEndObject();
    }

    private static bool HasImageContent(IReadOnlyList<JsonElement>? contentBlocks)
    {
        if (contentBlocks is null) return false;
        foreach (var block in contentBlocks)
        {
            if (JsonHelpers.GetString(block, "type") == "image" &&
                block.TryGetProperty("source", out var source) &&
                source.ValueKind == JsonValueKind.Object &&
                ((JsonHelpers.GetString(source, "type") == "url" &&
                  !string.IsNullOrWhiteSpace(JsonHelpers.GetString(source, "url"))) ||
                 (JsonHelpers.GetString(source, "type") != "url" &&
                  !string.IsNullOrWhiteSpace(JsonHelpers.GetString(source, "data")))))
            {
                return true;
            }
        }
        return false;
    }

    private static void WriteAnthropicContentBlocks(
        Utf8JsonWriter writer,
        IReadOnlyList<JsonElement> contentBlocks,
        bool addCacheControl)
    {
        var writableBlocks = new List<JsonElement>();
        foreach (var block in contentBlocks)
        {
            var type = JsonHelpers.GetString(block, "type");
            if (type == "text")
            {
                writableBlocks.Add(block);
                continue;
            }

            if (type == "image" &&
                block.TryGetProperty("source", out var source) &&
                source.ValueKind == JsonValueKind.Object &&
                ((JsonHelpers.GetString(source, "type") == "url" &&
                  !string.IsNullOrWhiteSpace(JsonHelpers.GetString(source, "url"))) ||
                 (JsonHelpers.GetString(source, "type") != "url" &&
                  !string.IsNullOrWhiteSpace(JsonHelpers.GetString(source, "data")))))
            {
                writableBlocks.Add(block);
            }
        }

        writer.WriteStartArray();
        for (var index = 0; index < writableBlocks.Count; index++)
        {
            var block = writableBlocks[index];
            var type = JsonHelpers.GetString(block, "type");
            var isLastBlock = addCacheControl && index == writableBlocks.Count - 1;
            writer.WriteStartObject();

            if (type == "text")
            {
                writer.WriteString("type", "text");
                writer.WriteString("text", JsonHelpers.GetString(block, "text") ?? string.Empty);
                if (isLastBlock) WriteCacheControl(writer);
                writer.WriteEndObject();
                continue;
            }

            var source = block.GetProperty("source");
            var sourceType = JsonHelpers.GetString(source, "type");
            if (sourceType == "url")
            {
                var url = JsonHelpers.GetString(source, "url");
                if (string.IsNullOrWhiteSpace(url)) continue;
                writer.WriteString("type", "image");
                writer.WritePropertyName("source");
                writer.WriteStartObject();
                writer.WriteString("type", "url");
                writer.WriteString("url", url);
                writer.WriteEndObject();
            }
            else
            {
                var data = JsonHelpers.GetString(source, "data");
                if (string.IsNullOrWhiteSpace(data)) continue;
                writer.WriteString("type", "image");
                writer.WritePropertyName("source");
                writer.WriteStartObject();
                writer.WriteString("type", "base64");
                writer.WriteString(
                    "media_type",
                    JsonHelpers.GetString(source, "mediaType") ??
                    ProviderContentHelpers.DetectImageMediaTypeFromBase64(data) ??
                    "image/png");
                writer.WriteString("data", ProviderContentHelpers.StripDataUrlPrefix(data));
                writer.WriteEndObject();
            }
            if (isLastBlock) WriteCacheControl(writer);
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    /// <summary>
    /// Writes the cache_control: ephemeral breakpoint marker.
    /// </summary>
    private static void WriteCacheControl(Utf8JsonWriter writer)
    {
        writer.WritePropertyName("cache_control");
        writer.WriteStartObject();
        writer.WriteString("type", "ephemeral");
        writer.WriteEndObject();
    }

    private static void WriteTools(Utf8JsonWriter writer, IReadOnlyList<ToolDefinition> toolDefs)
    {
        if (toolDefs.Count == 0) return;

        // Preserve workflow priority while keeping deterministic ordering for
        // callers that bypass the registry.
        var sorted = new List<ToolDefinition>(toolDefs);
        sorted.Sort((a, b) =>
        {
            var byPriority = a.Priority.CompareTo(b.Priority);
            return byPriority != 0
                ? byPriority
                : string.Compare(a.Name, b.Name, StringComparison.Ordinal);
        });

        writer.WritePropertyName("tools");
        writer.WriteStartArray();

        // No cache_control on tools — breakpoints are on system[last] + messages[last].
        // (Reasonix pattern: tools → system → messages, breakpoint on system and last message)
        foreach (var def in sorted)
        {
            writer.WriteStartObject();
            writer.WriteString("name", def.Name);
            writer.WriteString("description", def.Description);
            writer.WritePropertyName("input_schema");
            def.InputSchema.WriteTo(writer);
            writer.WriteEndObject();
        }

        writer.WriteEndArray();
    }

    private static bool WriteThinkingConfig(Utf8JsonWriter writer, JsonElement provider, HashSet<string> omitted)
    {
        if (!provider.TryGetProperty("thinkingConfig", out var thinkingConfig) ||
            thinkingConfig.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        var enabled = JsonHelpers.GetBool(thinkingConfig, "enabled", false);
        if (!enabled || omitted.Contains("thinking")) return false;

        var budget = JsonHelpers.GetIntNullable(thinkingConfig, "budgetTokens") ?? 10000;
        budget = Math.Max(1024, budget);

        writer.WritePropertyName("thinking");
        writer.WriteStartObject();
        writer.WriteString("type", "enabled");
        writer.WriteNumber("budget_tokens", budget);
        writer.WriteEndObject();

        // When thinking is enabled, temperature must be 1
        if (!omitted.Contains("temperature"))
        {
            writer.WriteNumber("temperature", 1);
        }

        return true;
    }

    private static int ResolveMaxTokens(JsonElement provider)
    {
        var maxTokens = JsonHelpers.GetIntNullable(provider, "maxTokens") ?? 4096;
        return maxTokens > 0 ? maxTokens : 4096;
    }
}

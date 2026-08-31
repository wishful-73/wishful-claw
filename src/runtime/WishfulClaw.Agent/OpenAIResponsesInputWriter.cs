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
/// Request body builder for the OpenAI Responses API provider.
/// Ported from OpenCowork AgentRuntimeOpenAIResponsesInputWriter.cs (simplified —
/// no prompt cache, sanitize replay, previous_response_id, content_blocks,
/// computer use, image generation, or web search).
/// </summary>
internal static partial class OpenAIResponsesProvider
{
    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    internal static string BuildRequestBodyForTests(
        JsonElement provider,
        IReadOnlyList<AgentRuntimeChatMessage> conversation,
        IReadOnlyList<ToolDefinition> toolDefs) =>
        BuildRequestBody(provider, conversation, toolDefs);

    private static string BuildRequestBody(
        JsonElement provider,
        IReadOnlyList<AgentRuntimeChatMessage> conversation,
        IReadOnlyList<ToolDefinition> toolDefs)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            var omitted = ProviderRequestOverrides.GetOmittedBodyKeys(provider);
            writer.WriteStartObject();
            if (!omitted.Contains("model"))
            {
                writer.WriteString("model", JsonHelpers.GetString(provider, "model") ?? string.Empty);
            }
            if (!omitted.Contains("input"))
            {
                writer.WritePropertyName("input");
                WriteResponsesInput(writer, provider, conversation);
            }
            if (!omitted.Contains("stream"))
            {
                writer.WriteBoolean("stream", true);
            }
            if (!omitted.Contains("tools"))
            {
                WriteResponsesTools(writer, toolDefs);
            }

            if (!omitted.Contains("temperature") &&
                JsonHelpers.GetDoubleNullable(provider, "temperature") is { } temperature)
            {
                writer.WriteNumber("temperature", temperature);
            }
            if (!omitted.Contains("max_output_tokens") &&
                JsonHelpers.GetIntNullable(provider, "maxTokens") is { } maxTokens && maxTokens > 0)
            {
                writer.WriteNumber("max_output_tokens", maxTokens);
            }
            if (!omitted.Contains("service_tier") &&
                JsonHelpers.GetString(provider, "serviceTier") is { Length: > 0 } serviceTier)
            {
                writer.WriteString("service_tier", serviceTier);
            }

            WriteResponsesThinkingConfig(writer, provider, omitted);
            ProviderRequestOverrides.WriteBodyOverrides(writer, provider, omitted);
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    private static void WriteResponsesInput(
        Utf8JsonWriter writer,
        JsonElement provider,
        IReadOnlyList<AgentRuntimeChatMessage> conversation)
    {
        writer.WriteStartArray();
        if (JsonHelpers.GetString(provider, "systemPrompt") is { Length: > 0 } systemPrompt)
        {
            writer.WriteStartObject();
            writer.WriteString("type", "message");
            writer.WriteString("role", "developer");
            writer.WriteString("content", systemPrompt);
            writer.WriteEndObject();
        }

        for (var index = 0; index < conversation.Count; index++)
        {
            var message = conversation[index];
            if (message.Role == "system")
            {
                continue;
            }

            foreach (var toolResult in message.ToolResults)
            {
                WriteResponsesToolResult(writer, toolResult);
            }

            if (message.Role != "assistant" && HasImageContent(message.ContentBlocks))
            {
                WriteResponsesMultimodalMessage(writer, message.ContentBlocks!);
            }
            else if (!string.IsNullOrWhiteSpace(message.Text))
            {
                var role = message.Role == "assistant" ? "assistant" : "user";
                WriteResponsesTextMessage(writer, role, message.Text);
            }

            foreach (var toolUse in message.ToolUses)
            {
                WriteResponsesToolUse(writer, toolUse);
            }
        }
        writer.WriteEndArray();
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
                 (JsonHelpers.GetString(source, "type") == "base64" &&
                  !string.IsNullOrWhiteSpace(JsonHelpers.GetString(source, "data")))))
            {
                return true;
            }
        }
        return false;
    }

    private static void WriteResponsesMultimodalMessage(
        Utf8JsonWriter writer,
        IReadOnlyList<JsonElement> contentBlocks)
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
                 (JsonHelpers.GetString(source, "type") == "base64" &&
                  !string.IsNullOrWhiteSpace(JsonHelpers.GetString(source, "data")))))
            {
                writableBlocks.Add(block);
            }
        }
        if (writableBlocks.Count == 0) return;

        writer.WriteStartObject();
        writer.WriteString("type", "message");
        writer.WriteString("role", "user");
        writer.WritePropertyName("content");
        writer.WriteStartArray();
        foreach (var block in writableBlocks)
        {
            var type = JsonHelpers.GetString(block, "type");
            if (type == "text")
            {
                writer.WriteStartObject();
                writer.WriteString("type", "input_text");
                writer.WriteString("text", JsonHelpers.GetString(block, "text") ?? string.Empty);
                writer.WriteEndObject();
                continue;
            }

            var source = block.GetProperty("source");
            var sourceType = JsonHelpers.GetString(source, "type");
            var imageUrl = sourceType == "url"
                ? JsonHelpers.GetString(source, "url")
                : BuildBase64ImageUrl(source);
            if (string.IsNullOrWhiteSpace(imageUrl)) continue;

            writer.WriteStartObject();
            writer.WriteString("type", "input_image");
            writer.WriteString("image_url", imageUrl);
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
        writer.WriteEndObject();
    }

    private static string? BuildBase64ImageUrl(JsonElement source)
    {
        var data = JsonHelpers.GetString(source, "data");
        if (string.IsNullOrWhiteSpace(data)) return null;
        var mediaType = JsonHelpers.GetString(source, "mediaType") ??
            ProviderContentHelpers.DetectImageMediaTypeFromBase64(data) ??
            "image/png";
        return $"data:{mediaType};base64,{ProviderContentHelpers.StripDataUrlPrefix(data)}";
    }

    private static void WriteResponsesTextMessage(
        Utf8JsonWriter writer,
        string role,
        string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return;
        }
        writer.WriteStartObject();
        writer.WriteString("type", "message");
        writer.WriteString("role", role);
        writer.WriteString("content", text);
        writer.WriteEndObject();
    }

    private static void WriteResponsesToolResult(Utf8JsonWriter writer, AgentRuntimeToolResult toolResult)
    {
        writer.WriteStartObject();
        writer.WriteString("type", "function_call_output");
        writer.WriteString("call_id", toolResult.ToolUseId);
        writer.WriteString("output", ToolResultToString(toolResult.Content));
        writer.WriteEndObject();
    }

    private static void WriteResponsesToolUse(Utf8JsonWriter writer, AgentRuntimeChatToolUse toolUse)
    {
        writer.WriteStartObject();
        writer.WriteString("type", "function_call");
        writer.WriteString("call_id", toolUse.Id);
        writer.WriteString("name", toolUse.Name);
        writer.WriteString("arguments", toolUse.Input.GetRawText());
        writer.WriteString("status", "completed");
        writer.WriteEndObject();
    }

    private static void WriteResponsesThinkingConfig(
        Utf8JsonWriter writer,
        JsonElement provider,
        HashSet<string> omitted)
    {
        if (!provider.TryGetProperty("thinkingConfig", out var thinkingConfig) ||
            thinkingConfig.ValueKind != JsonValueKind.Object)
        {
            if (!omitted.Contains("reasoning") &&
                JsonHelpers.GetString(provider, "responseSummary") is { Length: > 0 } summaryValue)
            {
                writer.WritePropertyName("reasoning");
                writer.WriteStartObject();
                writer.WriteString("summary", summaryValue);
                writer.WriteEndObject();
            }
            return;
        }

        var thinkingEnabled = JsonHelpers.GetBool(provider, "thinkingEnabled", false);
        var propertyName = thinkingEnabled ? "bodyParams" : "disabledBodyParams";
        if (thinkingConfig.TryGetProperty(propertyName, out var bodyParams) &&
            bodyParams.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in bodyParams.EnumerateObject())
            {
                if (!omitted.Contains(property.Name) &&
                    property.Name is not ("reasoning" or "include"))
                {
                    property.WriteTo(writer);
                }
            }
        }

        if (!thinkingEnabled || omitted.Contains("reasoning"))
        {
            return;
        }

        var hasReasoning = false;
        if (thinkingConfig.TryGetProperty("bodyParams", out var enabledBodyParams) &&
            enabledBodyParams.ValueKind == JsonValueKind.Object &&
            enabledBodyParams.TryGetProperty("reasoning", out var existingReasoning) &&
            existingReasoning.ValueKind == JsonValueKind.Object)
        {
            hasReasoning = true;
            writer.WritePropertyName("reasoning");
            writer.WriteStartObject();
            foreach (var property in existingReasoning.EnumerateObject())
            {
                property.WriteTo(writer);
            }
        }
        else if (JsonHelpers.GetString(provider, "responseSummary") is { Length: > 0 } ||
                 JsonHelpers.GetString(provider, "reasoningEffort") is { Length: > 0 })
        {
            hasReasoning = true;
            writer.WritePropertyName("reasoning");
            writer.WriteStartObject();
        }

        if (!hasReasoning)
        {
            return;
        }

        if (JsonHelpers.GetString(provider, "reasoningEffort") is { Length: > 0 } reasoningEffort &&
            JsonHelpers.ResolveEffectiveReasoningEffort(reasoningEffort, thinkingConfig)
                is { Length: > 0 } effectiveEffort)
        {
            writer.WriteString("effort", effectiveEffort);
        }
        if (JsonHelpers.GetString(provider, "responseSummary") is { Length: > 0 } summary)
        {
            writer.WriteString("summary", summary);
        }
        writer.WriteEndObject();
    }

    private static void WriteResponsesTools(
        Utf8JsonWriter writer,
        IReadOnlyList<ToolDefinition> toolDefs)
    {
        if (toolDefs.Count == 0)
        {
            return;
        }

        writer.WritePropertyName("tools");
        writer.WriteStartArray();
        foreach (var tool in toolDefs)
        {
            if (string.IsNullOrWhiteSpace(tool.Name))
            {
                continue;
            }

            writer.WriteStartObject();
            writer.WriteString("type", "function");
            writer.WriteString("name", tool.Name);
            writer.WriteString("description", tool.Description);
            writer.WritePropertyName("parameters");
            tool.InputSchema.WriteTo(writer);
            writer.WriteBoolean("strict", false);
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }
}

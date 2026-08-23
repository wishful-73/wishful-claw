using System.Buffers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Wire-format serialization/deserialization for the agent loop.
/// Converts between JsonElement wire messages and AgentRuntimeChatMessage objects,
/// and creates outgoing wire messages for assistant responses and tool results.
/// </summary>
internal static partial class AgentLoop
{
    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    // ── Wire conversation reading ──

    private static List<JsonElement> ReadWireConversation(JsonElement parameters)
    {
        var result = new List<JsonElement>();
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("messages", out var messages) ||
            messages.ValueKind != JsonValueKind.Array)
        {
            return result;
        }

        foreach (var message in messages.EnumerateArray())
        {
            if (message.ValueKind == JsonValueKind.Object)
            {
                result.Add(message.Clone());
            }
        }
        return result;
    }

    private static List<AgentRuntimeChatMessage> ReadConversation(IReadOnlyList<JsonElement> messages)
    {
        var result = new List<AgentRuntimeChatMessage>();

        foreach (var message in messages)
        {
            var role = JsonHelpers.GetString(message, "role");
            if (string.IsNullOrEmpty(role))
            {
                continue;
            }

            if (!message.TryGetProperty("content", out var content))
            {
                continue;
            }

            if (content.ValueKind == JsonValueKind.String)
            {
                result.Add(new AgentRuntimeChatMessage(
                    role,
                    content.GetString() ?? string.Empty,
                    [],
                    [],
                    JsonHelpers.GetString(message, "providerResponseId"),
                    ReasoningDetails: ReadReasoningDetails(message)));
                continue;
            }

            if (content.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            var text = new StringBuilder();
            var toolUses = new List<AgentRuntimeChatToolUse>();
            var toolResults = new List<AgentRuntimeToolResult>();
            var contentBlocks = new List<JsonElement>();

            foreach (var block in content.EnumerateArray())
            {
                if (block.ValueKind == JsonValueKind.Object)
                {
                    contentBlocks.Add(block.Clone());
                }

                switch (JsonHelpers.GetString(block, "type"))
                {
                    case "text":
                        if (JsonHelpers.GetString(block, "text") is { Length: > 0 } blockText)
                        {
                            text.Append(blockText);
                        }
                        break;
                    case "tool_use":
                        if (JsonHelpers.GetString(block, "id") is { Length: > 0 } id &&
                            JsonHelpers.GetString(block, "name") is { Length: > 0 } name)
                        {
                            var input = block.TryGetProperty("input", out var inputElement)
                                ? inputElement.Clone()
                                : AgentRuntimeProviderSupport.CreateEmptyObjectElement();
                            var extraContent = block.TryGetProperty("extraContent", out var extra) &&
                                extra.ValueKind == JsonValueKind.Object
                                    ? extra.Clone()
                                    : (JsonElement?)null;
                            toolUses.Add(new AgentRuntimeChatToolUse(id, name, input, extraContent));
                        }
                        break;
                    case "tool_result":
                        if (JsonHelpers.GetString(block, "toolUseId") is { Length: > 0 } toolUseId)
                        {
                            var resultContent = block.TryGetProperty("content", out var contentElement)
                                ? contentElement.Clone()
                                : AgentRuntimeProviderSupport.CreateStringElement(string.Empty);
                            var isError = JsonHelpers.GetBool(block, "isError", false);
                            toolResults.Add(new AgentRuntimeToolResult(
                                toolUseId, resultContent, isError ? true : null));
                        }
                        break;
                }
            }

            result.Add(new AgentRuntimeChatMessage(
                role,
                text.ToString(),
                toolUses,
                toolResults,
                JsonHelpers.GetString(message, "providerResponseId"),
                contentBlocks,
                ReasoningDetails: ReadReasoningDetails(message)));
        }

        return result;
    }

    // ── Wire message creation ──

    internal static JsonElement CreateAssistantWireMessage(
        AgentRuntimeChatMessage message,
        AgentRuntimeTokenUsage? usage)
    {
        return AgentRuntimeProviderSupport.CreateObjectElement(writer =>
        {
            writer.WriteString("id", NewMessageId());
            writer.WriteString("role", "assistant");
            writer.WritePropertyName("content");
            WriteAssistantWireContent(writer, message);
            writer.WriteNumber("createdAt", NowMs());
            if (!string.IsNullOrWhiteSpace(message.ProviderResponseId))
            {
                writer.WriteString("providerResponseId", message.ProviderResponseId);
            }
            if (message.ReasoningDetails is { } reasoningDetails &&
                reasoningDetails.ValueKind == JsonValueKind.Array)
            {
                writer.WritePropertyName("reasoning_details");
                reasoningDetails.WriteTo(writer);
            }
            if (usage is not null)
            {
                writer.WritePropertyName("usage");
                WriteUsage(writer, usage);
            }
        });
    }

    private static JsonElement? ReadReasoningDetails(JsonElement message)
    {
        return message.TryGetProperty("reasoning_details", out var details) &&
               details.ValueKind == JsonValueKind.Array
            ? details.Clone()
            : null;
    }

    private static void WriteAssistantWireContent(Utf8JsonWriter writer, AgentRuntimeChatMessage message)
    {
        if (message.ContentBlocks is { Count: > 0 } contentBlocks)
        {
            writer.WriteStartArray();
            foreach (var block in contentBlocks)
            {
                block.WriteTo(writer);
            }
            writer.WriteEndArray();
            return;
        }

        if (message.ToolUses.Count == 0)
        {
            writer.WriteStringValue(message.Text);
            return;
        }

        writer.WriteStartArray();
        if (!string.IsNullOrEmpty(message.Text))
        {
            writer.WriteStartObject();
            writer.WriteString("type", "text");
            writer.WriteString("text", message.Text);
            writer.WriteEndObject();
        }
        foreach (var toolUse in message.ToolUses)
        {
            writer.WriteStartObject();
            writer.WriteString("type", "tool_use");
            writer.WriteString("id", toolUse.Id);
            writer.WriteString("name", toolUse.Name);
            writer.WritePropertyName("input");
            toolUse.Input.WriteTo(writer);
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    private static void WriteUsage(Utf8JsonWriter writer, AgentRuntimeTokenUsage usage)
    {
        writer.WriteStartObject();
        writer.WriteNumber("inputTokens", usage.InputTokens);
        writer.WriteNumber("outputTokens", usage.OutputTokens);
        WriteOptionalNumber(writer, "billableInputTokens", usage.BillableInputTokens);
        WriteOptionalNumber(writer, "cacheReadTokens", usage.CacheReadTokens);
        WriteOptionalNumber(writer, "reasoningTokens", usage.ReasoningTokens);
        WriteOptionalNumber(writer, "contextTokens", usage.ContextTokens);
        WriteOptionalNumber(writer, "cacheCreationTokens", usage.CacheCreationTokens);
        WriteOptionalNumber(writer, "cacheCreation5mTokens", usage.CacheCreation5mTokens);
        WriteOptionalNumber(writer, "cacheCreation1hTokens", usage.CacheCreation1hTokens);
        if (usage.CacheReadRatio.HasValue)
        {
            writer.WriteNumber("cacheReadRatio", usage.CacheReadRatio.Value);
        }
        writer.WriteEndObject();
    }

    private static void WriteOptionalNumber(Utf8JsonWriter writer, string propertyName, int? value)
    {
        if (!value.HasValue) return;
        writer.WriteNumber(propertyName, value.Value);
    }

    /// <summary>
    /// Creates a wire-format user message containing tool results.
    /// </summary>
    internal static JsonElement CreateToolResultsWireMessage(List<AgentRuntimeToolResult> toolResults)
    {
        return AgentRuntimeProviderSupport.CreateObjectElement(writer =>
        {
            writer.WriteString("id", NewMessageId());
            writer.WriteString("role", "user");
            writer.WritePropertyName("content");
            writer.WriteStartArray();
            foreach (var result in toolResults)
            {
                writer.WriteStartObject();
                writer.WriteString("type", "tool_result");
                writer.WriteString("toolUseId", result.ToolUseId);
                if (result.Content.ValueKind == JsonValueKind.String)
                {
                    writer.WriteString("content", result.Content.GetString());
                }
                else
                {
                    writer.WritePropertyName("content");
                    result.Content.WriteTo(writer);
                }
                if (result.IsError is true)
                {
                    writer.WriteBoolean("isError", true);
                }
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            writer.WriteNumber("createdAt", NowMs());
        });
    }

    // ── Runtime parameters ──

    private static JsonElement CreateRuntimeParametersWithoutMessages(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object)
        {
            return parameters;
        }

        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            foreach (var property in parameters.EnumerateObject())
            {
                if (property.NameEquals("messages"))
                {
                    continue;
                }
                property.WriteTo(writer);
            }
            writer.WriteEndObject();
        }
        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }
}

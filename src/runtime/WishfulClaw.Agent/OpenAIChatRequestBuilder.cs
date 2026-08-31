using System.Buffers;
using System.Net.Http;
using System.Text.Json;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// OpenAI-compatible chat provider — request body building.
/// </summary>
internal static partial class OpenAIChatProvider
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

            // Field order aligned with Reasonix chatRequest struct:
            // model → messages → tools → stream → stream_options → temperature → max_tokens → ...
            if (!omitted.Contains("model"))
            {
                writer.WriteString("model", JsonHelpers.GetString(provider, "model") ?? string.Empty);
            }

            if (!omitted.Contains("messages"))
            {
                writer.WritePropertyName("messages");
                WriteMessages(writer, conversation, provider, state);
            }

            if (!omitted.Contains("tools"))
            {
                WriteTools(writer, toolDefs);
            }

            if (!omitted.Contains("stream"))
            {
                writer.WriteBoolean("stream", true);
            }

            if (!omitted.Contains("stream_options"))
            {
                writer.WritePropertyName("stream_options");
                writer.WriteStartObject();
                writer.WriteBoolean("include_usage", true);
                writer.WriteEndObject();
            }

            if (!omitted.Contains("temperature") &&
                JsonHelpers.GetDoubleNullable(provider, "temperature") is { } temperature)
            {
                writer.WriteNumber("temperature", temperature);
            }

            if (JsonHelpers.GetIntNullable(provider, "maxTokens") is { } maxTokens && maxTokens > 0)
            {
                var modelStr = JsonHelpers.GetString(provider, "model") ?? string.Empty;
                var maxTokensKey = AgentLoop.IsReasoningModel(modelStr) ? "max_completion_tokens" : "max_tokens";
                if (!omitted.Contains(maxTokensKey))
                {
                    writer.WriteNumber(maxTokensKey, maxTokens);
                }
            }

            WriteThinkingConfig(writer, provider, omitted);
            ProviderRequestOverrides.WriteBodyOverrides(writer, provider, omitted);

            writer.WriteEndObject();
        }

        return System.Text.Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    private static void WriteMessages(
        Utf8JsonWriter writer,
        IReadOnlyList<AgentRuntimeChatMessage> messages,
        JsonElement provider,
        AgentRuntimeRunState? state)
    {
        writer.WriteStartArray();

        if (JsonHelpers.GetString(provider, "systemPrompt") is { Length: > 0 } systemPrompt)
        {
            writer.WriteStartObject();
            writer.WriteString("role", "system");
            writer.WriteString("content", systemPrompt);
            writer.WriteEndObject();
        }

        for (var i = 0; i < messages.Count; i++)
        {
            var message = messages[i];
            if (message.Role == "system") continue;

            // Tool results → role: tool messages
            foreach (var toolResult in message.ToolResults)
            {
                writer.WriteStartObject();
                writer.WriteString("role", "tool");
                writer.WriteString("tool_call_id", toolResult.ToolUseId);
                writer.WritePropertyName("content");
                if (toolResult.Content.ValueKind == JsonValueKind.String)
                {
                    writer.WriteStringValue(toolResult.Content.GetString() ?? string.Empty);
                }
                else
                {
                    writer.WriteStringValue(toolResult.Content.GetRawText());
                }
                writer.WriteEndObject();
            }

            if (message.Role == "user")
            {
                if (message.ToolResults.Count > 0 && string.IsNullOrEmpty(message.Text) && message.ToolUses.Count == 0)
                {
                    continue; // Already written as tool messages
                }

                // Memory recall, memory-update notes, and timestamp are already
                // injected into the conversation message by InjectTransientPrefix
                // and TryInjectMemoryRecallAsync (called before/at iteration 1 of
                // the agent loop). No write-time suffix injection here - doing so
                // would double-inject memory content and break byte consistency
                // between the stored conversation and the API request.

                writer.WriteStartObject();
                writer.WriteString("role", "user");
                if (HasImageContent(message.ContentBlocks))
                {
                    writer.WritePropertyName("content");
                    WriteOpenAIContentBlocks(writer, message.ContentBlocks!);
                }
                else
                {
                    writer.WriteString("content", message.Text);
                }
                writer.WriteEndObject();
                continue;
            }

            if (message.Role == "assistant")
            {
                writer.WriteStartObject();
                writer.WriteString("role", "assistant");
                if (message.ToolUses.Count > 0)
                {
                    if (!string.IsNullOrEmpty(message.Text))
                    {
                        writer.WriteString("content", message.Text);
                    }
                    // DeepSeek thinking mode requires reasoning_content key on
                    // assistant tool_calls messages. Write it when available
                    // (matches Reasonix behavior for prefix cache stability).
                    if (message.ReasoningContent is not null)
                    {
                        writer.WriteString("reasoning_content", message.ReasoningContent);
                    }
                    WriteOpenRouterReasoningDetails(writer, message, provider);
                    writer.WritePropertyName("tool_calls");
                    writer.WriteStartArray();
                    foreach (var toolUse in message.ToolUses)
                    {
                        writer.WriteStartObject();
                        writer.WriteString("id", toolUse.Id);
                        writer.WriteString("type", "function");
                        writer.WritePropertyName("function");
                        writer.WriteStartObject();
                        writer.WriteString("name", toolUse.Name);
                        writer.WriteString("arguments", toolUse.Input.GetRawText());
                        writer.WriteEndObject();
                        writer.WriteEndObject();
                    }
                    writer.WriteEndArray();
                }
                else
                {
                    writer.WriteString("content", message.Text);
                    WriteOpenRouterReasoningDetails(writer, message, provider);
                }
                writer.WriteEndObject();
                continue;
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

    private static void WriteOpenAIContentBlocks(Utf8JsonWriter writer, IReadOnlyList<JsonElement> contentBlocks)
    {
        writer.WriteStartArray();
        foreach (var block in contentBlocks)
        {
            var type = JsonHelpers.GetString(block, "type");
            if (type == "text")
            {
                writer.WriteStartObject();
                writer.WriteString("type", "text");
                writer.WriteString("text", JsonHelpers.GetString(block, "text") ?? string.Empty);
                writer.WriteEndObject();
                continue;
            }

            if (type != "image" || !block.TryGetProperty("source", out var source) ||
                source.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var sourceType = JsonHelpers.GetString(source, "type");
            var imageUrl = sourceType == "url"
                ? JsonHelpers.GetString(source, "url")
                : BuildBase64ImageUrl(source);
            if (string.IsNullOrWhiteSpace(imageUrl))
            {
                continue;
            }

            writer.WriteStartObject();
            writer.WriteString("type", "image_url");
            writer.WritePropertyName("image_url");
            writer.WriteStartObject();
            writer.WriteString("url", imageUrl);
            writer.WriteEndObject();
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
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

    private static void WriteTools(Utf8JsonWriter writer, IReadOnlyList<ToolDefinition> toolDefs)
    {
        if (toolDefs.Count == 0) return;

        // Sort tools by name for stable byte ordering (prefix cache stability)
        var sorted = new List<ToolDefinition>(toolDefs);
        sorted.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.Ordinal));

        writer.WritePropertyName("tools");
        writer.WriteStartArray();
        foreach (var def in sorted)
        {
            // OpenAI format: { type: "function", function: { name, description, parameters } }
            writer.WriteStartObject();
            writer.WriteString("type", "function");
            writer.WritePropertyName("function");
            writer.WriteStartObject();
            writer.WriteString("name", def.Name);
            writer.WriteString("description", def.Description);
            writer.WritePropertyName("parameters");
            def.InputSchema.WriteTo(writer);
            writer.WriteEndObject(); // function
            writer.WriteEndObject(); // tool
        }
        writer.WriteEndArray();
    }

    private static void WriteOpenRouterReasoningDetails(
        Utf8JsonWriter writer,
        AgentRuntimeChatMessage message,
        JsonElement provider)
    {
        if (!IsOpenRouterProvider(provider) ||
            message.ReasoningDetails is not { } reasoningDetails ||
            reasoningDetails.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        writer.WritePropertyName("reasoning_details");
        reasoningDetails.WriteTo(writer);
    }

    private static bool IsOpenRouterProvider(JsonElement provider)
    {
        var baseUrl = JsonHelpers.GetString(provider, "baseUrl");
        return Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri) &&
            (uri.Host.Equals("openrouter.ai", StringComparison.OrdinalIgnoreCase) ||
             uri.Host.EndsWith(".openrouter.ai", StringComparison.OrdinalIgnoreCase));
    }

    private static void WriteThinkingConfig(Utf8JsonWriter writer, JsonElement provider, HashSet<string> omitted)
    {
        if (!provider.TryGetProperty("thinkingConfig", out var thinkingConfig) ||
            thinkingConfig.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        if (!provider.TryGetProperty("thinkingEnabled", out var thinkingEnabledValue) ||
            thinkingEnabledValue.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            return;
        }

        var thinkingEnabled = thinkingEnabledValue.GetBoolean();

        // When thinking is enabled, merge bodyParams from thinkingConfig into the request body.
        // This writes provider-specific fields like { "thinking": { "type": "enabled" } } or
        // { "enable_thinking": true } depending on the model's configuration.
        var isOpenRouter = IsOpenRouterProvider(provider);
        var reasoningEffort = thinkingEnabled
            ? JsonHelpers.GetString(provider, "reasoningEffort") ??
              JsonHelpers.GetString(thinkingConfig, "defaultReasoningEffort")
            : null;
        var effectiveEffort = !string.IsNullOrEmpty(reasoningEffort)
            ? JsonHelpers.ResolveEffectiveReasoningEffort(reasoningEffort, thinkingConfig)
            : null;

        if (thinkingEnabled &&
            thinkingConfig.TryGetProperty("bodyParams", out var bodyParams) &&
            bodyParams.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in bodyParams.EnumerateObject())
            {
                if (isOpenRouter && prop.Name == "reasoning")
                {
                    continue;
                }
                if (!omitted.Contains(prop.Name))
                {
                    prop.WriteTo(writer);
                }
            }

            if (isOpenRouter && !omitted.Contains("reasoning"))
            {
                writer.WritePropertyName("reasoning");
                writer.WriteStartObject();
                if (bodyParams.TryGetProperty("reasoning", out var reasoning) &&
                    reasoning.ValueKind == JsonValueKind.Object)
                {
                    foreach (var prop in reasoning.EnumerateObject())
                    {
                        if (prop.Name != "effort")
                        {
                            prop.WriteTo(writer);
                        }
                    }
                }
                if (!string.IsNullOrEmpty(effectiveEffort))
                {
                    writer.WriteString("effort", effectiveEffort);
                }
                writer.WriteEndObject();
            }
        }
        else if (!thinkingEnabled &&
                 thinkingConfig.TryGetProperty("disabledBodyParams", out var disabledParams) &&
                 disabledParams.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in disabledParams.EnumerateObject())
            {
                if (!omitted.Contains(prop.Name))
                {
                    prop.WriteTo(writer);
                }
            }
        }

        // OpenRouter accepts reasoning.effort as the canonical form. Keep the
        // legacy top-level shorthand for other OpenAI-compatible providers.
        if (!isOpenRouter && !string.IsNullOrEmpty(effectiveEffort) &&
            !omitted.Contains("reasoning_effort"))
        {
            writer.WriteString("reasoning_effort", effectiveEffort);
        }
    }
}

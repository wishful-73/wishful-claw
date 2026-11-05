using System.Text;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Agent.Executors;

namespace WishfulClaw.Agent;

/// <summary>
/// OpenAI-compatible chat provider — SSE fragment processing,
/// tool call buffer management, and usage parsing.
/// </summary>
internal static partial class OpenAIChatProvider
{
    private static async Task ProcessToolCallFragmentAsync(
        JsonElement fragment,
        Dictionary<int, ToolCallBuffer> toolBuffers,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        var index = JsonHelpers.GetInt(fragment, "index", toolBuffers.Count);
        if (!toolBuffers.TryGetValue(index, out var buffer))
        {
            buffer = new ToolCallBuffer(index);
            toolBuffers[index] = buffer;
        }

        if (JsonHelpers.GetString(fragment, "id") is { Length: > 0 } id && string.IsNullOrEmpty(buffer.Id))
        {
            buffer.Id = id;
        }

        string? argumentsDelta = null;
        if (fragment.TryGetProperty("function", out var function) &&
            function.ValueKind == JsonValueKind.Object)
        {
            if (JsonHelpers.GetString(function, "name") is { Length: > 0 } name)
            {
                buffer.Name = name;
            }
            argumentsDelta = JsonHelpers.GetString(function, "arguments");
            if (argumentsDelta is not null)
            {
                buffer.Arguments.Append(argumentsDelta);
            }
        }

        if (!buffer.Started && !string.IsNullOrEmpty(buffer.Id) && !string.IsNullOrEmpty(buffer.Name))
        {
            buffer.Started = true;
            await AgentRuntimeTools.EmitAsync(
                state, context,
                new AgentRuntimeStreamEvent(
                    "tool_use_streaming_start",
                    ToolCallId: buffer.Id,
                    ToolName: buffer.Name));
        }

        // Emit args delta after streaming_start so frontend has the tool call entry
        if (buffer.Started && argumentsDelta is { Length: > 0 })
        {
            await AgentRuntimeTools.EmitAsync(
                state, context,
                new AgentRuntimeStreamEvent(
                    "tool_use_args_delta",
                    ToolCallId: buffer.Id,
                    PartialInput: JsonSerializer.SerializeToElement(argumentsDelta, WorkerJsonHelper.GetTypeInfo<string>())));
        }
    }

    private static async Task FlushRemainingToolBuffersAsync(
        Dictionary<int, ToolCallBuffer> toolBuffers,
        List<AgentRuntimeNativeToolCall> completedToolCalls,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        foreach (var buffer in toolBuffers.Values.OrderBy(item => item.Index))
        {
            var id = string.IsNullOrEmpty(buffer.Id)
                ? $"call_{buffer.Index}_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}"
                : buffer.Id;
            var name = buffer.Name;
            var input = AgentLoop.TryParseJsonObject(buffer.Arguments.ToString(), out var parsedInput)
                ? parsedInput
                : AgentRuntimeProviderSupport.CreateEmptyObjectElement();
            completedToolCalls.Add(new AgentRuntimeNativeToolCall(id, name, input));
            await AgentRuntimeTools.EmitAsync(
                state, context,
                new AgentRuntimeStreamEvent(
                    "tool_use_generated",
                    ToolCallId: id,
                    ToolUseBlock: new AgentRuntimeToolUseBlock(id, name, input)));
        }
        toolBuffers.Clear();
    }

    private static bool TryCreateCompletedToolCall(JsonElement toolCallElement, out AgentRuntimeNativeToolCall toolCall)
    {
        toolCall = default!;
        if (toolCallElement.ValueKind != JsonValueKind.Object) return false;

        var id = AgentLoop.ReadString(toolCallElement, "id");
        if (!toolCallElement.TryGetProperty("function", out var function) ||
            function.ValueKind != JsonValueKind.Object) return false;

        var name = AgentLoop.ReadString(function, "name");
        if (string.IsNullOrWhiteSpace(name)) return false;

        var arguments = AgentLoop.ReadString(function, "arguments");
        var input = AgentLoop.TryParseJsonObject(arguments ?? string.Empty, out var parsedInput)
            ? parsedInput
            : AgentRuntimeProviderSupport.CreateEmptyObjectElement();
        toolCall = new AgentRuntimeNativeToolCall(
            string.IsNullOrWhiteSpace(id) ? $"call_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}" : id,
            name, input);
        return true;
    }

    // ── Usage parsing ──

    private static JsonElement? TryGetFirstChoice(JsonElement root)
    {
        if (!root.TryGetProperty("choices", out var choices) ||
            choices.ValueKind != JsonValueKind.Array ||
            choices.GetArrayLength() == 0)
        {
            return null;
        }
        return choices[0];
    }

    private static string? ReadMessageContentText(JsonElement message)
    {
        if (!message.TryGetProperty("content", out var content)) return null;
        if (content.ValueKind == JsonValueKind.String) return content.GetString();
        if (content.ValueKind != JsonValueKind.Array) return null;

        var builder = new StringBuilder();
        foreach (var block in content.EnumerateArray())
        {
            if (block.ValueKind != JsonValueKind.Object) continue;
            var text = AgentLoop.ReadString(block, "text");
            if (string.IsNullOrEmpty(text)) continue;
            if (builder.Length > 0) builder.Append('\n');
            builder.Append(text);
        }
        return builder.Length > 0 ? builder.ToString() : null;
    }

    private static bool TryReadUsage(JsonElement usage, out AgentRuntimeTokenUsage tokenUsage)
    {
        if (usage.ValueKind != JsonValueKind.Object)
        {
            tokenUsage = default!;
            return false;
        }

        var inputTokens = AgentLoop.ReadInt(usage, "prompt_tokens");
        var outputTokens = AgentLoop.ReadInt(usage, "completion_tokens");
        // DeepSeek puts prompt_cache_hit_tokens at the top level;
        // OpenAI/MiMo put cached_tokens under prompt_tokens_details.
        // We check all known field names for maximum provider compatibility.
        var cachedTokens = ReadFirstPositiveInt(usage, "cached_tokens", "cache_read_tokens", "cache_read_input_tokens", "cached_input_tokens", "prompt_cache_hit_tokens");
        var cacheWriteTokens = ReadFirstPositiveInt(usage, "cache_write_tokens", "cache_write_input_tokens", "cache_creation_tokens", "cache_creation_input_tokens");
        var reasoningTokens = ReadFirstPositiveInt(usage, "reasoning_tokens");

        // Check nested details objects
        foreach (var detailsName in new[] { "prompt_tokens_details", "input_tokens_details" })
        {
            if (usage.TryGetProperty(detailsName, out var details))
            {
                cachedTokens = cachedTokens > 0 ? cachedTokens :
                    ReadFirstPositiveInt(details, "cached_tokens", "cache_read_tokens", "cache_read_input_tokens", "cached_input_tokens");
                cacheWriteTokens = cacheWriteTokens > 0 ? cacheWriteTokens :
                    ReadFirstPositiveInt(details, "cache_write_tokens", "cache_write_input_tokens", "cache_creation_tokens", "cache_creation_input_tokens");
            }
        }

        foreach (var detailsName in new[] { "completion_tokens_details", "output_tokens_details" })
        {
            if (usage.TryGetProperty(detailsName, out var details))
            {
                reasoningTokens = reasoningTokens > 0 ? reasoningTokens :
                    ReadFirstPositiveInt(details, "reasoning_tokens");
            }
        }

        var billableInputTokens = cachedTokens > 0 || cacheWriteTokens > 0
            ? Math.Max(0, inputTokens - cachedTokens - cacheWriteTokens)
            : (int?)null;
        var cacheReadRatio = inputTokens > 0 && cachedTokens > 0
            ? Math.Min(1, cachedTokens / (double)inputTokens)
            : (double?)null;

        tokenUsage = new AgentRuntimeTokenUsage(
            inputTokens, outputTokens,
            billableInputTokens,
            cachedTokens > 0 ? cachedTokens : null,
            reasoningTokens > 0 ? reasoningTokens : null,
            inputTokens,
            CacheCreationTokens: cacheWriteTokens > 0 ? cacheWriteTokens : null,
            CacheReadRatio: cacheReadRatio);
        return inputTokens > 0 || outputTokens > 0;
    }

    private static int ReadFirstPositiveInt(JsonElement element, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            var value = AgentLoop.ReadInt(element, propertyName);
            if (value > 0) return value;
        }
        return 0;
    }

    // ── Tool call buffer ──

    private sealed class ToolCallBuffer(int index)
    {
        public int Index { get; } = index;
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public StringBuilder Arguments { get; } = new();
        public bool Started { get; set; }
    }
}

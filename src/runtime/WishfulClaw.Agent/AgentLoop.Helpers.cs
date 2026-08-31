using System.Buffers;
using System.Diagnostics;
using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// JSON parsing helpers and timing utilities for AgentLoop.
/// </summary>
internal static partial class AgentLoop
{
    // ── JSON helper methods ──

    /// <summary>
    /// Replaces or adds the systemPrompt field in the provider JSON element.
    /// </summary>
    internal static JsonElement InjectSystemPrompt(JsonElement provider, string systemPrompt)
    {
        if (string.IsNullOrWhiteSpace(systemPrompt)) return provider;

        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            var hasSystemPrompt = false;
            foreach (var prop in provider.EnumerateObject())
            {
                if (prop.NameEquals("systemPrompt"))
                {
                    writer.WriteString("systemPrompt", systemPrompt);
                    hasSystemPrompt = true;
                }
                else
                {
                    prop.WriteTo(writer);
                }
            }
            if (!hasSystemPrompt)
            {
                writer.WriteString("systemPrompt", systemPrompt);
            }
            writer.WriteEndObject();
        }
        using var doc = JsonDocument.Parse(buffer.WrittenMemory);
        return doc.RootElement.Clone();
    }

    internal static JsonElement GetObject(JsonElement element, string propertyName)
    {
        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(propertyName, out var property) &&
            property.ValueKind == JsonValueKind.Object)
        {
            return property;
        }
        return default;
    }

    internal static string? ReadString(JsonElement element, string propertyName)
    {
        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(propertyName, out var property) &&
            property.ValueKind == JsonValueKind.String)
        {
            return property.GetString();
        }
        return null;
    }

    internal static int ReadInt(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty(propertyName, out var property))
        {
            return 0;
        }
        if (property.ValueKind == JsonValueKind.Number &&
            property.TryGetInt64(out var longValue))
        {
            return longValue > int.MaxValue ? int.MaxValue : (int)Math.Max(0, longValue);
        }
        if (property.ValueKind == JsonValueKind.String &&
            long.TryParse(property.GetString(), out longValue))
        {
            return longValue > int.MaxValue ? int.MaxValue : (int)Math.Max(0, longValue);
        }
        return 0;
    }

    internal static bool TryParseJsonObject(string value, out JsonElement element)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            element = AgentRuntimeProviderSupport.CreateEmptyObjectElement();
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(value);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                element = AgentRuntimeProviderSupport.CreateEmptyObjectElement();
                return false;
            }
            element = document.RootElement.Clone();
            return true;
        }
        catch (JsonException)
        {
            element = AgentRuntimeProviderSupport.CreateEmptyObjectElement();
            return false;
        }
    }

    internal static JsonElement NormalizeRuntimeParameters(
        JsonElement parameters,
        AgentRunContext runContext,
        string sessionMode)
    {
        if (parameters.ValueKind != JsonValueKind.Object)
        {
            return parameters;
        }

        var buffer = new ArrayBufferWriter<byte>();
        var omitProjectContext = string.Equals(runContext.Scope, "global", StringComparison.OrdinalIgnoreCase);
        var hasSessionMode = false;
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            foreach (var property in parameters.EnumerateObject())
            {
                if (omitProjectContext && property.Name is "projectId" or "workingFolder" or "sshConnectionId")
                {
                    continue;
                }

                if (property.NameEquals("sessionMode"))
                {
                    writer.WriteString("sessionMode", sessionMode);
                    hasSessionMode = true;
                }
                else
                {
                    property.WriteTo(writer);
                }
            }

            if (!hasSessionMode)
            {
                writer.WriteString("sessionMode", sessionMode);
            }
            writer.WriteEndObject();
        }

        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    // ── Timing helpers ──

    internal static long ElapsedMs(long startedAt)
    {
        return (long)Math.Round(Stopwatch.GetElapsedTime(startedAt).TotalMilliseconds);
    }

    internal static long NowMs()
    {
        return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    internal static string NewMessageId()
    {
        return $"wc_{Guid.NewGuid():N}";
    }

    internal static int EstimateTokenCount(string text)
    {
        return string.IsNullOrWhiteSpace(text) ? 0 : Math.Max(1, text.Length / 4);
    }

    internal static double? ComputeTps(int outputTokens, long? firstTokenMs, long completedMs)
    {
        if (!firstTokenMs.HasValue || outputTokens <= 0)
        {
            return null;
        }
        var durationMs = completedMs - firstTokenMs.Value;
        return durationMs <= 0 ? null : outputTokens / (durationMs / 1000.0);
    }

    internal static void EnsureProviderTurnHasOutput(
        string providerType,
        string stopReason,
        string assistantText,
        string? reasoningContent,
        IReadOnlyCollection<AgentRuntimeNativeToolCall> toolCalls,
        AgentRuntimeTokenUsage? usage,
        long elapsedMs)
    {
        var textLength = assistantText.Length;
        var reasoningLength = reasoningContent?.Length ?? 0;
        if (!string.IsNullOrWhiteSpace(assistantText) || toolCalls.Count > 0)
        {
            return;
        }

        WorkerLog.Warn(
            $"provider response empty provider={providerType} stopReason={stopReason} " +
            $"textLength={textLength} reasoningLength={reasoningLength} " +
            $"toolCalls={toolCalls.Count} hasUsage={usage is not null} elapsedMs={elapsedMs}");
        throw new InvalidOperationException(
            $"{providerType} returned no usable assistant output " +
            $"(stopReason={stopReason}, textLength={textLength}, toolCalls={toolCalls.Count}).");
    }

    internal static bool IsReasoningModel(string model)
    {
        return model.StartsWith("o1", StringComparison.OrdinalIgnoreCase) ||
            model.StartsWith("o2", StringComparison.OrdinalIgnoreCase) ||
            model.StartsWith("o3", StringComparison.OrdinalIgnoreCase) ||
            model.StartsWith("o4", StringComparison.OrdinalIgnoreCase);
    }

    // ── Session helpers ──

    /// <summary>
    /// Formats a sessionId for logging, masking empty values.
    /// </summary>
    internal static string FormatSessionId(string? sessionId)
    {
        return string.IsNullOrEmpty(sessionId) ? "<empty>" : sessionId;
    }

    // ── Transient injection helpers ──

    /// <summary>
    /// Injects current timestamp as a transient prefix to the last user message.
    /// This stays OUT of the system prompt to preserve prefix cache stability.
    /// The agent gets fresh time context every turn without churning the cached prefix.
    /// Design follows Reasonix's transient turn-injection pattern.
    /// </summary>
    /// <summary>
    /// Injects timestamp + memory-update notes into the LAST user message
    /// in the conversation. This modifies the SessionConversation's live list
    /// directly — the timestamp becomes part of the permanent history, so
    /// every subsequent turn sees byte-identical historical messages.
    /// 
    /// Key insight: the timestamp is injected ONCE when the user message
    /// arrives, and never changes after that. The next turn's user message
    /// gets its own timestamp. Historical messages keep their original
    /// timestamps unchanged → prefix cache stable.
    /// </summary>
    internal static void InjectTransientPrefix(List<AgentRuntimeChatMessage> conversation, AgentRuntimeRunState state)
    {
        // Find the last user message (the current turn's input)
        for (var i = conversation.Count - 1; i >= 0; i--)
        {
            if (conversation[i].Role == "user" && conversation[i].ToolResults.Count == 0)
            {
                var msg = conversation[i];
                
                // Skip if already injected (e.g. re-entry on retry).
                // Use Contains instead of StartsWith because memory recall /
                // memory-update prefixes are prepended BEFORE <current_time>,
                // so the tag may not be at position 0 on messages injected with memory context.
                if (msg.Text.Contains("<current_time>", StringComparison.Ordinal))
                    return;

                var parts = new System.Text.StringBuilder();

                // Memory recall (first iteration only)
                if (!string.IsNullOrEmpty(state.PendingMemoryRecall))
                {
                    parts.Append(state.PendingMemoryRecall);
                }

                // Memory updates (drained at turn start)
                var memNotes = MemoryUpdateQueue.Drain(state.SessionId ?? "");
                state.PendingMemoryNotes = memNotes;
                if (memNotes.Count > 0)
                {
                    parts.AppendLine("<memory-update>");
                    parts.AppendLine("The following memory changes were just made and apply from now on:");
                    foreach (var note in memNotes)
                    {
                        parts.Append("- ").AppendLine(note);
                    }
                    parts.AppendLine("</memory-update>");
                    parts.AppendLine();
                }

                // Current timestamp (minute-level precision for stability)
                var now = DateTimeOffset.Now;
                parts.Append("<current_time>\n");
                parts.Append(now.ToString("yyyy-MM-dd HH:mm zzz"));
                parts.Append(" (");
                parts.Append(now.ToString("dddd"));
                parts.Append(")\n</current_time>\n\n");

                conversation[i] = msg with { Text = parts.ToString() + msg.Text };
                return;
            }
        }

        // No user message found — still drain memory queue
        state.PendingMemoryNotes = MemoryUpdateQueue.Drain(state.SessionId ?? "");
    }
}

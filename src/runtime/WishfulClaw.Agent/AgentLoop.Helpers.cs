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

    /// <summary>
    /// 会话级「请求上下文上限」（iter-32 S-73，S-84 由开关改成数值）。把 provider 的运行期
    /// contextLength 夹到会话设的上限，让自动压缩的触发点、手动压缩的价值下限、保留尾部的
    /// 预算全部按同一个有效窗口计算。模型档案里的 contextLength 不动，这里只改这一份运行期副本。
    /// </summary>
    /// <param name="capTokens">
    /// 上限，单位 token。&lt;= 0 表示不限制 —— 渲染端已按「上限是否设在当前模型上」判过，
    /// 换模型后传过来的就是 0。
    /// </param>
    internal static JsonElement ApplyContextCap(JsonElement provider, int capTokens)
    {
        if (capTokens <= 0) return provider;
        // 模型自身窗口本来就小于（或等于）上限时 min() 就是原值；没声明 contextLength 时
        // 压缩走 DefaultContextCompressionLimit 兜底，与上限无关，同样不动。
        if (JsonHelpers.GetIntNullable(provider, "contextLength") is not { } contextLength ||
            contextLength <= capTokens)
        {
            return provider;
        }

        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            foreach (var prop in provider.EnumerateObject())
            {
                if (prop.NameEquals("contextLength"))
                {
                    writer.WriteNumber("contextLength", capTokens);
                }
                else
                {
                    prop.WriteTo(writer);
                }
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
        // S-209：有思考也算「有输出」。有的模型（GLM-5.3-flash 实测）正常报结束、
        // 正文为空，但内容全落在思考里 —— 那不是空响应，把它当故障抛出去等于把一次
        // 可救的回复变成失败。真正无输出的形态是「正文空 + 无工具调用 + 思考也空」，
        // 日志实证（09-10 ~ 10-13 共 16 条 empty turn）里只有 2 条属于后者，
        // 且都是 iter-29 已处理的空流（hasUsage=False）。
        // 有思考但没正文的**催办**不在这里做 —— 这里只放宽判定，催办在 AgentLoop 里。
        if (!string.IsNullOrWhiteSpace(assistantText) || toolCalls.Count > 0 ||
            !string.IsNullOrWhiteSpace(reasoningContent))
        {
            return;
        }

        WorkerLog.Warn(
            $"provider response empty provider={providerType} stopReason={stopReason} " +
            $"textLength={textLength} reasoningLength={reasoningLength} " +
            $"toolCalls={toolCalls.Count} hasUsage={usage is not null} elapsedMs={elapsedMs}");
        throw new ProviderEmptyResponseException(
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
    /// Appends the timestamp + memory-update notes to the TAIL of the LAST user message
    /// in the conversation. This modifies the SessionConversation's live list directly
    /// (never the wire list that gets persisted) — the blocks stay in-memory only and
    /// disappear on restart.
    ///
    /// S-231 (2026-10-26): the blocks used to be PREPENDED. They now go last so that
    /// third-party gateways which derive the conversation title from the first user
    /// message (WorkBuddy domestic / international) read the user's own words. The method
    /// name keeps its historical "Prefix" for call-site stability.
    ///
    /// Key insight: the timestamp is injected ONCE when the user message arrives, and
    /// never changes after that. The next turn's user message gets its own timestamp.
    /// Historical messages keep their original bytes → prefix cache stable. The blocks
    /// stay OUT of the system prompt for the same reason.
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
                // Use Contains instead of StartsWith: the transient blocks are appended to the
                // END of the message (S-231), so <current_time> is never at position 0 anyway —
                // StartsWith would miss every injected message.
                // NOTE: this early return skips the Drain below on purpose — queued memory
                // notes then ride along to the next turn instead of being delivered twice.
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

                conversation[i] = msg with
                {
                    Text = AppendTransientBlock(msg.Text, parts.ToString()),
                    // S-208：原话与附加块分开放 —— Text 是发给模型的拼接结果，
                    // OriginalText 只留用户自己的话，SentAt 记这条消息的时刻。
                    // 压缩摘要取「用户说了什么、什么时候说的」读这两个字段，
                    // 不必再回头从 Text 里剥 <current_time> / <memory-*> 块。
                    OriginalText = msg.OriginalText ?? msg.Text,
                    SentAt = msg.SentAt ?? now,
                };
                return;
            }
        }

        // No user message found — still drain memory queue
        state.PendingMemoryNotes = MemoryUpdateQueue.Drain(state.SessionId ?? "");
    }

    /// <summary>
    /// Appends a runtime block to the END of the user's own text.
    /// <para>
    /// S-231: blocks must sit AFTER the user's words — third-party gateways that derive the
    /// conversation title from the first user message (WorkBuddy domestic / international)
    /// otherwise show "&lt;current_time&gt;…" as the title.
    /// </para>
    /// <para>
    /// Empty / whitespace-only text (pure-image messages) yields the block alone, never a
    /// leading blank line. The block's own trailing blank lines are trimmed; the user's
    /// trailing whitespace is preserved verbatim. The separator is always exactly two
    /// newlines, so text that already ends with a newline gains no extra folding.
    /// </para>
    /// <para>
    /// NOT idempotent: calling it twice with the same block appends it twice. Callers are
    /// responsible for not re-injecting (the <c>Contains</c> guard in
    /// <see cref="InjectTransientPrefix"/> is what enforces that).
    /// </para>
    /// </summary>
    internal static string AppendTransientBlock(string? text, string block)
    {
        if (string.IsNullOrEmpty(block)) return text ?? string.Empty;

        var blocks = block.TrimEnd();
        return string.IsNullOrWhiteSpace(text) ? blocks : text + "\n\n" + blocks;
    }
}

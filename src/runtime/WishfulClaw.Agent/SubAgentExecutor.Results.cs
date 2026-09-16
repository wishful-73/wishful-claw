using System.Text;
using System.Buffers;
using System.Text.Json;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

public static partial class SubAgentExecutor
{

    private static string BuildPromptText(JsonElement input)
    {
        var prompt =
            JsonHelpers.GetString(input, "prompt") ??
            JsonHelpers.GetString(input, "query") ??
            JsonHelpers.GetString(input, "task");

        return prompt?.Trim() ?? string.Empty;
    }

    // ── Result JSON ──

    private static JsonElement BuildResultJson(
        string agentName,
        string toolUseId,
        string output,
        bool success,
        string? stopReason,
        int toolCallCount,
        int iterations,
        bool reportSubmitted)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriteOptions))
        {
            writer.WriteStartObject();
            writer.WriteString("agentName", agentName);
            writer.WriteString("toolUseId", toolUseId);
            writer.WriteBoolean("success", success);
            writer.WriteString("output", output);
            // 显式声明这份 output 是子 agent 真实产出的报告。缺了它渲染端只能看 output
            // 是否为空 —— 而 Worker 对空输出会兜底成一句话，那条判据恒真。
            writer.WriteBoolean("reportSubmitted", reportSubmitted);
            writer.WriteString("stopReason", stopReason ?? "completed");
            writer.WriteNumber("toolCallCount", toolCallCount);
            writer.WriteNumber("iterations", iterations);
            writer.WriteEndObject();
        }
        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    /// <summary>
    /// Builds a concise tool call summary appended to the tool_result
    /// so the main agent has context about what the sub-agent did.
    /// Format: "工具调用摘要：\n1. Read(agents.md) → 成功\n..."
    /// </summary>
    private static string BuildToolCallSummary(IReadOnlyList<ToolCallSummary> summaries)
    {
        if (summaries.Count == 0) return string.Empty;

        var sb = new StringBuilder();
        sb.AppendLine("工具调用摘要：");
        for (var i = 0; i < summaries.Count; i++)
        {
            var s = summaries[i];
            var keyParam = ExtractKeyParam(s.Name, s.Input);
            var statusText = s.Status switch
            {
                "completed" => "成功",
                "error" => "失败",
                _ => s.Status
            };
            var paramPart = string.IsNullOrEmpty(keyParam) ? "" : $"({keyParam})";
            sb.AppendLine($"{i + 1}. {s.Name}{paramPart} → {statusText}");
        }
        return sb.ToString().TrimEnd();
    }

    /// <summary>
    /// Extracts the first key parameter from a tool call input for the summary.
    /// E.g., Read → file_path, Bash → command, Grep → pattern.
    /// </summary>
    private static string ExtractKeyParam(string toolName, JsonElement? input)
    {
        if (input is not { ValueKind: JsonValueKind.Object }) return string.Empty;

        var el = input.Value;
        var key = toolName switch
        {
            "Read" or "Edit" or "Write" or "WriteFile" or "CreateFile" => "file_path",
            "Bash" or "ShellExec" => "command",
            "Glob" => "pattern",
            "Grep" => "pattern",
            "Task" => "description",
            "WebFetch" => "url",
            "WebSearch" => "query",
            _ => null
        };

        // Try the mapped key first, then fall back to the first property
        if (key is not null && el.TryGetProperty(key, out var prop) && prop.ValueKind == JsonValueKind.String)
        {
            return TruncateForSummary(prop.GetString() ?? string.Empty, toolName);
        }

        // Fall back to first string property
        foreach (var p in el.EnumerateObject())
        {
            if (p.Value.ValueKind == JsonValueKind.String)
            {
                return TruncateForSummary(p.Value.GetString() ?? string.Empty, toolName);
            }
        }

        return string.Empty;
    }

    private static string TruncateForSummary(string value, string toolName)
    {
        // For Bash commands, truncate at first && or |
        if (toolName is "Bash" or "ShellExec")
        {
            var cutIdx = value.IndexOfAny(['&', '|']);
            if (cutIdx > 0) value = value[..cutIdx].Trim();
        }

        // Only show file name, not full path
        if (toolName is "Read" or "Edit" or "Write" or "WriteFile" or "CreateFile")
        {
            var lastSlash = value.LastIndexOfAny(['/', '\\']);
            if (lastSlash >= 0 && lastSlash < value.Length - 1)
            {
                value = value[(lastSlash + 1)..];
            }
        }

        // Max 40 chars
        return value.Length > 40 ? value[..40] + "..." : value;
    }

    // ── Registry Helpers ──


    /// <summary>
    /// Converts the collector's tool call summaries into registry entries
    /// for the SubAgentDetail tool.
    /// </summary>
    private static List<BackgroundSubAgentRegistry.SubAgentToolCallEntry> BuildToolCallEntries(
        IReadOnlyList<ToolCallSummary> summaries)
    {
        var entries = new List<BackgroundSubAgentRegistry.SubAgentToolCallEntry>();
        foreach (var s in summaries)
        {
            var keyParam = ExtractKeyParam(s.Name, s.Input);
            entries.Add(new BackgroundSubAgentRegistry.SubAgentToolCallEntry(
                s.Id, s.Name, keyParam, s.Status));
        }
        return entries;
    }

    // ── Helpers ──
}

using System.Buffers;
using System.Text;
using System.Text.Json;
using WishfulClaw.Agent.Tools;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// Tool output size limiting: head+tail UTF-8 truncation, retrieval-tool exemption and disk spill. Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
public static partial class ToolCallProcessor
{
    /// <summary>
    /// Maximum tool output size in bytes before head+tail truncation kicks in.
    /// Aligned with Reasonix's maxToolOutputBytes (32KB). Prevents giant tool
    /// results (e.g. WebFetch of a full webpage) from blowing the context window
    /// and destroying prefix cache hit rates.
    /// </summary>
    private const int MaxToolOutputBytes = 32 * 1024;

    private static string TruncateToolOutput(string output)
    {
        if (string.IsNullOrEmpty(output))
            return output;

        var totalBytes = Encoding.UTF8.GetByteCount(output);
        if (totalBytes <= MaxToolOutputBytes)
            return output;

        var keepBytes = MaxToolOutputBytes / 2;
        var headEnd = FindUtf8PrefixLength(output, keepBytes);
        var tailStart = FindUtf8SuffixStart(output, keepBytes);
        var head = output[..headEnd];
        var tail = output[tailStart..];
        var keptBytes = Encoding.UTF8.GetByteCount(head) + Encoding.UTF8.GetByteCount(tail);
        var omittedBytes = totalBytes - keptBytes;
        return head + "\n\n[truncated " + omittedBytes + " of " + totalBytes
            + " UTF-8 bytes — rerun with narrower args to see the middle]\n\n" + tail;
    }

    private static int FindUtf8PrefixLength(string value, int maxBytes)
    {
        var bytes = 0;
        var index = 0;
        foreach (var rune in value.EnumerateRunes())
        {
            if (bytes + rune.Utf8SequenceLength > maxBytes)
                break;
            bytes += rune.Utf8SequenceLength;
            index += rune.Utf16SequenceLength;
        }
        return index;
    }

    private static int FindUtf8SuffixStart(string value, int maxBytes)
    {
        var bytes = 0;
        var index = value.Length;
        while (index > 0)
        {
            var runeStart = index - 1;
            if (runeStart > 0
                && char.IsLowSurrogate(value[runeStart])
                && char.IsHighSurrogate(value[runeStart - 1]))
            {
                runeStart--;
            }

            var rune = Rune.GetRuneAt(value, runeStart);
            if (bytes + rune.Utf8SequenceLength > maxBytes)
                break;
            bytes += rune.Utf8SequenceLength;
            index = runeStart;
        }
        return index;
    }

    internal static string ApplyToolOutputLimit(
        AgentRuntimeNativeToolCall toolCall, string output, string? sessionId = null)
    {
        if (AgentRuntimeUseCapabilityExecutor.IsUseCapabilityTool(toolCall.Name))
        {
            var action = (JsonHelpers.GetString(toolCall.Input, "action") ?? string.Empty)
                .Trim()
                .ToLowerInvariant();
            if (action is "list" or "inspect")
                return output;
        }

        // Read 是取回工具：把它读回的内容再落盘会形成 read → spill → read 的死循环，
        // 所以检索类工具永远内联截断。没有 sessionId（旧调用点 / 单元测试）时同理不落盘。
        if (string.IsNullOrEmpty(sessionId) || IsRetrievalTool(toolCall.Name))
            return TruncateToolOutput(output);

        return SpillToolOutput(toolCall.Name, output, sessionId);
    }

    private static bool IsRetrievalTool(string toolName)
        => string.Equals(toolName, "Read", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// 超限时把完整输出落盘，内联只留「首尾预览 + 落盘位置 + 取回提示」。
    ///
    /// 两条硬约束：
    /// a) 替换后的内容永远不超过 <see cref="MaxToolOutputBytes"/>——预算先扣掉通知文本，
    ///    连通知都放不下就退回内联截断；
    /// b) 落盘失败（权限 / 磁盘 / 后端）一律退回原来的截断结果，绝不改变这次调用的成败。
    /// </summary>
    private static string SpillToolOutput(string toolName, string output, string sessionId)
    {
        if (string.IsNullOrEmpty(output))
            return output;

        var totalBytes = Encoding.UTF8.GetByteCount(output);
        if (totalBytes <= MaxToolOutputBytes)
            return output;

        SpillRef spill;
        try
        {
            spill = SpillStore.SaveText(sessionId, toolName, output);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn(
                "agent tool output spill failed tool=" + toolName + " sessionId=" + sessionId
                + " error=" + ex.Message);
            return TruncateToolOutput(output);
        }

        var notice = "\n\n[tool output too large: " + spill.Bytes + " UTF-8 bytes saved to "
            + spill.Locator + " — " + spill.RetrievalHint + "]\n\n";
        var previewBudget = MaxToolOutputBytes - Encoding.UTF8.GetByteCount(notice);
        if (previewBudget <= 0)
            return TruncateToolOutput(output);

        var keepBytes = previewBudget / 2;
        var headEnd = FindUtf8PrefixLength(output, keepBytes);
        var tailStart = FindUtf8SuffixStart(output, keepBytes);
        return output[..headEnd] + notice + output[tailStart..];
    }
}

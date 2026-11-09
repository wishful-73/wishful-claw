using System.Buffers;
using System.Text;
using System.Text.Json;
using WishfulClaw.Agent.Executors;
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
        // S-290：带 filePath 的 image 块是**结构化载荷**，截断它等于把图砍成半截。
        // 截断后模型拿到的不是 image 块，而是一段砍断的 JSON 文本（PNG 只剩 16 KB），
        // 解不出来还得再 Read 一次盘上文件补看 —— 每次截图白多一次模型往返，
        // 而第一轮它已经据一个坏块做过判断了。
        //
        // 判据**看内容不看工具名**：谁将来返回带路径的图都自动豁免，不靠名单维护（S-270）。
        // 豁免排在 SpillToolOutput 之前，顺带把「spill 失败 → 退回无提示截断」那条
        // 静默错误分支一起消掉（带 filePath 的块压根不走 spill）。
        //
        // 代价要认：这几百 KB 真的进 wire，本轮不省 —— 这正是 S-283 方案 A 原本的设计
        // （「本轮不省」）。真正省 wire 的那一刀是 S-275（压缩时把 image 换成路径占位），
        // 不靠在这里截断。别为了「省」把它加回来。
        if (HasRecoverableImageBlock(output))
            return output;

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

    /// <summary>
    /// S-290：输出里是否存在「带 filePath 的 image 块」。
    ///
    /// **为什么要求 filePath** —— 只有带路径的才保证「就算不进 wire，也能从盘上取回」，
    /// 放行它是安全交易。没有路径的 image 块（用户粘贴的图、外部来源）一旦豁免就是纯吃
    /// 上下文，该截还得截。
    ///
    /// **为什么不解析 JSON** —— 这个函数挂在**每一次**工具返回上，而命中的是少数；
    /// 为它 parse 一个 700 KB 的串不值。两次子串扫描够用。
    ///
    /// 判据认的是紧凑 JSON（`"type":"image"`，无空格）—— 上游 `JsonSerializer` 默认不缩进。
    /// 万一哪天开了缩进，这里判不中 ⇒ 退回原来的截断 / 落盘，是「行为变差」不是「行为出错」，
    /// 可以接受；真要改，动手前先看 `AgentRuntimeDesktopExecutor` 那边是不是还紧凑。
    /// </summary>
    private static bool HasRecoverableImageBlock(string output)
    {
        // 最短的合法形态也远长于这个长度，先挡掉空串和碎片
        if (output.Length < 32)
            return false;

        if (output.IndexOf("\"type\":\"image\"", StringComparison.Ordinal) < 0)
            return false;

        const string filePathKey = "\"filePath\":\"";
        var pathAt = output.IndexOf(filePathKey, StringComparison.Ordinal);
        if (pathAt < 0)
            return false;

        // `"filePath":""`（S-284 剥掉 data 后的落库形态）不算 —— 值为空的路径取不回任何东西
        var valueAt = pathAt + filePathKey.Length;
        return valueAt < output.Length && output[valueAt] != '"';
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

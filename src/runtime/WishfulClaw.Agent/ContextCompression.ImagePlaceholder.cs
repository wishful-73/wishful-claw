using System;
using System.Buffers;
using System.Collections.Generic;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// S-275（2026-10-30）：压缩时把保留尾部里「大得离谱」的图片块就地换成一行占位文本。
///
/// 病根不在「图大」，在**尾部预算对图片彻底失效**：
/// <c>TailStart</c> 的 <c>minKeep = 2</c> 无条件保住最后两条消息，而「读一张图 / 截一张图」
/// 恰好产生 <c>assistant(tool_use)</c> + <c>user(tool_result)</c> 这一对，正好占满 minKeep。
/// 于是那张图的 base64（实测 23~42 万字符）绕过 <c>DefaultTailTokens = 16384</c> 原样留下，
/// 压缩压完照样超阈值，下一轮立刻再压 —— 50 分钟连压 9 次就是这么来的。
///
/// 判据是**单条估算超尾部预算**，两侧必须同时改：
/// <list type="bullet">
/// <item>conversation 侧 —— 影响 <c>EstimateMessageTokens</c>，决定下一次压缩是否还触发；</item>
/// <item>wire 侧 —— 影响真正发给上游的字节，决定真实 inputTokens。</item>
/// </list>
/// 只改 conversation 侧等于自欺：<c>ShouldCompress</c> 读的是上游返回的真实 usage
/// （<c>AgentLoop.cs:285</c> 的 <c>FindRecentContextUsage</c>），不是估算。
///
/// <para>
/// 与 S-283 的分工：S-283 让图**落在盘上**并回传路径，本条才敢把 base64 摘掉 ——
/// 占位文案里那句「重新 Read 该路径」只有在图真在盘上时才成立。两条谁先谁后不能反。
/// </para>
///
/// <para>
/// 刻意不做（见 S-275 §六 方案 C）：**不**处理用户自己上传的图、**不**处理 tool_result
/// 之外的 image 块、**不**改 <c>MinKeep = 2</c>（拆散 tool_use/tool_result 配对会被上游
/// 判 400，S-246 那条线好不容易才把 400 压下去）。
/// </para>
/// </summary>
public static partial class ContextCompression
{
    /// <summary>占位块的正文前缀，同时作为「这块已经是占位」的识别依据（幂等）。</summary>
    internal const string ImagePlaceholderPrefix = "[图片已省略";

    /// <summary>
    /// 压缩尾部的 token 预算：取 <c>DefaultTailTokens</c> 与窗口一半的较小者。
    ///
    /// 抽成函数是因为两个调用点必须用**同一个数**：<c>PlanCompaction</c> 拿它算边界，
    /// <c>CompactAsync</c> 拿它判断哪条消息的图该占位。两处各写一份迟早漂移。
    /// </summary>
    internal static int TailBudgetTokens(JsonElement provider)
    {
        var contextLength = JsonHelpers.GetIntNullable(provider, "contextLength") ?? DefaultContextCompressionLimit;
        var budget = DefaultTailTokens;
        if (contextLength > 0)
        {
            var maxByWin = (int)(contextLength * 0.5);
            if (maxByWin < budget) budget = maxByWin;
        }
        return budget;
    }

    /// <summary>
    /// 单条消息估算超预算时，把它的 tool result 里的图片块换成占位文本。
    /// 没超预算、或本来就没图 —— 原样返回（引用不变，调用方可据此判断要不要动 wire）。
    /// </summary>
    internal static AgentRuntimeChatMessage PlaceholdOversizedImageResults(
        AgentRuntimeChatMessage message,
        int budgetTokens)
    {
        if (message.ToolResults.Count == 0)
        {
            return message;
        }

        // 估算是 O(消息字符数)，先算再决定要不要动结构；超预算才有必要重建。
        if (EstimateMessageTokens(message) <= budgetTokens)
        {
            return message;
        }

        List<AgentRuntimeToolResult>? rebuilt = null;
        for (var i = 0; i < message.ToolResults.Count; i++)
        {
            var result = message.ToolResults[i];
            var (content, changed) = PlaceholdImageBlocks(result.Content);
            if (!changed)
            {
                continue;
            }

            rebuilt ??= [.. message.ToolResults];
            rebuilt[i] = result with { Content = content };
        }

        return rebuilt is null ? message : message with { ToolResults = rebuilt };
    }

    /// <summary>
    /// 把 content 数组里的图片块换成等量文本占位块，其余块原样保留。
    /// 顺序不变 —— 组包层按块序列拼 parts，重排会让 text 与 image 错位。
    /// </summary>
    internal static (JsonElement content, bool changed) PlaceholdImageBlocks(JsonElement content)
    {
        if (content.ValueKind != JsonValueKind.Array)
        {
            return (content, false);
        }

        // 每个块都必须进新数组，不管它在第一张图之前还是之后。写成「遇到图才建列表」
        // 会把图之前的 text 块整个丢掉 —— Read 工具的文件路径正好在那儿，
        // 占位文案又靠它指路，丢了两边全废。
        var blocks = new List<JsonElement>(content.GetArrayLength());
        var changed = false;
        foreach (var block in content.EnumerateArray())
        {
            if (JsonHelpers.GetString(block, "type") == "image")
            {
                blocks.Add(CreatePlaceholderBlock(block));
                changed = true;
                continue;
            }

            blocks.Add(block);
        }

        return changed ? (CloneArray(blocks), true) : (content, false);
    }

    /// <summary>
    /// 同一条 wire 消息的图片占位。必须与 <see cref="PlaceholdOversizedImageResults"/> 成对调用：
    /// conversation 侧降的是估算，wire 侧降的才是上游真实 token。
    ///
    /// 整条消息用 <c>property.WriteTo</c> 逐字段拷回去，只拦下 <c>content</c> 重写 ——
    /// 手写字段清单会在上游加字段（<c>usage</c> / <c>meta</c> / <c>providerResponseId</c>）
    /// 时静默丢数据。
    /// </summary>
    internal static JsonElement PlaceholdWireMessageImages(JsonElement wireMessage)
    {
        if (wireMessage.ValueKind != JsonValueKind.Object ||
            !wireMessage.TryGetProperty("content", out var content) ||
            content.ValueKind != JsonValueKind.Array ||
            !HasImageInToolResults(content))
        {
            return wireMessage;
        }

        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            foreach (var property in wireMessage.EnumerateObject())
            {
                if (!property.NameEquals("content"))
                {
                    property.WriteTo(writer);
                    continue;
                }

                writer.WritePropertyName("content");
                WriteContentWithPlaceholders(writer, content);
            }

            writer.WriteEndObject();
        }

        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    private static bool HasImageInToolResults(JsonElement content)
    {
        foreach (var block in content.EnumerateArray())
        {
            if (JsonHelpers.GetString(block, "type") != "tool_result" ||
                !block.TryGetProperty("content", out var inner) ||
                inner.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var innerBlock in inner.EnumerateArray())
            {
                if (JsonHelpers.GetString(innerBlock, "type") == "image")
                {
                    return true;
                }
            }
        }

        return false;
    }

    private static void WriteContentWithPlaceholders(Utf8JsonWriter writer, JsonElement content)
    {
        writer.WriteStartArray();
        foreach (var block in content.EnumerateArray())
        {
            if (JsonHelpers.GetString(block, "type") != "tool_result" ||
                !block.TryGetProperty("content", out var inner) ||
                inner.ValueKind != JsonValueKind.Array)
            {
                block.WriteTo(writer);
                continue;
            }

            writer.WriteStartObject();
            foreach (var property in block.EnumerateObject())
            {
                if (!property.NameEquals("content"))
                {
                    property.WriteTo(writer);
                    continue;
                }

                writer.WritePropertyName("content");
                var (replaced, _) = PlaceholdImageBlocks(inner);
                replaced.WriteTo(writer);
            }

            writer.WriteEndObject();
        }

        writer.WriteEndArray();
    }

    /// <summary>
    /// 一张图的占位块。刻意不写路径 —— 路径在同一个 tool result 的 text 块里
    /// （S-283 的 <c>Saved to …</c>、Read 工具的文件头），抄一遍等于把路径解析逻辑
    /// 绑死在压缩层，各工具一改格式就失效。文案只负责指路。
    /// </summary>
    private static JsonElement CreatePlaceholderBlock(JsonElement image)
    {
        var chars = 0;
        if (image.TryGetProperty("source", out var source) &&
            source.ValueKind == JsonValueKind.Object &&
            JsonHelpers.GetString(source, "data") is { Length: > 0 } data)
        {
            chars = data.Length;
        }

        var text = chars > 0
            ? $"{ImagePlaceholderPrefix}：原图 base64 约 {chars / 1024} KB 已移除，路径见本条结果的文字说明；需要看图请重新 Read 该路径]"
            : $"{ImagePlaceholderPrefix}：路径见本条结果的文字说明；需要看图请重新 Read 该路径]";

        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("type", "text");
            writer.WriteString("text", text);
            writer.WriteEndObject();
        }

        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    private static JsonElement CloneArray(List<JsonElement> blocks)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartArray();
            foreach (var block in blocks)
            {
                block.WriteTo(writer);
            }

            writer.WriteEndArray();
        }

        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }
}

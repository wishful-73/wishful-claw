using System.Buffers;
using System.Text;
using System.Text.Json;

namespace WishfulClaw.Agent;

/// <summary>
/// `request_debug` 载荷裁剪（S-323）。
///
/// ## 为什么必须裁
///
/// 每次 provider 请求都会发一条 `request_debug`，带**整份请求体**。会话里攒了二十张截图
/// 之后，这份 body 是十几 MB —— 而它**每一轮、每次重试**都发一遍：组包 → JsonSerializer
/// → MessagePack → pipe → base64 → JSON → WebView 里再解回来。
///
/// 渲染层实际要多少？`debug-store.ts` 自己写着三档上限：store 条目 2,000 字符、常驻消息
/// 对象 4,000、落库 8,000。实测一份 11,983,135 字符的 payload 推过去，驻留 **2,695**
/// （0.02%）—— 剩下 99.98% 生成即丢。
///
/// ## 怎么裁
///
/// **不截断字符串**：截断会把 JSON 变成非法形态，调试面板 `JSON.parse` 直接失败，
/// 等于用「看不见」换「不卡」。这里做**结构化裁剪** —— 解析 → 超长字符串值换占位 →
/// 重新序列化。面板拿到的仍是合法 JSON：`model` / 参数 / 消息角色原样保留（排查 400
/// 真正要看的就这些），图片只剩一句 `[omitted 599,036 chars — S-323]`。
///
/// 阈值全部对齐渲染层的上限，而不是拍脑袋：
/// <list type="bullet">
/// <item>body ≤ 8 KB 不裁（等于落库上限 <c>MAX_PERSISTED_DEBUG_BODY_CHARS</c>，再大也没人存）；</item>
/// <item>单个字符串值 ≤ 1,024 字符（够看清一句话的开头与结尾）；</item>
/// <item>数组最多 64 项（防「一百条消息 × 每条 1 KB」堆出 100 KB）。</item>
/// </list>
///
/// 解析失败（body 不是合法 JSON）时退回硬截断：调试信息宁可短，也不该把十几 MB 原样推出去。
/// </summary>
internal static class RequestDebugBodyTrimmer
{
    /// <summary>触发裁剪的阈值，同时是渲染层落库上限。</summary>
    internal const int MaxBodyChars = 8 * 1024;

    /// <summary>单个字符串值超过这个长度就换成占位 —— 图片 base64 是 600 KB 量级，远超它。</summary>
    internal const int MaxStringValueChars = 1024;

    /// <summary>单个数组最多保留的项数。</summary>
    internal const int MaxArrayItems = 64;

    /// <summary>
    /// 把 body 里超长的字符串值换成占位说明。返回值仍是**合法 JSON**（除非入参本身不是）。
    /// </summary>
    public static string Trim(string? body)
    {
        if (string.IsNullOrEmpty(body)) return body ?? string.Empty;

        // 快速路径：绝大多数纯文本请求远不到 8 KB，别为它们付一次解析 + 重写。
        if (body.Length <= MaxBodyChars) return body;

        try
        {
            using var doc = JsonDocument.Parse(body);
            var buffer = new ArrayBufferWriter<byte>(Math.Min(body.Length, MaxBodyChars));
            using (var writer = new Utf8JsonWriter(buffer))
            {
                WriteTrimmed(writer, doc.RootElement);
            }

            return Encoding.UTF8.GetString(buffer.WrittenSpan);
        }
        catch (JsonException)
        {
            return HardTruncate(body);
        }
    }

    private static string HardTruncate(string body)
        => body[..MaxBodyChars] + $"\n... [truncated, {body.Length:N0} chars total]";

    private static void WriteTrimmed(Utf8JsonWriter writer, JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in element.EnumerateObject())
                {
                    writer.WritePropertyName(property.Name);
                    WriteTrimmed(writer, property.Value);
                }

                writer.WriteEndObject();
                break;

            case JsonValueKind.Array:
                WriteTrimmedArray(writer, element);
                break;

            case JsonValueKind.String:
                var value = element.GetString() ?? string.Empty;
                writer.WriteStringValue(value.Length > MaxStringValueChars
                    ? $"[omitted {value.Length:N0} chars — S-323]"
                    : value);
                break;

            default:
                // 数字 / 布尔 / null 都是定长或极短，原样写回。
                element.WriteTo(writer);
                break;
        }
    }

    /// <summary>
    /// 数组裁剪：只留前 <see cref="MaxArrayItems"/> 项，末尾补一条说明还能省掉多少。
    /// 长会话的 `messages` 是唯一会撞上这条的结构。
    /// </summary>
    private static void WriteTrimmedArray(Utf8JsonWriter writer, JsonElement element)
    {
        writer.WriteStartArray();
        var total = element.GetArrayLength();
        var index = 0;
        foreach (var item in element.EnumerateArray())
        {
            if (index >= MaxArrayItems)
            {
                writer.WriteStringValue($"[omitted {total - MaxArrayItems:N0} more items — S-323]");
                break;
            }

            WriteTrimmed(writer, item);
            index++;
        }

        writer.WriteEndArray();
    }
}

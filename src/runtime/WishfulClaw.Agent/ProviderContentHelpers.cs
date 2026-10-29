using System.Text;
using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Image and tool result content helpers.
/// </summary>
public static class ProviderContentHelpers
{
    // ── Image helpers ──

    /// <summary>
    /// 上游共同接受的图像 mime（S-246）。
    ///
    /// 这是四家（OpenAI / Anthropic / Gemini / 主流中转）的交集，不是某一家的完整能力表。
    /// 用途只有一个：**组包时把上游一定收不了的类型挡在请求体外**。
    ///
    /// 为什么要有这份名单 —— 修复前，请求体里的 mime 直接取自块上声明的 `mediaType`，
    /// 而声明可能来自文件扩展名（`ImageFileProbe` 认为 `.bmp → image/bmp`，那是正确的
    /// 「这是什么格式」，但它不代表上游会收）、来自渠道侧探测、来自历史里落库的旧块。
    /// 只要有一环把 bmp / svg 这类格式送出去，上游就回 400 `unsupported image`；
    /// 而那个 image 块在会话历史里，**每一轮请求都会重发** ⇒ 整个会话在清空历史前永久不可用。
    ///
    /// 所以判据放在最靠近出口的地方：字节是什么（嗅探）说了算，白名单说了算。
    /// </summary>
    public static readonly IReadOnlySet<string> SupportedImageMediaTypes =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/gif"
        };

    // 魔数常量。写成静态数组而不是内联 collection expression ——
    // `span.SequenceEqual([0x89, …])` 会被推断成 int[]，编译不过（S-246 实测）。
    private static readonly byte[] PngMagic = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly byte[] TiffLittleEndianMagic = [0x49, 0x49, 0x2A, 0x00];
    private static readonly byte[] TiffBigEndianMagic = [0x4D, 0x4D, 0x00, 0x2A];

    public static string StripDataUrlPrefix(string? value)    {
        var trimmed = value?.Trim() ?? string.Empty;
        var marker = ";base64,";
        var markerIndex = trimmed.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        return markerIndex >= 0 ? trimmed[(markerIndex + marker.Length)..] : trimmed;
    }

    /// <summary>
    /// 按字节嗅探图像格式 —— **只回答「这是什么」，不回答「上游要不要」**（S-246）。
    ///
    /// 与 <see cref="SupportedImageMediaTypes"/> 分工明确：这里认得出的格式越多越好，
    /// 包括上游不收的那几种（bmp / tiff / ico / svg）。认出来才有机会把它们拦下；
    /// 认不出就只能信声明，而声明恰恰是最容易错的一环。
    ///
    /// 前面几个格式沿用原实现（S-145）的 base64 前缀判据；gif / bmp / tiff / ico / svg
    /// 是 S-246 补的 —— 缺了它们，脏块会落进 `?? "image/png"` 的兜底分支，被贴上 png 标签发出去。
    /// </summary>
    public static string? DetectImageMediaTypeFromBase64(string? imageBase64)
    {        var normalized = StripDataUrlPrefix(imageBase64).Trim();
        if (normalized.Length < 8)
        {
            return null;
        }

        // base64 前 4 字符 = 前 3 字节，完全确定。取 64 字符（48 字节）：
        // 既能覆盖 PNG / RIFF-WEBP 这类「签名不在偏移 0」的容器，
        // 也够看清 SVG 前面的 `<?xml version="1.0"?>` 声明（S-246 实测 18 字节不够）。
        const int prefixChars = 64;
        var take = Math.Min(normalized.Length, prefixChars);
        take -= take % 4;
        if (take < 8)
        {
            take = 8;
        }

        byte[] head;
        try
        {
            // base64url 变体（`-` / `_`）先归一回标准字母表，否则 Convert 会抛。
            var slice = normalized[..take].Replace('-', '+').Replace('_', '/');
            head = Convert.FromBase64String(slice);
        }
        catch (FormatException)
        {
            return null;
        }

        var span = head.AsSpan();

        if (span.Length >= 8 && span[..8].SequenceEqual(PngMagic))
        {
            return "image/png";
        }
        if (span.Length >= 3 && span[0] == 0xFF && span[1] == 0xD8 && span[2] == 0xFF)
        {
            return "image/jpeg";
        }
        if (span.Length >= 12 && span[..4].SequenceEqual("RIFF"u8) && span[8..12].SequenceEqual("WEBP"u8))
        {
            return "image/webp";
        }
        if (span.Length >= 6 &&
            (span[..6].SequenceEqual("GIF87a"u8) || span[..6].SequenceEqual("GIF89a"u8)))
        {
            return "image/gif";
        }
        if (span.Length >= 2 && span[0] == (byte)'B' && span[1] == (byte)'M')
        {
            return "image/bmp";
        }
        if (span.Length >= 4 &&
            (span[..4].SequenceEqual(TiffLittleEndianMagic) || span[..4].SequenceEqual(TiffBigEndianMagic)))
        {
            return "image/tiff";
        }
        if (span.Length >= 4 && span[0] == 0x00 && span[1] == 0x00 && span[2] == 0x01 && span[3] == 0x00)
        {
            return "image/x-icon";
        }

        return DetectTextImageFormat(span);
    }

    /// <summary>
    /// SVG 是文本，没有二进制签名 —— 按「开头的可打印字节」认。认得出来是为了能拦：
    /// 上游一律不收 `<svg>`，而历史里落过一张 svg，同样会每轮 400。
    /// </summary>
    private static string? DetectTextImageFormat(ReadOnlySpan<byte> head)
    {
        foreach (var b in head)
        {
            // 有任何控制字节（除常见的 \t \r \n）就不是文本图，别猜。
            if (b == 0)
            {
                return null;
            }
            if (b < 0x09 || (b > 0x0D && b < 0x20))
            {
                return null;
            }
        }

        var text = Encoding.UTF8.GetString(head).TrimStart('\uFEFF', ' ', '\t', '\r', '\n');
        if (text.StartsWith("<svg", StringComparison.OrdinalIgnoreCase) ||
            (text.StartsWith("<?xml", StringComparison.OrdinalIgnoreCase) &&
             head.IndexOf("<svg"u8) >= 0))
        {
            return "image/svg+xml";
        }

        return null;
    }

    /// <summary>
    /// declared 的归一：大小写、`image/jpg` 这个非标准但常见的写法。
    /// 归一后**不判可行** —— 可行性只由 <see cref="SupportedImageMediaTypes"/> 决定。
    /// </summary>
    private static string? NormalizeDeclaredMediaType(string? declared)
    {
        var trimmed = declared?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        // 有些来源带 charset 之类的参数（`image/png; charset=binary`），只取 mime 主体。
        var semicolon = trimmed.IndexOf(';');
        if (semicolon >= 0)
        {
            trimmed = trimmed[..semicolon].Trim();
        }

        return trimmed.Equals("image/jpg", StringComparison.OrdinalIgnoreCase)
            ? "image/jpeg"
            : trimmed.ToLowerInvariant();
    }

    /// <summary>
    /// **组包前的唯一闸门（S-246）**：这个 image 块能不能以 base64 形式出门，出门该贴什么 mime。
    ///
    /// 顺序是「事实优先于声明」：
    /// <list type="number">
    /// <item>嗅探出真实格式 ⇒ 以嗅探为准（声明的 bmp 字节被标成 png，这里按 bmp 判，随后被白名单拦下）；</item>
    /// <item>**嗅探不出 ⇒ 一律丢块**（S-264 收严；修前这里回落信任声明，见方法内注释）；</item>
    /// <item>嗅探出但不在白名单 ⇒ 同样丢块。</item>
    /// </list>
    ///
    /// 返回 <c>null</c> 不等于「图没了」：<c>FileReadTool.ReadImage</c> 产出的
    /// `[text("Read image: 路径 (尺寸, 格式)"), image]` 里那行文本仍在，模型照旧知道读了哪张图。
    /// </summary>
    public static string? ResolveSupportedImageMediaType(string? imageBase64, string? declaredMediaType)
    {
        // 没有字节就没有「图」可言。声称 png 也不算 —— 这种块送出去只会换来一次 400。
        if (string.IsNullOrWhiteSpace(imageBase64))
        {
            return null;
        }

        var detected = DetectImageMediaTypeFromBase64(imageBase64);
        if (detected is not null)
        {
            return SupportedImageMediaTypes.Contains(detected) ? detected : null;
        }

        // S-264：**嗅探认不出 ⇒ 不再信任声明。**
        //
        // 修前这里回落到 declared，理由是「怕嗅探漏掉不认识的合法格式」。但那恰恰是脏图的通道：
        // 损坏 / 半截写入 / 非图像内容 / 未列的新格式，全部返回 null，于是全部被贴上声明的
        // `image/png` 送上上游，换回 400 `unsupported image`。真实现场（10-27～10-28）18 条
        // 图像 400 里 **10 条在微信渠道会话**，根本不经过 FileReadTool —— 只改工具层治不住。
        //
        // 收严不误杀白名单格式：`DetectImageMediaTypeFromBase64` 认 png/jpeg/webp/gif 全部四种
        // （外加 bmp/tiff/ico/svg），覆盖面**不小于**白名单。所以「声明是白名单格式、嗅探却
        // 认不出」只可能是「字节根本不是那四种」—— 它就是脏图，丢它是对的。
        var declared = NormalizeDeclaredMediaType(declaredMediaType);
        WorkerLog.Warn(
            $"image block dropped before provider turn: unrecognizable image bytes " +
            $"(declared={declared ?? "(none)"}); the block stays in history but no longer reaches the wire");
        return null;
    }

    /// <summary>
    /// url 形态 image 块的出门判据（S-261）：上游**自己拿得到这张图**才返回 url，否则 null。
    ///
    /// 为什么需要这一道 —— S-246 的白名单闸只覆盖 base64 形态。`source.type == "url"` 在
    /// <c>OpenAIChatRequestBuilder</c> 与 <c>AnthropicMessagesInputWriter</c> 里都是直接透传：
    /// 同一个语义（「这张图能不能出门」）长了两份判据，base64 那半有闸、url 那半零闸。
    /// 而渲染端 <c>visual-context.ts:272</c> 确实会把历史里 url 形态的块原样注入。
    /// 一张 <c>file:///</c> / <c>oc-media://</c> 的图送到上游必然换回 400 `unsupported image`，
    /// 块又留在历史里每轮重发 ⇒ 整个会话在清空历史前不可用。
    ///
    /// 判据只看三点，不需要猜渠道：http(s) 放行（上游可拉）；`data:…;base64,` 交回
    /// <see cref="ResolveSupportedImageMediaType"/>（嗅探优先 + 白名单），与 base64 块**同源判据**；
    /// 其余 scheme 上游一律解析不了，丢。
    /// </summary>
    /// <param name="imageSource">image 块的 <c>source</c> 对象。</param>
    /// <param name="warn">丢弃时是否写日志。<c>HasUsableImageBlock</c> 这类探测调用传 false，避免重复告警。</param>
    public static string? SendableImageUrl(JsonElement imageSource, bool warn = true)
    {
        if (imageSource.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var url = JsonHelpers.GetString(imageSource, "url")?.Trim();
        if (string.IsNullOrEmpty(url))
        {
            return null;
        }

        if (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
            url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            return url;
        }

        // `data:image/png;base64,AAAA…` —— 字节就在 url 里，按 base64 那套判。
        const string base64Marker = ";base64,";
        var marker = url.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
            ? url.IndexOf(base64Marker, StringComparison.OrdinalIgnoreCase)
            : -1;
        if (marker > 5)
        {
            var declared = url[5..marker];
            var base64 = url[(marker + base64Marker.Length)..];
            if (ResolveSupportedImageMediaType(base64, declared) is not null)
            {
                return url;
            }
        }

        if (warn)
        {
            // 只回显 scheme：data: 的载荷可能很长，日志里不能带。
            var colon = url.IndexOf(':');
            var scheme = colon > 0 && colon <= 12 ? url[..(colon + 1)] : "(none)";
            WorkerLog.Warn(
                $"image block dropped before provider turn: unsendable image url " +
                $"(scheme={scheme}); the block stays in history but no longer reaches the wire");
        }

        return null;
    }

    // ── Tool result helpers ──

    /// <summary>
    /// 这段 tool result content 里有没有**真能出门**的图像块（S-246）。
    ///
    /// 判据必须与组包闸门同源：只看 `data` 非空是不够的 —— 一张被闸门丢掉的脏图
    /// 会让调用方误以为「有图」而走 parts 分支，写出一个只有 text 的 parts 数组；
    /// 上游对空 parts 同样报错，等于把 400 从「图不合法」换成「内容不合法」。
    /// </summary>
    public static bool HasUsableImageBlock(JsonElement content)
    {
        if (content.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        foreach (var block in content.EnumerateArray())
        {
            if (JsonHelpers.GetString(block, "type") != "image")
            {
                continue;
            }
            if (!block.TryGetProperty("source", out var source) || source.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            if (JsonHelpers.GetString(source, "type") == "url")
            {
                // S-261：与组包闸同源 —— url 非空不等于「能出门」。
                if (SendableImageUrl(source, warn: false) is not null)
                {
                    return true;
                }
                continue;
            }

            var data = JsonHelpers.GetString(source, "data");
            if (string.IsNullOrWhiteSpace(data))
            {
                continue;
            }

            if (ResolveSupportedImageMediaType(data, JsonHelpers.GetString(source, "mediaType")) is not null)
            {
                return true;
            }
        }

        return false;
    }

    public static string ToolResultToString(JsonElement content)
    {
        if (content.ValueKind == JsonValueKind.String)
        {
            return content.GetString() ?? string.Empty;
        }

        if (content.ValueKind != JsonValueKind.Array)
        {
            return content.GetRawText();
        }

        var text = new StringBuilder();
        foreach (var block in content.EnumerateArray())
        {
            if (JsonHelpers.GetString(block, "type") == "text" &&
                JsonHelpers.GetString(block, "text") is { Length: > 0 } blockText)
            {
                if (text.Length > 0)
                {
                    text.Append('\n');
                }
                text.Append(blockText);
            }
        }
        return text.ToString();
    }
}

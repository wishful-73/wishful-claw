// S-246 回归：组包前的图像闸门 —— 嗅探执行事实，白名单执行可行。
//
// 这个缺陷的代价是「一条坏图卡死整个会话」，所以断言分三类：
//   · 嗅探要认得出上游不收的格式（bmp / tiff / ico / svg）—— 认不出就拦不住；
//   · 声明与事实冲突时，事实赢 —— 否则「bmp 字节标成 png」照样出门；
//   · 白名单内的四种不许误伤 —— 拦宽了等于把看图能力也砍了。
//
// S-264 追加第四类：**嗅探不出时不许回落信任声明**。工具层（S-266 的容器完整性、
// S-264 的签名判定）只覆盖走 FileReadTool 的路径；粘贴、渠道消息里的图不经过那层，
// 所以组包层这道闸是最后一关，这里的口径松一档，脏图就从渠道漏出去。
//
// 约定：失败断言打 FAIL，最后一行打 "passed: N, failed: M"，非零退出码表示失败
// （scripts/run-tests.mjs 按退出码判定，按 "passed: N" 取计数）。

using System;
using System.Text;
using System.Text.Json;
using WishfulClaw.Agent;

var passed = 0;
var failed = 0;

void Check(bool condition, string label)
{
    if (condition)
    {
        passed++;
        return;
    }
    failed++;
    Console.WriteLine($"FAIL {label}");
}

static string B64(byte[] head, int pad = 16)
{
    var buffer = new byte[head.Length + pad];
    head.CopyTo(buffer, 0);
    return Convert.ToBase64String(buffer);
}

var png = B64([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
var jpeg = B64([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
var webp = B64([.. "RIFF"u8, 0x18, 0x00, 0x00, 0x00, .. "WEBP"u8, .. "VP8 "u8]);
var gif = B64([.. "GIF89a"u8, 0x0A, 0x00, 0x0A, 0x00]);
var bmp = B64([0x42, 0x4D, 0x36, 0x00, 0x0C, 0x00, 0x00, 0x00]);
var tiffLe = B64([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00]);
var tiffBe = B64([0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08]);
var ico = B64([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10]);
var svg = Convert.ToBase64String(Encoding.UTF8.GetBytes("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"));
var svgXml = Convert.ToBase64String(Encoding.UTF8.GetBytes("<?xml version=\"1.0\"?><svg></svg>"));
var junk = Convert.ToBase64String(Encoding.ASCII.GetBytes("this is not an image at all, just bytes"));

// ── 一、嗅探：认得出「是什么」，包括上游不收的 ──

Check(ProviderContentHelpers.DetectImageMediaTypeFromBase64(png) == "image/png", "png sniffed");
Check(ProviderContentHelpers.DetectImageMediaTypeFromBase64(jpeg) == "image/jpeg", "jpeg sniffed");
Check(ProviderContentHelpers.DetectImageMediaTypeFromBase64(webp) == "image/webp", "webp sniffed");
Check(ProviderContentHelpers.DetectImageMediaTypeFromBase64(gif) == "image/gif", "gif sniffed (S-246 补)");
Check(ProviderContentHelpers.DetectImageMediaTypeFromBase64(bmp) == "image/bmp", "bmp sniffed (S-246 补)");
Check(ProviderContentHelpers.DetectImageMediaTypeFromBase64(tiffLe) == "image/tiff", "tiff II sniffed (S-246 补)");
Check(ProviderContentHelpers.DetectImageMediaTypeFromBase64(tiffBe) == "image/tiff", "tiff MM sniffed (S-246 补)");
Check(ProviderContentHelpers.DetectImageMediaTypeFromBase64(ico) == "image/x-icon", "ico sniffed (S-246 补)");
Check(ProviderContentHelpers.DetectImageMediaTypeFromBase64(svg) == "image/svg+xml", "svg sniffed (S-246 补)");
Check(ProviderContentHelpers.DetectImageMediaTypeFromBase64(svgXml) == "image/svg+xml", "xml-wrapped svg sniffed");
Check(ProviderContentHelpers.DetectImageMediaTypeFromBase64(junk) is null, "random bytes sniff to null");
Check(ProviderContentHelpers.DetectImageMediaTypeFromBase64(null) is null, "null sniffs to null");
Check(ProviderContentHelpers.DetectImageMediaTypeFromBase64("") is null, "empty sniffs to null");

// data URL 前缀不许干扰嗅探
Check(ProviderContentHelpers.DetectImageMediaTypeFromBase64($"data:image/png;base64,{png}") == "image/png",
    "data url prefix is stripped before sniffing");

// ── 二、闸门：白名单内的放行 ──

Check(ProviderContentHelpers.ResolveSupportedImageMediaType(png, null) == "image/png", "png passes the gate");
Check(ProviderContentHelpers.ResolveSupportedImageMediaType(jpeg, "image/png") == "image/jpeg",
    "declared png on jpeg bytes is corrected to jpeg");
Check(ProviderContentHelpers.ResolveSupportedImageMediaType(gif, null) == "image/gif",
    "gif passes the gate (修复前 gif 嗅不出、会被贴成 png 发出去)");
Check(ProviderContentHelpers.ResolveSupportedImageMediaType(webp, "image/webp") == "image/webp", "webp passes");

// 嗅不出 ⇒ 一律丢块（S-264 收严；修前这里回落到声明的白名单类型）。
//
// 这条口径改过，别按直觉改回去：回落信任声明的理由曾是「怕嗅探漏掉不认识的合法格式」，
// 但那恰恰是脏图的通道 —— 损坏 / 半截写入 / 非图像内容全部返回 null，于是全部被贴上
// 声明的 image/png 出门。白名单四种格式嗅探全认得出，覆盖面不小于白名单，所以
// 「声明是白名单格式、嗅探却认不出」只可能是「字节根本不是那四种」。
Check(ProviderContentHelpers.ResolveSupportedImageMediaType(junk, "image/png") is null,
    "unrecognised bytes with a whitelisted declared type are still dropped (S-264)");
Check(ProviderContentHelpers.ResolveSupportedImageMediaType(junk, "IMAGE/JPG") is null,
    "declared type normalisation does not change the drop (S-264)");
Check(ProviderContentHelpers.ResolveSupportedImageMediaType(junk, "image/png; charset=binary") is null,
    "declared mime parameters do not change the drop (S-264)");
Check(ProviderContentHelpers.ResolveSupportedImageMediaType(junk, null) is null,
    "unrecognised bytes with no declared type are dropped (S-264)");

// ── 三、闸门：该拦的必须拦住（这是本需求的核心） ──

Check(ProviderContentHelpers.ResolveSupportedImageMediaType(bmp, "image/bmp") is null,
    "bmp bytes with bmp declared are rejected (这就是那条线上 400)");
Check(ProviderContentHelpers.ResolveSupportedImageMediaType(bmp, null) is null, "bmp bytes with no declared type rejected");
Check(ProviderContentHelpers.ResolveSupportedImageMediaType(bmp, "image/png") is null,
    "bmp bytes mislabelled as png are rejected —— 事实赢，声明不作数");
Check(ProviderContentHelpers.ResolveSupportedImageMediaType(svg, "image/svg+xml") is null, "svg rejected");
Check(ProviderContentHelpers.ResolveSupportedImageMediaType(svg, "image/png") is null, "svg mislabelled as png rejected");
Check(ProviderContentHelpers.ResolveSupportedImageMediaType(tiffLe, "image/tiff") is null, "tiff rejected");
Check(ProviderContentHelpers.ResolveSupportedImageMediaType(ico, "image/x-icon") is null, "ico rejected");
Check(ProviderContentHelpers.ResolveSupportedImageMediaType(junk, "image/bmp") is null,
    "unrecognised bytes with a non-whitelisted declared type are rejected");
Check(ProviderContentHelpers.ResolveSupportedImageMediaType(junk, null) is null,
    "unrecognised bytes without a declared type are rejected（不再兜底成 png）");
Check(ProviderContentHelpers.ResolveSupportedImageMediaType(null, "image/png") is null,
    "no data at all is rejected");

// ── 四、tool result 的「有可用图」判据必须与闸门同源 ──
//
// 判据不同源的后果：脏块被判成「有图」⇒ 调用方走 parts 分支 ⇒ 写出只有 text 的 parts 数组
// ⇒ 上游把 400 从「图不合法」换成「内容不合法」。所以这里逐条对齐。

static JsonElement ContentOf(object payload)
{
    using var document = JsonDocument.Parse(JsonSerializer.Serialize(payload));
    return document.RootElement.Clone();
}

// 「放得出去」的图必须**真完整**：S-264 起容器完整性进了组包闸，
// 上面那个 14 字节的 `png` 只有签名 + IHDR、没有 IEND，本来就该被拦。
const string completePng =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

var goodContent = ContentOf(new object[]
{
    new { type = "text", text = "Read image: a.png (1x1, image/png)" },
    new { type = "image", source = new Dictionary<string, string>
        { ["type"] = "base64", ["mediaType"] = "image/png", ["data"] = completePng } }
});
var dirtyContent = ContentOf(new object[]
{
    new { type = "text", text = "Read image: a.bmp (2x2, image/bmp)" },
    new { type = "image", source = new Dictionary<string, string>
        { ["type"] = "base64", ["mediaType"] = "image/bmp", ["data"] = bmp } }
});
var mislabelledContent = ContentOf(new object[]
{
    new { type = "image", source = new Dictionary<string, string>
        { ["type"] = "base64", ["mediaType"] = "image/png", ["data"] = bmp } }
});
var urlContent = ContentOf(new object[]
{
    new { type = "image", source = new Dictionary<string, string>
        { ["type"] = "url", ["url"] = "https://example.com/a.png" } }
});
var budgetEmpty = ContentOf(new object[]
{
    new { type = "image", source = new Dictionary<string, string>
        { ["type"] = "base64", ["mediaType"] = "image/png" } }
});
var textOnly = ContentOf(new object[] { new { type = "text", text = "hi" } });

Check(ProviderContentHelpers.HasUsableImageBlock(goodContent), "usable image block is recognised");
Check(!ProviderContentHelpers.HasUsableImageBlock(dirtyContent), "bmp block is not usable");
Check(!ProviderContentHelpers.HasUsableImageBlock(mislabelledContent), "mislabelled bmp block is not usable");
Check(ProviderContentHelpers.HasUsableImageBlock(urlContent), "url image block is still usable");
Check(!ProviderContentHelpers.HasUsableImageBlock(budgetEmpty), "block without data is not usable");
Check(!ProviderContentHelpers.HasUsableImageBlock(textOnly), "text-only content has no image");

Console.WriteLine($"passed: {passed}, failed: {failed}");
return failed == 0 ? 0 : 1;

// S-323 回归：`request_debug` 的 body 必须被裁到「与图片数量无关」的量级。
//
// 为什么这条必须有回归：这个 bug 不报错、不崩、界面一切正常 —— 只是每一轮把十几 MB 的
// 请求体（含全部历史截图 base64）经组包 → MessagePack → pipe → 壳重编码 → base64 → JSON
// 推给渲染层。除了「内存曲线难看」以外没有任何可观测症状，所以只能靠断言把它钉住。
//
// 约定：失败断言打 FAIL，最后一行打 "passed: N, failed: M"，非零退出码表示失败。

using System;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using WishfulClaw.Agent.Protocol;
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

// ── 一、真实形状：20 张截图，每张 599,036 字符 base64（与真实截图同量级）──────────
const int ImageCount = 20;
var fakeBase64 = new string('A', 599_036);

var bodyBuilder = new StringBuilder();
bodyBuilder.Append("{\"model\":\"gpt-4o\",\"messages\":[");
for (var i = 0; i < ImageCount; i++)
{
    if (i > 0) bodyBuilder.Append(',');
    bodyBuilder.Append("{\"role\":\"tool\",\"tool_call_id\":\"call_")
        .Append(i)
        .Append("\",\"content\":[{\"type\":\"image_url\",\"image_url\":{\"url\":\"data:image/png;base64,")
        .Append(fakeBase64)
        .Append("\"}}]}");
}

bodyBuilder.Append("],\"stream\":true}");
var body = bodyBuilder.ToString();

Console.WriteLine($"原始 body: {body.Length:N0} chars");
Check(body.Length > 10_000_000, "test body is realistically large (>10M chars)");

var sw = Stopwatch.StartNew();
var trimmed = RequestDebugBodyTrimmer.Trim(body);
sw.Stop();

Console.WriteLine($"裁剪后 body: {trimmed.Length:N0} chars  耗时 {sw.ElapsedMilliseconds} ms");
Console.WriteLine($"压缩比: {(double)trimmed.Length / body.Length:P2}");

// 核心断言：裁剪后必须**与图片数量无关**。一行占位约 40 字符 × 20 张，远小于 8 KB。
Check(trimmed.Length < RequestDebugBodyTrimmer.MaxBodyChars, $"trimmed body is small (actual {trimmed.Length:N0} chars)");
Check(trimmed.Length < 64_000, "trimmed body under 64K (image count independent)");

// 结构化裁剪的意义就在这条：面板拿到的还是合法 JSON，`JSON.parse` 不会失败。
var parsedOk = true;
JsonDocument? parsedDoc = null;
try
{
    parsedDoc = JsonDocument.Parse(trimmed);
}
catch (JsonException)
{
    parsedOk = false;
}

Check(parsedOk, "trimmed body is still valid JSON");

if (parsedDoc is not null)
{
    using (parsedDoc)
    {
        var root = parsedDoc.RootElement;

        // 排查 400 真正要看的字段不能丢。
        Check(root.TryGetProperty("model", out var modelEl) && modelEl.GetString() == "gpt-4o",
            "model field preserved");
        Check(root.TryGetProperty("stream", out var streamEl) && streamEl.ValueKind == JsonValueKind.True,
            "stream flag preserved");

        // 消息条数与角色结构保留，只有超长字符串值换成了占位。
        Check(root.TryGetProperty("messages", out var messagesEl) &&
              messagesEl.ValueKind == JsonValueKind.Array &&
              messagesEl.GetArrayLength() == ImageCount,
            $"all {ImageCount} messages preserved");
        if (messagesEl.ValueKind == JsonValueKind.Array && messagesEl.GetArrayLength() == ImageCount)
        {
            var first = messagesEl[0];
            Check(first.TryGetProperty("role", out var roleEl) && roleEl.GetString() == "tool",
                "message role preserved");
            Check(first.TryGetProperty("content", out var contentEl) &&
                  contentEl.ValueKind == JsonValueKind.Array &&
                  contentEl.GetArrayLength() == 1,
                "content array shape preserved");
        }
    }
}

// 占位里报的是**整个字符串值**的长度（含 `data:image/png;base64,` 前缀 22 字符），
// 不是 base64 本身 —— 面板要还原的正是「这个值原来多大」。
var dataUrlPrefixLength = "data:image/png;base64,".Length;
Check(trimmed.Contains($"[omitted {dataUrlPrefixLength + 599_036:N0} chars", StringComparison.Ordinal),
    $"placeholder states the original length ({dataUrlPrefixLength + 599_036:N0})");
Check(!trimmed.Contains(fakeBase64, StringComparison.Ordinal), "raw base64 payload no longer present");

// ── 二、快速路径：不超过阈值就原样返回，不解析、不改一个字节 ─────────────────────
var smallBody = "{\"model\":\"gpt-4o\",\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}]}";
Check(RequestDebugBodyTrimmer.Trim(smallBody) == smallBody, "short body returns unchanged (fast path)");

var exactLimit = new string('x', RequestDebugBodyTrimmer.MaxBodyChars);
Check(RequestDebugBodyTrimmer.Trim(exactLimit) == exactLimit, "body exactly at limit returns unchanged");

// null / 空串不抛，返回空串（占位语义：没有 body 可展示）。
Check(RequestDebugBodyTrimmer.Trim(null!) == string.Empty, "null body -> empty string");
Check(RequestDebugBodyTrimmer.Trim(string.Empty) == string.Empty, "empty body -> empty string");

// ── 三、非法 JSON：退回硬截断，绝不把原文推出去 ────────────────────────────────
var brokenBody = "{\"model\":\"" + new string('y', 50_000);
var brokenTrimmed = RequestDebugBodyTrimmer.Trim(brokenBody);
Check(brokenTrimmed.Length < brokenBody.Length, "broken JSON got truncated");
Check(brokenTrimmed.Length <= RequestDebugBodyTrimmer.MaxBodyChars + 64,
    $"broken JSON truncated to ~1x limit (actual {brokenTrimmed.Length:N0})");
Check(brokenTrimmed.Contains("[truncated", StringComparison.Ordinal), "broken JSON says truncated");

// ── 四、数组上限：长会话的 messages 不可能无限堆 ──────────────────────────────
var manyBuilder = new StringBuilder();
manyBuilder.Append("{\"model\":\"m\",\"messages\":[");
for (var i = 0; i < 200; i++)
{
    if (i > 0) manyBuilder.Append(',');
    manyBuilder.Append("{\"role\":\"user\",\"content\":\"message #").Append(i).Append('"');
    manyBuilder.Append(",\"pad\":\"").Append('z', 200).Append("\"}");
}

manyBuilder.Append("]}");
var manyTrimmed = RequestDebugBodyTrimmer.Trim(manyBuilder.ToString());

var manyParsedOk = true;
using (var manyDoc = TryParse(manyTrimmed))
{
    if (manyDoc is null)
    {
        manyParsedOk = false;
    }
    else
    {
        var arr = manyDoc.RootElement.GetProperty("messages");
        // 保留前 64 项 + 末尾一条说明。
        Check(arr.GetArrayLength() == RequestDebugBodyTrimmer.MaxArrayItems + 1,
            $"array capped at {RequestDebugBodyTrimmer.MaxArrayItems} items + 1 note (actual {arr.GetArrayLength()})");
        Check(arr[arr.GetArrayLength() - 1].GetString()!.Contains("more items", StringComparison.Ordinal),
            "array note explains how many items were dropped");
    }
}

Check(manyParsedOk, "capped array body is still valid JSON");

// ── 五、中文：短值原样保真（不因重写乱码），超长值照旧换占位 ────────────────────
const string chineseValue = "心相智能助手，你好。";
var cnBuilder = new StringBuilder();
cnBuilder.Append("{\"model\":\"m\",\"messages\":[{\"role\":\"user\",\"content\":\"");
cnBuilder.Append(chineseValue);
cnBuilder.Append("\",\"longNote\":\"");
cnBuilder.Append('中', 10_000);
cnBuilder.Append("\"}]}");
var cnTrimmed = RequestDebugBodyTrimmer.Trim(cnBuilder.ToString());
using (var cnDoc = TryParse(cnTrimmed))
{
    Check(cnDoc is not null, "chinese body stays valid JSON");
    if (cnDoc is not null)
    {
        var message = cnDoc.RootElement.GetProperty("messages")[0];
        var content = message.GetProperty("content").GetString()!;
        Check(content == chineseValue, "short chinese value round-trips byte-exact (no mojibake)");

        var longNote = message.GetProperty("longNote").GetString()!;
        Check(longNote.StartsWith("[omitted 10,000 chars", StringComparison.Ordinal),
            "over-long chinese value got placeholder with its char count");
    }
}

Console.WriteLine($"passed: {passed}, failed: {failed}");
return failed == 0 ? 0 : 1;

static JsonDocument? TryParse(string json)
{
    try
    {
        return JsonDocument.Parse(json);
    }
    catch (JsonException)
    {
        return null;
    }
}

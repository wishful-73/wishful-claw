// S-236 档 2 回归：图像输入被上游拒时的「剥图重试 + 记忆」两条规则。
//
// 这两条规则都是保守匹配，写错了代价不对称：
//   · 漏匹配 —— 用户看到一次莫名其妙的 400 报错（可接受，有报错总好过静默吞图）
//   · 误匹配 —— 把一个「模型不存在」之类的真 400 当成图像问题，剥图重发，
//               错误被推迟一次往返才暴露，还可能让用户以为问题出在图片上
// 所以下面一半断言是「不许匹配」。
//
// 约定：失败断言打 FAIL，最后一行打 "passed: N, failed: M"，非零退出码表示失败
// （scripts/run-tests.mjs 按退出码判定，按 "passed: N" 取计数）。

using System;
using System.IO;
using WishfulClaw.Agent;

// 记忆会落盘到全局数据目录；先指到临时目录，别污染真实的 ~/.wishful-claw
var tempDataDir = Path.Combine(Path.GetTempPath(), "wc-image-input-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(tempDataDir);
Environment.SetEnvironmentVariable("WISHFULCLAW_DATA_DIR", tempDataDir);

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

// ── 一、ImageInputErrors：认得出「不吃图像输入」 ──

Check(ImageInputErrors.IsImageUnsupportedError(new Exception("image_url is not supported by this model")),
    "openai image_url not supported is recognised");
Check(ImageInputErrors.IsImageUnsupportedError(new Exception("This model does not support images.")),
    "does not support images is recognised");
Check(ImageInputErrors.IsImageUnsupportedError(new Exception("unknown variant `image_url`, expected `text`")),
    "serde unknown variant with backticks is recognised");
Check(ImageInputErrors.IsImageUnsupportedError(new Exception("unknown variant \"image_url\"")),
    "serde unknown variant with quotes is recognised");
Check(ImageInputErrors.IsImageUnsupportedError(new Exception("该模型不支持图片输入")),
    "chinese 不支持图片 is recognised");
Check(ImageInputErrors.IsImageUnsupportedError(new Exception("当前模型不支持多模态")),
    "chinese 不支持多模态 is recognised");
Check(ImageInputErrors.IsImageUnsupportedError(new Exception("bad request", new Exception("image input is not supported"))),
    "marker found in inner exception is recognised");

// ── 二、ImageInputErrors：不许把无关 400 吞进来 ──
//
// 下面每一条都必须继续走 ProviderRetryPolicy 的重试（400 可重试是有意设计）。

Check(!ImageInputErrors.IsImageUnsupportedError(new Exception("The model `gpt-5` does not exist")),
    "model-not-found 400 stays out");
Check(!ImageInputErrors.IsImageUnsupportedError(new Exception("Incorrect API key provided")),
    "invalid api key 400 stays out");
Check(!ImageInputErrors.IsImageUnsupportedError(new Exception("context_length_exceeded")),
    "context length 400 stays out");
Check(!ImageInputErrors.IsImageUnsupportedError(new Exception("insufficient tool messages following tool_calls message")),
    "tool-pairing 400 stays out (owned by ToolPairingErrors)");
Check(!ImageInputErrors.IsImageUnsupportedError(new Exception("rate limit reached for requests")),
    "rate limit message stays out");
Check(!ImageInputErrors.IsImageUnsupportedError(new Exception("invalid_request_error: messages[0].role must be one of")),
    "generic schema 400 stays out");
Check(!ImageInputErrors.IsImageUnsupportedError(new Exception("An error occurred")),
    "vague message stays out");
Check(!ImageInputErrors.IsImageUnsupportedError(new Exception("")),
    "empty message stays out");

// 上游中转常把报错包一层，但「数据不足就别猜」同样适用于 inner 链

Check(!ImageInputErrors.IsImageUnsupportedError(new Exception("upstream failed", new Exception("connection reset"))),
    "unrelated inner exception stays out");

// ── 三、ImageVisionMemory：身份不全就不记 ──
//
// 一条不知道属于哪个渠道的记录，下次可能把能读图的模型记成瞎的。

Check(!ImageVisionMemory.IsKnownUnsupported(null, "gpt-5"), "null provider is never remembered");
Check(!ImageVisionMemory.IsKnownUnsupported("openai", null), "null model is never remembered");
Check(!ImageVisionMemory.IsKnownUnsupported("  ", "gpt-5"), "blank provider is never remembered");
Check(!ImageVisionMemory.IsKnownUnsupported("openai", "  "), "blank model is never remembered");
Check(ImageVisionMemory.GetRememberedAt(null, "gpt-5") is null, "null provider has no remembered timestamp");

ImageVisionMemory.RememberUnsupported(null, "gpt-5");
ImageVisionMemory.RememberUnsupported("openai", null);
Check(!ImageVisionMemory.IsKnownUnsupported(null, "gpt-5"), "remembering with null provider writes nothing");

// ── 四、ImageVisionMemory：记住 / 查回 / 不串号 ──

Check(!ImageVisionMemory.IsKnownUnsupported("openai", "gpt-4o"), "unknown pair starts as supported");

ImageVisionMemory.RememberUnsupported("openai", "gpt-4o");
Check(ImageVisionMemory.IsKnownUnsupported("openai", "gpt-4o"), "remembered pair is known unsupported");
Check(ImageVisionMemory.GetRememberedAt("openai", "gpt-4o") is not null, "remembered pair carries a timestamp");

// 同一 model 挂在另一个渠道下是另一条记录 —— 换个 provider 不许继承
Check(!ImageVisionMemory.IsKnownUnsupported("deepseek", "gpt-4o"), "memory does not leak across providers");
Check(!ImageVisionMemory.IsKnownUnsupported("openai", "gpt-4o-mini"), "memory does not leak across models");

// 大小写与空白按同一条处理（模型 id 在配置里被手抄过，别因此重撞 400）
Check(ImageVisionMemory.IsKnownUnsupported("OpenAI", "GPT-4o"), "lookup is case insensitive");
Check(ImageVisionMemory.IsKnownUnsupported(" openai ", " gpt-4o "), "lookup trims surrounding whitespace");

// 重复撞同一个不刷新时间：首次实测日期更有信息量
var firstSeen = ImageVisionMemory.GetRememberedAt("openai", "gpt-4o");
ImageVisionMemory.RememberUnsupported("openai", "gpt-4o");
Check(ImageVisionMemory.GetRememberedAt("openai", "gpt-4o") == firstSeen, "re-remembering keeps the first timestamp");

// ── 五、落盘：写在数据目录里，且是一份能被读回的 json ──

var memoryFile = Path.Combine(tempDataDir, "image-vision-unsupported.json");
Check(File.Exists(memoryFile), "memory file lands in the data directory");

if (File.Exists(memoryFile))
{
    var raw = File.ReadAllText(memoryFile);
    Check(raw.Contains("openai:gpt-4o", StringComparison.Ordinal), "persisted json contains the memory key");
    Check(!raw.Contains(":gpt-5", StringComparison.Ordinal), "persisted json has no half-identity entry");
}

Console.WriteLine($"passed: {passed}, failed: {failed}");

try
{
    Directory.Delete(tempDataDir, recursive: true);
}
catch (IOException)
{
    // 清理失败不影响结论
}

return failed == 0 ? 0 : 1;

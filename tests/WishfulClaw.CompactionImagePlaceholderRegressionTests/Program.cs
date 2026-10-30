// S-275 回归：压缩保留尾部时，把「大得离谱」的图片块换成占位文本。
//
// 这一条的两个方向都会出事，所以两边都得钉住：
//   · 该占的没占 —— 24 万字符的截图原样抬过 16384 的尾部预算，压完照样超阈值，
//                   下一轮立刻再压，50 分钟连压 9 次（S-275 现场）
//   · 不该占的占了 —— 模型看不见刚截的图，接下来所有基于图的操作全部瞎猜
// 所以下面既有「必须换掉」也有「一个字都不许动」。
//
// 还有一条只靠代码结构保证、必须靠断言钉死：**wire 侧和 conversation 侧成对**。
// 只改 conversation 侧等于自欺 —— ShouldCompress 读的是上游返回的真实 usage。
//
// 约定：失败断言打 FAIL，最后一行打 "passed: N, failed: M"，非零退出码表示失败
// （scripts/run-tests.mjs 按退出码判定，按 "passed: N" 取计数）。

using System;
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

JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement;

// 内插原始字符串里 JSON 的 `}}` 会和插值结束符打架，所以 base64 一律走占位替换。
string WithData(string raw, string data) => raw.Replace("__DATA__", data, StringComparison.Ordinal);

// 真实截图 base64 是 23~42 万字符；这里用 20000 就够越过 16384 的预算，
// 又不至于让测试跑得慢。
var bigData = new string('A', 20_000);
var smallData = new string('A', 1_000);

// text 里带 Windows 路径（`C:\Users\...`），拼进 JSON 必须走序列化 —— 手写反斜杠
// 会在 `\U` 上炸掉（JsonReaderException: 'U' is an invalid escapable character）。
JsonElement ToolResultContent(string text, string data) => Json(WithData("""
    [
      {"type":"text","text":__TEXT_JSON__},
      {"type":"image","source":{"type":"base64","mediaType":"image/png","data":"__DATA__"}}
    ]
    """, data).Replace("__TEXT_JSON__", JsonSerializer.Serialize(text), StringComparison.Ordinal));

AgentRuntimeChatMessage ToolResultMessage(string toolUseId, JsonElement content) =>
    AgentRuntimeChatMessage.UserToolResults([new AgentRuntimeToolResult(toolUseId, content, null)]);

var budget = 16_384;

// ── 一、该占的必须占 ──

var bigContent = ToolResultContent("Saved to C:\\Users\\me\\.wishful-claw\\screenshots\\2026-10\\abc.png.", bigData);
var bigMessage = ToolResultMessage("toolu_big", bigContent);

Check(ContextCompression.EstimateMessageTokens(bigMessage) > budget,
    "S-275 setup: a 20k-char screenshot is over the tail budget");

var placed = ContextCompression.PlaceholdOversizedImageResults(bigMessage, budget);

Check(!ReferenceEquals(placed, bigMessage),
    "S-275: an over-budget tool result is rebuilt");

Check(ContextCompression.EstimateMessageTokens(placed) <= budget,
    "S-275: the placeholder brings the message back under budget");

var placedBlocks = placed.ToolResults[0].Content;
Check(placedBlocks.ValueKind == JsonValueKind.Array && placedBlocks.GetArrayLength() == 2,
    "S-275: block count is unchanged, the image is replaced in place");

Check(placedBlocks[0].GetProperty("type").GetString() == "text" &&
      placedBlocks[0].GetProperty("text").GetString() == "Saved to C:\\Users\\me\\.wishful-claw\\screenshots\\2026-10\\abc.png.",
    "S-275: the original text block stays first and untouched");

var placeholderText = placedBlocks[1].GetProperty("text").GetString() ?? "";
Check(placedBlocks[1].GetProperty("type").GetString() == "text" &&
      placeholderText.StartsWith(ContextCompression.ImagePlaceholderPrefix, StringComparison.Ordinal),
    "S-275: the image block becomes a text placeholder");

Check(placeholderText.Contains("19 KB", StringComparison.Ordinal),
    "S-275: the placeholder names the removed size (20000/1024 = 19 KB)");

Check(placeholderText.Contains("重新 Read", StringComparison.Ordinal),
    "S-275: the placeholder tells the model how to get the image back");

// 占位化之后不许留下任何 base64 —— 一个字符漏网就等于没修。
Check(!placedBlocks.GetRawText().Contains(bigData.Substring(0, 256), StringComparison.Ordinal),
    "S-275: not a single byte of the base64 survives");

// ── 二、不该占的不许动 ──

var smallMessage = ToolResultMessage("toolu_small", ToolResultContent("Saved to C:\\small.png.", smallData));
Check(ReferenceEquals(ContextCompression.PlaceholdOversizedImageResults(smallMessage, budget), smallMessage),
    "S-275: an under-budget screenshot is left alone");

var textOnly = AgentRuntimeChatMessage.User("just talking");
Check(ReferenceEquals(ContextCompression.PlaceholdOversizedImageResults(textOnly, budget), textOnly),
    "S-275: a message without tool results is returned by reference");

var textOnlyResult = ToolResultMessage("toolu_txt", Json("""[{"type":"text","text":"done"}]"""));
Check(ReferenceEquals(ContextCompression.PlaceholdOversizedImageResults(textOnlyResult, budget), textOnlyResult),
    "S-275: an over-budget result with no image is left alone (the fix is not a truncator)");

// ── 三、幂等 ──
// 压缩会连着触发（S-275 现场就是 9 次），第二次跑到的尾部可能已经占位过。

var placedAgain = ContextCompression.PlaceholdOversizedImageResults(placed, budget);
Check(ReferenceEquals(placedAgain, placed),
    "S-275: running the placeholder twice changes nothing");

var (sameContent, sameChanged) = ContextCompression.PlaceholdImageBlocks(placedBlocks);
Check(!sameChanged && sameContent.GetRawText() == placedBlocks.GetRawText(),
    "S-275: PlaceholdImageBlocks is idempotent at the block level");

// ── 四、多图 ──

var twoImages = Json(WithData("""
    [
      {"type":"text","text":"two shots"},
      {"type":"image","source":{"type":"base64","mediaType":"image/png","data":"__DATA__"}},
      {"type":"image","source":{"type":"base64","mediaType":"image/png","data":"__DATA__"}}
    ]
    """, bigData));
var twoPlaced = ContextCompression.PlaceholdOversizedImageResults(
    ToolResultMessage("toolu_two", twoImages), budget);
Check(twoPlaced.ToolResults[0].Content.GetArrayLength() == 3,
    "S-275: two images become two placeholders, count preserved");
Check(twoPlaced.ToolResults[0].Content[1].GetProperty("type").GetString() == "text" &&
      twoPlaced.ToolResults[0].Content[2].GetProperty("type").GetString() == "text",
    "S-275: both images are replaced, order preserved");

// ── 五、wire 侧：真正决定上游 token 的那一层 ──

var wire = Json(WithData("""
    {
      "id":"w-1",
      "role":"user",
      "content":[
        {"type":"tool_result","toolUseId":"toolu_big","content":[
          {"type":"text","text":"Saved to C:\\shot.png."},
          {"type":"image","source":{"type":"base64","mediaType":"image/png","data":"__DATA__"}}
        ],"isError":false}
      ],
      "createdAt":1750000000000,
      "meta":{"kept":"yes"}
    }
    """, bigData));

var placedWire = ContextCompression.PlaceholdWireMessageImages(wire);

Check(placedWire.GetProperty("id").GetString() == "w-1" &&
      placedWire.GetProperty("role").GetString() == "user" &&
      placedWire.GetProperty("createdAt").GetInt64() == 1_750_000_000_000 &&
      placedWire.GetProperty("meta").GetProperty("kept").GetString() == "yes",
    "S-275 wire: every top-level field survives the rewrite");

Check(placedWire.GetProperty("content")[0].GetProperty("toolUseId").GetString() == "toolu_big" &&
      placedWire.GetProperty("content")[0].GetProperty("isError").GetBoolean() == false,
    "S-275 wire: tool_result sibling fields survive");

Check(placedWire.GetProperty("content")[0].GetProperty("content")[1].GetProperty("type").GetString() == "text",
    "S-275 wire: the image block is replaced on the wire too");

Check(!placedWire.GetRawText().Contains(bigData.Substring(0, 256), StringComparison.Ordinal),
    "S-275 wire: no base64 survives into the request body");

// 用户自己发的图不在本条范围内（S-275 §六 方案 C）：它是用户意图，
// 而且频率低，占位化它属于另一条线。
var userImageWire = Json(WithData("""
    {"id":"w-2","role":"user","content":[
      {"type":"text","text":"看看这个"},
      {"type":"image","source":{"type":"base64","mediaType":"image/png","data":"__DATA__"}}
    ],"createdAt":1}
    """, bigData));
// JsonElement 是 struct，ReferenceEquals 比的是装箱后的引用（永远 false），
// 所以 wire 侧「没动」只能按原始文本判 —— 内容一字不差才算没改。
Check(ContextCompression.PlaceholdWireMessageImages(userImageWire).GetRawText() == userImageWire.GetRawText(),
    "S-275 wire: a user-uploaded image is out of scope and left byte-identical");

var cleanWire = Json("""{"id":"w-3","role":"user","content":[{"type":"text","text":"hi"}],"createdAt":1}""");
Check(ContextCompression.PlaceholdWireMessageImages(cleanWire).GetRawText() == cleanWire.GetRawText(),
    "S-275 wire: a message without images comes back byte-identical");

// ── 六、尾部预算：两个调用点必须读同一个数 ──

Check(ContextCompression.TailBudgetTokens(Json("""{"contextLength":200000}""")) == 16_384,
    "S-275 budget: a large window is capped by DefaultTailTokens");

Check(ContextCompression.TailBudgetTokens(Json("""{"contextLength":20000}""")) == 10_000,
    "S-275 budget: a small window halves");

Check(ContextCompression.TailBudgetTokens(Json("""{"contextLength":0}""")) == 16_384,
    "S-275 budget: contextLength=0 falls back to DefaultTailTokens");

Check(ContextCompression.TailBudgetTokens(Json("""{"model":"x"}""")) == 16_384,
    "S-275 budget: a provider without contextLength uses the default window");

Console.WriteLine($"passed: {passed}, failed: {failed}");
return failed == 0 ? 0 : 1;

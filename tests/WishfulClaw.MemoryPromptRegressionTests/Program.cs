// S-313(b) / S-314 回归：热记忆默认只给指针，全文注入作为回退口子。
//
// 这里要钉死的是三件事，任何一件松了都会静默退化成「白占预算还过期」：
//   1) 默认模式提示里**没有**记忆正文，只有一行路径指针；
//   2) 记忆变了，指针模式的提示字节**一个都不许动** —— 否则前缀缓存失效，
//      改这条需求就白改了；
//   3) cacheKey：指针模式不随 MEMORY.md 变，全文模式必须随它变
//      （S-314 的原始缺陷就是全文模式下 key 里压根没有 MEMORY.md，跨会话永远旧快照）。
//
// 用 project scope 指向临时目录，不碰真实数据目录。

using System;
using System.IO;
using System.Text;
using System.Text.Json;
using WishfulClaw.Agent;
using WishfulClaw.Infrastructure.Storage;
using WishfulClaw.Persona;

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

JsonElement Params(string workingFolder, bool fullInjection = false) =>
    JsonDocument.Parse(
        JsonSerializer.Serialize(new { workingFolder, memoryFullInjection = fullInjection }))
        .RootElement.Clone();

var root = Path.Combine(Path.GetTempPath(), "wc-mem-" + Guid.NewGuid().ToString("N"));

try
{
    var memPath = Path.Combine(WishfulClawDataDir.ProjectRoot(root), "MEMORY.md");
    Directory.CreateDirectory(Path.GetDirectoryName(memPath)!);
    File.WriteAllText(
        memPath,
        "# 热记忆\n\n## 独有标记\nMEMORY-BODY-MARKER\n",
        new UTF8Encoding(false));

    var pointerParams = Params(root);
    var fullParams = Params(root, fullInjection: true);

    // ── 默认（指针）模式 ──
    var pointerPrompt = PromptBuilder.Build(PromptProfile.Main, null, pointerParams, null, root, null, null);
    Check(pointerPrompt.Contains("<memory-path scope=\"project:"), "default mode emits a memory pointer block");
    Check(pointerPrompt.Contains(memPath), "the pointer carries the real MEMORY.md path");
    Check(!pointerPrompt.Contains("MEMORY-BODY-MARKER"), "default mode does NOT inline the memory body");
    Check(!pointerPrompt.Contains("<memory scope="), "default mode no longer emits the full-injection block");

    // ── 回退口子：memoryFullInjection = true ──
    var fullPrompt = PromptBuilder.Build(PromptProfile.Main, null, fullParams, null, root, null, null);
    Check(fullPrompt.Contains("MEMORY-BODY-MARKER"), "fallback mode still inlines the memory body");
    Check(fullPrompt.Contains("<memory scope="), "fallback mode keeps the original memory block");
    Check(!fullPrompt.Contains("<memory-path scope="), "fallback mode does not also emit the pointer");

    // ── 核心收益：记忆变了，指针模式的提示字节不动 ──
    // 这一条一旦失效，等于每次热写都打掉提供商的前缀缓存。
    File.AppendAllText(memPath, "\n## 后来加的\nMEMORY-BODY-MARKER-2\n", new UTF8Encoding(false));
    File.SetLastWriteTimeUtc(memPath, DateTime.UtcNow.AddMinutes(5));

    var pointerPrompt2 = PromptBuilder.Build(PromptProfile.Main, null, pointerParams, null, root, null, null);
    Check(pointerPrompt2 == pointerPrompt, "pointer-mode prompt is byte-identical after a memory write");
    Check(!pointerPrompt2.Contains("MEMORY-BODY-MARKER-2"), "the new entry is not inlined either");

    var fullPrompt2 = PromptBuilder.Build(PromptProfile.Main, null, fullParams, null, root, null, null);
    Check(fullPrompt2.Contains("MEMORY-BODY-MARKER-2"), "fallback mode picks up the new entry on rebuild");

    // ── cacheKey 敏感性 ──
    var mtime = File.GetLastWriteTimeUtc(memPath);
    var keyPointer = SystemPromptCache.ComputeKey(
        null, root, null, null, null, null, null, null, null, sandboxEnabled: true, memoryFullInjection: false);
    var keyFull = SystemPromptCache.ComputeKey(
        null, root, null, null, null, null, null, null, null, sandboxEnabled: true, memoryFullInjection: true);
    Check(keyPointer != keyFull, "the two modes never share a cache key");

    File.SetLastWriteTimeUtc(memPath, mtime.AddMinutes(5));
    var keyPointerAfter = SystemPromptCache.ComputeKey(
        null, root, null, null, null, null, null, null, null, sandboxEnabled: true, memoryFullInjection: false);
    var keyFullAfter = SystemPromptCache.ComputeKey(
        null, root, null, null, null, null, null, null, null, sandboxEnabled: true, memoryFullInjection: true);
    Check(keyPointerAfter == keyPointer, "pointer-mode key ignores MEMORY.md mtime (content is not in the prompt)");
    Check(keyFullAfter != keyFull, "fallback-mode key follows MEMORY.md mtime (this is the S-314 fix)");

    // ── 没有 MEMORY.md 的项目：两种模式都不该凭空造出一个块 ──
    var bare = Path.Combine(root, "裸项目");
    Directory.CreateDirectory(bare);
    var barePointer = PromptBuilder.Build(PromptProfile.Main, null, Params(bare), null, bare, null, null);
    Check(!barePointer.Contains("<memory-path"), "no MEMORY.md on disk, no pointer");
    var bareFull = PromptBuilder.Build(PromptProfile.Main, null, Params(bare, true), null, bare, null, null);
    Check(!bareFull.Contains("<memory scope="), "no MEMORY.md on disk, no memory block");
}
finally
{
    try
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }
    catch
    {
        // 临时目录清理失败不影响判定。
    }
}

Console.WriteLine($"memory-prompt: passed: {passed}, failed: {failed}");
return failed == 0 ? 0 : 1;

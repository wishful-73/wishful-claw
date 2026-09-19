using WishfulClaw.Agent.Tools.MemoryTools;

namespace WishfulClaw.GoalRegressionTests;

/// <summary>
/// iter-32 S-86 —— memory_hot_write 的节标题匹配与删除边界。
///
/// 三处缺陷都出在「节标题」这一层，所以只测纯函数（UpsertSection / DeleteSection /
/// FindSectionHeadings），不碰文件系统 —— 落盘那一层 S-80 已单独盖过。
///
/// 修之前（当时是 `content.IndexOf("## " + title)`）这组断言必然全红：
///   1. 裸子串查找，**无行首校验** —— `### 协作纪律` 会被当成 `## 协作纪律` 命中，
///      内容被静默写进三级标题底下；
///   2. `IndexOf` 只取第一个命中 —— 标题重复时只改一份，另一份连标题整块留着；
///   3. DeleteSection **向前无下限地吃换行** —— 连 H1 与首个 H2 之间的分隔空行一起吃掉，
///      文件头变成同一行的 `# Long-Term Memory## 协作纪律`，markdown 不再识别为标题。
/// </summary>
internal static partial class Program
{
    private static void RunMemoryHotWriteSuite()
    {
        // ── 1. 行首校验：`### A` 不是 `## A` ───────────────────────────────
        // 三级标题刻意放在 `## B` 节内部：它既不能被命中，也不能被当成 A 节的一部分删掉。
        var withH3 = "# T\n\n## A\nold-body\n\n## B\nkeep-b\n\n### A\nnested\n";
        var upserted = MemoryHotWriteTool.UpsertSection(withH3, "A", "NEW");

        Assert(upserted.Contains("## A\nNEW\n"), "S-86 二级标题被更新");
        Assert(upserted.Contains("### A\nnested"), "S-86 三级标题不被命中、不被误删");
        Assert(!upserted.Contains("old-body"), "S-86 旧正文被替换");
        AssertEqual(1, MemoryHotWriteTool.FindSectionHeadings(withH3, "A").Count,
            "S-86 同名三级标题不计入命中");

        // ── 2. 正文里出现的 `## A` 不是标题（非行首） ─────────────────────
        var inlineMarker = "# T\n\n## B\n前言 ## A 后语\n";
        var appended = MemoryHotWriteTool.UpsertSection(inlineMarker, "A", "NEW");

        Assert(appended.Contains("## B\n前言 ## A 后语"), "S-86 行内出现的标记不被当成标题");
        Assert(appended.TrimEnd().EndsWith("## A\nNEW"), "S-86 行内标记走新增分支（追加到文末）");

        // ── 3. 标题整行相等：`## 协作纪律规则` 不是 `## 协作纪律` ─────────
        var longerTitle = "# T\n\n## 协作纪律规则\nkeep-b\n";
        var notMatched = MemoryHotWriteTool.UpsertSection(longerTitle, "协作纪律", "NEW");

        Assert(notMatched.Contains("## 协作纪律规则\nkeep-b"), "S-86 更长标题不被短标题命中");
        AssertEqual(0, MemoryHotWriteTool.FindSectionHeadings(longerTitle, "协作纪律").Count,
            "S-86 标题必须整行相等");

        // ── 4. 标题重复：第一处替换，其余整节删除 ─────────────────────────
        var duplicated = "# T\n\n## A\nfirst\n\n## B\nkeep-b\n\n## A\nsecond\n";
        var deduped = MemoryHotWriteTool.UpsertSection(duplicated, "A", "NEW");

        AssertEqual(1, CountSubstring(deduped, "## A"), "S-86 重复标题归一成一份");
        Assert(deduped.Contains("## A\nNEW\n"), "S-86 第一处被替换");
        Assert(!deduped.Contains("second"), "S-86 第二处整节删除");
        Assert(deduped.Contains("## B\nkeep-b"), "S-86 中间那节没被误删");

        // ── 5. 删除：保留 H1 与下一个 H2 之间的分隔空行 ──────────────────
        var toDelete = "# Long-Term Memory\n\n## A\nold-body\n\n## B\nkeep-b\n";
        var (afterDelete, found) = MemoryHotWriteTool.DeleteSection(toDelete, "A");

        AssertEqual(true, found, "S-86 存在的节删除返回 found=true");
        Assert(!afterDelete.StartsWith("# Long-Term Memory##"), "S-86 删除后不产生标题粘连");
        Assert(afterDelete.StartsWith("# Long-Term Memory\n\n## B"), "S-86 H1 与下一个 H2 之间保留空行");
        Assert(!afterDelete.Contains("old-body"), "S-86 被删节的正文一并移除");

        // ── 6. 删除末节 / 不存在的节 ─────────────────────────────────────
        var (afterTailDelete, tailFound) = MemoryHotWriteTool.DeleteSection("# T\n\n## A\nold-body\n", "A");
        AssertEqual(true, tailFound, "S-86 末节删除返回 found=true");
        AssertEqual("# T\n\n", afterTailDelete, "S-86 末节删完只剩 H1 与空行分隔");

        var (untouched, missingFound) = MemoryHotWriteTool.DeleteSection("# T\n\n## A\nold-body\n", "Nope");
        AssertEqual(false, missingFound, "S-86 不存在的节返回 found=false");
        AssertEqual("# T\n\n## A\nold-body\n", untouched, "S-86 不存在的节不动原文");

        // ── 7. 删除重复标题：全删 ────────────────────────────────────────
        var (afterDupDelete, dupFound) = MemoryHotWriteTool.DeleteSection(
            "# T\n\n## A\none\n\n## A\ntwo\n\n## B\nkeep-b\n", "A");

        AssertEqual(true, dupFound, "S-86 重复标题删除返回 found=true");
        AssertEqual(0, CountSubstring(afterDupDelete, "## A"), "S-86 重复标题被全部删除");
        Assert(afterDupDelete.Contains("## B\nkeep-b"), "S-86 后面那节保留");

        // ── 8. 写两次不繁殖：新增后再写同一节，仍是单份 ──────────────────
        var once = MemoryHotWriteTool.UpsertSection("# Long-Term Memory\n", "X", "1");
        var twice = MemoryHotWriteTool.UpsertSection(once, "X", "2");

        AssertEqual(1, CountSubstring(twice, "## X"), "S-86 连续写同一节不会繁殖标题");
        Assert(twice.Contains("## X\n2\n"), "S-86 第二次写入生效");
        Assert(!twice.Contains("\n1\n"), "S-86 旧正文已被覆盖");

        // ── 9. 标题大小写与行尾空格容错 ──────────────────────────────────
        AssertEqual(1, MemoryHotWriteTool.FindSectionHeadings("# T\n\n## Todo\nx\n", "todo").Count,
            "S-86 标题匹配大小写不敏感");
        AssertEqual(1, MemoryHotWriteTool.FindSectionHeadings("# T\n\n## A   \nbody\n", "A").Count,
            "S-86 标题行尾随空格不影响匹配");
    }

    /// <summary>数 substring 出现次数（大小写敏感，仅本套断言内部使用）。</summary>
    private static int CountSubstring(string content, string substring)
    {
        var count = 0;
        var index = 0;
        while ((index = content.IndexOf(substring, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += substring.Length;
        }

        return count;
    }
}

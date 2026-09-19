using System.Text;
using System.Text.Json;
using WishfulClaw.Core.Tools;
using WishfulClaw.Workspace.Memory;

namespace WishfulClaw.Agent.Tools.MemoryTools;

using WishfulClaw.Agent;
using static WishfulClaw.Agent.Tools.ToolHelpers;

/// <summary>
/// Write, update, or delete a section in hot memory (MEMORY.md).
/// The file path is resolved internally; the agent does not need to know it.
/// Bottom layer is plain file read + string replace + file write.
/// </summary>
public sealed class MemoryHotWriteTool : IToolExecutor
{
    public string Name => "memory_hot_write";

    public string Description =>
        "Write, update, or delete a section in hot memory (MEMORY.md). " +
        "Existing section titles are replaced in place; new sections are appended; empty content deletes the section. " +
        "Use for important context that should always be loaded.";

    public string[]? VisibleScopes => ToolVisibilityScopes.GlobalSideAndWorkRuns;

    public bool IsCore => true;

    public JsonElement InputSchema { get; } = ParseSchema(
        """{"type":"object","properties":{"section":{"type":"string","description":"Section title (the ## heading in MEMORY.md)"},"content":{"type":"string","description":"Markdown content for the section. Empty string to delete the section."}},"required":["section"]}""");

    public async Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)
    {
        var section = GetString(input, "section");
        if (string.IsNullOrWhiteSpace(section))
            return new ToolResult("memory_hot_write requires a non-empty 'section' parameter", true);

        var content = GetString(input, "content");
        var scope = MemoryToolHelpers.ResolveScope(context);
        var path = MemoryPathResolver.GetMemoryFilePath(scope);

        // Ensure file exists
        if (!File.Exists(path))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            // 不带 Encoding 参数 = 无 BOM（iter-32 S-80），与 WriteAndFlushAsync 的写法保持一致。
            await File.WriteAllTextAsync(path, "# Long-Term Memory\n", context.CancellationToken);
        }

        var fileContent = await File.ReadAllTextAsync(path, Encoding.UTF8, context.CancellationToken);

        // 历史粘连文件的兜底。iter-32 S-86 把「删节吃空行」的缺陷 3 修掉之后，粘连不再新产生，
        // 但存量文件里可能已经有了，所以这一段继续留着。
        fileContent = NormalizeGluedHeadings(fileContent);

        if (string.IsNullOrWhiteSpace(content))
        {
            // Delete section
            var (updated, found) = DeleteSection(fileContent, section!);
            if (!found)
                return new ToolResult($"Section '{section}' not found in hot memory (scope={scope}).", true);

            await WriteAndFlushAsync(path, updated, context.CancellationToken);
            MemoryUpdateQueue.Enqueue(context.SessionId ?? "",
                $"Hot memory section '{section}' was deleted (scope={scope}). Disregard its content still shown in the cached memory until next session.");
            return new ToolResult($"Section '{section}' deleted from hot memory (scope={scope}).");
        }

        // Upsert section
        fileContent = UpsertSection(fileContent, section!, content!);
        await WriteAndFlushAsync(path, fileContent, context.CancellationToken);
        MemoryUpdateQueue.Enqueue(context.SessionId ?? "",
            $"Hot memory section '{section}' was written/updated (scope={scope}). Current content:\n{content!.Trim()}");
        return new ToolResult($"Section '{section}' written to hot memory (scope={scope}).");
    }

    /// <summary>
    /// 找到「## {title}」这个二级标题的**全部**出现位置。返回空列表 = 没这个节。
    ///
    /// 三条判据缺一不可。缺第 1 条就是 iter-32 S-86 的缺陷 1（2026-09-19 实际踩到）：
    ///   1. **行首** —— 裸子串查找会让 `### 协作纪律` 命中 `## 协作纪律`（从下标 1 开始），
    ///      于是内容被写进三级标题底下，而且整个过程是静默的。
    ///   2. **前缀恰为 `## `** —— `###` 因第三个字符是 `#` 而非空格，被天然排除。
    ///   3. **标题文本整行相等**（大小写不敏感，尾随空格与 `\r` 先 trim）——
    ///      否则 `## 协作纪律` 会命中 `## 协作纪律规则`。
    ///
    /// 返回全部命中而不是第一个：标题重复时只改一份是 S-86 的缺陷 2。
    /// </summary>
    internal static List<int> FindSectionHeadings(string content, string title)
    {
        var found = new List<int>();
        var wanted = title.Trim();

        for (var i = 0; i + 3 <= content.Length; i++)
        {
            if (content[i] != '#' || content[i + 1] != '#' || content[i + 2] != ' ')
                continue;

            if (i != 0 && content[i - 1] != '\n')
                continue;

            var lineEnd = FindLineEnd(content, i);
            var lineTitle = content[(i + 3)..lineEnd].TrimEnd('\r', ' ');
            if (!string.Equals(lineTitle, wanted, StringComparison.OrdinalIgnoreCase))
                continue;

            found.Add(i);
        }

        return found;
    }

    /// <summary>
    /// 插入或更新一个节：新增的追加到文末，已存在的替换正文。
    ///
    /// **标题重复时（脏数据）第一处替换、其余整节删除** —— 静默只改一份比报错更糟，
    /// 用户根本看不到；全部清掉能让文件回到单份标题（S-86 缺陷 2）。
    /// </summary>
    internal static string UpsertSection(string content, string title, string body)
    {
        var hits = FindSectionHeadings(content, title);

        if (hits.Count == 0)
            return content.TrimEnd() + $"\n\n## {title.Trim()}\n{body.Trim()}\n";

        // 倒序删重复项：删掉的都在第一处**之后**，所以 hits[0] 的下标不会失效。
        for (var i = hits.Count - 1; i >= 1; i--)
            content = RemoveSectionAt(content, hits[i]);

        var headingIndex = hits[0];
        var headingLineEnd = FindLineEnd(content, headingIndex);
        var nextHeading = FindNextHeading(content, headingLineEnd);
        var before = content[..headingIndex] + $"## {title.Trim()}";
        var after = nextHeading >= 0 ? content[nextHeading..] : "";

        return $"{before}\n{body.Trim()}\n{after}";
    }

    /// <summary>
    /// 删除一个节。标题重复时**全部**删掉（理由同 UpsertSection）。
    /// </summary>
    internal static (string result, bool found) DeleteSection(string content, string title)
    {
        var hits = FindSectionHeadings(content, title);
        if (hits.Count == 0) return (content, false);

        for (var i = hits.Count - 1; i >= 0; i--)
            content = RemoveSectionAt(content, hits[i]);

        return (content, true);
    }

    /// <summary>
    /// 从给定标题行行首删到下一个二级标题行行首（或文件末尾）。
    ///
    /// **绝不从标题行向前吃空行** —— 那是 S-86 的缺陷 3：它会把 H1 与首个 H2 之间的
    /// 分隔空行一并吃掉，文件头变成 `# Long-Term Memory## 协作纪律`（同一行，markdown
    /// 不再识别为标题）。标题本来就在行首，所以直接用下标当起点；分隔空行自然留在
    /// **前一节**那一边。
    /// </summary>
    private static string RemoveSectionAt(string content, int headingStart)
    {
        var nextHeading = FindNextHeading(content, headingStart + 3);
        return nextHeading >= 0
            ? content[..headingStart] + content[nextHeading..]
            : content[..headingStart];
    }

    /// <summary>
    /// lineStart 起这一行的末尾换行符位置；最后一行没有换行符时返回 content.Length。
    /// </summary>
    private static int FindLineEnd(string content, int lineStart)
    {
        var index = content.IndexOf('\n', lineStart);
        return index < 0 ? content.Length : index;
    }

    /// <summary>
    /// Find the next "## " heading at line start, starting from the given index.
    /// Returns -1 if not found.
    /// </summary>
    internal static int FindNextHeading(string content, int startFrom)
    {
        for (var i = startFrom; i < content.Length; i++)
        {
            // Check for "## " at line start (preceded by newline or start of string)
            if (content[i] == '#' && i + 2 < content.Length && content[i + 1] == '#' && content[i + 2] == ' ')
            {
                // Must be at line start
                if (i == 0 || content[i - 1] == '\n')
                    return i;
            }
        }

        return -1;
    }

    /// <summary>
    /// Fix glued headings: "# Title## Section" → "# Title\n## Section".
    /// Only matches ## not ### or deeper.
    /// </summary>
    private static string NormalizeGluedHeadings(string content)
    {
        var sb = new StringBuilder(content.Length + 16);
        for (var i = 0; i < content.Length; i++)
        {
            // Look for "## " not preceded by newline and not part of "###"
            if (content[i] == '#' && i + 2 < content.Length && content[i + 1] == '#' && content[i + 2] == ' ')
            {
                var atLineStart = i == 0 || content[i - 1] == '\n';
                var partOfDeeper = i > 0 && content[i - 1] == '#';

                if (!atLineStart && !partOfDeeper)
                    sb.Append('\n');
            }

            sb.Append(content[i]);
        }

        return sb.ToString();
    }
}

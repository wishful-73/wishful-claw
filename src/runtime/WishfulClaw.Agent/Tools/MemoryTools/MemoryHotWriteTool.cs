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

            await File.WriteAllTextAsync(path, "# Long-Term Memory\n", Encoding.UTF8, context.CancellationToken);

        }



        var fileContent = await File.ReadAllTextAsync(path, Encoding.UTF8, context.CancellationToken);



        // Normalize: fix glued headings like "# Title## Section" → "# Title\n## Section"

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

    /// Simple string-based upsert: find "## {title}" heading, replace its body;

    /// if not found, append a new section at the end.

    /// </summary>

    private static string UpsertSection(string content, string title, string body)

    {

        var heading = $"## {title}";

        var idx = content.IndexOf(heading, StringComparison.OrdinalIgnoreCase);



        if (idx >= 0)

        {

            // Find the end of this section: next "## " at line start, or end of file

            var bodyStart = idx + heading.Length;

            var nextHeading = FindNextHeading(content, bodyStart);

            var before = content[..bodyStart];

            var after = nextHeading >= 0 ? content[nextHeading..] : "";

            return $"{before}\n{body.Trim()}\n{after}";

        }



        // Append new section

        var newSection = $"\n\n## {title}\n{body.Trim()}\n";

        return content.TrimEnd() + newSection;

    }



    /// <summary>

    /// Simple string-based delete: find "## {title}" heading, remove heading + body.

    /// </summary>

    private static (string result, bool found) DeleteSection(string content, string title)

    {

        var heading = $"## {title}";

        var idx = content.IndexOf(heading, StringComparison.OrdinalIgnoreCase);



        if (idx < 0) return (content, false);



        var nextHeading = FindNextHeading(content, idx + heading.Length);



        // Extend start backward to remove preceding newlines

        var start = idx;

        while (start > 0 && (content[start - 1] == '\n' || content[start - 1] == '\r'))

            start--;



        var end = nextHeading >= 0 ? nextHeading : content.Length;



        return (content[..start] + content[end..], true);

    }



    /// <summary>

    /// Find the next "## " heading at line start, starting from the given index.

    /// Returns -1 if not found.

    /// </summary>

    private static int FindNextHeading(string content, int startFrom)

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

                {

                    sb.Append('\n');

                }

            }

            sb.Append(content[i]);

        }

        return sb.ToString();

    }

}


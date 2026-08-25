using System.Diagnostics;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphAstroExtractor — bespoke embedded extractor for Astro component files
// (port of extraction/astro-extractor.ts). NO Astro grammar: an .astro file is
// multi-language — a TypeScript frontmatter block fenced by `---` lines, a JSX-like
// template, and optional <script>/<style> blocks. The frontmatter and <script>
// regions are carved by regex and delegated to the TS CodeGraphTreeSitterExtractor
// via CodeGraphSfcScriptRunner (Astro processes both as TypeScript by default), whose
// results are offset back to full-SFC coordinates.
//
// Emits: one `component` node for the file (Astro components are always importable),
// the delegated frontmatter/<script> symbols, template function-call refs
// (`{fn(...)}`) and template component-usage refs (`<PascalCase>`), skipping Astro
// built-ins (<Fragment>, <Code>, <Debug>).
//
// GLOBAL namespace, all-internal, reflection-free/AOT; [GeneratedRegex] fixed patterns.
// =============================================================================
internal sealed partial class CodeGraphAstroExtractor
{
    private const string Extension = ".astro";

    // Astro built-in components — compiler-provided (<Fragment>) or from astro:components.
    private static readonly HashSet<string> AstroBuiltinComponents = new(StringComparer.Ordinal)
    {
        "Fragment", "Code", "Debug"
    };

    private readonly string filePath;
    private readonly string source;
    private readonly CodeGraphGrammarRegistry registry;
    private readonly List<CodeGraphNode> nodes = new();
    private readonly List<CodeGraphEdge> edges = new();
    private readonly List<CodeGraphUnresolvedReference> unresolvedReferences = new();
    private readonly List<CodeGraphExtractionError> errors = new();

    private CodeGraphAstroExtractor(string filePath, string content, CodeGraphGrammarRegistry registry)
    {
        this.filePath = filePath;
        this.source = content;
        this.registry = registry;
    }

    public static CodeGraphExtractionResult ExtractFromSource(
        string filePath, string content, CodeGraphGrammarRegistry registry) =>
        new CodeGraphAstroExtractor(filePath, content, registry).Extract();

    private CodeGraphExtractionResult Extract()
    {
        Stopwatch sw = Stopwatch.StartNew();

        try
        {
            CodeGraphNode componentNode = CodeGraphSfcScriptRunner.ComponentNode(
                filePath, source, Extension, CodeGraphLanguage.Astro);
            nodes.Add(componentNode);

            // Frontmatter (--- fenced, TypeScript). Its content has no leading newline,
            // so its 0-indexed startLine is the line the content itself begins on.
            Frontmatter? frontmatter = ExtractFrontmatter();
            if (frontmatter is { } fm)
            {
                RunScript(fm.Content, fm.StartLine, componentNode.Id);
            }

            // <script> blocks (client-side, TypeScript-capable).
            foreach (ScriptBlock block in ExtractScriptBlocks())
            {
                RunScript(block.Content, block.StartLine, componentNode.Id);
            }

            List<(int Start, int End)> covered = CoveredRanges(frontmatter);
            ExtractTemplateCalls(componentNode.Id, covered);
            ExtractTemplateComponents(componentNode.Id, covered);
        }
        catch (Exception ex)
        {
            errors.Add(new CodeGraphExtractionError(
                $"Astro extraction error: {ex.Message}", "error", filePath, null, null, "parse_error"));
        }

        return new CodeGraphExtractionResult(nodes, edges, unresolvedReferences, errors, sw.Elapsed.TotalMilliseconds);
    }

    // Astro treats both frontmatter and <script> as TypeScript by default.
    private void RunScript(string content, int blockStartLine, string componentNodeId) =>
        CodeGraphSfcScriptRunner.RunScript(
            filePath, content, CodeGraphLanguage.TypeScript, blockStartLine,
            CodeGraphLanguage.Astro, componentNodeId, registry,
            nodes, edges, unresolvedReferences, errors);

    private readonly record struct Frontmatter(string Content, int StartLine, int EndLine);

    private readonly record struct ScriptBlock(string Content, int StartLine);

    // The frontmatter block: content between the opening `---` fence (first non-blank
    // line of the file) and the closing `---` fence. An unclosed fence is treated as
    // "no frontmatter" rather than swallowing the whole template as TypeScript.
    private Frontmatter? ExtractFrontmatter()
    {
        string[] lines = source.Split('\n');

        int openIdx = -1;
        for (int i = 0; i < lines.Length; i++)
        {
            string trimmed = lines[i].Trim();
            if (trimmed.Length == 0)
            {
                continue;
            }

            if (trimmed == "---")
            {
                openIdx = i;
            }

            break;
        }

        if (openIdx == -1)
        {
            return null;
        }

        int closeIdx = -1;
        for (int i = openIdx + 1; i < lines.Length; i++)
        {
            if (lines[i].Trim() == "---")
            {
                closeIdx = i;
                break;
            }
        }

        if (closeIdx == -1)
        {
            return null;
        }

        string content = string.Join('\n', lines[(openIdx + 1)..closeIdx]);
        return new Frontmatter(content, openIdx + 1, closeIdx);
    }

    // <script> blocks from the template portion. Content starts right after the opening
    // tag's `>`; its leading `\n` is part of the content (contentStartLine = tagLine +
    // openingTagLines).
    private List<ScriptBlock> ExtractScriptBlocks()
    {
        var blocks = new List<ScriptBlock>();
        foreach (Match match in ScriptRegex().Matches(source))
        {
            string content = match.Groups["content"].Value;
            int scriptTagLine = CodeGraphSfcScriptRunner.CountNewlines(source, match.Index);
            int gt = match.Value.IndexOf('>');
            string openingTag = gt >= 0 ? match.Value[..(gt + 1)] : match.Value;
            int openingTagLines = CodeGraphSfcScriptRunner.CountNewlines(openingTag, openingTag.Length);
            blocks.Add(new ScriptBlock(content, scriptTagLine + openingTagLines));
        }

        return blocks;
    }

    // 0-indexed [start, end] line ranges the template scans must skip: the frontmatter
    // block (opening fence through closing fence) plus <script>/<style> blocks.
    private List<(int Start, int End)> CoveredRanges(Frontmatter? frontmatter)
    {
        var ranges = new List<(int, int)>();
        if (frontmatter is { } fm)
        {
            ranges.Add((fm.StartLine - 1, fm.EndLine));
        }

        foreach (Match m in BlockRegex().Matches(source))
        {
            int startLine = CodeGraphSfcScriptRunner.CountNewlines(source, m.Index);
            int endLine = startLine + CodeGraphSfcScriptRunner.CountNewlines(m.Value, m.Value.Length);
            ranges.Add((startLine, endLine));
        }

        return ranges;
    }

    // Function calls in Astro template expressions. A `{` group left open at end-of-line
    // (the pervasive `{posts.map((post) => (` pattern) contributes its opening line's calls.
    private void ExtractTemplateCalls(string componentNodeId, List<(int Start, int End)> covered)
    {
        string[] lines = source.Split('\n');
        for (int lineIdx = 0; lineIdx < lines.Length; lineIdx++)
        {
            if (IsCovered(covered, lineIdx))
            {
                continue;
            }

            string line = lines[lineIdx];
            var exprs = new List<(string Text, int Offset)>();

            foreach (Match exprMatch in TemplateExprRegex().Matches(line))
            {
                exprs.Add((exprMatch.Groups[1].Value, exprMatch.Index));
            }

            Match openMatch = OpenExprRegex().Match(TemplateExprRegex().Replace(line, string.Empty));
            if (openMatch.Success)
            {
                exprs.Add((openMatch.Groups[1].Value, line.LastIndexOf('{')));
            }

            foreach ((string text, int offset) in exprs)
            {
                foreach (Match callMatch in CallRegex().Matches(text))
                {
                    string callee = callMatch.Groups[1].Value;
                    if (callee is "if" or "await" or "function")
                    {
                        continue;
                    }

                    unresolvedReferences.Add(new CodeGraphUnresolvedReference(
                        componentNodeId, callee, CodeGraphEdgeKind.Calls,
                        lineIdx + 1, offset + callMatch.Index,
                        filePath, CodeGraphLanguage.Astro, null, null));
                }
            }
        }
    }

    // PascalCase template tags (<Layout>, <PostCard />) — component instantiations.
    private void ExtractTemplateComponents(string componentNodeId, List<(int Start, int End)> covered)
    {
        string[] lines = source.Split('\n');
        for (int lineIdx = 0; lineIdx < lines.Length; lineIdx++)
        {
            if (IsCovered(covered, lineIdx))
            {
                continue;
            }

            string line = lines[lineIdx];
            foreach (Match match in ComponentTagRegex().Matches(line))
            {
                string componentName = match.Groups[1].Value;
                if (AstroBuiltinComponents.Contains(componentName))
                {
                    continue;
                }

                unresolvedReferences.Add(new CodeGraphUnresolvedReference(
                    componentNodeId, componentName, CodeGraphEdgeKind.References,
                    lineIdx + 1, match.Index + 1,
                    filePath, CodeGraphLanguage.Astro, null, null));
            }
        }
    }

    private static bool IsCovered(List<(int Start, int End)> ranges, int lineIdx)
    {
        foreach ((int start, int end) in ranges)
        {
            if (lineIdx >= start && lineIdx <= end)
            {
                return true;
            }
        }

        return false;
    }

    // ── Fixed patterns ([GeneratedRegex]) — verbatim from astro-extractor.ts ────────

    [GeneratedRegex(@"<script(\s[^>]*)?>(?<content>[\s\S]*?)</script>")]
    private static partial Regex ScriptRegex();

    [GeneratedRegex(@"<(script|style)(\s[^>]*)?>[\s\S]*?</\1>")]
    private static partial Regex BlockRegex();

    // Complete groups {...} — excluding JSX comments ({/* ... */}).
    [GeneratedRegex(@"\{([^}/][^}]*)\}")]
    private static partial Regex TemplateExprRegex();

    // A group opened but not closed on this line.
    [GeneratedRegex(@"\{([^}/][^}]*)$")]
    private static partial Regex OpenExprRegex();

    [GeneratedRegex(@"\b([a-zA-Z_$][\w$.]*)\s*\(")]
    private static partial Regex CallRegex();

    [GeneratedRegex(@"<([A-Z][a-zA-Z0-9_$]*)\b")]
    private static partial Regex ComponentTagRegex();
}

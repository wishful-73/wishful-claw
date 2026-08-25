using System.Diagnostics;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphSvelteExtractor — bespoke embedded extractor for Svelte component files
// (port of extraction/svelte-extractor.ts). NO Svelte grammar: a .svelte file is
// multi-language (script + template + style), so the <script> region is carved by
// regex and delegated to the TS/JS CodeGraphTreeSitterExtractor via
// CodeGraphSfcScriptRunner, whose results are offset back to full-SFC coordinates.
//
// Emits: one `component` node for the file (Svelte components are always importable),
// the delegated <script> symbols, template function-call refs (`{fn(...)}`), and
// template component-usage refs (`<PascalCase>`). Svelte 5 rune calls ($state,
// $props, …) are filtered out of the reference set at the end.
//
// GLOBAL namespace, all-internal, reflection-free/AOT; [GeneratedRegex] fixed patterns.
// =============================================================================
internal sealed partial class CodeGraphSvelteExtractor
{
    private const string Extension = ".svelte";

    // Svelte 5 runes — compiler builtins, not real functions.
    private static readonly HashSet<string> SvelteRunes = new(StringComparer.Ordinal)
    {
        "$props", "$state", "$derived", "$effect", "$bindable", "$inspect", "$host", "$snippet"
    };

    private readonly string filePath;
    private readonly string source;
    private readonly CodeGraphGrammarRegistry registry;
    private readonly List<CodeGraphNode> nodes = new();
    private readonly List<CodeGraphEdge> edges = new();
    private readonly List<CodeGraphUnresolvedReference> unresolvedReferences = new();
    private readonly List<CodeGraphExtractionError> errors = new();

    private CodeGraphSvelteExtractor(string filePath, string content, CodeGraphGrammarRegistry registry)
    {
        this.filePath = filePath;
        this.source = content;
        this.registry = registry;
    }

    public static CodeGraphExtractionResult ExtractFromSource(
        string filePath, string content, CodeGraphGrammarRegistry registry) =>
        new CodeGraphSvelteExtractor(filePath, content, registry).Extract();

    private CodeGraphExtractionResult Extract()
    {
        Stopwatch sw = Stopwatch.StartNew();

        try
        {
            CodeGraphNode componentNode = CodeGraphSfcScriptRunner.ComponentNode(
                filePath, source, Extension, CodeGraphLanguage.Svelte);
            nodes.Add(componentNode);

            foreach (ScriptBlock block in ExtractScriptBlocks())
            {
                CodeGraphSfcScriptRunner.RunScript(
                    filePath, block.Content,
                    block.IsTypeScript ? CodeGraphLanguage.TypeScript : CodeGraphLanguage.JavaScript,
                    block.StartLine, CodeGraphLanguage.Svelte, componentNode.Id, registry,
                    nodes, edges, unresolvedReferences, errors);
            }

            ExtractTemplateCalls(componentNode.Id);
            ExtractTemplateComponents(componentNode.Id);

            // Filter out Svelte rune calls ($state, $props, $derived, …).
            unresolvedReferences.RemoveAll(r => SvelteRunes.Contains(r.ReferenceName));
        }
        catch (Exception ex)
        {
            errors.Add(new CodeGraphExtractionError(
                $"Svelte extraction error: {ex.Message}", "error", filePath, null, null, "parse_error"));
        }

        return new CodeGraphExtractionResult(nodes, edges, unresolvedReferences, errors, sw.Elapsed.TotalMilliseconds);
    }

    private readonly record struct ScriptBlock(string Content, int StartLine, bool IsTypeScript);

    // <script> / <script context="module"> blocks. The content starts right after the
    // opening tag's `>`; its leading `\n` is part of the content, so relative line 1
    // sits ON the tag's closing line — contentStartLine = tagLine + openingTagLines.
    private List<ScriptBlock> ExtractScriptBlocks()
    {
        var blocks = new List<ScriptBlock>();
        foreach (Match match in ScriptRegex().Matches(source))
        {
            string attrs = match.Groups[1].Value;
            string content = match.Groups["content"].Value;
            bool isTypeScript = LangAttrRegex().IsMatch(attrs);

            int scriptTagLine = CodeGraphSfcScriptRunner.CountNewlines(source, match.Index);
            int gt = match.Value.IndexOf('>');
            string openingTag = gt >= 0 ? match.Value[..(gt + 1)] : match.Value;
            int openingTagLines = CodeGraphSfcScriptRunner.CountNewlines(openingTag, openingTag.Length);

            blocks.Add(new ScriptBlock(content, scriptTagLine + openingTagLines, isTypeScript));
        }

        return blocks;
    }

    // Function calls in template expressions (`{fn(...)}`) — calls frequently live in
    // markup (`class={cn(...)}`), not <script>. Lines inside <script>/<style> are skipped.
    private void ExtractTemplateCalls(string componentNodeId)
    {
        List<(int Start, int End)> covered = CoveredRanges();
        string[] lines = source.Split('\n');

        for (int lineIdx = 0; lineIdx < lines.Length; lineIdx++)
        {
            if (IsCovered(covered, lineIdx))
            {
                continue;
            }

            string line = lines[lineIdx];
            foreach (Match exprMatch in TemplateExprRegex().Matches(line))
            {
                string expr = exprMatch.Groups[1].Value;
                foreach (Match callMatch in CallRegex().Matches(expr))
                {
                    string callee = callMatch.Groups[1].Value;
                    if (SvelteRunes.Contains(callee))
                    {
                        continue;
                    }

                    if (callee is "if" or "else" or "each" or "await")
                    {
                        continue;
                    }

                    unresolvedReferences.Add(new CodeGraphUnresolvedReference(
                        componentNodeId, callee, CodeGraphEdgeKind.Calls,
                        lineIdx + 1, exprMatch.Index + callMatch.Index,
                        filePath, CodeGraphLanguage.Svelte, null, null));
                }
            }
        }
    }

    // PascalCase template tags (<Modal>, <Button />) are component instantiations.
    private void ExtractTemplateComponents(string componentNodeId)
    {
        List<(int Start, int End)> covered = CoveredRanges();
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
                unresolvedReferences.Add(new CodeGraphUnresolvedReference(
                    componentNodeId, match.Groups[1].Value, CodeGraphEdgeKind.References,
                    lineIdx + 1, match.Index + 1,
                    filePath, CodeGraphLanguage.Svelte, null, null));
            }
        }
    }

    // 0-indexed [start, end] line ranges covered by <script>/<style> blocks.
    private List<(int Start, int End)> CoveredRanges()
    {
        var ranges = new List<(int, int)>();
        foreach (Match m in BlockRegex().Matches(source))
        {
            int startLine = CodeGraphSfcScriptRunner.CountNewlines(source, m.Index);
            int endLine = startLine + CodeGraphSfcScriptRunner.CountNewlines(m.Value, m.Value.Length);
            ranges.Add((startLine, endLine));
        }

        return ranges;
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

    // ── Fixed patterns ([GeneratedRegex]) — verbatim from svelte-extractor.ts ──────

    [GeneratedRegex(@"<script(\s[^>]*)?>(?<content>[\s\S]*?)</script>")]
    private static partial Regex ScriptRegex();

    [GeneratedRegex(@"lang\s*=\s*[""'](ts|typescript)[""']")]
    private static partial Regex LangAttrRegex();

    [GeneratedRegex(@"<(script|style)(\s[^>]*)?>[\s\S]*?</\1>")]
    private static partial Regex BlockRegex();

    [GeneratedRegex(@"\{([^}#/:@][^}]*)\}")]
    private static partial Regex TemplateExprRegex();

    [GeneratedRegex(@"\b([a-zA-Z_$][\w$.]*)\s*\(")]
    private static partial Regex CallRegex();

    [GeneratedRegex(@"<([A-Z][a-zA-Z0-9_$]*)\b")]
    private static partial Regex ComponentTagRegex();
}

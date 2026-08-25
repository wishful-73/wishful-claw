using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphVueExtractor — bespoke embedded extractor for Vue Single-File Components
// (port of extraction/vue-extractor.ts). NO Vue grammar: a .vue SFC is multi-language
// (script + template + style), so the <script> / <script setup> region is carved by
// regex and delegated to the TS/JS CodeGraphTreeSitterExtractor via
// CodeGraphSfcScriptRunner, whose results are offset back to full-SFC coordinates.
//
// Emits: one `component` node for the file (Vue components are always importable), the
// delegated <script> symbols, and template component-usage refs — PascalCase (<Modal>)
// and kebab-case (<my-button>, folded to MyButton) tags — skipping HTML elements and
// Vue built-ins (<Transition>, <KeepAlive>, …).
//
// GLOBAL namespace, all-internal, reflection-free/AOT; [GeneratedRegex] fixed patterns.
// =============================================================================
internal sealed partial class CodeGraphVueExtractor
{
    private const string Extension = ".vue";

    // Vue built-in components — never a user component reference.
    private static readonly HashSet<string> VueBuiltinComponents = new(StringComparer.Ordinal)
    {
        "Transition", "TransitionGroup", "KeepAlive", "Suspense", "Teleport", "Component", "Slot"
    };

    private readonly string filePath;
    private readonly string source;
    private readonly CodeGraphGrammarRegistry registry;
    private readonly List<CodeGraphNode> nodes = new();
    private readonly List<CodeGraphEdge> edges = new();
    private readonly List<CodeGraphUnresolvedReference> unresolvedReferences = new();
    private readonly List<CodeGraphExtractionError> errors = new();

    private CodeGraphVueExtractor(string filePath, string content, CodeGraphGrammarRegistry registry)
    {
        this.filePath = filePath;
        this.source = content;
        this.registry = registry;
    }

    public static CodeGraphExtractionResult ExtractFromSource(
        string filePath, string content, CodeGraphGrammarRegistry registry) =>
        new CodeGraphVueExtractor(filePath, content, registry).Extract();

    private CodeGraphExtractionResult Extract()
    {
        Stopwatch sw = Stopwatch.StartNew();

        try
        {
            CodeGraphNode componentNode = CodeGraphSfcScriptRunner.ComponentNode(
                filePath, source, Extension, CodeGraphLanguage.Vue);
            nodes.Add(componentNode);

            foreach (ScriptBlock block in ExtractScriptBlocks())
            {
                CodeGraphSfcScriptRunner.RunScript(
                    filePath, block.Content,
                    block.IsTypeScript ? CodeGraphLanguage.TypeScript : CodeGraphLanguage.JavaScript,
                    block.StartLine, CodeGraphLanguage.Vue, componentNode.Id, registry,
                    nodes, edges, unresolvedReferences, errors);
            }

            ExtractTemplateComponents(componentNode.Id);
        }
        catch (Exception ex)
        {
            errors.Add(new CodeGraphExtractionError(
                $"Vue extraction error: {ex.Message}", "error", filePath, null, null, "parse_error"));
        }

        return new CodeGraphExtractionResult(nodes, edges, unresolvedReferences, errors, sw.Elapsed.TotalMilliseconds);
    }

    private readonly record struct ScriptBlock(string Content, int StartLine, bool IsTypeScript);

    // <script> / <script setup> blocks. The content starts right after the opening
    // tag's `>`; its leading `\n` is part of the content, so relative line 1 sits ON
    // the tag's closing line — contentStartLine = tagLine + openingTagLines.
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

    // Template component usages: PascalCase (<Modal>) and kebab-case (<my-button>,
    // folded to MyButton) tags. Lowercase, hyphen-less tags are native HTML — skipped;
    // Vue built-ins are skipped. Lines inside <script>/<style> are skipped.
    private void ExtractTemplateComponents(string componentNodeId)
    {
        var covered = new List<(int Start, int End)>();
        foreach (Match m in BlockRegex().Matches(source))
        {
            int startLine = CodeGraphSfcScriptRunner.CountNewlines(source, m.Index);
            int endLine = startLine + CodeGraphSfcScriptRunner.CountNewlines(m.Value, m.Value.Length);
            covered.Add((startLine, endLine));
        }

        string[] lines = source.Split('\n');
        for (int lineIdx = 0; lineIdx < lines.Length; lineIdx++)
        {
            if (IsCovered(covered, lineIdx))
            {
                continue;
            }

            string line = lines[lineIdx];
            foreach (Match match in TagRegex().Matches(line))
            {
                string raw = match.Groups[1].Value;
                string componentName;
                if (raw.Length > 0 && raw[0] is >= 'A' and <= 'Z')
                {
                    componentName = raw; // PascalCase component
                }
                else if (raw.Contains('-'))
                {
                    componentName = KebabToPascal(raw); // kebab-case component
                }
                else
                {
                    continue; // lowercase, no hyphen → native HTML element
                }

                if (VueBuiltinComponents.Contains(componentName))
                {
                    continue;
                }

                unresolvedReferences.Add(new CodeGraphUnresolvedReference(
                    componentNodeId, componentName, CodeGraphEdgeKind.References,
                    lineIdx + 1, match.Index + 1,
                    filePath, CodeGraphLanguage.Vue, null, null));
            }
        }
    }

    // `my-component` → `MyComponent` (Vue allows either form in templates).
    private static string KebabToPascal(string name)
    {
        var sb = new StringBuilder(name.Length);
        foreach (string part in name.Split('-'))
        {
            if (part.Length > 0)
            {
                sb.Append(char.ToUpperInvariant(part[0]));
                sb.Append(part.AsSpan(1));
            }
        }

        return sb.ToString();
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

    // ── Fixed patterns ([GeneratedRegex]) — verbatim from vue-extractor.ts ──────────

    [GeneratedRegex(@"<script(\s[^>]*)?>(?<content>[\s\S]*?)</script>")]
    private static partial Regex ScriptRegex();

    [GeneratedRegex(@"lang\s*=\s*[""'](ts|typescript)[""']")]
    private static partial Regex LangAttrRegex();

    [GeneratedRegex(@"<(script|style)(\s[^>]*)?>[\s\S]*?</\1>")]
    private static partial Regex BlockRegex();

    [GeneratedRegex(@"<([A-Za-z][A-Za-z0-9_-]*)\b")]
    private static partial Regex TagRegex();
}

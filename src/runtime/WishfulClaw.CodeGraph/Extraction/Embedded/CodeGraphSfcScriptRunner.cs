using System.Text;

// =============================================================================
// CodeGraphSfcScriptRunner — shared delegation core for the Single-File-Component
// embedded extractors (Svelte / Vue / Astro). Port of the common body of
// extraction/{svelte,vue,astro}-extractor.ts.
//
// An SFC is multi-language: a <script> / <script setup> / `---` frontmatter region
// of TypeScript or JavaScript, plus a template and optional <style>. Rather than
// ship an SFC grammar, each extractor regex-carves the script region(s) and hands
// them to the EXISTING TS/JS CodeGraphTreeSitterExtractor, then OFFSETS the returned
// line positions back to full-SFC coordinates — the delegated engine parses only the
// carved substring, so every line it reports is relative to that region's start.
// Columns are line-relative BYTE offsets, so shifting whole lines keeps them valid
// (nothing column-side to adjust); only line numbers move.
//
// GLOBAL namespace, all-internal, reflection-free/AOT.
// =============================================================================
internal static class CodeGraphSfcScriptRunner
{
    private static readonly char[] SlashChars = { '/', '\\' };

    // Component node for the SFC file itself — SFC components are always importable,
    // so the file always yields one `component` node (svelte/vue/astro createComponentNode).
    public static CodeGraphNode ComponentNode(string filePath, string source, string extension, string language)
    {
        string[] lines = source.Split('\n');
        string fileName = BaseName(filePath);
        string componentName = fileName.EndsWith(extension, StringComparison.Ordinal)
            ? fileName[..^extension.Length]
            : fileName;
        string id = CodeGraphNodeIdFactory.NodeId(filePath, CodeGraphNodeKind.Component, componentName, 1);
        int endColumn = lines.Length > 0 ? lines[^1].Length : 0;

        return new CodeGraphNode(
            Id: id,
            Kind: CodeGraphNodeKind.Component,
            Name: componentName,
            QualifiedName: $"{filePath}::{componentName}",
            FilePath: filePath,
            Language: language,
            StartLine: 1,
            EndLine: lines.Length,
            StartColumn: 0,
            EndColumn: endColumn,
            Docstring: null,
            Signature: null,
            Visibility: null,
            IsExported: true,
            IsAsync: false,
            IsStatic: false,
            IsAbstract: false,
            Decorators: null,
            TypeParameters: null,
            ReturnType: null,
            UpdatedAt: Now());
    }

    // Parse ONE script/frontmatter region with the TS/JS engine, then merge its
    // nodes/edges/refs/errors into the SFC lists with every line position shifted by
    // `blockStartLine` (the 0-indexed line the region's content begins on) and the
    // language relabeled to the SFC's. A component -> node `contains` edge is added
    // per delegated node (mirrors processScriptBlock).
    public static void RunScript(
        string filePath,
        string scriptContent,
        string scriptLanguage,
        int blockStartLine,
        string sfcLanguage,
        string componentNodeId,
        CodeGraphGrammarRegistry registry,
        List<CodeGraphNode> nodes,
        List<CodeGraphEdge> edges,
        List<CodeGraphUnresolvedReference> unresolvedReferences,
        List<CodeGraphExtractionError> errors)
    {
        ICodeGraphLanguageExtractor extractor = scriptLanguage == CodeGraphLanguage.TypeScript
            ? CodeGraphTypeScriptExtractor.Instance
            : CodeGraphJavaScriptExtractor.Instance;

        // Grammar lib missing / ABI-unsupported — degrade to a warning (the TS
        // isLanguageSupported === false branch) but keep the component + template refs.
        nint? handle = registry.GetLanguage(scriptLanguage);
        if (handle is not { } grammar || grammar == 0)
        {
            errors.Add(new CodeGraphExtractionError(
                $"Parser for {scriptLanguage} not available, cannot parse {sfcLanguage} script block",
                "warning", filePath, null, null, null));
            return;
        }

        CodeGraphExtractionResult result;
        try
        {
            CodeGraphSourceText source = CodeGraphSourceText.FromUtf8(Encoding.UTF8.GetBytes(scriptContent));
            using CodeGraphTsParser parser = new();
            parser.SetLanguage(grammar);
            using CodeGraphTsTree tree = parser.Parse(source);
            CodeGraphTreeSitterExtractor engine = new(filePath, scriptLanguage, extractor, source);
            result = engine.Extract(tree);
        }
        catch (Exception ex)
        {
            errors.Add(new CodeGraphExtractionError(
                $"{sfcLanguage} script parse error: {ex.Message}", "error", filePath, null, null, "parse_error"));
            return;
        }

        // Offset lines back to full-SFC coordinates; relabel language to the SFC's.
        // The node id (a pure function of the SCRIPT-relative start line) is left
        // as-is — matching the TS, which never recomputes it — so the engine's own
        // `contains` edges (which target these ids) stay connected after the shift.
        foreach (CodeGraphNode node in result.Nodes)
        {
            CodeGraphNode shifted = node with
            {
                StartLine = node.StartLine + blockStartLine,
                EndLine = node.EndLine + blockStartLine,
                Language = sfcLanguage
            };
            nodes.Add(shifted);
            edges.Add(new CodeGraphEdge(
                componentNodeId, shifted.Id, CodeGraphEdgeKind.Contains, null, null, null, null));
        }

        foreach (CodeGraphEdge edge in result.Edges)
        {
            edges.Add(edge.Line is int line ? edge with { Line = line + blockStartLine } : edge);
        }

        foreach (CodeGraphUnresolvedReference r in result.UnresolvedReferences)
        {
            unresolvedReferences.Add(r with
            {
                Line = r.Line + blockStartLine,
                FilePath = filePath,
                Language = sfcLanguage
            });
        }

        foreach (CodeGraphExtractionError err in result.Errors)
        {
            errors.Add(err.Line is int line ? err with { Line = line + blockStartLine } : err);
        }
    }

    // Count of '\n' in s[0..end) — the 0-indexed line a char offset sits on. Newlines
    // are single-byte ASCII, so a char-index scan matches the engine's byte-line count.
    public static int CountNewlines(string s, int end)
    {
        int limit = Math.Min(end, s.Length);
        int count = 0;
        for (int i = 0; i < limit; i++)
        {
            if (s[i] == '\n')
            {
                count++;
            }
        }

        return count;
    }

    private static string BaseName(string path)
    {
        int slash = path.LastIndexOfAny(SlashChars);
        return slash >= 0 && slash + 1 <= path.Length ? path[(slash + 1)..] : path;
    }

    public static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}

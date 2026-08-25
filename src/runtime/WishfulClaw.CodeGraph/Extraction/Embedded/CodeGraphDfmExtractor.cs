using System.Diagnostics;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphDfmExtractor — bespoke (regex-only, no tree-sitter) extractor for Delphi
// DFM/FMX form files (port of extraction/dfm-extractor.ts; analysis/01 §7 embedded
// extractors, analysis/02 §3.3).
//
// DFM/FMX files describe a form's visual component hierarchy and event-handler
// bindings in a simple `object … end` text format that no tree-sitter grammar
// covers. Extracted:
//   * Components (`object <Name>: <Type>`) → `component` nodes.
//   * Nesting → `contains` edges (via an object/end stack).
//   * Event handlers (`OnClick = MethodName`) → an unresolved `references` edge to
//     the handler method declared in the paired Pascal unit.
//
// GLOBAL namespace, all-internal, reflection-free/AOT; [GeneratedRegex] fixed
// patterns.
// =============================================================================
internal sealed partial class CodeGraphDfmExtractor
{
    private readonly string filePath;
    private readonly string source;
    private readonly List<CodeGraphNode> nodes = new();
    private readonly List<CodeGraphEdge> edges = new();
    private readonly List<CodeGraphUnresolvedReference> unresolvedReferences = new();
    private readonly List<CodeGraphExtractionError> errors = new();

    private CodeGraphDfmExtractor(string filePath, string content)
    {
        this.filePath = filePath;
        this.source = content;
    }

    // Static entry point (parity with the TS `new DfmExtractor(...).extract()`).
    public static CodeGraphExtractionResult ExtractFromSource(string filePath, string content) =>
        new CodeGraphDfmExtractor(filePath, content).Extract();

    private CodeGraphExtractionResult Extract()
    {
        Stopwatch sw = Stopwatch.StartNew();

        try
        {
            CodeGraphNode fileNode = CreateFileNode();
            ParseComponents(fileNode.Id);
        }
        catch (Exception ex)
        {
            errors.Add(new CodeGraphExtractionError(
                $"DFM extraction error: {ex.Message}", "error", filePath, null, null, "parse_error"));
        }

        return new CodeGraphExtractionResult(nodes, edges, unresolvedReferences, errors, sw.Elapsed.TotalMilliseconds);
    }

    private CodeGraphNode CreateFileNode()
    {
        string[] lines = source.Split('\n');
        int endColumn = lines.Length > 0 ? lines[^1].Length : 0;
        string id = CodeGraphNodeIdFactory.NodeId(filePath, CodeGraphNodeKind.File, filePath, 1);
        CodeGraphNode node = new(
            id, CodeGraphNodeKind.File, FileName(filePath), filePath, filePath, CodeGraphLanguage.Pascal,
            1, lines.Length, 0, endColumn, null, null, null, false, false, false, false, null, null, null, Now());
        nodes.Add(node);
        return node;
    }

    // Parse `object`/`end` blocks and extract components + event handlers.
    private void ParseComponents(string fileNodeId)
    {
        string[] lines = source.Split('\n');
        var stack = new List<string> { fileNodeId };
        bool inMultiLine = false;
        string multiLineEndChar = ")";

        for (int i = 0; i < lines.Length; i++)
        {
            string line = lines[i];
            int lineNum = i + 1;

            // Skip multi-line property values (`= ( … )` sets, `= < … >` item lists).
            if (inMultiLine)
            {
                if (line.TrimEnd().EndsWith(multiLineEndChar, StringComparison.Ordinal))
                {
                    inMultiLine = false;
                }

                continue;
            }

            if (MultiLineStartRegex().IsMatch(line))
            {
                inMultiLine = true;
                multiLineEndChar = ")";
                continue;
            }

            if (MultiLineItemStartRegex().IsMatch(line))
            {
                inMultiLine = true;
                multiLineEndChar = ">";
                continue;
            }

            // Component declaration: `object <Name>: <Type>`.
            Match objMatch = ObjectRegex().Match(line);
            if (objMatch.Success)
            {
                string name = objMatch.Groups[2].Value;
                string typeName = objMatch.Groups[3].Value;
                string nodeId = CodeGraphNodeIdFactory.NodeId(filePath, CodeGraphNodeKind.Component, name, lineNum);
                nodes.Add(new CodeGraphNode(
                    nodeId, CodeGraphNodeKind.Component, name, $"{filePath}#{name}", filePath, CodeGraphLanguage.Pascal,
                    lineNum, lineNum, 0, line.Length, null, typeName, null, false, false, false, false, null, null, null, Now()));
                edges.Add(new CodeGraphEdge(stack[^1], nodeId, CodeGraphEdgeKind.Contains, null, null, null, null));
                stack.Add(nodeId);
                continue;
            }

            // Event handler: `On<Event> = MethodName`.
            Match eventMatch = EventRegex().Match(line);
            if (eventMatch.Success)
            {
                string methodName = eventMatch.Groups[2].Value;
                unresolvedReferences.Add(new CodeGraphUnresolvedReference(
                    stack[^1], methodName, CodeGraphEdgeKind.References, lineNum, 0, null, null, null, null));
                continue;
            }

            // Block end.
            if (EndRegex().IsMatch(line) && stack.Count > 1)
            {
                stack.RemoveAt(stack.Count - 1);
            }
        }
    }

    private static string FileName(string path)
    {
        int slash = path.LastIndexOf('/');
        return slash >= 0 && slash + 1 < path.Length ? path[(slash + 1)..] : path;
    }

    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // ── Fixed patterns ([GeneratedRegex]) — verbatim from dfm-extractor.ts ──────────

    [GeneratedRegex(@"^\s*(object|inherited|inline)\s+(\w+)\s*:\s*(\w+)")]
    private static partial Regex ObjectRegex();

    [GeneratedRegex(@"^\s*(On\w+)\s*=\s*(\w+)\s*$")]
    private static partial Regex EventRegex();

    [GeneratedRegex(@"^\s*end\s*$")]
    private static partial Regex EndRegex();

    [GeneratedRegex(@"=\s*\(\s*$")]
    private static partial Regex MultiLineStartRegex();

    [GeneratedRegex(@"=\s*<\s*$")]
    private static partial Regex MultiLineItemStartRegex();
}

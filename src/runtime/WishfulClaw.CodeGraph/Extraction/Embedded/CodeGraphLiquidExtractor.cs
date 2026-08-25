using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphLiquidExtractor — bespoke (regex-only, no tree-sitter) extractor for
// Liquid templates (port of extraction/liquid-extractor.ts; analysis/01 §7 embedded
// extractors, analysis/02 §3.3).
//
// Liquid (Shopify, Jekyll, …) has no functions/classes, so instead we extract the
// template's dependency graph:
//   * `{% render 'snippet' %}` / `{% include 'snippet' %}` → import + component nodes
//     and a `references` edge to `snippets/<name>.liquid`.
//   * `{% section 'name' %}` → import + component nodes and a ref to
//     `sections/<name>.liquid`.
//   * `{% schema %}…{% endschema %}` → a constant node named by the schema `name`.
//   * `{% assign var = … %}` → a variable node.
//   * Shopify OS 2.0 JSON templates / section groups (`templates/*.json`,
//     `sections/*.json`) map each `sections.*.type` to its `sections/<type>.liquid`
//     file via a `references` edge (no symbol nodes — the JSON just carries links).
//
// GLOBAL namespace, all-internal, reflection-free/AOT; [GeneratedRegex] fixed
// patterns; JSON parsed with JsonDocument (Decision 7 — never JsonSerializer).
// =============================================================================
internal sealed partial class CodeGraphLiquidExtractor
{
    private readonly string filePath;
    private readonly string source;
    private readonly List<CodeGraphNode> nodes = new();
    private readonly List<CodeGraphEdge> edges = new();
    private readonly List<CodeGraphUnresolvedReference> unresolvedReferences = new();
    private readonly List<CodeGraphExtractionError> errors = new();
    private readonly List<int> lineStarts = new();

    private CodeGraphLiquidExtractor(string filePath, string content)
    {
        this.filePath = filePath;
        this.source = content;
        ComputeLineStarts();
    }

    // Static entry point (parity with the TS `new LiquidExtractor(...).extract()`).
    public static CodeGraphExtractionResult ExtractFromSource(string filePath, string content) =>
        new CodeGraphLiquidExtractor(filePath, content).Extract();

    private CodeGraphExtractionResult Extract()
    {
        Stopwatch sw = Stopwatch.StartNew();

        try
        {
            CodeGraphNode fileNode = CreateFileNode();

            // Shopify OS 2.0 JSON template / section group: link each section `type` to
            // its `sections/<type>.liquid` file. No symbol nodes — the JSON just carries
            // the references — so it stays out of any symbol-bearing-file metric while
            // its sections still get their dependents.
            if (filePath.EndsWith(".json", StringComparison.Ordinal))
            {
                ExtractShopifyJsonSections(fileNode.Id);
            }
            else
            {
                ExtractSnippetReferences(fileNode.Id);
                ExtractSectionReferences(fileNode.Id);
                ExtractSchema(fileNode.Id);
                ExtractAssignments(fileNode.Id);
            }
        }
        catch (Exception ex)
        {
            errors.Add(new CodeGraphExtractionError(
                $"Liquid extraction error: {ex.Message}", "error", filePath, null, null, "parse_error"));
        }

        return new CodeGraphExtractionResult(nodes, edges, unresolvedReferences, errors, sw.Elapsed.TotalMilliseconds);
    }

    private CodeGraphNode CreateFileNode()
    {
        string[] lines = source.Split('\n');
        int endColumn = lines.Length > 0 ? lines[^1].Length : 0;
        string id = CodeGraphNodeIdFactory.NodeId(filePath, CodeGraphNodeKind.File, filePath, 1);
        CodeGraphNode node = new(
            id, CodeGraphNodeKind.File, FileName(filePath), filePath, filePath, CodeGraphLanguage.Liquid,
            1, lines.Length, 0, endColumn, null, null, null, false, false, false, false, null, null, null, Now());
        nodes.Add(node);
        return node;
    }

    // Shopify OS 2.0 JSON template / section group. Both have a `sections` object
    // mapping id → `{ "type": "<section-name>", … }`; the `type` names a
    // `sections/<type>.liquid` file. Emit a `references` edge to each.
    private void ExtractShopifyJsonSections(string fromNodeId)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(source);
        }
        catch
        {
            return; // not valid JSON (or a partial) — nothing to link
        }

        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Object ||
                !doc.RootElement.TryGetProperty("sections", out JsonElement sections) ||
                sections.ValueKind != JsonValueKind.Object)
            {
                return;
            }

            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (JsonProperty section in sections.EnumerateObject())
            {
                if (section.Value.ValueKind != JsonValueKind.Object ||
                    !section.Value.TryGetProperty("type", out JsonElement typeEl) ||
                    typeEl.ValueKind != JsonValueKind.String)
                {
                    continue;
                }

                string type = typeEl.GetString()!;
                if (!seen.Add(type))
                {
                    continue;
                }

                unresolvedReferences.Add(new CodeGraphUnresolvedReference(
                    fromNodeId, $"sections/{type}.liquid", CodeGraphEdgeKind.References, 1, 0, null, null, null, null));
            }
        }
    }

    // `{% render 'snippet' %}` / `{% include 'snippet' %}`.
    private void ExtractSnippetReferences(string fileNodeId)
    {
        foreach (Match match in RenderRegex().Matches(source))
        {
            string tagType = match.Groups[1].Value;
            string snippetName = match.Groups[2].Value;
            int line = GetLineNumber(match.Index);
            int startColumn = match.Index - GetLineStart(line);

            string importId = CodeGraphNodeIdFactory.NodeId(filePath, CodeGraphNodeKind.Import, snippetName, line);
            AddNode(new CodeGraphNode(
                importId, CodeGraphNodeKind.Import, snippetName, $"{filePath}::import:{snippetName}", filePath,
                CodeGraphLanguage.Liquid, line, line, startColumn, startColumn + match.Length,
                null, match.Value, null, false, false, false, false, null, null, null, Now()));
            edges.Add(new CodeGraphEdge(fileNodeId, importId, CodeGraphEdgeKind.Contains, null, null, null, null));

            string componentId = CodeGraphNodeIdFactory.NodeId(filePath, CodeGraphNodeKind.Component, $"{tagType}:{snippetName}", line);
            AddNode(new CodeGraphNode(
                componentId, CodeGraphNodeKind.Component, snippetName, $"{filePath}::{tagType}:{snippetName}", filePath,
                CodeGraphLanguage.Liquid, line, line, startColumn, startColumn + match.Length,
                null, null, null, false, false, false, false, null, null, null, Now()));
            edges.Add(new CodeGraphEdge(fileNodeId, componentId, CodeGraphEdgeKind.Contains, null, null, null, null));

            unresolvedReferences.Add(new CodeGraphUnresolvedReference(
                fileNodeId, $"snippets/{snippetName}.liquid", CodeGraphEdgeKind.References, line, startColumn, null, null, null, null));
        }
    }

    // `{% section 'name' %}`.
    private void ExtractSectionReferences(string fileNodeId)
    {
        foreach (Match match in SectionRegex().Matches(source))
        {
            string sectionName = match.Groups[1].Value;
            int line = GetLineNumber(match.Index);
            int startColumn = match.Index - GetLineStart(line);

            string importId = CodeGraphNodeIdFactory.NodeId(filePath, CodeGraphNodeKind.Import, sectionName, line);
            AddNode(new CodeGraphNode(
                importId, CodeGraphNodeKind.Import, sectionName, $"{filePath}::import:{sectionName}", filePath,
                CodeGraphLanguage.Liquid, line, line, startColumn, startColumn + match.Length,
                null, match.Value, null, false, false, false, false, null, null, null, Now()));
            edges.Add(new CodeGraphEdge(fileNodeId, importId, CodeGraphEdgeKind.Contains, null, null, null, null));

            string componentId = CodeGraphNodeIdFactory.NodeId(filePath, CodeGraphNodeKind.Component, $"section:{sectionName}", line);
            AddNode(new CodeGraphNode(
                componentId, CodeGraphNodeKind.Component, sectionName, $"{filePath}::section:{sectionName}", filePath,
                CodeGraphLanguage.Liquid, line, line, startColumn, startColumn + match.Length,
                null, null, null, false, false, false, false, null, null, null, Now()));
            edges.Add(new CodeGraphEdge(fileNodeId, componentId, CodeGraphEdgeKind.Contains, null, null, null, null));

            unresolvedReferences.Add(new CodeGraphUnresolvedReference(
                fileNodeId, $"sections/{sectionName}.liquid", CodeGraphEdgeKind.References, line, startColumn, null, null, null, null));
        }
    }

    // `{% schema %}…{% endschema %}` → a constant node named by the schema `name`.
    private void ExtractSchema(string fileNodeId)
    {
        foreach (Match match in SchemaRegex().Matches(source))
        {
            string schemaContent = match.Groups[1].Value;
            int startLine = GetLineNumber(match.Index);
            int endLine = GetLineNumber(match.Index + match.Length);
            string schemaName = SchemaName(schemaContent);

            string nodeId = CodeGraphNodeIdFactory.NodeId(filePath, CodeGraphNodeKind.Constant, $"schema:{schemaName}", startLine);
            // SECURITY (#383): don't dump the raw {% schema %} JSON into the docstring —
            // the schema name is already in `name`, and the data block could leak any
            // IDs/endpoints/keys a developer placed in setting defaults.
            AddNode(new CodeGraphNode(
                nodeId, CodeGraphNodeKind.Constant, schemaName, $"{filePath}::schema:{schemaName}", filePath,
                CodeGraphLanguage.Liquid, startLine, endLine, match.Index - GetLineStart(startLine), 0,
                null, null, null, false, false, false, false, null, null, null, Now()));
            edges.Add(new CodeGraphEdge(fileNodeId, nodeId, CodeGraphEdgeKind.Contains, null, null, null, null));
        }
    }

    // Shopify schema names can be a plain string or a translation object
    // (`{"en": "...", "fr": "..."}`); default to "schema" when absent / invalid.
    private static string SchemaName(string schemaContent)
    {
        try
        {
            using JsonDocument doc = JsonDocument.Parse(schemaContent);
            if (doc.RootElement.ValueKind != JsonValueKind.Object ||
                !doc.RootElement.TryGetProperty("name", out JsonElement nameEl))
            {
                return "schema";
            }

            if (nameEl.ValueKind == JsonValueKind.String)
            {
                return nameEl.GetString()!;
            }

            if (nameEl.ValueKind == JsonValueKind.Object)
            {
                if (nameEl.TryGetProperty("en", out JsonElement en) && en.ValueKind == JsonValueKind.String)
                {
                    return en.GetString()!;
                }

                foreach (JsonProperty p in nameEl.EnumerateObject())
                {
                    if (p.Value.ValueKind == JsonValueKind.String)
                    {
                        return p.Value.GetString()!;
                    }
                }
            }
        }
        catch
        {
            // Schema isn't valid JSON — use the default name.
        }

        return "schema";
    }

    // `{% assign var = … %}` → a variable node.
    private void ExtractAssignments(string fileNodeId)
    {
        foreach (Match match in AssignRegex().Matches(source))
        {
            string variableName = match.Groups[1].Value;
            int line = GetLineNumber(match.Index);
            int startColumn = match.Index - GetLineStart(line);

            string nodeId = CodeGraphNodeIdFactory.NodeId(filePath, CodeGraphNodeKind.Variable, variableName, line);
            AddNode(new CodeGraphNode(
                nodeId, CodeGraphNodeKind.Variable, variableName, $"{filePath}::{variableName}", filePath,
                CodeGraphLanguage.Liquid, line, line, startColumn, startColumn + match.Length,
                null, null, null, false, false, false, false, null, null, null, Now()));
            edges.Add(new CodeGraphEdge(fileNodeId, nodeId, CodeGraphEdgeKind.Contains, null, null, null, null));
        }
    }

    private void AddNode(CodeGraphNode node) => nodes.Add(node);

    private void ComputeLineStarts()
    {
        lineStarts.Add(0);
        for (int i = 0; i < source.Length; i++)
        {
            if (source[i] == '\n')
            {
                lineStarts.Add(i + 1);
            }
        }
    }

    // 1-based line of a char index (≙ substring(0, index).match(/\n/g).length + 1).
    private int GetLineNumber(int index)
    {
        int lo = 0;
        int hi = lineStarts.Count - 1;
        while (lo < hi)
        {
            int mid = (lo + hi + 1) >> 1;
            if (lineStarts[mid] <= index)
            {
                lo = mid;
            }
            else
            {
                hi = mid - 1;
            }
        }

        return lo + 1;
    }

    // Char index of the start of a 1-based line.
    private int GetLineStart(int lineNumber)
    {
        int idx = lineNumber - 1;
        return idx >= 0 && idx < lineStarts.Count ? lineStarts[idx] : 0;
    }

    private static string FileName(string path)
    {
        int slash = path.LastIndexOf('/');
        return slash >= 0 && slash + 1 < path.Length ? path[(slash + 1)..] : path;
    }

    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // ── Fixed patterns ([GeneratedRegex]) — verbatim from liquid-extractor.ts ───────

    [GeneratedRegex(@"\{%[-]?\s*(render|include)\s+['""]([^'""]+)['""]")]
    private static partial Regex RenderRegex();

    [GeneratedRegex(@"\{%[-]?\s*section\s+['""]([^'""]+)['""]")]
    private static partial Regex SectionRegex();

    [GeneratedRegex(@"\{%[-]?\s*schema\s*[-]?%\}([\s\S]*?)\{%[-]?\s*endschema\s*[-]?%\}")]
    private static partial Regex SchemaRegex();

    [GeneratedRegex(@"\{%[-]?\s*assign\s+(\w+)\s*=")]
    private static partial Regex AssignRegex();
}

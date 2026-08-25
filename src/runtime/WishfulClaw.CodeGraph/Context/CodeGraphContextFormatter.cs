using System.Text;
using System.Text.Json;

// =============================================================================
// CodeGraphContextFormatter — renders a CodeGraphTaskContext as markdown or JSON for
// injection into an agent (port of context/formatter.ts). The markdown path is the
// product surface: a compact "Code Context" document (Entry Points / Related Symbols /
// Code) optimized for minimal context usage, with generated files (`.pb.go`,
// `.pulsar.go`, mocks, …) re-sorted LAST so a flow query leads with the hand-written
// implementation, not codegen scaffolding.
//
// FormatAsMarkdown reproduces the FULL buildContext string assembly (context/index.ts
// :267): the formatter body + the in-memory call-paths section + the low-confidence
// note when the subgraph's confidence is 'low'. JSON is written with Utf8JsonWriter
// (reflection-free, AOT-safe) rather than a reflection serializer.
// =============================================================================
internal static class CodeGraphContextFormatter
{
    // The full markdown emitted by buildContext (format: 'markdown'): the compact document
    // + call paths + (confidence 'low' ? the honest-handoff note).
    public static string FormatAsMarkdown(CodeGraphTaskContext context)
    {
        var core = FormatCoreMarkdown(context);
        var callPaths = CodeGraphCallPaths.BuildCallPathsSection(context.Subgraph);
        // #687 dynamic-dispatch boundary notes (where the static path ends at runtime
        // dispatch) — surfaced right after the call paths, before the honest-handoff note.
        var boundaries = string.IsNullOrEmpty(context.DynamicBoundaries)
            ? string.Empty
            : "\n" + context.DynamicBoundaries + "\n";
        var lowConfidence = context.Subgraph.Confidence == "low"
            ? CodeGraphCallPaths.BuildLowConfidenceNote(context.EntryPoints)
            : string.Empty;
        return core + callPaths + boundaries + lowConfidence;
    }

    // formatContextAsMarkdown (context/formatter.ts:18).
    private static string FormatCoreMarkdown(CodeGraphTaskContext context)
    {
        var lines = new List<string>
        {
            "## Code Context\n",
            $"**Query:** {context.Query}\n"
        };

        // Entry points — generated files ranked last (stable).
        var orderedEntries = context.EntryPoints
            .OrderBy(n => CodeGraphGeneratedDetection.IsGeneratedFile(n.FilePath) ? 1 : 0)
            .ToList();
        if (orderedEntries.Count > 0)
        {
            lines.Add("### Entry Points\n");
            foreach (var node in orderedEntries)
            {
                var location = node.StartLine != 0 ? $":{node.StartLine}" : string.Empty;
                lines.Add($"- **{node.Name}** ({node.Kind}) - {node.FilePath}{location}");
                if (!string.IsNullOrEmpty(node.Signature))
                {
                    lines.Add($"  `{node.Signature}`");
                }
            }

            lines.Add(string.Empty);
        }

        // Related symbols — compact per-file list; drop entry points + generated files.
        var entryIds = new HashSet<string>(context.EntryPoints.Select(e => e.Id), StringComparer.Ordinal);
        var otherSymbols = context.Subgraph.Nodes.Values
            .Where(n => !entryIds.Contains(n.Id))
            .Where(n => !CodeGraphGeneratedDetection.IsGeneratedFile(n.FilePath))
            .Take(10)
            .ToList();
        if (otherSymbols.Count > 0)
        {
            lines.Add("### Related Symbols\n");
            var byFileOrder = new List<string>();
            var byFile = new Dictionary<string, List<CodeGraphNode>>(StringComparer.Ordinal);
            foreach (var node in otherSymbols)
            {
                if (!byFile.TryGetValue(node.FilePath, out var existing))
                {
                    existing = new List<CodeGraphNode>();
                    byFile[node.FilePath] = existing;
                    byFileOrder.Add(node.FilePath);
                }

                existing.Add(node);
            }

            foreach (var file in byFileOrder)
            {
                var nodeList = string.Join(", ", byFile[file].Select(n => $"{n.Name}:{n.StartLine}"));
                lines.Add($"- {file}: {nodeList}");
            }

            lines.Add(string.Empty);
        }

        // Code blocks — only for key entry points; generated blocks last (stable).
        if (context.CodeBlocks.Count > 0)
        {
            var orderedBlocks = context.CodeBlocks
                .OrderBy(b => CodeGraphGeneratedDetection.IsGeneratedFile(b.FilePath) ? 1 : 0)
                .ToList();
            lines.Add("### Code\n");
            foreach (var block in orderedBlocks)
            {
                var nodeName = block.Node?.Name ?? "Unknown";
                lines.Add($"#### {nodeName} ({block.FilePath}:{block.StartLine})\n");
                lines.Add("```" + block.Language);
                lines.Add(block.Content);
                lines.Add("```\n");
            }
        }

        return string.Join("\n", lines);
    }

    // formatContextAsJson (context/formatter.ts:97). Structured JSON for programmatic use.
    public static string FormatAsJson(CodeGraphTaskContext context)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = true }))
        {
            writer.WriteStartObject();
            writer.WriteString("query", context.Query);
            writer.WriteString("summary", context.Summary);

            writer.WritePropertyName("entryPoints");
            writer.WriteStartArray();
            foreach (var node in context.EntryPoints)
            {
                WriteSerializedNode(writer, node);
            }

            writer.WriteEndArray();

            writer.WritePropertyName("nodes");
            writer.WriteStartArray();
            foreach (var node in context.Subgraph.Nodes.Values)
            {
                WriteSerializedNode(writer, CodeGraphNodeView.From(node));
            }

            writer.WriteEndArray();

            writer.WritePropertyName("edges");
            writer.WriteStartArray();
            foreach (var edge in context.Subgraph.Edges)
            {
                WriteSerializedEdge(writer, edge);
            }

            writer.WriteEndArray();

            writer.WritePropertyName("codeBlocks");
            writer.WriteStartArray();
            foreach (var block in context.CodeBlocks)
            {
                writer.WriteStartObject();
                writer.WriteString("filePath", block.FilePath);
                writer.WriteNumber("startLine", block.StartLine);
                writer.WriteNumber("endLine", block.EndLine);
                writer.WriteString("language", block.Language);
                writer.WriteString("content", block.Content);
                WriteNullableString(writer, "nodeName", block.Node?.Name);
                WriteNullableString(writer, "nodeKind", block.Node?.Kind);
                writer.WriteEndObject();
            }

            writer.WriteEndArray();

            writer.WritePropertyName("relatedFiles");
            writer.WriteStartArray();
            foreach (var file in context.RelatedFiles)
            {
                writer.WriteStringValue(file);
            }

            writer.WriteEndArray();

            writer.WritePropertyName("stats");
            writer.WriteStartObject();
            writer.WriteNumber("nodeCount", context.Stats.NodeCount);
            writer.WriteNumber("edgeCount", context.Stats.EdgeCount);
            writer.WriteNumber("fileCount", context.Stats.FileCount);
            writer.WriteNumber("codeBlockCount", context.Stats.CodeBlockCount);
            writer.WriteNumber("totalCodeSize", context.Stats.TotalCodeSize);
            writer.WriteEndObject();

            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }

    // serializeNode (context/formatter.ts:237) — the projected field subset.
    private static void WriteSerializedNode(Utf8JsonWriter writer, CodeGraphNodeView node)
    {
        writer.WriteStartObject();
        writer.WriteString("id", node.Id);
        writer.WriteString("kind", node.Kind);
        writer.WriteString("name", node.Name);
        writer.WriteString("qualifiedName", node.QualifiedName);
        writer.WriteString("filePath", node.FilePath);
        writer.WriteString("language", node.Language);
        writer.WriteNumber("startLine", node.StartLine);
        writer.WriteNumber("endLine", node.EndLine);
        WriteNullableString(writer, "signature", node.Signature);
        WriteNullableString(writer, "docstring", node.Docstring);
        WriteNullableString(writer, "visibility", node.Visibility);
        writer.WriteBoolean("isExported", node.IsExported);
        writer.WriteBoolean("isAsync", node.IsAsync);
        writer.WriteBoolean("isStatic", node.IsStatic);
        writer.WriteEndObject();
    }

    // serializeEdge (context/formatter.ts:259).
    private static void WriteSerializedEdge(Utf8JsonWriter writer, CodeGraphEdge edge)
    {
        writer.WriteStartObject();
        writer.WriteString("source", edge.Source);
        writer.WriteString("target", edge.Target);
        writer.WriteString("kind", edge.Kind);
        if (edge.Line.HasValue)
        {
            writer.WriteNumber("line", edge.Line.Value);
        }
        else
        {
            writer.WriteNull("line");
        }

        if (edge.Column.HasValue)
        {
            writer.WriteNumber("column", edge.Column.Value);
        }
        else
        {
            writer.WriteNull("column");
        }

        writer.WriteEndObject();
    }

    private static void WriteNullableString(Utf8JsonWriter writer, string name, string? value)
    {
        if (value is null)
        {
            writer.WriteNull(name);
        }
        else
        {
            writer.WriteString(name, value);
        }
    }
}

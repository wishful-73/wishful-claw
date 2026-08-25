using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphReactRenderSynthesizer — reactRenderEdges (callback-synthesizer.ts:400).
// Phase.Main, always run (no language gate). React class-component re-render:
// `this.setState(...)` re-runs the component's `render()`, but that hop is React-
// internal (no static edge), so a flow "mutation -> setState -> repaint" dead-ends at
// setState. Bridge it: for each class with a `render` method, link every sibling
// method whose body calls `this.setState(` -> `render`. The setState gate keeps this
// to React class components; over-approximation accepted (reachability-correct).
// =============================================================================
internal sealed class CodeGraphReactRenderSynthesizer : ICodeGraphEdgeSynthesizer
{
    // SETSTATE_RE (ts:40).
    private static readonly Regex SetStateRe = new(@"this\.setState\s*\(", RegexOptions.ECMAScript);

    private static readonly string[] Always = System.Array.Empty<string>();

    public string Name => "react-render";

    public IReadOnlyList<string> RequiredLanguages => Always;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var scanned = 0;
        foreach (var cls in ctx.IterateNodesByKind(CodeGraphNodeKind.Class))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            var children = CodeGraphSynthesizerSupport.MethodsOf(ctx, cls.Id);
            CodeGraphNode? render = null;
            foreach (var child in children)
            {
                if (child.Name == "render")
                {
                    render = child;
                    break;
                }
            }

            if (render is null)
            {
                continue;
            }

            var added = 0;
            foreach (var m in children)
            {
                if (added >= CodeGraphSynthesizerSupport.MaxCallbacksPerChannel)
                {
                    break;
                }

                if (m.Id == render.Id)
                {
                    continue;
                }

                var content = ctx.ReadFile(m.FilePath);
                var src = string.IsNullOrEmpty(content)
                    ? null
                    : CodeGraphSynthesizerSupport.SliceLines(content, m.StartLine, m.EndLine);
                if (string.IsNullOrEmpty(src) || !SetStateRe.IsMatch(src))
                {
                    continue;
                }

                var key = m.Id + ">" + render.Id;
                if (!seen.Add(key))
                {
                    continue;
                }

                edges.Add(new CodeGraphEdge(
                    m.Id,
                    render.Id,
                    CodeGraphEdgeKind.Calls,
                    CodeGraphSynthesizerSupport.Metadata(
                        ("synthesizedBy", "react-render"),
                        ("via", "setState"),
                        ("registeredAt", render.FilePath + ":" + render.StartLine)),
                    m.StartLine,
                    Column: null,
                    CodeGraphProvenance.Heuristic));
                added++;
            }
        }

        return edges;
    }
}

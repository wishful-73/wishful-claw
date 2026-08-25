using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphReactJsxChildSynthesizer — reactJsxChildEdges (callback-synthesizer.ts:
// 1204). Phase.Main, always run (no language gate). A component that returns
// `<Child .../>` mounts Child — React calls it — but JSX instantiation is not a
// static call edge, so a render tree breaks at the JSX hop. Link parent -> each
// capitalized JSX child it renders. File-oriented (read each JSX file once).
// Precision gate: the child name must resolve to a component/function/class node —
// TS generics like `Array<Foo>` resolve to a type (or nothing) and are dropped.
// =============================================================================
internal sealed class CodeGraphReactJsxChildSynthesizer : ICodeGraphEdgeSynthesizer
{
    // JSX_TAG_RE (ts:42) — a capitalized opening tag.
    private static readonly Regex JsxTagRe = new(@"<([A-Z][A-Za-z0-9_]*)[\s/>]", RegexOptions.ECMAScript);

    // PARENT_KINDS (ts:1208).
    private static readonly HashSet<string> ParentKinds = new(StringComparer.Ordinal)
    {
        CodeGraphNodeKind.Method, CodeGraphNodeKind.Function, CodeGraphNodeKind.Component
    };

    private static readonly string[] Always = System.Array.Empty<string>();

    public string Name => "jsx-render";

    public IReadOnlyList<string> RequiredLanguages => Always;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var scanned = 0;
        foreach (var file in ctx.GetAllFiles())
        {
            if ((++scanned & 255) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content) ||
                (!content.Contains("</", StringComparison.Ordinal) && !content.Contains("/>", StringComparison.Ordinal)))
            {
                continue; // JSX-file gate
            }

            var parents = new List<CodeGraphNode>();
            foreach (var n in ctx.GetNodesInFile(file))
            {
                if (ParentKinds.Contains(n.Kind))
                {
                    parents.Add(n);
                }
            }

            foreach (var parent in parents)
            {
                var src = CodeGraphSynthesizerSupport.SliceLines(content, parent.StartLine, parent.EndLine);
                if (string.IsNullOrEmpty(src) ||
                    (!src.Contains("</", StringComparison.Ordinal) && !src.Contains("/>", StringComparison.Ordinal)))
                {
                    continue;
                }

                // Distinct child tag names in the parent's body, insertion-ordered.
                var names = new List<string>();
                var nameSeen = new HashSet<string>(StringComparer.Ordinal);
                foreach (Match m in JsxTagRe.Matches(src))
                {
                    var nm = m.Groups[1].Value;
                    if (nameSeen.Add(nm))
                    {
                        names.Add(nm);
                    }
                }

                var added = 0;
                foreach (var name in names)
                {
                    if (added >= CodeGraphSynthesizerSupport.MaxJsxChildren)
                    {
                        break;
                    }

                    CodeGraphNode? child = null;
                    foreach (var cand in ctx.GetNodesByName(name))
                    {
                        if (cand.Kind == CodeGraphNodeKind.Component ||
                            cand.Kind == CodeGraphNodeKind.Function ||
                            cand.Kind == CodeGraphNodeKind.Class)
                        {
                            child = cand;
                            break;
                        }
                    }

                    if (child is null || child.Id == parent.Id)
                    {
                        continue;
                    }

                    var key = parent.Id + ">" + child.Id;
                    if (!seen.Add(key))
                    {
                        continue;
                    }

                    edges.Add(new CodeGraphEdge(
                        parent.Id,
                        child.Id,
                        CodeGraphEdgeKind.Calls,
                        CodeGraphSynthesizerSupport.Metadata(
                            ("synthesizedBy", "jsx-render"),
                            ("via", name)),
                        parent.StartLine,
                        Column: null,
                        CodeGraphProvenance.Heuristic));
                    added++;
                }
            }
        }

        return edges;
    }
}

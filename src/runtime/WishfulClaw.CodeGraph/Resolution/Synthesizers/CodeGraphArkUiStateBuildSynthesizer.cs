using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphArkUiStateBuildSynthesizer — arkuiStateBuildEdges (callback-
// synthesizer.ts:503). Phase.Main, gated to arkts. The ArkTS analog of
// react-render / flutter-build: assigning a reactive-decorated property
// (`@State count`, `@Link selected`, …) re-runs the `@Component struct`'s
// `build()`, but that hop is framework-internal — no static edge. Bridge it:
// for each arkts struct with a `build()` method and at least one reactive
// property, link every sibling method whose body ASSIGNS (or array-mutates) one
// of those OWN reactive property names → `build`. Assignment-gated on the
// struct's own reactive props (a read-only method, or a struct with none, gets
// nothing).
// =============================================================================
internal sealed class CodeGraphArkUiStateBuildSynthesizer : ICodeGraphEdgeSynthesizer
{
    // ARKUI_REACTIVE_DECORATORS (ts:481) — V1 (@Component) + V2 (@ComponentV2)
    // decorators whose assignment re-runs build().
    private static readonly HashSet<string> ReactiveDecorators = new(StringComparer.Ordinal)
    {
        "State", "Prop", "Link", "Provide", "Consume", "StorageLink", "StorageProp",
        "LocalStorageLink", "LocalStorageProp", "ObjectLink",
        "Local", "Provider", "Consumer"
    };

    // ARKUI_ARRAY_MUTATORS (ts:488) — observed-array mutators that re-render like
    // an assignment.
    private const string ArrayMutators = "push|pop|shift|unshift|splice|sort|reverse|fill";

    private static readonly string[] Required = { CodeGraphLanguage.ArkTs };

    public string Name => "arkui-state";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var scanned = 0;
        foreach (var structNode in ctx.IterateNodesByKind(CodeGraphNodeKind.Struct))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (structNode.Language != CodeGraphLanguage.ArkTs)
            {
                continue;
            }

            // All contained children (methods AND properties), not just methods.
            var children = new List<CodeGraphNode>();
            foreach (var e in ctx.GetOutgoingEdges(structNode.Id, CodeGraphSynthesizerSupport.ContainsEdgeKinds))
            {
                var n = ctx.GetNodeById(e.Target);
                if (n is not null)
                {
                    children.Add(n);
                }
            }

            CodeGraphNode? build = null;
            var reactiveProps = new List<CodeGraphNode>();
            foreach (var n in children)
            {
                if (n.Kind == CodeGraphNodeKind.Method && n.Name == "build" && build is null)
                {
                    build = n;
                }
                else if (n.Kind == CodeGraphNodeKind.Property && n.Decorators is not null)
                {
                    foreach (var d in n.Decorators)
                    {
                        if (ReactiveDecorators.Contains(d))
                        {
                            reactiveProps.Add(n);
                            break;
                        }
                    }
                }
            }

            if (build is null || reactiveProps.Count == 0)
            {
                continue;
            }

            var alternation = new System.Text.StringBuilder();
            for (var i = 0; i < reactiveProps.Count; i++)
            {
                if (i > 0)
                {
                    alternation.Append('|');
                }

                alternation.Append(Regex.Escape(reactiveProps[i].Name));
            }

            // `this.count = …` / `+=` / `++` / `--` / `this.todos.push(…)`. The
            // `=(?!=)` keeps `this.done == x` comparisons out.
            Regex mutationRe;
            try
            {
                mutationRe = new Regex(
                    "this\\.(?:" + alternation + ")\\s*(?:=(?!=)|\\+\\+|--|[+\\-*/%&|^]=|\\.(?:" +
                    ArrayMutators + ")\\s*\\()");
            }
            catch (ArgumentException)
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

                if (m.Kind != CodeGraphNodeKind.Method || m.Id == build.Id)
                {
                    continue;
                }

                var content = ctx.ReadFile(m.FilePath);
                var src = string.IsNullOrEmpty(content)
                    ? null
                    : CodeGraphSynthesizerSupport.SliceLines(content, m.StartLine, m.EndLine);
                if (string.IsNullOrEmpty(src))
                {
                    continue;
                }

                var safe = CodeGraphStripComments.StripForRegex(src, CodeGraphLanguage.TypeScript);
                if (!mutationRe.IsMatch(safe))
                {
                    continue;
                }

                var key = m.Id + ">" + build.Id;
                if (!seen.Add(key))
                {
                    continue;
                }

                edges.Add(new CodeGraphEdge(
                    m.Id,
                    build.Id,
                    CodeGraphEdgeKind.Calls,
                    CodeGraphSynthesizerSupport.Metadata(
                        ("synthesizedBy", "arkui-state"),
                        ("via", "state assignment"),
                        ("registeredAt", build.FilePath + ":" + build.StartLine)),
                    m.StartLine,
                    Column: null,
                    CodeGraphProvenance.Heuristic));
                added++;
            }
        }

        return edges;
    }
}

using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphFlutterBuildSynthesizer — flutterBuildEdges (callback-synthesizer.ts:
// 441). Phase.Main, gated to dart. The Flutter analog of react-render: a State
// class's `build()` re-runs whenever a sibling method calls `setState(() {…})`,
// but that framework-internal hop has no static call edge — so "onTap →
// _increment → setState → build" dead-ends at the mutator. Bridge it: for each
// class with a `build()` method in a `.dart` file, link every sibling method
// whose body calls `setState(` → `build` (capped per class).
// =============================================================================
internal sealed class CodeGraphFlutterBuildSynthesizer : ICodeGraphEdgeSynthesizer
{
    // FLUTTER_SETSTATE_RE (ts:41) — `setState((){…})` / `this.setState`.
    private static readonly Regex SetStateRe = new(@"\bsetState\s*\(", RegexOptions.ECMAScript);

    private static readonly string[] Required = { CodeGraphLanguage.Dart };

    public string Name => "flutter-build";

    public IReadOnlyList<string> RequiredLanguages => Required;

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
            CodeGraphNode? build = null;
            foreach (var n in children)
            {
                if (n.Name == "build")
                {
                    build = n;
                    break;
                }
            }

            if (build is null || !build.FilePath.EndsWith(".dart", StringComparison.Ordinal))
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

                if (m.Id == build.Id)
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
                        ("synthesizedBy", "flutter-build"),
                        ("via", "setState"),
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

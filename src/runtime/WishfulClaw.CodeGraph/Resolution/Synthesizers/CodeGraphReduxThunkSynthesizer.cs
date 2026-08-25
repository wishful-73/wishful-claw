using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphReduxThunkSynthesizer — reduxThunkEdges (callback-synthesizer.ts:2059).
// Phase.Main, JS family gate (ts:3529 has(...JS_FAMILY)). Redux-thunk dispatch chain:
// `export const X = createAsyncThunk(prefix, async (a, api) => {...})` passes the async
// body as an ARGUMENT, so tree-sitter never extracts it as a function node — `X` is a
// `constant` whose body calls are ORPHANED, and a flow `dispatch(X()) -> X -> nextThunk`
// dead-ends at the constant. Bridge it: body-scan each thunk constant for
// `dispatch(Y(...))` and link X -> Y. High-precision — the initializer (in `signature`)
// must be a create(Async)Thunk call, and Y must resolve to a function/constant/method;
// capped; cross-file by design. Provenance heuristic, synthesizedBy 'redux-thunk'.
// =============================================================================
internal sealed class CodeGraphReduxThunkSynthesizer : ICodeGraphEdgeSynthesizer
{
    // THUNK_DECL_RE (ts:2055) — the initializer / candidate-signature gate.
    private static readonly Regex ThunkDeclRe = new(@"create(?:Async)?Thunk", RegexOptions.ECMAScript);

    // THUNK_DISPATCH_RE (ts:2056) — `dispatch(<name>` followed by `(`, `,` or `)`.
    private static readonly Regex ThunkDispatchRe = new(
        @"\bdispatch\s*\(\s*([A-Za-z_]\w*)\s*[(),]",
        RegexOptions.ECMAScript);

    // THUNK_FANOUT_CAP (ts:2057).
    private const int ThunkFanoutCap = 24;

    // has(...JS_FAMILY) (ts:3480/3529).
    private static readonly string[] Required =
    {
        CodeGraphLanguage.TypeScript, CodeGraphLanguage.JavaScript,
        CodeGraphLanguage.Tsx, CodeGraphLanguage.Jsx
    };

    public string Name => "redux-thunk";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var scanned = 0;
        foreach (var node in ctx.IterateNodesByKind(CodeGraphNodeKind.Constant))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            // Cheap gate: the initializer (captured in `signature`) must be a
            // create(Async)Thunk call — avoids reading every constant's body.
            if (string.IsNullOrEmpty(node.Signature) || !ThunkDeclRe.IsMatch(node.Signature))
            {
                continue;
            }

            var content = ctx.ReadFile(node.FilePath);
            var src = string.IsNullOrEmpty(content)
                ? null
                : CodeGraphSynthesizerSupport.SliceLines(content, node.StartLine, node.EndLine);
            if (string.IsNullOrEmpty(src))
            {
                continue;
            }

            // Thunks are TS/JS-family (same comment syntax); map to a CommentLang.
            var lang = node.Language == CodeGraphLanguage.JavaScript || node.Language == CodeGraphLanguage.Jsx
                ? CodeGraphLanguage.JavaScript
                : CodeGraphLanguage.TypeScript;
            var safe = CodeGraphStripComments.StripForRegex(src, lang);
            var lineOf = CodeGraphSynthesizerSupport.MakeLineAt(safe, node.StartLine);

            var added = 0;
            foreach (Match m in ThunkDispatchRe.Matches(safe))
            {
                if (added >= ThunkFanoutCap)
                {
                    break;
                }

                var name = m.Groups[1].Value;
                if (name == node.Name)
                {
                    continue; // self-dispatch (recursive thunk) — skip
                }

                // Resolve the dispatched name, PREFERRING the thunk/action-creator over a
                // same-named service function: thunk const > other const > same-file
                // callable > first match. A single candidate (no collision) is unaffected.
                var cands = new List<CodeGraphNode>();
                foreach (var n in ctx.GetNodesByName(name))
                {
                    if (n.Kind == CodeGraphNodeKind.Constant ||
                        n.Kind == CodeGraphNodeKind.Function ||
                        n.Kind == CodeGraphNodeKind.Method)
                    {
                        cands.Add(n);
                    }
                }

                CodeGraphNode? target = null;
                foreach (var c in cands)
                {
                    if (!string.IsNullOrEmpty(c.Signature) && ThunkDeclRe.IsMatch(c.Signature))
                    {
                        target = c;
                        break;
                    }
                }

                if (target is null)
                {
                    foreach (var c in cands)
                    {
                        if (c.Kind == CodeGraphNodeKind.Constant)
                        {
                            target = c;
                            break;
                        }
                    }
                }

                if (target is null)
                {
                    foreach (var c in cands)
                    {
                        if (c.FilePath == node.FilePath)
                        {
                            target = c;
                            break;
                        }
                    }
                }

                if (target is null && cands.Count > 0)
                {
                    target = cands[0];
                }

                if (target is null || target.Id == node.Id)
                {
                    continue;
                }

                var key = node.Id + ">" + target.Id;
                if (!seen.Add(key))
                {
                    continue;
                }

                var line = lineOf(m.Index);
                edges.Add(new CodeGraphEdge(
                    node.Id,
                    target.Id,
                    CodeGraphEdgeKind.Calls,
                    CodeGraphSynthesizerSupport.Metadata(
                        ("synthesizedBy", "redux-thunk"),
                        ("via", name),
                        ("registeredAt", node.FilePath + ":" + line)),
                    line,
                    Column: null,
                    CodeGraphProvenance.Heuristic));
                added++;
            }
        }

        return edges;
    }
}

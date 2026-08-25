using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphClosureCollectionSynthesizer — closureCollectionEdges (callback-
// synthesizer.ts:252). Phase.Main, ALWAYS run (RequiredLanguages empty) — the
// per-node CC_LANGUAGES gate does the real filtering. Language-agnostic (Swift-first)
// closure-collection dynamic dispatch: one method appends a closure to a collection
// property; another iterates that property INVOKING each element (`coll.forEach { $0() }`
// / `{ it() }`). The element-invoke (`$0(` / `it(`) proves the collection holds
// closures, so pairing a dispatcher to same-named registrars (`.append`/`.add`/
// `.push`/`.insert`, incl. Swift `prop.write { $0.append }`) is high-precision.
// Cross-file/class by design (Alamofire appends in DataRequest.validate, iterates in
// base Request.didCompleteTask — neither same-file nor same-class pairing reaches it).
//
// The dispatcher gate (`{ $0(` / `{ it(`) is Swift/Kotlin trailing-closure syntax, so
// only those languages can contribute a dispatcher; gating BOTH sides to CC_LANGUAGES
// is precision AND perf (`.push(`/`.add(` is everywhere in JS/PHP — an ungated scan
// slices+regexes nearly every function on repos that can't emit an edge, #1235).
// =============================================================================
internal sealed class CodeGraphClosureCollectionSynthesizer : ICodeGraphEdgeSynthesizer
{
    // CC_DISPATCH_RE (ts:65) / CC_APPEND_WRITE_RE (ts:66) / CC_APPEND_DIRECT_RE (ts:67).
    private static readonly Regex DispatchRe = new(
        @"(\w+)\.forEach\s*\{\s*(?:\$0|it)\s*\(",
        RegexOptions.ECMAScript);

    private static readonly Regex AppendWriteRe = new(
        @"(\w+)\.write\s*\{\s*\$0(?:\.(\w+))?\.(?:append|add|push|insert)\s*\(",
        RegexOptions.ECMAScript);

    private static readonly Regex AppendDirectRe = new(
        @"(\w+)\.(?:append|add|push|insert)\s*\(",
        RegexOptions.ECMAScript);

    // CC_FANOUT_CAP (ts:68) — skip a field name with more dispatchers/registrars than
    // this (too generic to pair confidently).
    private const int CcFanoutCap = 8;

    // CC_LANGUAGES (ts:77) — only Swift/Kotlin trailing-closure syntax qualifies.
    private static readonly HashSet<string> CcLanguages = new(StringComparer.Ordinal)
    {
        CodeGraphLanguage.Swift, CodeGraphLanguage.Kotlin
    };

    private static readonly string[] Always = System.Array.Empty<string>();

    public string Name => "closure-collection";

    public IReadOnlyList<string> RequiredLanguages => Always;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        // field -> dispatcher methods (+ forEach line); field -> registrar methods
        // (+ append line). Insertion order preserved (== JS Map) for stable pairing.
        var dispatchers = new Dictionary<string, List<(CodeGraphNode Node, int Line)>>(StringComparer.Ordinal);
        var registrars = new Dictionary<string, List<(CodeGraphNode Node, int Line)>>(StringComparer.Ordinal);

        void AddReg(string? field, CodeGraphNode node, int absLine)
        {
            // `$0.append` mis-captures the `0`; the write-RE owns that field. Also drop
            // an empty capture.
            if (string.IsNullOrEmpty(field) || IsAllDigits(field))
            {
                return;
            }

            if (!registrars.TryGetValue(field, out var arr))
            {
                arr = new List<(CodeGraphNode, int)>();
                registrars[field] = arr;
            }

            if (!ContainsNode(arr, node.Id))
            {
                arr.Add((node, absLine));
            }
        }

        var scanned = 0;
        foreach (var m in MethodAndFunctionNodes(ctx))
        {
            if ((++scanned & 127) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!CcLanguages.Contains(m.Language))
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

            var hasForEach = src.Contains(".forEach", StringComparison.Ordinal);
            var hasAppend = src.Contains(".append(", StringComparison.Ordinal) ||
                            src.Contains(".add(", StringComparison.Ordinal) ||
                            src.Contains(".push(", StringComparison.Ordinal) ||
                            src.Contains(".insert(", StringComparison.Ordinal);
            if (!hasForEach && !hasAppend)
            {
                continue;
            }

            var lineAt = CodeGraphSynthesizerSupport.MakeLineAt(src, m.StartLine);

            if (hasForEach)
            {
                foreach (Match d in DispatchRe.Matches(src))
                {
                    var field = d.Groups[1].Value;
                    if (!dispatchers.TryGetValue(field, out var arr))
                    {
                        arr = new List<(CodeGraphNode, int)>();
                        dispatchers[field] = arr;
                    }

                    if (!ContainsNode(arr, m.Id))
                    {
                        arr.Add((m, lineAt(d.Index)));
                    }
                }
            }

            if (hasAppend)
            {
                foreach (Match w in AppendWriteRe.Matches(src))
                {
                    // nested `$0.streams` else the `.write` receiver.
                    var field = w.Groups[2].Success && w.Groups[2].Value.Length > 0
                        ? w.Groups[2].Value
                        : w.Groups[1].Value;
                    AddReg(field, m, lineAt(w.Index));
                }

                foreach (Match a in AppendDirectRe.Matches(src))
                {
                    AddReg(a.Groups[1].Value, m, lineAt(a.Index));
                }
            }
        }

        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (field, disps) in dispatchers)
        {
            if (!registrars.TryGetValue(field, out var regs) || regs.Count == 0)
            {
                continue;
            }

            // Generic field name — can't pair confidently.
            if (disps.Count > CcFanoutCap || regs.Count > CcFanoutCap)
            {
                continue;
            }

            foreach (var disp in disps)
            {
                foreach (var reg in regs)
                {
                    if (disp.Node.Id == reg.Node.Id)
                    {
                        continue;
                    }

                    var key = disp.Node.Id + ">" + reg.Node.Id;
                    if (!seen.Add(key))
                    {
                        continue;
                    }

                    edges.Add(new CodeGraphEdge(
                        disp.Node.Id,
                        reg.Node.Id,
                        CodeGraphEdgeKind.Calls,
                        CodeGraphSynthesizerSupport.Metadata(
                            ("synthesizedBy", "closure-collection"),
                            ("field", field),
                            ("registeredAt", reg.Node.FilePath + ":" + reg.Line)),
                        disp.Line,
                        Column: null,
                        CodeGraphProvenance.Heuristic));
                }
            }
        }

        return edges;
    }

    // Stream method + function nodes lazily (methodAndFunctionNodes, ts:173).
    private static IEnumerable<CodeGraphNode> MethodAndFunctionNodes(CodeGraphResolutionContext ctx)
    {
        foreach (var n in ctx.IterateNodesByKind(CodeGraphNodeKind.Method))
        {
            yield return n;
        }

        foreach (var n in ctx.IterateNodesByKind(CodeGraphNodeKind.Function))
        {
            yield return n;
        }
    }

    private static bool ContainsNode(List<(CodeGraphNode Node, int Line)> arr, string nodeId)
    {
        foreach (var e in arr)
        {
            if (e.Node.Id == nodeId)
            {
                return true;
            }
        }

        return false;
    }

    // /^\d+$/ — ASCII digits only, matching JS `\d` (a purely-numeric mis-capture).
    private static bool IsAllDigits(string s)
    {
        foreach (var c in s)
        {
            if (c < '0' || c > '9')
            {
                return false;
            }
        }

        return s.Length > 0;
    }
}

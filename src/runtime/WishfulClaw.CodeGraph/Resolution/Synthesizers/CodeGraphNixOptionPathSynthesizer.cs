using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphNixOptionPathSynthesizer — nixOptionPathEdges (callback-synthesizer.ts:
// 3060). Phase.Main, gated to nix. Nix module-system option wiring: an option is
// DECLARED in one module (`options.launchd.user.agents = mkOption { ... }`) and SET
// in others (`launchd.user.agents.yabai = { ... }`) — unified inside the module
// evaluator, so there is no static edge. Link each config-write binding to the
// option declaration whose path is the longest static-segment prefix of the write
// path. Precision gates: static segments only, matched prefix ≥2 segments,
// single-file declarations only (ambiguous → no edge), writes inside an options
// block excluded (declaration internals).
// =============================================================================
internal sealed class CodeGraphNixOptionPathSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly Regex PlainSegRe = new(@"^[A-Za-z_][A-Za-z0-9_'-]*$", RegexOptions.CultureInvariant);

    private static readonly string[] Required = { CodeGraphLanguage.Nix };

    // The sentinel prefix marking a submodule's own (non-global) namespace (ts:3095).
    private const string Submodule = " submodule";

    public string Name => "nix-option-path";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    private sealed class Rec
    {
        public required string Id;
        public required string FilePath;
        public required int StartLine;
        public required int EndLine;
        public required List<string> Segs;
    }

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        // One streaming pass over nix bindings (variables + the odd function-valued
        // option); memory stays O(bindings-kept).
        var byFile = new Dictionary<string, List<Rec>>(StringComparer.Ordinal);
        var scanned = 0;
        foreach (var kind in new[] { CodeGraphNodeKind.Variable, CodeGraphNodeKind.Function })
        {
            foreach (var node in ctx.IterateNodesByKind(kind))
            {
                if ((++scanned & 63) == 0)
                {
                    ct.ThrowIfCancellationRequested();
                }

                if (node.Language != CodeGraphLanguage.Nix)
                {
                    continue;
                }

                var segs = NixLeadingPlainSegments(node.Name);
                if (segs.Count == 0)
                {
                    continue;
                }

                var rec = new Rec
                {
                    Id = node.Id,
                    FilePath = node.FilePath,
                    StartLine = node.StartLine,
                    EndLine = node.EndLine,
                    Segs = segs
                };
                if (byFile.TryGetValue(node.FilePath, out var arr))
                {
                    arr.Add(rec);
                }
                else
                {
                    byFile[node.FilePath] = new List<Rec> { rec };
                }
            }
        }

        var decls = new Dictionary<string, List<Rec>>(StringComparer.Ordinal);
        var writes = new List<Rec>();

        void Register(List<string> path, Rec rec)
        {
            if (path.Count < 2 || path.Contains(Submodule))
            {
                return;
            }

            var key = string.Join(".", path);
            if (decls.TryGetValue(key, out var arr))
            {
                arr.Add(rec);
            }
            else
            {
                decls[key] = new List<Rec> { rec };
            }
        }

        foreach (var recs in byFile.Values)
        {
            recs.Sort((a, b) =>
            {
                var c = a.StartLine - b.StartLine;
                return c != 0 ? c : b.EndLine - a.EndLine;
            });

            var stack = new List<(int Start, int End, List<string> Prefix)>();
            foreach (var rec in recs)
            {
                while (stack.Count > 0 && stack[^1].End < rec.StartLine)
                {
                    stack.RemoveAt(stack.Count - 1);
                }

                // Strict containment at line granularity.
                (int Start, int End, List<string> Prefix)? enclosing = null;
                if (stack.Count > 0)
                {
                    var top = stack[^1];
                    if (rec.StartLine >= top.Start && rec.EndLine <= top.End &&
                        !(rec.StartLine == top.Start && rec.EndLine == top.End))
                    {
                        enclosing = top;
                    }
                }

                if (rec.Segs[0] == "options")
                {
                    var ownPath = rec.Segs.GetRange(1, rec.Segs.Count - 1);
                    var prefix = enclosing is not null ? new List<string> { Submodule } : ownPath;
                    Register(prefix, rec);
                    stack.Add((rec.StartLine, rec.EndLine, prefix));
                    continue;
                }

                if (enclosing is not null)
                {
                    var composed = new List<string>(enclosing.Value.Prefix);
                    composed.AddRange(rec.Segs);
                    Register(composed, rec);
                    stack.Add((rec.StartLine, rec.EndLine, composed));
                    continue;
                }

                if (rec.Segs.Count >= 2)
                {
                    writes.Add(rec);
                }
            }
        }

        var edges = new List<CodeGraphEdge>();
        if (decls.Count == 0 || writes.Count == 0)
        {
            return edges;
        }

        foreach (var w in writes)
        {
            // `config.services.x = ...` spells the same write with an explicit prefix.
            var segs = w.Segs.Count > 0 && w.Segs[0] == "config"
                ? w.Segs.GetRange(1, w.Segs.Count - 1)
                : w.Segs;
            if (segs.Count < 2)
            {
                continue;
            }

            // Longest prefix wins; ambiguous longest does NOT fall back to shorter.
            for (var len = Math.Min(segs.Count, 6); len >= 2; len--)
            {
                var optionPath = string.Join(".", segs.GetRange(0, len));
                if (!decls.TryGetValue(optionPath, out var candidates) || candidates.Count == 0)
                {
                    continue;
                }

                var files = new HashSet<string>(StringComparer.Ordinal);
                foreach (var c in candidates)
                {
                    files.Add(c.FilePath);
                }

                if (files.Count == 1)
                {
                    var target = candidates[0];
                    if (target.Id != w.Id)
                    {
                        edges.Add(new CodeGraphEdge(
                            w.Id,
                            target.Id,
                            CodeGraphEdgeKind.References,
                            CodeGraphSynthesizerSupport.Metadata(
                                ("synthesizedBy", "nix-option-path"),
                                ("optionPath", optionPath),
                                ("registeredAt", target.FilePath + ":" + target.StartLine)),
                            w.StartLine,
                            Column: null,
                            CodeGraphProvenance.Heuristic));
                    }
                }

                break; // longest hit decides, matched or ambiguous
            }
        }

        return edges;
    }

    // nixLeadingPlainSegments (ts:3022): the leading STATIC segments of a dotted
    // binding name — plain identifiers, plus quoted segments as opaque verbatim
    // tokens; an interpolated (`${...}`) segment ends the prefix.
    private static List<string> NixLeadingPlainSegments(string name)
    {
        var segs = new List<string>();
        var i = 0;
        var n = name.Length;
        while (i < n)
        {
            if (name[i] == '"')
            {
                var j = i + 1;
                while (j < n && name[j] != '"')
                {
                    if (name[j] == '\\')
                    {
                        j++;
                    }

                    j++;
                }

                if (j >= n)
                {
                    return segs; // unterminated — stop at the static head
                }

                var tok = name.Substring(i, j - i + 1);
                if (tok.Contains("${", StringComparison.Ordinal))
                {
                    return segs; // interpolated → dynamic → stop
                }

                segs.Add(tok);
                i = j + 1;
                if (i >= n)
                {
                    break;
                }

                if (name[i] != '.')
                {
                    return segs;
                }

                i++;
                continue;
            }

            var k = i;
            while (k < n && name[k] != '.')
            {
                if (name[k] == '"' || (name[k] == '$' && k + 1 < n && name[k + 1] == '{'))
                {
                    return segs;
                }

                k++;
            }

            var seg = name.Substring(i, k - i);
            if (!PlainSegRe.IsMatch(seg))
            {
                return segs;
            }

            segs.Add(seg);
            i = k + 1;
        }

        return segs;
    }
}

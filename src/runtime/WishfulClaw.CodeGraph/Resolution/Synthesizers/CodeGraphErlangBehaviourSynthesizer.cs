using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphErlangBehaviourSynthesizer — erlangBehaviourDispatchEdges (callback-
// synthesizer.ts:3176). Phase.Main, gated to erlang. An Erlang behaviour declares
// `-callback fn(...)`; an implementer module `-behaviour(X)` exports `fn`. A
// var-module call `Mod:fn(...)` dispatches dynamically to the implementer's `fn`,
// with no static edge. Bridge it: for each `Var:fn(` dispatch site whose `fn/arity`
// is declared by exactly ONE behaviour, link the enclosing function → each
// implementer module's exported `fn` (via the `implements` edges), behind a
// fan-out cap so mega-behaviours don't mint arbitrary coverage.
//
// SIMPLIFICATION vs TS: the impl-target gate `n.isExported !== false` (keep unless
// explicitly non-exported) maps to `n.IsExported` here — the C# node model has no
// tri-state `undefined`, so this keeps only nodes extraction marked exported.
// =============================================================================
internal sealed class CodeGraphErlangBehaviourSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly Regex ErlangExtRe = new(@"\.(?:erl|hrl)$", RegexOptions.CultureInvariant);

    // ERLANG_DISPATCH_RE (ts:2954) — `Var:fn(`.
    private static readonly Regex DispatchRe = new(
        @"(^|[^?\w@'])([A-Z][A-Za-z0-9_@]*):([a-z][A-Za-z0-9_@]*)\(",
        RegexOptions.CultureInvariant);

    // ERLANG_CALLBACK_DECL_RE (ts:2955).
    private static readonly Regex CallbackDeclRe = new(
        @"(^|\n)\s*-callback\s+('[^'\n]+'|[a-z][A-Za-z0-9_@]*)\s*\(",
        RegexOptions.CultureInvariant);

    // Cheap pre-filter for pass 2 (ts:3252).
    private static readonly Regex QuickCheckRe = new(@"[A-Z][A-Za-z0-9_@]*:[a-z]", RegexOptions.CultureInvariant);

    // ERLANG_BEHAVIOUR_FANOUT_CAP (ts:2956).
    private const int FanoutCap = 24;

    private static readonly string[] Required = { CodeGraphLanguage.Erlang };

    public string Name => "erlang-behaviour";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        // Cheap language gate: stream the namespace kind once, keep erlang only.
        var erlangModules = new List<CodeGraphNode>();
        var scanned = 0;
        foreach (var n in ctx.IterateNodesByKind(CodeGraphNodeKind.Namespace))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (n.Language == CodeGraphLanguage.Erlang)
            {
                erlangModules.Add(n);
            }
        }

        var edges = new List<CodeGraphEdge>();
        if (erlangModules.Count == 0)
        {
            return edges;
        }

        var moduleByFile = new Dictionary<string, CodeGraphNode>(StringComparer.Ordinal);
        foreach (var ns in erlangModules)
        {
            if (!moduleByFile.ContainsKey(ns.FilePath))
            {
                moduleByFile[ns.FilePath] = ns;
            }
        }

        // Pass 1 — behaviour `-callback` declarations.
        var declaringBehaviours = new Dictionary<string, List<CodeGraphNode>>(StringComparer.Ordinal);
        var callbackNames = new HashSet<string>(StringComparer.Ordinal);
        var scannedFiles = 0;
        foreach (var file in ctx.GetAllFiles())
        {
            if ((++scannedFiles & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!ErlangExtRe.IsMatch(file) || !moduleByFile.TryGetValue(file, out var behaviour))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content) || !content.Contains("-callback", StringComparison.Ordinal))
            {
                continue;
            }

            var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Erlang);
            foreach (Match m in CallbackDeclRe.Matches(safe))
            {
                var name = m.Groups[2].Value.Trim('\'');
                var arity = ErlangArityAt(safe, m.Index + m.Length - 1);
                if (arity < 0)
                {
                    continue;
                }

                var key = name + "/" + arity;
                if (declaringBehaviours.TryGetValue(key, out var arr))
                {
                    var present = false;
                    foreach (var b in arr)
                    {
                        if (b.Id == behaviour.Id)
                        {
                            present = true;
                            break;
                        }
                    }

                    if (!present)
                    {
                        arr.Add(behaviour);
                    }
                }
                else
                {
                    declaringBehaviours[key] = new List<CodeGraphNode> { behaviour };
                }

                callbackNames.Add(name);
            }
        }

        if (declaringBehaviours.Count == 0)
        {
            return edges;
        }

        // Implementer target lookup, lazy per (behaviour, fn).
        var targetCache = new Dictionary<string, List<CodeGraphNode>>(StringComparer.Ordinal);

        List<CodeGraphNode> TargetsOf(CodeGraphNode behaviour, string fn)
        {
            var cacheKey = behaviour.Id + "#" + fn;
            if (targetCache.TryGetValue(cacheKey, out var cached))
            {
                return cached;
            }

            var targets = new List<CodeGraphNode>();
            foreach (var e in ctx.GetIncomingEdges(behaviour.Id, ImplementsOnly))
            {
                var impl = ctx.GetNodeById(e.Source);
                if (impl is null || impl.Language != CodeGraphLanguage.Erlang || impl.Kind != CodeGraphNodeKind.Namespace)
                {
                    continue;
                }

                foreach (var node in ctx.GetNodesInFile(impl.FilePath))
                {
                    if (node.Kind == CodeGraphNodeKind.Function && node.Name == fn && node.IsExported)
                    {
                        targets.Add(node);
                    }
                }
            }

            targetCache[cacheKey] = targets;
            return targets;
        }

        // Pass 2 — dispatch sites.
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in ctx.GetAllFiles())
        {
            if ((++scannedFiles & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!ErlangExtRe.IsMatch(file))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content) || !QuickCheckRe.IsMatch(content))
            {
                continue;
            }

            var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Erlang);
            var nodesInFile = ctx.GetNodesInFile(file);
            var lineAt = CodeGraphSynthesizerSupport.MakeLineAt(safe, 1);

            foreach (Match m in DispatchRe.Matches(safe))
            {
                var fn = m.Groups[3].Value;
                if (!callbackNames.Contains(fn))
                {
                    continue;
                }

                var openIdx = m.Index + m.Length - 1;
                var arity = ErlangArityAt(safe, openIdx);
                if (arity < 0)
                {
                    continue;
                }

                if (!declaringBehaviours.TryGetValue(fn + "/" + arity, out var behaviours) || behaviours.Count != 1)
                {
                    continue; // unknown or ambiguous
                }

                var behaviour = behaviours[0];
                var targets = TargetsOf(behaviour, fn);
                if (targets.Count == 0 || targets.Count > FanoutCap)
                {
                    continue;
                }

                var line = lineAt(m.Index);
                var disp = CodeGraphSynthesizerSupport.EnclosingFn(nodesInFile, line);
                if (disp is null)
                {
                    continue;
                }

                foreach (var target in targets)
                {
                    if (target.Id == disp.Id)
                    {
                        continue;
                    }

                    var key = disp.Id + ">" + target.Id;
                    if (!seen.Add(key))
                    {
                        continue;
                    }

                    edges.Add(new CodeGraphEdge(
                        disp.Id,
                        target.Id,
                        CodeGraphEdgeKind.Calls,
                        CodeGraphSynthesizerSupport.Metadata(
                            ("synthesizedBy", "erlang-behaviour"),
                            ("via", behaviour.Name + ":" + fn + "/" + arity),
                            ("registeredAt", file + ":" + line)),
                        line,
                        Column: null,
                        CodeGraphProvenance.Heuristic));
                }
            }
        }

        return edges;
    }

    private static readonly string[] ImplementsOnly = { CodeGraphEdgeKind.Implements };

    // erlangArityAt (ts:2964) — arg count of the call/decl whose `(` is at openIdx;
    // `()` → 0, unbalanced/oversized → -1. Skips nested brackets, strings, atoms,
    // and `$c` char literals.
    private static int ErlangArityAt(string src, int openIdx)
    {
        var depth = 1;
        var commas = 0;
        var sawArg = false;
        var limit = Math.Min(src.Length, openIdx + 4000);
        for (var i = openIdx + 1; i < limit; i++)
        {
            var ch = src[i];
            if (ch == '"' || ch == '\'')
            {
                i++;
                while (i < limit && src[i] != ch)
                {
                    if (src[i] == '\\')
                    {
                        i++;
                    }

                    i++;
                }

                sawArg = true;
                continue;
            }

            if (ch == '$')
            {
                i++;
                if (i < limit && src[i] == '\\')
                {
                    i++;
                }

                sawArg = true;
                continue;
            }

            if (ch == '(' || ch == '[' || ch == '{')
            {
                depth++;
                sawArg = true;
                continue;
            }

            if (ch == ')' || ch == ']' || ch == '}')
            {
                depth--;
                if (depth == 0)
                {
                    return sawArg ? commas + 1 : 0;
                }

                continue;
            }

            if (ch == ',' && depth == 1)
            {
                commas++;
                continue;
            }

            if (!char.IsWhiteSpace(ch))
            {
                sawArg = true;
            }
        }

        return -1;
    }
}

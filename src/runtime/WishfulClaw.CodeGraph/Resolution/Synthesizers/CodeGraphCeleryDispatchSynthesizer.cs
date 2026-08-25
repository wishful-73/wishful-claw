using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphCeleryDispatchSynthesizer — celeryDispatchEdges (callback-synthesizer.ts:
// 2524). Phase.Main, gate has('python') (ts:3534). Celery decouples a task's call site
// from its body through async dispatch:
//   @shared_task                        # also @app.task / @<app>.task / @task
//   def process(account_ids): ...
//   process.apply_async(kwargs={...})   # or process.delay(...) — dynamic, no static edge
// Bridge it: link the enclosing function/method at each `.delay(`/`.apply_async(` site ->
// the task function body. Precision rests on the DECORATOR gate — the dispatched name must
// resolve to a Python function carrying a celery task decorator (read from the source
// lines ABOVE its `def`, since the def's own startLine excludes the decorator). Same-file /
// unique-candidate disambiguation; canvas forms have no single identifier before `.delay`
// so they're skipped, not mis-bridged.
// =============================================================================
internal sealed class CodeGraphCeleryDispatchSynthesizer : ICodeGraphEdgeSynthesizer
{
    // CELERY_DISPATCH_RE (ts:2515).
    private static readonly Regex DispatchRe = new(
        @"\b([A-Za-z_]\w*)\s*\.\s*(?:delay|apply_async)\s*\(",
        RegexOptions.ECMAScript);

    // CELERY_TASK_DECORATOR_RE (ts:2519) — stateless (.IsMatch), `@`-anchored + `\b`-bounded.
    private static readonly Regex TaskDecoratorRe = new(
        @"@\s*(?:[A-Za-z_][\w.]*\.)?(?:shared_task|task)\b",
        RegexOptions.ECMAScript);

    // A previous decl terminates the upward decorator walk.
    private static readonly Regex PrevDeclRe = new(@"^(?:async\s+def|def|class)\b", RegexOptions.ECMAScript);

    // CELERY_PY_EXT (ts:2520).
    private static readonly Regex PyExt = new(@"\.py$", RegexOptions.ECMAScript);

    // CELERY_FANOUT_CAP (ts:2521) / CELERY_DECORATOR_LOOKBACK (ts:2522).
    private const int CeleryFanoutCap = 80;
    private const int CeleryDecoratorLookback = 12;

    // has('python') (ts:3534).
    private static readonly string[] Required = { CodeGraphLanguage.Python };

    public string Name => "celery-dispatch";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var taskCache = new Dictionary<string, bool>(StringComparer.Ordinal);

        // isCeleryTask (ts:2530) — memoized decorator gate: reads the file and scans a
        // few lines above the def, stopping at the previous declaration.
        bool IsCeleryTask(CodeGraphNode node)
        {
            if (taskCache.TryGetValue(node.Id, out var cached))
            {
                return cached;
            }

            var v = false;
            if (node.Kind == CodeGraphNodeKind.Function && PyExt.IsMatch(node.FilePath))
            {
                var content = ctx.ReadFile(node.FilePath);
                if (!string.IsNullOrEmpty(content))
                {
                    var lines = content.Split('\n');
                    var stop = Math.Max(0, node.StartLine - 1 - CeleryDecoratorLookback);
                    for (var i = node.StartLine - 2; i >= stop; i--)
                    {
                        var t = (i >= 0 && i < lines.Length ? lines[i] : string.Empty).Trim();
                        if (PrevDeclRe.IsMatch(t))
                        {
                            break; // previous decl -> stop
                        }

                        if (TaskDecoratorRe.IsMatch(t))
                        {
                            v = true;
                            break;
                        }
                    }
                }
            }

            taskCache[node.Id] = v;
            return v;
        }

        // resolve (ts:2552) — the dispatched name to a celery-task function node.
        CodeGraphNode? Resolve(string name, string dispatchFile)
        {
            var cands = new List<CodeGraphNode>();
            foreach (var n in ctx.GetNodesByName(name))
            {
                if (n.Kind == CodeGraphNodeKind.Function && IsCeleryTask(n))
                {
                    cands.Add(n);
                }
            }

            if (cands.Count == 0)
            {
                return null;
            }

            if (cands.Count == 1)
            {
                return cands[0];
            }

            // Cross-module name collision: prefer a task defined in the dispatching file,
            // else bail (ambiguous — precision over recall).
            foreach (var c in cands)
            {
                if (c.FilePath == dispatchFile)
                {
                    return c;
                }
            }

            return null;
        }

        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var scannedFiles = 0;
        foreach (var file in ctx.GetAllFiles())
        {
            if ((++scannedFiles & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!PyExt.IsMatch(file))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content) ||
                (!content.Contains(".delay(", StringComparison.Ordinal) &&
                 !content.Contains(".apply_async(", StringComparison.Ordinal)))
            {
                continue;
            }

            var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Python);
            var nodesInFile = ctx.GetNodesInFile(file);
            var lineOf = CodeGraphSynthesizerSupport.MakeLineAt(safe, 1);
            var added = 0;
            foreach (Match m in DispatchRe.Matches(safe))
            {
                if (added >= CeleryFanoutCap)
                {
                    break;
                }

                var name = m.Groups[1].Value;
                var line = lineOf(m.Index);
                var disp = CodeGraphSynthesizerSupport.EnclosingFn(nodesInFile, line);
                if (disp is null)
                {
                    continue; // module-level dispatch — no source symbol to attribute
                }

                var target = Resolve(name, file);
                if (target is null || target.Id == disp.Id)
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
                        ("synthesizedBy", "celery-dispatch"),
                        ("via", name),
                        ("registeredAt", file + ":" + line)),
                    line,
                    Column: null,
                    CodeGraphProvenance.Heuristic));
                added++;
            }
        }

        return edges;
    }
}

using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphSidekiqDispatchSynthesizer — sidekiqDispatchEdges (callback-synthesizer.ts:
// 2856). Phase.Main, gated to Ruby. Sidekiq enqueues background work via
// `Worker.perform_async(...)` / `.perform_in` / `.perform_at`; the actual work runs in
// the worker's instance `#perform`, dispatched by the framework — no static call edge —
// so a caller->job flow breaks at the enqueue site. Bridge it: link the enclosing
// method at each `Worker.perform_async(...)` site -> the worker's `perform`.
//
// The receiver must be a Sidekiq worker, gated by `include Sidekiq::Job|Worker` read
// from the class BODY (the mixin is an external gem module — no resolvable edge).
// Namespace disambiguation: a namespaced ref (`Comments::SendEmailNotificationWorker`)
// resolves by EXACT qualified name first; an unqualified ref links only when a single
// worker bears the simple name (an ambiguous collision bails — precision over recall).
// ActiveJob's `perform_later`/`_now` is deliberately not matched. Capped per file.
// =============================================================================
internal sealed class CodeGraphSidekiqDispatchSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly string[] RequiredRuby = { CodeGraphLanguage.Ruby };

    // SIDEKIQ_DISPATCH_RE (ts:2851) — `[Namespace::]Worker.perform_async|_in|_at`.
    private static readonly Regex DispatchRe = new(
        @"([A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*)\s*\.\s*perform_(?:async|in|at)\b",
        RegexOptions.ECMAScript);

    // SIDEKIQ_WORKER_RE (ts:2852) — the worker mixin in a class body.
    private static readonly Regex WorkerRe = new(
        @"\binclude\s+Sidekiq::(?:Job|Worker)\b",
        RegexOptions.ECMAScript);

    // Cheap per-file prefilter (ts:2864).
    private static readonly Regex DispatchPrefilter = new(
        @"\.perform_(?:async|in|at)\b",
        RegexOptions.ECMAScript);

    // SIDEKIQ_FANOUT_CAP (ts:2854).
    private const int SidekiqFanoutCap = 80;

    public string Name => "sidekiq-dispatch";

    public IReadOnlyList<string> RequiredLanguages => RequiredRuby;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        // class node id -> its instance `perform` method (null if not a Sidekiq worker),
        // memoized. Present-with-null distinguishes "checked, not a worker" from "unseen".
        var performCache = new Dictionary<string, CodeGraphNode?>(StringComparer.Ordinal);

        CodeGraphNode? PerformOf(CodeGraphNode cls)
        {
            if (performCache.TryGetValue(cls.Id, out var cached))
            {
                return cached;
            }

            CodeGraphNode? v = null;
            var content = ctx.ReadFile(cls.FilePath);
            if (!string.IsNullOrEmpty(content))
            {
                var end = cls.EndLine;
                var body = CodeGraphSynthesizerSupport.SliceLines(content, cls.StartLine, end);
                if (body is not null && WorkerRe.IsMatch(body))
                {
                    foreach (var n in ctx.GetNodesInFile(cls.FilePath))
                    {
                        if (n.Kind == CodeGraphNodeKind.Method && n.Name == "perform" &&
                            n.StartLine >= cls.StartLine && n.StartLine <= end)
                        {
                            v = n;
                            break;
                        }
                    }
                }
            }

            performCache[cls.Id] = v;
            return v;
        }

        // Resolve a (possibly namespaced) worker reference to its `perform`.
        CodeGraphNode? Resolve(string reference)
        {
            if (reference.Contains("::", StringComparison.Ordinal))
            {
                foreach (var n in ctx.GetNodesByQualifiedName(reference))
                {
                    if (n.Kind == CodeGraphNodeKind.Class && PerformOf(n) is not null)
                    {
                        return PerformOf(n);
                    }
                }
            }

            var simple = LastSegment(reference);
            CodeGraphNode? soleWorker = null;
            var count = 0;
            foreach (var n in ctx.GetNodesByName(simple))
            {
                if (n.Kind == CodeGraphNodeKind.Class && PerformOf(n) is not null)
                {
                    count++;
                    soleWorker = n;
                }
            }

            return count == 1 ? PerformOf(soleWorker!) : null;
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

            if (!file.EndsWith(".rb", StringComparison.Ordinal))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content) || !DispatchPrefilter.IsMatch(content))
            {
                continue;
            }

            var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Ruby);
            var nodesInFile = ctx.GetNodesInFile(file);
            var lineAt = CodeGraphSynthesizerSupport.MakeLineAt(safe, 1);
            var added = 0;
            foreach (Match m in DispatchRe.Matches(safe))
            {
                if (added >= SidekiqFanoutCap)
                {
                    break;
                }

                var line = lineAt(m.Index);
                var disp = CodeGraphSynthesizerSupport.EnclosingFn(nodesInFile, line);
                if (disp is null)
                {
                    continue;
                }

                var target = Resolve(m.Groups[1].Value);
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
                        ("synthesizedBy", "sidekiq-dispatch"),
                        ("via", m.Groups[1].Value),
                        ("registeredAt", file + ":" + line)),
                    line,
                    Column: null,
                    CodeGraphProvenance.Heuristic));
                added++;
            }
        }

        return edges;
    }

    // ref.split('::').pop() — the last `::` segment (the simple worker name).
    private static string LastSegment(string reference)
    {
        var idx = reference.LastIndexOf("::", StringComparison.Ordinal);
        return idx < 0 ? reference : reference.Substring(idx + 2);
    }
}

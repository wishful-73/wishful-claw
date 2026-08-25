using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphEventEmitterSynthesizer — eventEmitterEdges (callback-synthesizer.ts:
// 329). Phase.Main, always run (no language gate). Phase-2 string-keyed EventEmitter
// channels: `this.on('mount', function onmount(){})` (registration) pairs with
// `fn.emit('mount')` (dispatch) -> synthesize (method containing emit('mount')) ->
// onmount. Named handlers only; capped by event fan-out — generic keys ('error')
// that need receiver-type matching are skipped (deferred to Phase 3).
// =============================================================================
internal sealed class CodeGraphEventEmitterSynthesizer : ICodeGraphEdgeSynthesizer
{
    // ON_RE (ts:38) / EMIT_RE (ts:39).
    private static readonly Regex OnRe = new(
        @"\.(?:on|once|addListener)\(\s*['""]([^'""]+)['""]\s*,\s*(?:function\s+(\w+)|(?:this\.)?(\w+))",
        RegexOptions.ECMAScript);

    private static readonly Regex EmitRe = new(
        @"\.(?:emit|fire|dispatchEvent)\(\s*['""]([^'""]+)['""]",
        RegexOptions.ECMAScript);

    private static readonly string[] Always = System.Array.Empty<string>();

    public string Name => "event-emitter";

    public IReadOnlyList<string> RequiredLanguages => Always;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        // event -> dispatcher node ids; event -> (handler id -> registration site).
        // Dictionary/HashSet iterate in insertion order absent removals (none here),
        // matching JS Map/Set — the join order the per-event metadata depends on.
        var emitsByEvent = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        var handlersByEvent = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);

        var scanned = 0;
        foreach (var file in ctx.GetAllFiles())
        {
            if ((++scanned & 255) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content))
            {
                continue;
            }

            var hasEmit = content.Contains(".emit(", StringComparison.Ordinal) ||
                          content.Contains(".fire(", StringComparison.Ordinal) ||
                          content.Contains(".dispatchEvent(", StringComparison.Ordinal);
            var hasOn = content.Contains(".on(", StringComparison.Ordinal) ||
                        content.Contains(".once(", StringComparison.Ordinal) ||
                        content.Contains(".addListener(", StringComparison.Ordinal);
            if (!hasEmit && !hasOn)
            {
                continue;
            }

            var nodesInFile = ctx.GetNodesInFile(file);
            var lineOf = CodeGraphSynthesizerSupport.MakeLineAt(content, 1);

            if (hasEmit)
            {
                foreach (Match m in EmitRe.Matches(content))
                {
                    var disp = CodeGraphSynthesizerSupport.EnclosingFn(nodesInFile, lineOf(m.Index));
                    if (disp is null)
                    {
                        continue;
                    }

                    var eventName = m.Groups[1].Value;
                    if (!emitsByEvent.TryGetValue(eventName, out var set))
                    {
                        set = new HashSet<string>(StringComparer.Ordinal);
                        emitsByEvent[eventName] = set;
                    }

                    set.Add(disp.Id);
                }
            }

            if (hasOn)
            {
                foreach (Match m in OnRe.Matches(content))
                {
                    var handlerName = m.Groups[2].Success ? m.Groups[2].Value : m.Groups[3].Value;
                    if (string.IsNullOrEmpty(handlerName))
                    {
                        continue;
                    }

                    CodeGraphNode? handler = null;
                    foreach (var cand in ctx.GetNodesByName(handlerName))
                    {
                        if (cand.Kind == CodeGraphNodeKind.Function || cand.Kind == CodeGraphNodeKind.Method)
                        {
                            handler = cand;
                            break;
                        }
                    }

                    if (handler is null)
                    {
                        continue;
                    }

                    var eventName = m.Groups[1].Value;
                    if (!handlersByEvent.TryGetValue(eventName, out var map))
                    {
                        map = new Dictionary<string, string>(StringComparer.Ordinal);
                        handlersByEvent[eventName] = map;
                    }

                    map[handler.Id] = file + ":" + lineOf(m.Index);
                }
            }
        }

        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (eventName, dispatchers) in emitsByEvent)
        {
            if (!handlersByEvent.TryGetValue(eventName, out var handlers))
            {
                continue;
            }

            // Precision guard: a generic event with many handlers/dispatchers can't be
            // matched without receiver-type info (Phase 3) — skip rather than over-link.
            if (dispatchers.Count > CodeGraphSynthesizerSupport.EventFanoutCap ||
                handlers.Count > CodeGraphSynthesizerSupport.EventFanoutCap)
            {
                continue;
            }

            foreach (var d in dispatchers)
            {
                foreach (var (h, registeredAt) in handlers)
                {
                    if (d == h)
                    {
                        continue;
                    }

                    var key = d + ">" + h;
                    if (!seen.Add(key))
                    {
                        continue;
                    }

                    // NOTE: no `line` (Line:null) — matches the TS edge shape.
                    edges.Add(new CodeGraphEdge(
                        d,
                        h,
                        CodeGraphEdgeKind.Calls,
                        CodeGraphSynthesizerSupport.Metadata(
                            ("synthesizedBy", "event-emitter"),
                            ("event", eventName),
                            ("registeredAt", registeredAt)),
                        Line: null,
                        Column: null,
                        CodeGraphProvenance.Heuristic));
                }
            }
        }

        return edges;
    }
}

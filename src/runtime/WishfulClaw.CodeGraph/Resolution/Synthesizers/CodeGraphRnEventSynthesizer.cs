using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphRnEventSynthesizer — rnEventEdges (callback-synthesizer.ts:1404).
// Phase.Main, gated to the JS family. React Native native→JS event channel: a
// native module sends an event (`sendEventWithName:@"X"` in ObjC,
// `sendEvent(withName:"X")` in Swift, `.emit("X", …)` / `sendEvent(ctx,"X",…)`
// wrappers on the JVM) that a JS `.addListener("X", handler)` receives — a bridge
// hop with no static edge. Link the native dispatcher's enclosing function → the
// JS handler when both name the SAME event, behind the same generic-name fan-out
// cap as the in-language channel.
// =============================================================================
internal sealed class CodeGraphRnEventSynthesizer : ICodeGraphEdgeSynthesizer
{
    // RN_OBJC_SEND_RE (ts:1383) / RN_SWIFT_SEND_RE (:1389) / RN_JVM_EMIT_RE (:1394)
    // / RN_NATIVE_SENDEVENT_RE (:1402) / ADDLISTENER_ANY (ts:1485).
    private static readonly Regex ObjcSendRe = new(@"\bsendEventWithName\s*:\s*@""([^""]+)""", RegexOptions.CultureInvariant);
    private static readonly Regex SwiftSendRe = new(@"\bsendEvent\s*\(\s*withName\s*:\s*""([^""]+)""", RegexOptions.CultureInvariant);
    private static readonly Regex JvmEmitRe = new(@"\.emit\s*\(\s*""([^""]+)""\s*,", RegexOptions.CultureInvariant);
    private static readonly Regex NativeSendEventRe = new(@"\bsendEvent\s*\([^;{}]*?""([^""]+)""", RegexOptions.CultureInvariant);
    private static readonly Regex AddListenerAnyRe = new(
        @"\.(?:on|once|addListener)\(\s*['""]([^'""]+)['""]\s*,\s*([A-Za-z_][\w.]*)",
        RegexOptions.CultureInvariant);

    private static readonly string[] Required =
    {
        CodeGraphLanguage.TypeScript, CodeGraphLanguage.JavaScript,
        CodeGraphLanguage.Tsx, CodeGraphLanguage.Jsx
    };

    public string Name => "rn-event-channel";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var nativeDispatchersByEvent = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        var jsHandlersByEvent = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);

        var scanned = 0;
        foreach (var file in ctx.GetAllFiles())
        {
            if ((++scanned & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content))
            {
                continue;
            }

            var nodesInFile = ctx.GetNodesInFile(file);
            var lineOf = CodeGraphSynthesizerSupport.MakeLineAt(content, 1);

            void AddDispatcher(string ev, int line)
            {
                var disp = CodeGraphSynthesizerSupport.EnclosingFn(nodesInFile, line);
                if (disp is null)
                {
                    return;
                }

                if (!nativeDispatchersByEvent.TryGetValue(ev, out var set))
                {
                    set = new HashSet<string>(StringComparer.Ordinal);
                    nativeDispatchersByEvent[ev] = set;
                }

                set.Add(disp.Id);
            }

            if (file.EndsWith(".m", StringComparison.Ordinal) || file.EndsWith(".mm", StringComparison.Ordinal))
            {
                foreach (Match m in ObjcSendRe.Matches(content))
                {
                    if (m.Groups[1].Value.Length > 0)
                    {
                        AddDispatcher(m.Groups[1].Value, lineOf(m.Index));
                    }
                }
            }

            if (file.EndsWith(".swift", StringComparison.Ordinal))
            {
                foreach (Match m in SwiftSendRe.Matches(content))
                {
                    if (m.Groups[1].Value.Length > 0)
                    {
                        AddDispatcher(m.Groups[1].Value, lineOf(m.Index));
                    }
                }

                foreach (Match m in NativeSendEventRe.Matches(content))
                {
                    if (m.Groups[1].Value.Length > 0)
                    {
                        AddDispatcher(m.Groups[1].Value, lineOf(m.Index));
                    }
                }
            }

            if (file.EndsWith(".java", StringComparison.Ordinal) || file.EndsWith(".kt", StringComparison.Ordinal))
            {
                foreach (Match m in JvmEmitRe.Matches(content))
                {
                    if (m.Groups[1].Value.Length > 0)
                    {
                        AddDispatcher(m.Groups[1].Value, lineOf(m.Index));
                    }
                }

                foreach (Match m in NativeSendEventRe.Matches(content))
                {
                    if (m.Groups[1].Value.Length > 0)
                    {
                        AddDispatcher(m.Groups[1].Value, lineOf(m.Index));
                    }
                }
            }

            if (IsJsFamilyFile(file))
            {
                foreach (Match m in AddListenerAnyRe.Matches(content))
                {
                    var ev = m.Groups[1].Value;
                    var arg = m.Groups[2].Value;
                    if (ev.Length == 0 || arg.Length == 0)
                    {
                        continue;
                    }

                    var bareName = arg.Contains('.') ? arg[(arg.LastIndexOf('.') + 1)..] : arg;
                    string? targetId = null;
                    foreach (var n in ctx.GetNodesByName(bareName))
                    {
                        if (n.Kind == CodeGraphNodeKind.Function || n.Kind == CodeGraphNodeKind.Method)
                        {
                            targetId = n.Id;
                            break;
                        }
                    }

                    var line = lineOf(m.Index);
                    if (targetId is null)
                    {
                        // Fall back to the enclosing function (subscribe-wrapper pattern).
                        targetId = CodeGraphSynthesizerSupport.EnclosingFn(nodesInFile, line)?.Id;
                    }

                    if (targetId is null)
                    {
                        // Broader fallback: smallest enclosing constant/variable node.
                        CodeGraphNode? smallest = null;
                        foreach (var n in nodesInFile)
                        {
                            if (n.Kind != CodeGraphNodeKind.Constant && n.Kind != CodeGraphNodeKind.Variable)
                            {
                                continue;
                            }

                            if (n.StartLine <= line && n.EndLine >= line)
                            {
                                if (smallest is null || n.StartLine >= smallest.StartLine)
                                {
                                    smallest = n;
                                }
                            }
                        }

                        targetId = smallest?.Id;
                    }

                    if (targetId is null)
                    {
                        continue;
                    }

                    if (!jsHandlersByEvent.TryGetValue(ev, out var map))
                    {
                        map = new Dictionary<string, string>(StringComparer.Ordinal);
                        jsHandlersByEvent[ev] = map;
                    }

                    map[targetId] = file + ":" + line;
                }
            }
        }

        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (ev, dispatchers) in nativeDispatchersByEvent)
        {
            if (!jsHandlersByEvent.TryGetValue(ev, out var handlers))
            {
                continue;
            }

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

                    edges.Add(new CodeGraphEdge(
                        d,
                        h,
                        CodeGraphEdgeKind.Calls,
                        CodeGraphSynthesizerSupport.Metadata(
                            ("synthesizedBy", "rn-event-channel"),
                            ("event", ev),
                            ("registeredAt", registeredAt)),
                        Line: null,
                        Column: null,
                        CodeGraphProvenance.Heuristic));
                }
            }
        }

        return edges;
    }

    private static bool IsJsFamilyFile(string file) =>
        file.EndsWith(".js", StringComparison.Ordinal) ||
        file.EndsWith(".jsx", StringComparison.Ordinal) ||
        file.EndsWith(".ts", StringComparison.Ordinal) ||
        file.EndsWith(".tsx", StringComparison.Ordinal) ||
        file.EndsWith(".mjs", StringComparison.Ordinal) ||
        file.EndsWith(".cjs", StringComparison.Ordinal);
}

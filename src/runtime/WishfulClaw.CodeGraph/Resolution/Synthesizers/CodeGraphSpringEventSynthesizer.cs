using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphSpringEventSynthesizer — springEventEdges (callback-synthesizer.ts:2637).
// Phase.Main, gate has('java') (ts:3535). Spring decouples an event PUBLISHER from
// its LISTENER(s) through the application event bus, linked by the EVENT TYPE:
//   // SomeService.java
//   eventPublisher.publishEvent(new PasswordChangedEvent(this, username));   // publish
//   // RememberMeTokenRevoker.java — a DIFFERENT file
//   @EventListener(PasswordChangedEvent.class)                              // listen
//   public void onPasswordChanged(PasswordChangedEvent event) { ... }
// Bridge it: link the enclosing method at each `publishEvent(new XEvent(...))` site ->
// every listener method of XEvent. Listeners are `@EventListener` / `@TransactionalEventListener`
// methods (event type = the first param type, or the `@EventListener(X.class)` value form) and
// the older `class … implements ApplicationListener<X> { void onApplicationEvent(X e) }`. Keyed
// by exact type name, usually cross-file. A repo with no `@EventListener`/`publishEvent` yields 0.
// (Java method nodes INCLUDE their leading annotations in the range — startLine is the first
// `@…` line — so the annotation block is scanned DOWNWARD from startLine, bounded to consecutive
// `@`-lines so it can't bleed into an adjacent method.)
// =============================================================================
internal sealed class CodeGraphSpringEventSynthesizer : ICodeGraphEdgeSynthesizer
{
    // SPRING_PUBLISH_RE (ts:2613).
    private static readonly Regex PublishRe = new(
        @"\.publishEvent\s*\(\s*new\s+([A-Z][A-Za-z0-9_]*)",
        RegexOptions.ECMAScript);

    // SPRING_LISTENER_ANNO_RE (ts:2614).
    private static readonly Regex ListenerAnnoRe = new(
        @"@(?:EventListener|TransactionalEventListener)\b",
        RegexOptions.ECMAScript);

    // SPRING_ANNO_TYPE_RE (ts:2615) — the `@EventListener(X.class)` value form.
    private static readonly Regex AnnoTypeRe = new(
        @"@(?:EventListener|TransactionalEventListener)\s*\(\s*([A-Z][A-Za-z0-9_]*)\.class",
        RegexOptions.ECMAScript);

    // SPRING_APP_LISTENER_RE (ts:2616).
    private static readonly Regex AppListenerRe = new(
        @"\bApplicationListener\s*<",
        RegexOptions.ECMAScript);

    // SPRING_JAVA_EXT (ts:2617).
    private static readonly Regex JavaExt = new(@"\.java$", RegexOptions.ECMAScript);

    // springFirstParamType tail check — event types are PascalCase class names.
    private static readonly Regex TypeNameRe = new(@"^[A-Z][A-Za-z0-9_]*$", RegexOptions.ECMAScript);

    // Whitespace splitter for the first parameter's tokens (JS first.split(/\s+/)).
    private static readonly Regex WsRe = new(@"\s+", RegexOptions.ECMAScript);

    // SPRING_FANOUT_CAP (ts:2618).
    private const int SpringFanoutCap = 80;

    // has('java') (ts:3535).
    private static readonly string[] Required = { CodeGraphLanguage.Java };

    public string Name => "spring-event";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var scannedFiles = 0;

        // Pass 1 — event-type -> listener methods, scanning only event-relevant files.
        // This is the ONLY full read sweep: publisher files are recorded here so pass 2
        // re-reads just those instead of every .java file again (#1212).
        var listeners = new Dictionary<string, List<CodeGraphNode>>(StringComparer.Ordinal);
        var publisherFiles = new List<string>();
        foreach (var file in ctx.GetAllFiles())
        {
            if ((++scannedFiles & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!JavaExt.IsMatch(file))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content))
            {
                continue;
            }

            if (content.Contains(".publishEvent(", StringComparison.Ordinal))
            {
                publisherFiles.Add(file);
            }

            var hasAnno = content.Contains("@EventListener", StringComparison.Ordinal) ||
                          content.Contains("@TransactionalEventListener", StringComparison.Ordinal);
            var hasAppListener = AppListenerRe.IsMatch(content);
            if (!hasAnno && !hasAppListener)
            {
                continue;
            }

            var lines = content.Split('\n');
            foreach (var node in ctx.GetNodesInFile(file))
            {
                if (node.Kind != CodeGraphNodeKind.Method)
                {
                    continue;
                }

                // Collect this method's own leading annotation block (consecutive
                // `@`-lines from startLine — no bleed into the next method).
                var annoLines = new List<string>();
                for (var i = node.StartLine - 1; i < lines.Length && i < node.StartLine + 7; i++)
                {
                    var t = lines[i].Trim();
                    if (!t.StartsWith("@", StringComparison.Ordinal))
                    {
                        break; // reached the declaration → stop
                    }

                    annoLines.Add(t);
                }

                var head = string.Join("\n", annoLines);
                var annotated = hasAnno && ListenerAnnoRe.IsMatch(head);
                var isAppListener = hasAppListener && node.Name == "onApplicationEvent";
                if (!annotated && !isAppListener)
                {
                    continue;
                }

                var type = SpringFirstParamType(node.Signature);
                if (type is null && annotated)
                {
                    var m = AnnoTypeRe.Match(head);
                    if (m.Success)
                    {
                        type = m.Groups[1].Value;
                    }
                }

                if (type is null)
                {
                    continue;
                }

                if (listeners.TryGetValue(type, out var arr))
                {
                    arr.Add(node);
                }
                else
                {
                    listeners[type] = new List<CodeGraphNode> { node };
                }
            }
        }

        if (listeners.Count == 0)
        {
            return System.Array.Empty<CodeGraphEdge>();
        }

        // Pass 2 — link each publishEvent(new XEvent(...)) site -> every listener of
        // XEvent. Only the publisher files recorded in pass 1 are (re-)read.
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in publisherFiles)
        {
            if ((++scannedFiles & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content) ||
                !content.Contains(".publishEvent(", StringComparison.Ordinal))
            {
                continue;
            }

            var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Java);
            var nodesInFile = ctx.GetNodesInFile(file);
            var lineOf = CodeGraphSynthesizerSupport.MakeLineAt(safe, 1);
            var added = 0;
            foreach (Match m in PublishRe.Matches(safe))
            {
                if (added >= SpringFanoutCap)
                {
                    break;
                }

                if (!listeners.TryGetValue(m.Groups[1].Value, out var targets) || targets.Count == 0)
                {
                    continue;
                }

                var line = lineOf(m.Index);
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
                            ("synthesizedBy", "spring-event"),
                            ("via", m.Groups[1].Value),
                            ("registeredAt", file + ":" + line)),
                        line,
                        Column: null,
                        CodeGraphProvenance.Heuristic));
                    added++;
                }
            }
        }

        return edges;
    }

    // springFirstParamType (ts:2623): the first parameter's type from a Java method
    // signature (`"void (XEvent e)"` -> `XEvent`). Skips a leading `final`/`@Anno`,
    // strips generics, and requires a PascalCase class name (event types are classes)
    // — so a no-arg or primitive-param method yields null.
    private static string? SpringFirstParamType(string? sig)
    {
        if (string.IsNullOrEmpty(sig))
        {
            return null;
        }

        var open = sig.IndexOf('(');
        if (open < 0)
        {
            return null;
        }

        var close = sig.IndexOf(')', open);
        var inner = sig.Substring(open + 1, (close < 0 ? sig.Length : close) - open - 1).Trim();
        if (inner.Length == 0)
        {
            return null;
        }

        var first = inner.Split(',')[0].Trim();
        var toks = new List<string>();
        foreach (var t in WsRe.Split(first))
        {
            if (t.Length > 0 && t != "final" && !t.StartsWith("@", StringComparison.Ordinal))
            {
                toks.Add(t);
            }
        }

        if (toks.Count < 2)
        {
            return null; // need `Type name`
        }

        var type = toks[toks.Count - 2];
        var lt = type.IndexOf('<'); // drop generic args (replace(/<.*$/, ''))
        if (lt >= 0)
        {
            type = type.Substring(0, lt);
        }

        return TypeNameRe.IsMatch(type) ? type : null;
    }
}

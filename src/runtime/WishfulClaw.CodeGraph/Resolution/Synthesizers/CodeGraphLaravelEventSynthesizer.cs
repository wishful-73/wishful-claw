using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphLaravelEventSynthesizer — laravelEventEdges (callback-synthesizer.ts:3341).
// Phase.Main, gated to PHP. Laravel fires domain events with `event(new XEvent(...))`;
// listeners run through the framework's dispatcher — no static call edge — so a
// caller->listener flow breaks at the `event(...)` site. Bridge it: build an
// event-name -> listener-`handle` map from BOTH registration mechanisms, then link each
// `event(new XEvent(...))` site's enclosing function -> every listener of XEvent.
//
// Pass 1 sources (both real, both needed): (A) a typed listener `handle(EventType $e)`
// first param (read from the method decl — PHP has no signature; a `handle(A|B $e)`
// union splits into two events), and (B) the EventServiceProvider `$listen` map (the
// ONLY way to link an UNTYPED `handle()`), parsed from comment-stripped source so a
// fully-commented map contributes nothing. Jobs are excluded by construction — they
// dispatch via `::dispatch`, never `event(new X)`. Capped per dispatch site.
// =============================================================================
internal sealed class CodeGraphLaravelEventSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly string[] RequiredPhp = { CodeGraphLanguage.Php };

    // LARAVEL_DISPATCH_RE (ts:3307) — `event(new [\]XEvent`.
    private static readonly Regex DispatchRe = new(
        @"\bevent\s*\(\s*new\s+\\?([A-Za-z_][\w\\]*)",
        RegexOptions.ECMAScript);

    // A `$listen` entry: `Event::class => [Listener::class, …]` (LISTEN_ENTRY_RE, ts:3311).
    private static readonly Regex ListenEntryRe = new(
        @"(?:([A-Za-z_\\][\w\\]*)::class|'([^']+)'|""([^""]+)"")\s*=>\s*\[([^\]]*)\]",
        RegexOptions.ECMAScript);

    // A single class reference inside a `$listen` value list (LISTEN_CLASS_RE, ts:3312).
    private static readonly Regex ListenClassRe = new(
        @"(?:([A-Za-z_\\][\w\\]*)::class|'([^']+)'|""([^""]+)"")",
        RegexOptions.ECMAScript);

    // The `$listen = [` declaration (ts:3373 safe.search).
    private static readonly Regex ListenDeclRe = new(@"\$listen\s*=\s*\[", RegexOptions.ECMAScript);

    // A `handle(...)` first param type (laravelHandleEventTypes, ts:3321).
    private static readonly Regex HandleParamRe = new(
        @"function\s+handle\s*\(\s*(?:\.\.\.\s*)?(\??[A-Za-z_\\][\w\\|]*)\s+&?\s*(?:\.\.\.\s*)?\$",
        RegexOptions.ECMAScript);

    // A short class name shape (`^[A-Z]\w*$`, ts:3327).
    private static readonly Regex ShortClassNameRe = new(@"^[A-Z]\w*$", RegexOptions.ECMAScript);

    // LARAVEL_FANOUT_CAP (ts:3309).
    private const int LaravelFanoutCap = 200;

    public string Name => "laravel-event";

    public IReadOnlyList<string> RequiredLanguages => RequiredPhp;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        // event short name -> its listener `handle` methods (deduped by node id).
        var listeners = new Dictionary<string, Dictionary<string, CodeGraphNode>>(StringComparer.Ordinal);

        void Add(string ev, CodeGraphNode handle)
        {
            if (!listeners.TryGetValue(ev, out var m))
            {
                m = new Dictionary<string, CodeGraphNode>(StringComparer.Ordinal);
                listeners[ev] = m;
            }

            m[handle.Id] = handle;
        }

        CodeGraphNode? HandleOf(CodeGraphNode cls)
        {
            foreach (var n in ctx.GetNodesInFile(cls.FilePath))
            {
                if (n.Kind == CodeGraphNodeKind.Method && n.Name == "handle" &&
                    n.StartLine >= cls.StartLine && n.StartLine <= cls.EndLine)
                {
                    return n;
                }
            }

            return null;
        }

        // Pass 1 — build the event->handle map from both registration mechanisms.
        var scannedFiles = 0;
        foreach (var file in ctx.GetAllFiles())
        {
            if ((++scannedFiles & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!file.EndsWith(".php", StringComparison.Ordinal))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content))
            {
                continue;
            }

            // (A) typed listener handles — node-driven, so a commented-out method can't
            // leak in.
            if (content.Contains("function handle", StringComparison.Ordinal))
            {
                foreach (var node in ctx.GetNodesInFile(file))
                {
                    if (node.Kind != CodeGraphNodeKind.Method || node.Name != "handle")
                    {
                        continue;
                    }

                    var decl = CodeGraphSynthesizerSupport.SliceLines(content, node.StartLine, node.StartLine + 2);
                    if (decl is null)
                    {
                        continue;
                    }

                    foreach (var ev in LaravelHandleEventTypes(decl))
                    {
                        Add(ev, node);
                    }
                }
            }

            // (B) the EventServiceProvider `$listen` map — parsed from comment-stripped
            // source so a fully-commented map contributes nothing.
            if (content.Contains("$listen", StringComparison.Ordinal))
            {
                var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Php);
                var declMatch = ListenDeclRe.Match(safe);
                var body = declMatch.Success
                    ? PhpArrayBody(safe, safe.IndexOf('[', declMatch.Index))
                    : null;
                if (body is not null)
                {
                    foreach (Match em in ListenEntryRe.Matches(body))
                    {
                        var ev = PhpSimpleName(FirstGroup(em, 1, 2, 3));
                        foreach (Match lm in ListenClassRe.Matches(em.Groups[4].Value))
                        {
                            var ln = PhpSimpleName(FirstGroup(lm, 1, 2, 3));
                            CodeGraphNode? cls = null;
                            foreach (var n in ctx.GetNodesByName(ln))
                            {
                                if (n.Kind == CodeGraphNodeKind.Class && HandleOf(n) is not null)
                                {
                                    cls = n;
                                    break;
                                }
                            }

                            if (cls is not null)
                            {
                                Add(ev, HandleOf(cls)!);
                            }
                        }
                    }
                }
            }
        }

        if (listeners.Count == 0)
        {
            return System.Array.Empty<CodeGraphEdge>();
        }

        // Pass 2 — link each event(new X(...)) site -> every listener of X.
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in ctx.GetAllFiles())
        {
            if ((++scannedFiles & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!file.EndsWith(".php", StringComparison.Ordinal))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content) || !content.Contains("event(", StringComparison.Ordinal))
            {
                continue;
            }

            var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Php);
            var nodesInFile = ctx.GetNodesInFile(file);
            var lineAt = CodeGraphSynthesizerSupport.MakeLineAt(safe, 1);
            var added = 0;
            foreach (Match m in DispatchRe.Matches(safe))
            {
                if (added >= LaravelFanoutCap)
                {
                    break;
                }

                var via = PhpSimpleName(m.Groups[1].Value);
                if (!listeners.TryGetValue(via, out var targets))
                {
                    continue;
                }

                var line = lineAt(m.Index);
                var disp = CodeGraphSynthesizerSupport.EnclosingFn(nodesInFile, line);
                if (disp is null)
                {
                    continue;
                }

                foreach (var target in targets.Values)
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
                            ("synthesizedBy", "laravel-event"),
                            ("via", via),
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

    // Short class name from a PHP reference: `\App\Events\Foo` / `App\Events::Foo` ->
    // `Foo` (phpSimpleName, ts:3315).
    private static string PhpSimpleName(string s)
    {
        var t = s.Length > 0 && s[0] == '\\' ? s.Substring(1) : s;
        var bs = t.LastIndexOf('\\');
        if (bs >= 0)
        {
            t = t.Substring(bs + 1);
        }

        var cc = t.LastIndexOf("::", StringComparison.Ordinal);
        if (cc >= 0)
        {
            t = t.Substring(cc + 2);
        }

        return t.Trim();
    }

    // First-parameter class type(s) of a `handle(...)` decl — union-split, short-named,
    // primitives dropped (laravelHandleEventTypes, ts:3321).
    private static List<string> LaravelHandleEventTypes(string decl)
    {
        var m = HandleParamRe.Match(decl);
        if (!m.Success)
        {
            return new List<string>();
        }

        var raw = m.Groups[1].Value;
        if (raw.Length > 0 && raw[0] == '?')
        {
            raw = raw.Substring(1);
        }

        var result = new List<string>();
        foreach (var part in raw.Split('|'))
        {
            var name = PhpSimpleName(part);
            if (ShortClassNameRe.IsMatch(name))
            {
                result.Add(name);
            }
        }

        return result;
    }

    // From an opening `[`, the bracket-balanced body up to its matching `]`
    // (phpArrayBody, ts:3332). openIdx must point at a `[` (else returns null).
    private static string? PhpArrayBody(string src, int openIdx)
    {
        if (openIdx < 0)
        {
            return null;
        }

        var depth = 0;
        for (var i = openIdx; i < src.Length; i++)
        {
            if (src[i] == '[')
            {
                depth++;
            }
            else if (src[i] == ']' && --depth == 0)
            {
                return src.Substring(openIdx + 1, i - (openIdx + 1));
            }
        }

        return null;
    }

    // The first alternation group that participated (em[1] ?? em[2] ?? em[3] ?? '').
    private static string FirstGroup(Match m, int a, int b, int c)
    {
        if (m.Groups[a].Success)
        {
            return m.Groups[a].Value;
        }

        if (m.Groups[b].Success)
        {
            return m.Groups[b].Value;
        }

        return m.Groups[c].Success ? m.Groups[c].Value : string.Empty;
    }
}

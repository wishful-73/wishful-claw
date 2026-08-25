using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphObjectRegistrySynthesizer — objectRegistryEdges (callback-synthesizer.ts:
// 2188). Phase.Main. UNGATED in the TS reference (ts:3530 calls it with no has(...)
// guard) so RequiredLanguages is empty/always-run; the internal REGISTRY_JS_EXT
// extension gate makes it a no-op on non-JS files. A command/handler registry maps
// string keys -> handler class/function symbols in an object literal, then dispatches by
// a RUNTIME key static parsing can't follow:
//   this.commands = { [Cmd.ADD]: AddObjectCommand, ... }   // registration
//   new this.commands[command](args).execute()             // dynamic dispatch
// Bridge it: link each dispatching function -> each registered handler's callable entry
// (a class's execute/run/handle/… method — preferring the method chained at the dispatch
// site — or the function value). Same-file scope; >=2 callable entries required; capped.
// =============================================================================
internal sealed class CodeGraphObjectRegistrySynthesizer : ICodeGraphEdgeSynthesizer
{
    // REGISTRY_ASSIGN_RE (ts:2123) / REGISTRY_DISPATCH_RE (ts:2124).
    private static readonly Regex AssignRe = new(
        @"(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)|((?:this\.)?[A-Za-z_$][\w$]*))\s*=\s*\{",
        RegexOptions.ECMAScript);

    private static readonly Regex DispatchRe = new(
        @"(?:\bnew\s+)?((?:this\.)?[A-Za-z_$][\w$]*)\s*\[\s*([A-Za-z_$][\w$.]*)\s*\]\s*(?:\(|\.[A-Za-z_$])",
        RegexOptions.ECMAScript);

    // The two chained-entry window regexes (ts:2214).
    private static readonly Regex ChainedCallRe = new(
        @"\]\s*\([^)]*\)\s*\.\s*([A-Za-z_$][\w$]*)",
        RegexOptions.ECMAScript);

    private static readonly Regex ChainedDotRe = new(@"\]\s*\.\s*([A-Za-z_$][\w$]*)", RegexOptions.ECMAScript);

    // Cheap pre-filter (ts:2199) — a computed member access BY NAME.
    private static readonly Regex PreFilterRe = new(@"[\w$]\s*\[\s*[A-Za-z_$]", RegexOptions.ECMAScript);

    // registryEntryNames per-segment matcher (ts:2158).
    private static readonly Regex EntryRe = new(
        @"^\s*(?:\[[^\]]+\]|['""]?[\w$]+['""]?)\s*:\s*([A-Za-z_$][\w$]*)\s*$",
        RegexOptions.ECMAScript);

    // REGISTRY_JS_EXT (ts:2128) + the strip-language extension test.
    private static readonly Regex RegistryJsExt = new(@"\.(?:ts|tsx|js|jsx|mjs|cjs)$", RegexOptions.ECMAScript);
    private static readonly Regex JsLangExt = new(@"\.(?:jsx?|mjs|cjs)$", RegexOptions.ECMAScript);

    // REGISTRY_MIN_ENTRIES (ts:2125) / REGISTRY_FANOUT_CAP (ts:2126).
    private const int RegistryMinEntries = 2;
    private const int RegistryFanoutCap = 40;

    // REGISTRY_CLASS_ENTRY (ts:2127) — a class's callable dispatch entry method.
    private static readonly HashSet<string> RegistryClassEntry = new(StringComparer.Ordinal)
    {
        "execute", "run", "handle", "perform", "process", "call", "apply", "dispatch"
    };

    private static readonly string[] Always = System.Array.Empty<string>();

    public string Name => "object-registry";

    public IReadOnlyList<string> RequiredLanguages => Always;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var scanned = 0;
        foreach (var file in ctx.GetAllFiles())
        {
            if ((++scanned & 255) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!RegistryJsExt.IsMatch(file))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            // Cheap pre-filter: a computed member access BY NAME — the dispatch shape.
            if (string.IsNullOrEmpty(content) || !PreFilterRe.IsMatch(content))
            {
                continue;
            }

            // Skip minified/generated bundles: average line length is the reliable tell
            // (real source ~30–80, minified in the hundreds/thousands).
            var nl = 0;
            foreach (var ch in content)
            {
                if (ch == '\n')
                {
                    nl++;
                }
            }

            var newlines = nl + 1;
            if ((double)content.Length / newlines > 200d)
            {
                continue;
            }

            var lang = JsLangExt.IsMatch(file) ? CodeGraphLanguage.JavaScript : CodeGraphLanguage.TypeScript;
            var safe = CodeGraphStripComments.StripForRegex(content, lang);
            var lineOf = CodeGraphSynthesizerSupport.MakeLineAt(safe, 1);

            // 1. Dispatch sites: `(new )?<ref>[<ident-key>]` followed by a call or chain.
            var dispatches = new List<(string Ref, int Line, string? Chained)>();
            foreach (Match dm in DispatchRe.Matches(safe))
            {
                var winLen = Math.Min(160, safe.Length - dm.Index);
                var win = safe.Substring(dm.Index, winLen);
                string? chained = null;
                var cm = ChainedCallRe.Match(win);
                if (cm.Success)
                {
                    chained = cm.Groups[1].Value;
                }
                else
                {
                    var cm2 = ChainedDotRe.Match(win);
                    if (cm2.Success)
                    {
                        chained = cm2.Groups[1].Value;
                    }
                }

                dispatches.Add((dm.Groups[1].Value, lineOf(dm.Index), chained));
            }

            if (dispatches.Count == 0)
            {
                continue;
            }

            var refs = new HashSet<string>(StringComparer.Ordinal);
            foreach (var d in dispatches)
            {
                refs.Add(Norm(d.Ref));
            }

            // 2. Registries: an object literal assigned to a dispatched ref, >=2 entries.
            var registries = new Dictionary<string, (List<string> Names, int Line)>(StringComparer.Ordinal);
            foreach (Match am in AssignRe.Matches(safe))
            {
                var lhs = Norm(am.Groups[1].Success ? am.Groups[1].Value : am.Groups[2].Value);
                if (!refs.Contains(lhs) || registries.ContainsKey(lhs))
                {
                    continue;
                }

                var body = BraceBody(safe, am.Index + am.Length - 1);
                if (body is null)
                {
                    continue;
                }

                var names = RegistryEntryNames(body); // depth-0 `key: Identifier` entries only
                if (names.Count >= RegistryMinEntries)
                {
                    registries[lhs] = (names, lineOf(am.Index));
                }
            }

            if (registries.Count == 0)
            {
                continue;
            }

            // 3. Link each dispatcher -> each registered handler's callable entry.
            var nodesInFile = ctx.GetNodesInFile(file);
            foreach (var d in dispatches)
            {
                if (!registries.TryGetValue(Norm(d.Ref), out var reg))
                {
                    continue;
                }

                var disp = CodeGraphSynthesizerSupport.EnclosingFn(nodesInFile, d.Line);
                if (disp is null)
                {
                    continue;
                }

                var added = 0;
                foreach (var name in reg.Names)
                {
                    if (added >= RegistryFanoutCap)
                    {
                        break;
                    }

                    var target = ResolveRegistryHandler(ctx, name, d.Chained);
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
                            ("synthesizedBy", "object-registry"),
                            ("via", name),
                            ("registeredAt", file + ":" + reg.Line)),
                        d.Line,
                        Column: null,
                        CodeGraphProvenance.Heuristic));
                    added++;
                }
            }
        }

        return edges;
    }

    // norm (ts:2220) — strip a leading `this.` so a field-initializer registry matches a
    // `this.commands[k]` dispatch.
    private static string Norm(string r) =>
        r.StartsWith("this.", StringComparison.Ordinal) ? r.Substring(5) : r;

    // braceBody (ts:2131): from the opening `{` at openIdx, the brace-balanced body.
    private static string? BraceBody(string src, int openIdx)
    {
        var depth = 0;
        for (var i = openIdx; i < src.Length; i++)
        {
            var ch = src[i];
            if (ch == '{')
            {
                depth++;
            }
            else if (ch == '}' && --depth == 0)
            {
                return src.Substring(openIdx + 1, i - (openIdx + 1));
            }
        }

        return null;
    }

    // registryEntryNames (ts:2145): top-level `key: Identifier` entries, DEPTH-AWARE so
    // method-shorthand/arrow/nested-object bodies don't leak inner pairs.
    private static List<string> RegistryEntryNames(string body)
    {
        var segs = new List<string>();
        var depth = 0;
        var start = 0;
        for (var i = 0; i < body.Length; i++)
        {
            var c = body[i];
            if (c == '{' || c == '(' || c == '[')
            {
                depth++;
            }
            else if (c == '}' || c == ')' || c == ']')
            {
                depth--;
            }
            else if (c == ',' && depth == 0)
            {
                segs.Add(body.Substring(start, i - start));
                start = i + 1;
            }
        }

        segs.Add(body.Substring(start));

        var names = new List<string>();
        foreach (var seg in segs)
        {
            var m = EntryRe.Match(seg);
            if (m.Success && m.Groups[1].Value.Length >= 3 && !names.Contains(m.Groups[1].Value))
            {
                names.Add(m.Groups[1].Value);
            }
        }

        return names;
    }

    // resolveRegistryHandler (ts:2166): a function value, or a class's execute-like method
    // (preferring the method chained at the dispatch site), else the class.
    private static CodeGraphNode? ResolveRegistryHandler(CodeGraphResolutionContext ctx, string name, string? chained)
    {
        var cands = ctx.GetNodesByName(name);

        CodeGraphNode? fn = null;
        foreach (var n in cands)
        {
            if (n.Kind == CodeGraphNodeKind.Function)
            {
                fn = n;
                break;
            }
        }

        if (fn is not null)
        {
            return fn;
        }

        CodeGraphNode? cls = null;
        foreach (var n in cands)
        {
            if (n.Kind == CodeGraphNodeKind.Class || n.Kind == CodeGraphNodeKind.Struct)
            {
                cls = n;
                break;
            }
        }

        if (cls is not null)
        {
            var methods = new List<CodeGraphNode>();
            foreach (var n in ctx.GetNodesInFile(cls.FilePath))
            {
                if (n.Kind == CodeGraphNodeKind.Method && n.StartLine >= cls.StartLine && n.StartLine <= cls.EndLine)
                {
                    methods.Add(n);
                }
            }

            var want = chained is not null && RegistryClassEntry.Contains(chained) ? chained : null;
            CodeGraphNode? entry = null;
            if (want is not null)
            {
                foreach (var mm in methods)
                {
                    if (mm.Name == want)
                    {
                        entry = mm;
                        break;
                    }
                }
            }

            if (entry is null)
            {
                foreach (var mm in methods)
                {
                    if (RegistryClassEntry.Contains(mm.Name))
                    {
                        entry = mm;
                        break;
                    }
                }
            }

            if (entry is null)
            {
                foreach (var mm in methods)
                {
                    if (mm.Name == "constructor")
                    {
                        entry = mm;
                        break;
                    }
                }
            }

            return entry ?? cls;
        }

        // Require a CALLABLE target — a registry dispatched as `reg[k](…)` invokes a
        // function/method, never a data `constant`.
        foreach (var n in cands)
        {
            if (n.Kind == CodeGraphNodeKind.Method)
            {
                return n;
            }
        }

        return null;
    }
}

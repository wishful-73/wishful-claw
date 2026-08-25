using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphVuexDispatchSynthesizer — vuexDispatchEdges (callback-synthesizer.ts:2431).
// Phase.Main, gate has('vue', ...JS_FAMILY) (ts:3533). Vuex dispatches actions/mutations
// by a runtime STRING key: `dispatch('user/login')` / `commit('SET_TOKEN')` /
// `this.$store.dispatch('app/toggleDevice')`. The action & mutation definitions are
// object-literal methods in store module files (extracted as function nodes). Bridge the
// string key to its node: the LAST `/` segment is the action/mutation name; the preceding
// segment is the namespace (~ the store module's file). Resolve to a function node IN A
// STORE FILE (the >=2-signal store-file gate excludes a same-named `api/` helper),
// disambiguated by the namespace appearing in the path (or same-file for a root key).
// =============================================================================
internal sealed class CodeGraphVuexDispatchSynthesizer : ICodeGraphEdgeSynthesizer
{
    // Consumer file gate — same set as pinia (ts:2337 PINIA_CONSUMER_EXT, reused at 2468).
    private static readonly Regex ConsumerExt = new(
        @"\.(?:ts|tsx|js|jsx|mjs|cjs|vue)$",
        RegexOptions.ECMAScript);

    private static readonly Regex JsLangExt = new(@"\.(?:jsx?|mjs|cjs)$", RegexOptions.ECMAScript);

    // VUEX_DISPATCH_RE (ts:2421) — `dispatch('ns/action')` / `commit('M')`.
    private static readonly Regex DispatchRe = new(
        @"\b(?:dispatch|commit)\s*\(\s*['""]([A-Za-z][\w/]*)['""]",
        RegexOptions.ECMAScript);

    // VUEX_STORE_SIGNAL (ts:2422) — the >=2-of-these store-file tell.
    private static readonly Regex StoreSignal = new(
        @"\bdefineStore\b|\bcreateStore\b|\bVuex\b|\bmutations\b|\bactions\b|\bgetters\b|\bnamespaced\b",
        RegexOptions.ECMAScript);

    // VUEX_FANOUT_CAP (ts:2423).
    private const int VuexFanoutCap = 120;

    // has('vue', ...JS_FAMILY) (ts:3480/3533).
    private static readonly string[] Required =
    {
        CodeGraphLanguage.Vue, CodeGraphLanguage.TypeScript, CodeGraphLanguage.JavaScript,
        CodeGraphLanguage.Tsx, CodeGraphLanguage.Jsx
    };

    public string Name => "vuex-dispatch";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var storeFileCache = new Dictionary<string, bool>(StringComparer.Ordinal);

        // Memoized >=2-signal store-file tell (ts:2434). Reads the file once per path.
        bool IsStoreFile(string file)
        {
            if (storeFileCache.TryGetValue(file, out var cached))
            {
                return cached;
            }

            var c = ctx.ReadFile(file);
            var signals = new HashSet<string>(StringComparer.Ordinal);
            if (!string.IsNullOrEmpty(c))
            {
                foreach (Match sm in StoreSignal.Matches(c))
                {
                    signals.Add(sm.Value);
                    if (signals.Count >= 2)
                    {
                        break;
                    }
                }
            }

            var v = signals.Count >= 2;
            storeFileCache[file] = v;
            return v;
        }

        // Resolve a string key to a store-file action/mutation node (ts:2450).
        CodeGraphNode? Resolve(string key, string dispatchFile)
        {
            var segs = key.Split('/');
            var action = segs[segs.Length - 1];
            var cands = new List<CodeGraphNode>();
            foreach (var n in ctx.GetNodesByName(action))
            {
                if (n.Kind == CodeGraphNodeKind.Function && IsStoreFile(n.FilePath))
                {
                    cands.Add(n);
                }
            }

            if (cands.Count == 0)
            {
                return null;
            }

            if (segs.Length > 1)
            {
                var mod = segs[segs.Length - 2]; // immediate namespace ~ the module file
                foreach (var c in cands)
                {
                    if (PathHasSegment(c.FilePath, mod))
                    {
                        return c;
                    }
                }

                return cands.Count == 1 ? cands[0] : null;
            }

            // Root key: a local `commit('M')` inside an action targets the same module
            // file; otherwise accept only an unambiguous single store-wide match.
            foreach (var c in cands)
            {
                if (c.FilePath == dispatchFile)
                {
                    return c;
                }
            }

            return cands.Count == 1 ? cands[0] : null;
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

            if (!ConsumerExt.IsMatch(file))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content) ||
                (!content.Contains("dispatch(", StringComparison.Ordinal) &&
                 !content.Contains("commit(", StringComparison.Ordinal)))
            {
                continue;
            }

            var lang = JsLangExt.IsMatch(file) ? CodeGraphLanguage.JavaScript : CodeGraphLanguage.TypeScript;
            var safe = CodeGraphStripComments.StripForRegex(content, lang);
            var nodesInFile = ctx.GetNodesInFile(file);
            CodeGraphNode? fallback = null;
            foreach (var n in nodesInFile)
            {
                if (n.Kind == CodeGraphNodeKind.Component)
                {
                    fallback = n; // .vue top-level
                    break;
                }
            }

            var lineOf = CodeGraphSynthesizerSupport.MakeLineAt(safe, 1);
            var added = 0;
            foreach (Match m in DispatchRe.Matches(safe))
            {
                if (added >= VuexFanoutCap)
                {
                    break;
                }

                var key = m.Groups[1].Value;
                var line = lineOf(m.Index);
                var disp = CodeGraphSynthesizerSupport.EnclosingFn(nodesInFile, line) ?? fallback;
                if (disp is null)
                {
                    continue;
                }

                var target = Resolve(key, file);
                if (target is null || target.Id == disp.Id)
                {
                    continue;
                }

                var edgeKey = disp.Id + ">" + target.Id;
                if (!seen.Add(edgeKey))
                {
                    continue;
                }

                edges.Add(new CodeGraphEdge(
                    disp.Id,
                    target.Id,
                    CodeGraphEdgeKind.Calls,
                    CodeGraphSynthesizerSupport.Metadata(
                        ("synthesizedBy", "vuex-dispatch"),
                        ("via", key),
                        ("registeredAt", file + ":" + line)),
                    line,
                    Column: null,
                    CodeGraphProvenance.Heuristic));
                added++;
            }
        }

        return edges;
    }

    // pathHasSegment (ts:2427): a path segment (dir or filename stem) equals `seg` —
    // `…/modules/user.js` has the segment `user`. Escapes `seg` exactly like the TS
    // char-class replace before embedding it in the boundary pattern.
    private static bool PathHasSegment(string filePath, string seg)
    {
        var escaped = Regex.Replace(seg, @"[.*+?^${}()|[\]\\]", m => "\\" + m.Value);
        return Regex.IsMatch(filePath, "[\\\\/]" + escaped + "[\\\\/.]");
    }
}

using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphPiniaStoreSynthesizer — piniaStoreEdges (callback-synthesizer.ts:2343).
// Phase.Main, gate has('vue', ...JS_FAMILY) (ts:3532). A Pinia store factory
// `export const useXStore = defineStore(...)` exposes its actions as methods on the
// store instance; a consumer does `const s = useXStore()` then `s.action()`. The call
// is a method-on-instance with no static edge to the action (which lives in the store's
// module). Bridge it: map each factory -> its file, bind `const <var> = useXStore()` per
// consumer file, and link the enclosing function -> the `<var>.method()` action node IN
// THE STORE'S FILE. The same-store-file gate keeps it precise (a Pinia built-in like
// `$patch` or an unrelated same-named method resolves to nothing).
// =============================================================================
internal sealed class CodeGraphPiniaStoreSynthesizer : ICodeGraphEdgeSynthesizer
{
    // PINIA_CONSUMER_EXT (ts:2337).
    private static readonly Regex ConsumerExt = new(
        @"\.(?:ts|tsx|js|jsx|mjs|cjs|vue)$",
        RegexOptions.ECMAScript);

    // JS-family extension → the comment-strip language (javascript else typescript).
    private static readonly Regex JsLangExt = new(@"\.(?:jsx?|mjs|cjs)$", RegexOptions.ECMAScript);

    // PINIA_FACTORY_RE (ts:2338) / PINIA_BIND_RE (ts:2339) / PINIA_CALL_RE (ts:2340).
    private static readonly Regex FactoryRe = new(
        @"\b(?:export\s+)?const\s+(\w+)\s*=\s*defineStore\s*\(",
        RegexOptions.ECMAScript);

    private static readonly Regex BindRe = new(
        @"\bconst\s+(\w+)\s*=\s*(?:await\s+)?(\w+)\s*\(",
        RegexOptions.ECMAScript);

    private static readonly Regex CallRe = new(@"(\w+)\s*\.\s*(\w+)\s*\(", RegexOptions.ECMAScript);

    // PINIA_FANOUT_CAP (ts:2341).
    private const int PiniaFanoutCap = 80;

    // has('vue', ...JS_FAMILY) (ts:3480/3532).
    private static readonly string[] Required =
    {
        CodeGraphLanguage.Vue, CodeGraphLanguage.TypeScript, CodeGraphLanguage.JavaScript,
        CodeGraphLanguage.Tsx, CodeGraphLanguage.Jsx
    };

    public string Name => "pinia-store";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var scannedFiles = 0;

        // 1. Map each `const useXStore = defineStore(...)` factory -> its store file.
        var factoryFile = new Dictionary<string, string>(StringComparer.Ordinal);
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
            if (string.IsNullOrEmpty(content) || !content.Contains("defineStore", StringComparison.Ordinal))
            {
                continue;
            }

            foreach (Match m in FactoryRe.Matches(content))
            {
                factoryFile[m.Groups[1].Value] = file;
            }
        }

        if (factoryFile.Count == 0)
        {
            return System.Array.Empty<CodeGraphEdge>();
        }

        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
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
            if (string.IsNullOrEmpty(content) || !content.Contains("Store", StringComparison.Ordinal))
            {
                continue;
            }

            var lang = JsLangExt.IsMatch(file) ? CodeGraphLanguage.JavaScript : CodeGraphLanguage.TypeScript;
            var safe = CodeGraphStripComments.StripForRegex(content, lang);

            // 2. Bind store vars in this file: `const <var> = <known-factory>(...)`.
            var varStore = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (Match bm in BindRe.Matches(safe))
            {
                if (factoryFile.TryGetValue(bm.Groups[2].Value, out var sf))
                {
                    varStore[bm.Groups[1].Value] = sf;
                }
            }

            if (varStore.Count == 0)
            {
                continue;
            }

            // 3. Link `<var>.<method>(` -> the action function node in the store's file.
            var nodesInFile = ctx.GetNodesInFile(file);
            CodeGraphNode? fallbackDispatcher = null;
            foreach (var n in nodesInFile)
            {
                if (n.Kind == CodeGraphNodeKind.Component)
                {
                    fallbackDispatcher = n; // .vue top-level setup
                    break;
                }
            }

            var lineOf = CodeGraphSynthesizerSupport.MakeLineAt(safe, 1);
            var added = 0;
            foreach (Match cm in CallRe.Matches(safe))
            {
                if (added >= PiniaFanoutCap)
                {
                    break;
                }

                if (!varStore.TryGetValue(cm.Groups[1].Value, out var storeFile))
                {
                    continue;
                }

                var method = cm.Groups[2].Value;
                var line = lineOf(cm.Index);
                var disp = CodeGraphSynthesizerSupport.EnclosingFn(nodesInFile, line) ?? fallbackDispatcher;
                if (disp is null)
                {
                    continue;
                }

                CodeGraphNode? target = null;
                foreach (var n in ctx.GetNodesByName(method))
                {
                    if (n.Kind == CodeGraphNodeKind.Function && n.FilePath == storeFile)
                    {
                        target = n;
                        break;
                    }
                }

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
                        ("synthesizedBy", "pinia-store"),
                        ("via", method),
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

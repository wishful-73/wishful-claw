using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphArkUiRouterSynthesizer — arkuiRouterEdges (callback-synthesizer.ts:
// 679). Phase.Main, gated to arkts. HarmonyOS page navigation:
// `router.pushUrl({ url: 'pages/Detail' })` / replaceUrl reaches the `@Entry
// struct` of `<module>/src/main/ets/pages/Detail.ets`, a string hop with no
// static edge. Bridge literal urls to the page struct: resolve against the
// standard `src/main/ets/` layout, prefer the caller's own workspace module,
// drop anything still ambiguous. Only `@Entry` structs qualify as targets.
// =============================================================================
internal sealed class CodeGraphArkUiRouterSynthesizer : ICodeGraphEdgeSynthesizer
{
    // ARKUI_ROUTER_RE (ts:666).
    private static readonly Regex RouterRe = new(
        @"\brouter\s*\.\s*(?:pushUrl|replaceUrl)\s*\(\s*\{[^)]{0,200}?\burl\s*:\s*['""]([\w\-./]+)['""]",
        RegexOptions.CultureInvariant);

    private static readonly string[] Required = { CodeGraphLanguage.ArkTs };

    public string Name => "arkui-route";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var allFiles = ctx.GetAllFiles();
        var moduleDirs = CodeGraphArkUiEmitterSynthesizer.ModuleDirs(ctx);

        var scanned = 0;
        foreach (var file in allFiles)
        {
            if ((++scanned & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!file.EndsWith(".ets", StringComparison.Ordinal))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content) || !content.Contains("router.", StringComparison.Ordinal))
            {
                continue;
            }

            var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.TypeScript);
            var nodes = CodeGraphArkUiEmitterSynthesizer.FnNodesInFile(ctx, file);
            var lineAt = CodeGraphSynthesizerSupport.MakeLineAt(safe, 1);

            foreach (Match m in RouterRe.Matches(safe))
            {
                var url = m.Groups[1].Value;
                var line = lineAt(m.Index);
                var encl = CodeGraphArkUiEmitterSynthesizer.SmallestEnclosing(nodes, line);
                if (encl is null)
                {
                    continue;
                }

                var suffix = "/src/main/ets/" + url + ".ets";
                var candidates = new List<string>();
                foreach (var f in allFiles)
                {
                    if (f.EndsWith(suffix, StringComparison.Ordinal))
                    {
                        candidates.Add(f);
                    }
                }

                if (candidates.Count > 1)
                {
                    var scope = CodeGraphArkUiEmitterSynthesizer.ModuleScopeOf(moduleDirs, file);
                    var sameModule = new List<string>();
                    foreach (var f in candidates)
                    {
                        if (CodeGraphArkUiEmitterSynthesizer.ModuleScopeOf(moduleDirs, f) == scope)
                        {
                            sameModule.Add(f);
                        }
                    }

                    if (sameModule.Count > 0)
                    {
                        candidates = sameModule;
                    }
                }

                if (candidates.Count != 1)
                {
                    continue; // ambiguous or unresolved — never guess
                }

                CodeGraphNode? page = null;
                foreach (var n in ctx.GetNodesInFile(candidates[0]))
                {
                    if (n.Kind == CodeGraphNodeKind.Struct && n.Decorators is not null &&
                        n.Decorators.Contains("Entry"))
                    {
                        page = n;
                        break;
                    }
                }

                if (page is null)
                {
                    continue;
                }

                var key = encl.Id + ">" + page.Id;
                if (!seen.Add(key))
                {
                    continue;
                }

                edges.Add(new CodeGraphEdge(
                    encl.Id,
                    page.Id,
                    CodeGraphEdgeKind.Calls,
                    CodeGraphSynthesizerSupport.Metadata(
                        ("synthesizedBy", "arkui-route"),
                        ("event", url),
                        ("registeredAt", candidates[0] + ":" + page.StartLine)),
                    line,
                    Column: null,
                    CodeGraphProvenance.Heuristic));
            }
        }

        return edges;
    }
}

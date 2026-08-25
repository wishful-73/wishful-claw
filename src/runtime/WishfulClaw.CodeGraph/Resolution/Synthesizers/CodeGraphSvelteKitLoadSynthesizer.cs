using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphSvelteKitLoadSynthesizer — svelteKitLoadEdges (callback-synthesizer.ts:2005).
// Phase.Main, gated to Svelte. SvelteKit runs a route's `load` / `actions` from a
// sibling `+page.server.ts` (or `.js`, or the shared `+page.ts`) module before rendering
// the `+page.svelte` / `+layout.svelte` component — a framework-internal data hop with
// no static edge, so the page component never links to the loader that feeds it. Bridge
// it: for each `+page`/`+layout` SFC, link its component -> the `load`/`actions` export
// in the co-located loader file (checking `.server.ts`, `.server.js`, `.ts`, `.js`).
//
// Edge is `references` / `heuristic` / `synthesizedBy:'sveltekit-load'` (a data-load
// dependency, not a direct call). A project with no SvelteKit routes is a no-op.
// =============================================================================
internal sealed class CodeGraphSvelteKitLoadSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly string[] RequiredSvelte = { CodeGraphLanguage.Svelte };

    // `<dir>/+page.svelte` / `<dir>/+layout.svelte` (ts:2013).
    private static readonly Regex PageLayoutRe =
        new(@"(.*/)(\+(?:page|layout))\.svelte$", RegexOptions.ECMAScript);

    // Loader-file extensions, server-first (ts:2019).
    private static readonly string[] LoaderExts = { ".server.ts", ".server.js", ".ts", ".js" };

    // HOOKS / HOOK_KINDS (ts:2009).
    private static readonly HashSet<string> Hooks = new(StringComparer.Ordinal) { "load", "actions" };

    private static readonly HashSet<string> HookKinds = new(StringComparer.Ordinal)
    {
        CodeGraphNodeKind.Function, CodeGraphNodeKind.Method, CodeGraphNodeKind.Constant, CodeGraphNodeKind.Variable
    };

    public string Name => "sveltekit-load";

    public IReadOnlyList<string> RequiredLanguages => RequiredSvelte;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var allFilesList = ctx.GetAllFiles();
        var allFiles = new HashSet<string>(allFilesList, StringComparer.Ordinal);
        var scanned = 0;

        foreach (var file in allFilesList)
        {
            if ((++scanned & 255) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            var m = PageLayoutRe.Match(file);
            if (!m.Success)
            {
                continue;
            }

            var dir = m.Groups[1].Value;
            var prefix = m.Groups[2].Value;

            CodeGraphNode? page = null;
            foreach (var n in ctx.GetNodesInFile(file))
            {
                if (n.Kind == CodeGraphNodeKind.Component)
                {
                    page = n;
                    break;
                }
            }

            if (page is null)
            {
                continue;
            }

            foreach (var ext in LoaderExts)
            {
                var loaderFile = dir + prefix + ext;
                if (!allFiles.Contains(loaderFile))
                {
                    continue;
                }

                foreach (var hook in ctx.GetNodesInFile(loaderFile))
                {
                    if (!HookKinds.Contains(hook.Kind) || !Hooks.Contains(hook.Name))
                    {
                        continue;
                    }

                    edges.Add(new CodeGraphEdge(
                        page.Id,
                        hook.Id,
                        CodeGraphEdgeKind.References,
                        CodeGraphSynthesizerSupport.Metadata(
                            ("synthesizedBy", "sveltekit-load"),
                            ("via", hook.Name),
                            ("registeredAt", loaderFile + ":" + hook.StartLine)),
                        page.StartLine,
                        Column: null,
                        CodeGraphProvenance.Heuristic));
                }
            }
        }

        return edges;
    }
}

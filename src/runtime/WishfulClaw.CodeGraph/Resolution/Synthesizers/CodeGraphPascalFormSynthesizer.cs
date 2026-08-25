using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphPascalFormSynthesizer — pascalFormEdges (callback-synthesizer.ts:
// 1966). Phase.Main, gated to pascal. Delphi form code-behind: a form unit
// `UFRMAbout.pas` owns its visual form definition `UFRMAbout.dfm` (VCL) / `.fmx`
// (FireMonkey) — paired by basename in the same directory, wired by the
// `{$R *.dfm}` directive rather than a `uses` clause. Link the unit file node →
// its form file node (`references`) so a `.dfm`/`.fmx` used only as a form
// definition isn't orphaned.
// =============================================================================
internal sealed class CodeGraphPascalFormSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly Regex FormExtRe = new(@"\.(dfm|fmx)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly string[] Required = { CodeGraphLanguage.Pascal };

    public string Name => "pascal-form";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var allFiles = new HashSet<string>(ctx.GetAllFiles(), StringComparer.Ordinal);

        var scanned = 0;
        foreach (var file in allFiles)
        {
            if ((++scanned & 255) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!FormExtRe.IsMatch(file))
            {
                continue;
            }

            var pasFile = FormExtRe.Replace(file, ".pas");
            if (!allFiles.Contains(pasFile))
            {
                continue;
            }

            var formNode = FirstFileNode(ctx, file);
            var unitNode = FirstFileNode(ctx, pasFile);
            if (formNode is null || unitNode is null)
            {
                continue;
            }

            edges.Add(new CodeGraphEdge(
                unitNode.Id,
                formNode.Id,
                CodeGraphEdgeKind.References,
                CodeGraphSynthesizerSupport.Metadata(
                    ("synthesizedBy", "pascal-form"),
                    ("registeredAt", pasFile)),
                unitNode.StartLine,
                Column: null,
                CodeGraphProvenance.Heuristic));
        }

        return edges;
    }

    private static CodeGraphNode? FirstFileNode(CodeGraphResolutionContext ctx, string file)
    {
        foreach (var n in ctx.GetNodesInFile(file))
        {
            if (n.Kind == CodeGraphNodeKind.File)
            {
                return n;
            }
        }

        return null;
    }
}

using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphCicsResolver — CICS (COBOL) framework resolver (port of frameworks/cics.ts).
// Resolves the pseudo-conversational transaction hop: a `cics-transid:XXXX` reference
// (emitted by the COBOL extractor for `EXEC CICS RETURN/START TRANSID`) is mapped to the
// program module whose TRAN*-named working-storage data item declares that id as a
// `VALUE` literal. No match (an id owned by an out-of-repo program) stays unresolved.
//
// The transaction-id -> module index (a JS WeakMap) is a ConditionalWeakTable, built once
// per context. Global namespace, all-internal, reflection-free/AOT; [GeneratedRegex].
// =============================================================================
internal sealed partial class CodeGraphCicsResolver : ICodeGraphFrameworkResolver
{
    private const string TransidRefPrefix = "cics-transid:";

    private static readonly string[] CobolLanguages = { CodeGraphLanguage.Cobol };

    // transaction id -> owning program module, built once per resolution context.
    private static readonly ConditionalWeakTable<CodeGraphResolutionContext, Dictionary<string, string>>
        TransidIndexes = new();

    public string Name => "cics";

    public IReadOnlyList<string>? Languages => CobolLanguages;

    // Any indexed COBOL program qualifies — the resolver only acts on cics-transid: refs.
    public bool Detect(CodeGraphResolutionContext ctx)
    {
        foreach (var n in ctx.GetNodesByKind(CodeGraphNodeKind.Module))
        {
            if (n.Language == CodeGraphLanguage.Cobol)
            {
                return true;
            }
        }

        return false;
    }

    // cics-transid:XXXX matches no symbol name — opt it past the name-exists pre-filter.
    public bool ClaimsReference(string name) => name.StartsWith(TransidRefPrefix, StringComparison.Ordinal);

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        if (!r.ReferenceName.StartsWith(TransidRefPrefix, StringComparison.Ordinal))
        {
            return null;
        }

        var tx = r.ReferenceName[TransidRefPrefix.Length..].ToUpperInvariant();

        var index = TransidIndexes.GetValue(ctx, BuildIndex);
        return index.TryGetValue(tx, out var targetNodeId)
            ? new CodeGraphResolvedRef(targetNodeId, 0.85, CodeGraphResolvedBy.Framework)
            : null;
    }

    private Dictionary<string, string> BuildIndex(CodeGraphResolutionContext ctx)
    {
        var index = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var node in EnumerateDataNodes(ctx))
        {
            if (node.Language != CodeGraphLanguage.Cobol)
            {
                continue;
            }

            if (!TranidNameRegex().IsMatch(node.Name))
            {
                continue;
            }

            if (node.Signature is null)
            {
                continue;
            }

            var value = ValueLiteralRegex().Match(node.Signature);
            if (!value.Success || value.Groups[1].Value.Length == 0)
            {
                continue;
            }

            var tx = value.Groups[1].Value.ToUpperInvariant();
            if (index.ContainsKey(tx))
            {
                continue; // first declaration wins
            }

            foreach (var n in ctx.GetNodesInFile(node.FilePath))
            {
                if (n.Kind == CodeGraphNodeKind.Module && n.Language == CodeGraphLanguage.Cobol)
                {
                    index[tx] = n.Id;
                    break;
                }
            }
        }

        return index;
    }

    // variable + field + constant nodes, in that order (≙ cics.ts dataNodes spread).
    private static IEnumerable<CodeGraphNode> EnumerateDataNodes(CodeGraphResolutionContext ctx)
    {
        foreach (var n in ctx.GetNodesByKind(CodeGraphNodeKind.Variable))
        {
            yield return n;
        }

        foreach (var n in ctx.GetNodesByKind(CodeGraphNodeKind.Field))
        {
            yield return n;
        }

        foreach (var n in ctx.GetNodesByKind(CodeGraphNodeKind.Constant))
        {
            yield return n;
        }
    }

    [GeneratedRegex("TRAN", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex TranidNameRegex();

    [GeneratedRegex(@"\bVALUE\s+['""]([A-Za-z0-9$#@]{1,4})['""]", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ValueLiteralRegex();
}

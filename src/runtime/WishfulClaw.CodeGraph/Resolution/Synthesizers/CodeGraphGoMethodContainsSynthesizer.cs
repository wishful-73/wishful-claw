// =============================================================================
// CodeGraphGoMethodContainsSynthesizer — goCrossFileMethodContainsEdges
// (callback-synthesizer.ts:906). Phase.GoPrePass, persisted BEFORE the next pass:
// goImplements derives a struct's method set from these `contains` edges, so this
// must land first (#583).
//
// In Go a type's methods are commonly declared in a different file from the `type`
// declaration (`type User struct{}` in user.go, `func (u *User) Save()` in
// user_store.go). Extraction attaches the struct->method `contains` edge only when
// the receiver type is in the SAME file, so a cross-file method is orphaned from its
// struct. Go guarantees the receiver type is in the same PACKAGE (= same directory)
// as the method, so this is a DETERMINISTIC structural link, not a heuristic — hence
// the emitted edge carries NO provenance:'heuristic' and NO metadata, exactly like
// the same-file `contains` edges extraction already emits.
// =============================================================================
internal sealed class CodeGraphGoMethodContainsSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly string[] RequiredGo = { CodeGraphLanguage.Go };

    // Kinds that can own a receiver method (TYPE_KINDS, ts:910).
    private static readonly HashSet<string> TypeKinds = new(StringComparer.Ordinal)
    {
        CodeGraphNodeKind.Struct, CodeGraphNodeKind.Class, CodeGraphNodeKind.Interface,
        CodeGraphNodeKind.Enum, CodeGraphNodeKind.TypeAlias
    };

    public string Name => "go-cross-file-method-contains";

    public IReadOnlyList<string> RequiredLanguages => RequiredGo;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.GoPrePass;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var scanned = 0;
        foreach (var method in ctx.IterateNodesByKind(CodeGraphNodeKind.Method))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (method.Language != CodeGraphLanguage.Go)
            {
                continue;
            }

            // The receiver type is encoded in the method's qualifiedName as
            // `Recv::name` (extraction sets `${receiverType}::${name}`).
            var qn = method.QualifiedName;
            if (string.IsNullOrEmpty(qn))
            {
                continue;
            }

            var sep = qn.LastIndexOf("::", StringComparison.Ordinal);
            if (sep <= 0)
            {
                continue;
            }

            var receiver = qn[..sep];
            if (receiver.Length == 0)
            {
                continue;
            }

            // Already attached to its type (the same-file case handled at extraction)?
            var hasTypeParent = false;
            foreach (var incoming in ctx.GetIncomingEdges(method.Id, CodeGraphSynthesizerSupport.ContainsEdgeKinds))
            {
                var src = ctx.GetNodeById(incoming.Source);
                if (src is not null && TypeKinds.Contains(src.Kind))
                {
                    hasTypeParent = true;
                    break;
                }
            }

            if (hasTypeParent)
            {
                continue;
            }

            // Find the receiver type in the SAME directory (= same Go package). Go
            // forbids duplicate type names within a package, so a same-name same-dir
            // match is unambiguous.
            var dir = DirOf(method.FilePath);
            CodeGraphNode? owner = null;
            foreach (var candidate in ctx.GetNodesByName(receiver))
            {
                if (candidate.Language == CodeGraphLanguage.Go &&
                    TypeKinds.Contains(candidate.Kind) &&
                    DirOf(candidate.FilePath) == dir)
                {
                    owner = candidate;
                    break;
                }
            }

            if (owner is null)
            {
                continue;
            }

            var key = owner.Id + ">" + method.Id;
            if (!seen.Add(key))
            {
                continue;
            }

            // Deterministic structural link — NO provenance/metadata (matches the
            // same-file `contains` edges extraction emits).
            edges.Add(new CodeGraphEdge(
                owner.Id, method.Id, CodeGraphEdgeKind.Contains, Metadata: null, method.StartLine, Column: null, Provenance: null));
        }

        return edges;
    }

    // p.replace(/\\/g, '/').lastIndexOf('/') → the directory portion, or "" (ts:911).
    private static string DirOf(string p)
    {
        var s = p.Replace('\\', '/');
        var i = s.LastIndexOf('/');
        return i >= 0 ? s[..i] : string.Empty;
    }
}

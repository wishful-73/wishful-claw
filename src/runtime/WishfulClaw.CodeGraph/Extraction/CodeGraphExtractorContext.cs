// =============================================================================
// CodeGraphExtractorContext — the controlled callback surface passed to language
// hooks (VisitNode / SynthesizeMembers). Port of ExtractorContext
// (tree-sitter-types.ts §50-71) / makeExtractorContext (tree-sitter.ts:1403).
//
// A hook can create nodes, dispatch/visit children, add unresolved references, and
// push/pop the scope stack — WITHOUT reaching into the engine's internals. It wraps
// a single CodeGraphTreeSitterExtractor and forwards to its internal operations.
// =============================================================================
internal sealed class CodeGraphExtractorContext
{
    private readonly CodeGraphTreeSitterExtractor _engine;

    internal CodeGraphExtractorContext(CodeGraphTreeSitterExtractor engine) => _engine = engine;

    /// <summary>Create a node and add it to the extraction result (skips empty names).</summary>
    public CodeGraphNode? CreateNode(string kind, string name, CodeGraphTsNode node, CodeGraphNodeExtra extra = default) =>
        _engine.CreateNode(kind, name, node, extra);

    /// <summary>Dispatch a node through the standard visitNode ladder.</summary>
    public void VisitNode(CodeGraphTsNode node) => _engine.VisitNode(node);

    /// <summary>Walk a function body to extract calls and nested structure.</summary>
    public void VisitFunctionBody(CodeGraphTsNode body, string functionId) =>
        _engine.VisitFunctionBody(body, functionId);

    /// <summary>Add an unresolved reference (a name string, resolved cross-file later).</summary>
    public void AddUnresolvedReference(CodeGraphUnresolvedReference reference) =>
        _engine.AddUnresolvedReference(reference);

    /// <summary>Push a node id onto the scope stack (containment / qualified-name build).</summary>
    public void PushScope(string nodeId) => _engine.PushScope(nodeId);

    /// <summary>Pop the last node id from the scope stack.</summary>
    public void PopScope() => _engine.PopScope();

    /// <summary>Current file path.</summary>
    public string FilePath => _engine.FilePath;

    /// <summary>Current source text (UTF-8 byte buffer + byte-offset slicing).</summary>
    public CodeGraphSourceText Source => _engine.Source;

    /// <summary>Stack of enclosing scope node ids (current scope).</summary>
    public IReadOnlyList<string> NodeStack => _engine.NodeStack;

    /// <summary>All nodes extracted so far.</summary>
    public IReadOnlyList<CodeGraphNode> Nodes => _engine.Nodes;
}

// -----------------------------------------------------------------------------
// CodeGraphNodeExtra — the optional per-node fields CreateNode layers on top of the
// positional CodeGraphNode (the analog of CodeGraph's `Partial<Node>` extra arg).
// Nullable everywhere: a null boolean means "leave at the record default (false)".
// QualifiedName overrides the scope-stack-built value (used by receiver-typed
// methods, e.g. Go/Rust `Recv::method`).
// -----------------------------------------------------------------------------
internal readonly struct CodeGraphNodeExtra
{
    public string? Docstring { get; init; }
    public string? Signature { get; init; }
    public string? Visibility { get; init; }
    public bool? IsExported { get; init; }
    public bool? IsAsync { get; init; }
    public bool? IsStatic { get; init; }
    public bool? IsAbstract { get; init; }
    public IReadOnlyList<string>? Decorators { get; init; }
    public IReadOnlyList<string>? TypeParameters { get; init; }
    public string? ReturnType { get; init; }
    public string? QualifiedName { get; init; }
}

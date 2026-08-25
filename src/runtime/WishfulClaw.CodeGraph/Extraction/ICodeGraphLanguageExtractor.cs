// =============================================================================
// ICodeGraphLanguageExtractor — the per-language extraction CONTRACT.
//
// Port of CodeGraph's `LanguageExtractor` interface (extraction/tree-sitter-types.ts
// §3.1). A language extractor is a DECLARATIVE CONFIG OBJECT (analysis/01 §3.1:
// "not a class or function") — arrays of grammar node-type NAME strings + field
// names + optional hook callbacks. The port's leverage is ONE engine
// (CodeGraphTreeSitterExtractor) + N thin configs implementing this contract.
//
// Two shapes ship here:
//   * ICodeGraphLanguageExtractor — the interface the engine depends on.
//   * CodeGraphLanguageExtractor   — a sealed record implementing it with sensible
//     defaults, so a minimal config is `new CodeGraphLanguageExtractor { … }`.
//
// Node/text params: hooks receive a value-type CodeGraphTsNode (carries its owning
// CodeGraphSourceText, so `node.Text` slices by byte offset). Where the TS hook also
// took the `source` string, the C# hook takes a CodeGraphSourceText for the rare
// case a hook needs to slice an arbitrary byte range. Predicate hooks (GetVisibility,
// IsAsync, …) take only the node, mirroring the TS signatures.
//
// MVP note: the engine wires nearly every hook below. ExtractVariables is declared
// for contract parity (CodeGraph's extractVariable also drives off hardcoded
// per-language branches, not this hook). Framework/value-ref/function-ref behaviors
// are deferred (analysis/01 §7) — configs simply leave those hooks unset.
// =============================================================================
internal interface ICodeGraphLanguageExtractor
{
    // --- Node type mappings (grammar-specific node.type name strings) ---
    IReadOnlyList<string> FunctionTypes { get; }
    IReadOnlyList<string> ClassTypes { get; }
    IReadOnlyList<string> MethodTypes { get; }
    IReadOnlyList<string> InterfaceTypes { get; }
    IReadOnlyList<string> StructTypes { get; }
    IReadOnlyList<string> EnumTypes { get; }
    /// <summary>Enum members/cases (Rust 'enum_variant', Swift 'enum_entry'). Optional.</summary>
    IReadOnlyList<string>? EnumMemberTypes { get; }
    IReadOnlyList<string> TypeAliasTypes { get; }
    IReadOnlyList<string> ImportTypes { get; }
    IReadOnlyList<string> CallTypes { get; }
    IReadOnlyList<string> VariableTypes { get; }
    /// <summary>Class fields extracted as 'field' kind. Optional.</summary>
    IReadOnlyList<string>? FieldTypes { get; }
    /// <summary>Class properties extracted as 'property' kind. Optional.</summary>
    IReadOnlyList<string>? PropertyTypes { get; }

    // --- Field name mappings (grammar-specific field names) ---
    string NameField { get; }
    string BodyField { get; }
    string ParamsField { get; }
    string? ReturnField { get; }

    // --- Extra config knobs ---
    /// <summary>Additional node types treated as class declarations (Dart 'mixin_declaration').</summary>
    IReadOnlyList<string>? ExtraClassNodeTypes { get; }
    /// <summary>Methods can be top-level without an enclosing class (Go: true).</summary>
    bool MethodsAreTopLevel { get; }
    /// <summary>Skip a bodiless class as a forward declaration (C/C++ `class Foo;`).</summary>
    bool SkipBodilessClass { get; }
    /// <summary>NodeKind for interface-like declarations (Rust: 'trait'). Default 'interface'.</summary>
    string? InterfaceKind { get; }
    /// <summary>File-level package/namespace declaration node types (Java/Kotlin).</summary>
    IReadOnlyList<string>? PackageTypes { get; }

    // --- Hooks ---
    /// <summary>Offset-preserving source transform applied before parse. MUST return an
    /// equal-byte-length buffer (Decision 22). (utf8, filePath) -> utf8.</summary>
    Func<byte[], string?, byte[]>? PreParse { get; }
    /// <summary>Override symbol-name extraction.</summary>
    Func<CodeGraphTsNode, CodeGraphSourceText, string?>? ResolveName { get; }
    /// <summary>Post-process a name to recover an identifier mangled by a macro (C/C++).
    /// MUST be a no-op on a well-formed name.</summary>
    Func<string, string>? RecoverMangledName { get; }
    /// <summary>Extract a property name when the generic walk fails.</summary>
    Func<CodeGraphTsNode, CodeGraphSourceText, string?>? ExtractPropertyName { get; }
    /// <summary>Extract a signature string from a declaration node.</summary>
    Func<CodeGraphTsNode, CodeGraphSourceText, string?>? GetSignature { get; }
    /// <summary>public | private | protected | internal | null.</summary>
    Func<CodeGraphTsNode, string?>? GetVisibility { get; }
    Func<CodeGraphTsNode, CodeGraphSourceText, bool>? IsExported { get; }
    Func<CodeGraphTsNode, bool>? IsAsync { get; }
    Func<CodeGraphTsNode, bool>? IsStatic { get; }
    /// <summary>Whether a variable/field declaration is a constant (const vs let/var).</summary>
    Func<CodeGraphTsNode, bool>? IsConst { get; }
    /// <summary>Extra symbol-level modifier keywords persisted onto node.Decorators.</summary>
    Func<CodeGraphTsNode, IReadOnlyList<string>?>? ExtractModifiers { get; }
    /// <summary>Custom subtree visitor. Return true if fully handled (skip default dispatch).</summary>
    Func<CodeGraphTsNode, CodeGraphExtractorContext, bool>? VisitNode { get; }
    /// <summary>Synthesize compile-time members at end of class extraction (Java Lombok).</summary>
    Action<CodeGraphTsNode, CodeGraphExtractorContext>? SynthesizeMembers { get; }
    /// <summary>Classify a reused class node: class | struct | enum | interface | trait.</summary>
    Func<CodeGraphTsNode, string?>? ClassifyClassNode { get; }
    /// <summary>Classify a reused method node: method | constructor | property. Default 'method'.</summary>
    Func<CodeGraphTsNode, string?>? ClassifyMethodNode { get; }
    /// <summary>Resolve the body node when it is not a child field (Dart sibling body).
    /// (node, bodyField) -> body or null.</summary>
    Func<CodeGraphTsNode, string, CodeGraphTsNode?>? ResolveBody { get; }
    /// <summary>Extract import info from an import node; null if unrecognized.</summary>
    Func<CodeGraphTsNode, CodeGraphSourceText, CodeGraphImportInfo?>? ExtractImport { get; }
    /// <summary>Extract declared variables from a declaration node (contract parity — the
    /// MVP engine drives extractVariable off per-language branches, not this hook).</summary>
    Func<CodeGraphTsNode, CodeGraphSourceText, IReadOnlyList<CodeGraphVariableInfo>>? ExtractVariables { get; }
    /// <summary>Receiver/owner type of a method (Go/Rust). Included in the qualified name.</summary>
    Func<CodeGraphTsNode, CodeGraphSourceText, string?>? GetReceiverType { get; }
    /// <summary>Normalized return type name stored on node.ReturnType.</summary>
    Func<CodeGraphTsNode, CodeGraphSourceText, string?>? GetReturnType { get; }
    /// <summary>Override a type-alias node's kind (Go type_spec wrapping struct/interface).</summary>
    Func<CodeGraphTsNode, CodeGraphSourceText, string?>? ResolveTypeAliasKind { get; }
    /// <summary>True if a function/method name is a macro misparse artifact to skip.</summary>
    Func<string, CodeGraphTsNode, bool>? IsMisparsedFunction { get; }
    /// <summary>Detect a bare method call parsed as a plain identifier (Ruby). Returns callee.</summary>
    Func<CodeGraphTsNode, CodeGraphSourceText, string?>? ExtractBareCall { get; }
    /// <summary>Extract the dotted package name from a package declaration node.</summary>
    Func<CodeGraphTsNode, CodeGraphSourceText, string?>? ExtractPackage { get; }
}

// -----------------------------------------------------------------------------
// CodeGraphLanguageExtractor — data-driven default implementation. Configs write
// `new CodeGraphLanguageExtractor { FunctionTypes = [...], GetVisibility = n => ... }`.
// Required arrays default empty; optional arrays/hooks default null; field names
// default to the empty string so a partially-specified config still compiles.
// -----------------------------------------------------------------------------
internal sealed record CodeGraphLanguageExtractor : ICodeGraphLanguageExtractor
{
    public IReadOnlyList<string> FunctionTypes { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> ClassTypes { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> MethodTypes { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> InterfaceTypes { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> StructTypes { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> EnumTypes { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string>? EnumMemberTypes { get; init; }
    public IReadOnlyList<string> TypeAliasTypes { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> ImportTypes { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> CallTypes { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> VariableTypes { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string>? FieldTypes { get; init; }
    public IReadOnlyList<string>? PropertyTypes { get; init; }

    public string NameField { get; init; } = string.Empty;
    public string BodyField { get; init; } = string.Empty;
    public string ParamsField { get; init; } = string.Empty;
    public string? ReturnField { get; init; }

    public IReadOnlyList<string>? ExtraClassNodeTypes { get; init; }
    public bool MethodsAreTopLevel { get; init; }
    public bool SkipBodilessClass { get; init; }
    public string? InterfaceKind { get; init; }
    public IReadOnlyList<string>? PackageTypes { get; init; }

    public Func<byte[], string?, byte[]>? PreParse { get; init; }
    public Func<CodeGraphTsNode, CodeGraphSourceText, string?>? ResolveName { get; init; }
    public Func<string, string>? RecoverMangledName { get; init; }
    public Func<CodeGraphTsNode, CodeGraphSourceText, string?>? ExtractPropertyName { get; init; }
    public Func<CodeGraphTsNode, CodeGraphSourceText, string?>? GetSignature { get; init; }
    public Func<CodeGraphTsNode, string?>? GetVisibility { get; init; }
    public Func<CodeGraphTsNode, CodeGraphSourceText, bool>? IsExported { get; init; }
    public Func<CodeGraphTsNode, bool>? IsAsync { get; init; }
    public Func<CodeGraphTsNode, bool>? IsStatic { get; init; }
    public Func<CodeGraphTsNode, bool>? IsConst { get; init; }
    public Func<CodeGraphTsNode, IReadOnlyList<string>?>? ExtractModifiers { get; init; }
    public Func<CodeGraphTsNode, CodeGraphExtractorContext, bool>? VisitNode { get; init; }
    public Action<CodeGraphTsNode, CodeGraphExtractorContext>? SynthesizeMembers { get; init; }
    public Func<CodeGraphTsNode, string?>? ClassifyClassNode { get; init; }
    public Func<CodeGraphTsNode, string?>? ClassifyMethodNode { get; init; }
    public Func<CodeGraphTsNode, string, CodeGraphTsNode?>? ResolveBody { get; init; }
    public Func<CodeGraphTsNode, CodeGraphSourceText, CodeGraphImportInfo?>? ExtractImport { get; init; }
    public Func<CodeGraphTsNode, CodeGraphSourceText, IReadOnlyList<CodeGraphVariableInfo>>? ExtractVariables { get; init; }
    public Func<CodeGraphTsNode, CodeGraphSourceText, string?>? GetReceiverType { get; init; }
    public Func<CodeGraphTsNode, CodeGraphSourceText, string?>? GetReturnType { get; init; }
    public Func<CodeGraphTsNode, CodeGraphSourceText, string?>? ResolveTypeAliasKind { get; init; }
    public Func<string, CodeGraphTsNode, bool>? IsMisparsedFunction { get; init; }
    public Func<CodeGraphTsNode, CodeGraphSourceText, string?>? ExtractBareCall { get; init; }
    public Func<CodeGraphTsNode, CodeGraphSourceText, string?>? ExtractPackage { get; init; }
}

// Result of a language's ExtractImport hook (tree-sitter-types.ts ImportInfo).
internal sealed record CodeGraphImportInfo(
    string ModuleName,
    string Signature,
    bool HandledRefs = false);

// One variable within a declaration (tree-sitter-types.ts VariableInfo). Kind is a
// CodeGraphNodeKind value ('variable' | 'constant'). DelegateToFunction/PositionNode
// are absent-child-safe nullable struct nodes.
internal sealed record CodeGraphVariableInfo(
    string Name,
    string Kind,
    string? Signature = null,
    CodeGraphTsNode? DelegateToFunction = null,
    CodeGraphTsNode? PositionNode = null);

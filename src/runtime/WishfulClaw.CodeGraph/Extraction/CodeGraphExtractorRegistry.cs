// =============================================================================
// CodeGraphExtractorRegistry — language-id → extraction-config lookup (the C#
// analog of CodeGraph's getLanguageExtractor(language) map).
//
// A plain keyed lookup, populated by the language-config slice (one
// ICodeGraphLanguageExtractor per grammar language it ships) and consulted by
// CodeGraphIndexer to resolve the config for a detected language. No aliasing and
// no reflection: a language whose config is not registered simply has no extractor,
// and the indexer tracks that file as skipped (the isLanguageSupported === false
// path). Keys are the CodeGraphLanguage.* vocabulary constants, compared Ordinal.
// =============================================================================
internal sealed class CodeGraphExtractorRegistry
{
    private readonly Dictionary<string, ICodeGraphLanguageExtractor> byLanguage;

    public CodeGraphExtractorRegistry() =>
        byLanguage = new Dictionary<string, ICodeGraphLanguageExtractor>(StringComparer.Ordinal);

    public CodeGraphExtractorRegistry(
        IEnumerable<KeyValuePair<string, ICodeGraphLanguageExtractor>> extractors)
        : this()
    {
        foreach (KeyValuePair<string, ICodeGraphLanguageExtractor> entry in extractors)
        {
            byLanguage[entry.Key] = entry.Value;
        }
    }

    // Register (or replace) the extraction config for a language id (CodeGraphLanguage.*).
    public void Register(string language, ICodeGraphLanguageExtractor extractor) =>
        byLanguage[language] = extractor;

    // The extraction config for a language id, or null when none is registered.
    public ICodeGraphLanguageExtractor? Get(string language) =>
        byLanguage.TryGetValue(language, out ICodeGraphLanguageExtractor? extractor)
            ? extractor
            : null;

    public bool Contains(string language) => byLanguage.ContainsKey(language);

    public int Count => byLanguage.Count;

    // MVP analog of CodeGraph's EXTRACTORS barrel (languages/index.ts): a registry
    // wired with the shipped grammar-language configs. tsx reuses the TypeScript
    // config and jsx reuses the JavaScript config — exactly as the TS map keys them
    // (`tsx: typescriptExtractor`, `jsx: javascriptExtractor`).
    public static CodeGraphExtractorRegistry CreateDefault()
    {
        var registry = new CodeGraphExtractorRegistry();
        registry.Register(CodeGraphLanguage.TypeScript, CodeGraphTypeScriptExtractor.Instance);
        registry.Register(CodeGraphLanguage.Tsx, CodeGraphTypeScriptExtractor.Instance);
        registry.Register(CodeGraphLanguage.JavaScript, CodeGraphJavaScriptExtractor.Instance);
        registry.Register(CodeGraphLanguage.Jsx, CodeGraphJavaScriptExtractor.Instance);
        registry.Register(CodeGraphLanguage.Python, CodeGraphPythonExtractor.Instance);
        registry.Register(CodeGraphLanguage.Go, CodeGraphGoExtractor.Instance);
        registry.Register(CodeGraphLanguage.Java, CodeGraphJavaExtractor.Instance);
        registry.Register(CodeGraphLanguage.Rust, CodeGraphRustExtractor.Instance);
        registry.Register(CodeGraphLanguage.CSharp, CodeGraphCSharpExtractor.Instance);
        registry.Register(CodeGraphLanguage.C, CodeGraphCExtractor.Instance);
        registry.Register(CodeGraphLanguage.Cpp, CodeGraphCppExtractor.Instance);
        registry.Register(CodeGraphLanguage.Php, CodeGraphPhpExtractor.Instance);
        registry.Register(CodeGraphLanguage.Ruby, CodeGraphRubyExtractor.Instance);
        registry.Register(CodeGraphLanguage.Scala, CodeGraphScalaExtractor.Instance);
        // M7 niche languages (15). Each ships an ICodeGraphLanguageExtractor config;
        // resolution is grammar-gated, so an absent grammar simply skips the file.
        registry.Register(CodeGraphLanguage.Swift, CodeGraphSwiftExtractor.Instance);
        registry.Register(CodeGraphLanguage.Kotlin, CodeGraphKotlinExtractor.Instance);
        registry.Register(CodeGraphLanguage.Dart, CodeGraphDartExtractor.Instance);
        registry.Register(CodeGraphLanguage.ObjC, CodeGraphObjcExtractor.Instance);
        registry.Register(CodeGraphLanguage.ArkTs, CodeGraphArkTsExtractor.Instance);
        registry.Register(CodeGraphLanguage.Cobol, CodeGraphCobolExtractor.Instance);
        registry.Register(CodeGraphLanguage.VbNet, CodeGraphVbNetExtractor.Instance);
        registry.Register(CodeGraphLanguage.Erlang, CodeGraphErlangExtractor.Instance);
        registry.Register(CodeGraphLanguage.Nix, CodeGraphNixExtractor.Instance);
        registry.Register(CodeGraphLanguage.Terraform, CodeGraphTerraformExtractor.Instance);
        registry.Register(CodeGraphLanguage.Solidity, CodeGraphSolidityExtractor.Instance);
        registry.Register(CodeGraphLanguage.Lua, CodeGraphLuaExtractor.Instance);
        registry.Register(CodeGraphLanguage.Luau, CodeGraphLuauExtractor.Instance);
        registry.Register(CodeGraphLanguage.R, CodeGraphRExtractor.Instance);
        // CFML is NOT registered here — like Razor, it is a bespoke embedded extractor
        // (CodeGraphCfmlEmbeddedExtractor) that dialect-switches across the
        // cfml/cfscript/cfquery grammars, routed by CodeGraphExtractor.EmbeddedKind. Its
        // cfscript/cfquery configs (CodeGraphCfmlExtractor.Instance / CfQueryInstance) are
        // consumed directly by that extractor, never looked up through this registry.
        registry.Register(CodeGraphLanguage.Pascal, CodeGraphPascalExtractor.Instance);
        // Grammar-expansion set (TreeSitter.DotNet 1.3.0). Razor is NOT here — it is a
        // bespoke embedded extractor (regex directives + @code C# delegation), not a
        // tree-sitter config, and is routed by CodeGraphExtractor.EmbeddedKind instead.
        registry.Register(CodeGraphLanguage.Bash, CodeGraphBashExtractor.Instance);
        registry.Register(CodeGraphLanguage.Haskell, CodeGraphHaskellExtractor.Instance);
        registry.Register(CodeGraphLanguage.Julia, CodeGraphJuliaExtractor.Instance);
        return registry;
    }
}

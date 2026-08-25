using System.Diagnostics;
using System.Text;

// =============================================================================
// CodeGraphExtractor — the per-file extraction entry point (port of
// extractFromSource, tree-sitter.ts:6568).
//
// Two paths, mirroring the TS branch ladder:
//   1. BESPOKE embedded-format extractors for formats no single grammar covers —
//      MyBatis mapper XML, Liquid templates, Delphi DFM/FMX forms (all regex-only),
//      plus the Single-File-Component formats Svelte/Vue/Astro (regex-split the SFC,
//      then delegate its <script>/frontmatter region to the TS/JS engine, offsetting
//      positions back to full-SFC coordinates). Selected up front by language (+ file
//      extension for pascal), they parse from the decoded source and return before any
//      grammar lookup for the SFC language itself. `extractor` is not consulted for
//      these (there is no config for svelte/vue/astro/xml/liquid/dfm); the SFC
//      extractors reach the TS/JS grammar through the `registry` passed to them.
//   2. GRAMMAR path — resolve the grammar, apply the optional offset-preserving
//      preParse, parse with CodeGraphTsParser, run CodeGraphTreeSitterExtractor,
//      dispose the tree/parser.
//
// A missing grammar (registry returns null), an absent config on the grammar path,
// or a preParse that fails the byte-length invariant returns an empty result with a
// diagnostic error — never throws — so one unindexable file never fails a whole run.
// =============================================================================
internal static class CodeGraphExtractor
{
    // Which bespoke embedded-format extractor (if any) owns a file. Used by both the
    // extraction branch below and CodeGraphIndexer (to let these grammar-less
    // languages through its "no extraction config" skip guard).
    private enum EmbeddedFormat
    {
        None,
        MyBatis,
        Liquid,
        Dfm,
        Svelte,
        Vue,
        Astro,
        Razor,
        Cfml
    }

    // True when a file is handled by a bespoke embedded-format extractor rather than a
    // tree-sitter grammar (the indexer consults this so it doesn't skip these
    // languages, which have no ICodeGraphLanguageExtractor registered).
    public static bool HasEmbeddedExtractor(string filePath, string language) =>
        EmbeddedKind(filePath, language) != EmbeddedFormat.None;

    public static CodeGraphExtractionResult ExtractFromSource(
        string filePath,
        ReadOnlySpan<byte> utf8,
        string language,
        ICodeGraphLanguageExtractor? extractor,
        CodeGraphGrammarRegistry registry,
        IReadOnlyList<ICodeGraphFrameworkResolver>? frameworks = null)
    {
        Stopwatch sw = Stopwatch.StartNew();

        // (1) Bespoke embedded-format extractors — no grammar, parse decoded source.
        EmbeddedFormat embedded = EmbeddedKind(filePath, language);
        if (embedded != EmbeddedFormat.None)
        {
            string content = Encoding.UTF8.GetString(utf8);
            CodeGraphExtractionResult embeddedResult = embedded switch
            {
                EmbeddedFormat.MyBatis => CodeGraphMyBatisExtractor.ExtractFromSource(filePath, content),
                EmbeddedFormat.Liquid => CodeGraphLiquidExtractor.ExtractFromSource(filePath, content),
                EmbeddedFormat.Dfm => CodeGraphDfmExtractor.ExtractFromSource(filePath, content),
                // SFC extractors carve the <script>/frontmatter region and delegate it to
                // the TS/JS engine, so they need the grammar registry (not just the source).
                EmbeddedFormat.Svelte => CodeGraphSvelteExtractor.ExtractFromSource(filePath, content, registry),
                EmbeddedFormat.Vue => CodeGraphVueExtractor.ExtractFromSource(filePath, content, registry),
                EmbeddedFormat.Astro => CodeGraphAstroExtractor.ExtractFromSource(filePath, content, registry),
                // Razor/Blazor markup: regex directives + component tags, plus @code/@{ }
                // C# delegated to the C# tree-sitter engine (refs only).
                EmbeddedFormat.Razor => CodeGraphRazorExtractor.ExtractFromSource(filePath, content, registry),
                // CFML (.cfc/.cfm → cfml, .cfs → cfscript): dialect-switch between the
                // cfml/cfscript/cfquery grammars, delegating <cfscript>/<cfquery> bodies.
                EmbeddedFormat.Cfml => CodeGraphCfmlEmbeddedExtractor.ExtractFromSource(filePath, content, language, registry),
                _ => ErrorResult($"No embedded extractor for language: {language}", "grammar_unavailable", filePath, sw.Elapsed.TotalMilliseconds)
            };
            return MergeFrameworkExtraction(embeddedResult, filePath, content, null, language, frameworks);
        }

        // (2) Grammar path — a tree-sitter config is required here.
        if (extractor is null)
        {
            return ErrorResult(
                $"No extraction config for language: {language}",
                "grammar_unavailable",
                filePath,
                sw.Elapsed.TotalMilliseconds);
        }

        // Grammar lib missing / ABI-unsupported — disable just this file.
        nint? handle = registry.GetLanguage(language);
        if (handle is not { } grammar || grammar == 0)
        {
            return ErrorResult(
                $"No grammar available for language: {language}",
                "grammar_unavailable",
                filePath,
                sw.Elapsed.TotalMilliseconds);
        }

        // Materialize the UTF-8 buffer (the parse tree indexes byte offsets into it).
        byte[] bytes = utf8.ToArray();
        // Frameworks receive the ORIGINAL source (upstream passes the pre-preParse
        // string to fw.extract); decoded lazily inside the merge only when applicable.
        byte[] originalBytes = bytes;

        // Offset-preserving pre-parse transform (e.g. C# blanks mis-parsed directive
        // lines). MUST return an equal-length buffer so node positions stay valid.
        if (extractor.PreParse != null)
        {
            byte[] transformed;
            try
            {
                transformed = extractor.PreParse(bytes, filePath);
            }
            catch (Exception ex)
            {
                return ErrorResult($"preParse failed: {ex.Message}", "preparse_error", filePath, sw.Elapsed.TotalMilliseconds);
            }
            if (transformed.Length != bytes.Length)
            {
                return ErrorResult(
                    "preParse must preserve byte length (Decision 22)",
                    "preparse_length_mismatch",
                    filePath,
                    sw.Elapsed.TotalMilliseconds);
            }
            bytes = transformed;
        }

        CodeGraphSourceText source = CodeGraphSourceText.FromUtf8(bytes);

        // Per-parse timeout budget (R5, ≙ parse-pool.ts:330): a pathological file
        // makes ts_parser_parse_string return NULL — surfaced below as a timeout
        // diagnostic — instead of wedging the worker past its supervisor pings.
        ulong timeoutMicros = ComputeParseTimeoutMicros(bytes.Length);

        try
        {
            using CodeGraphTsParser parser = new();
            parser.SetLanguage(grammar);
            parser.SetTimeoutMicros(timeoutMicros);
            using CodeGraphTsTree tree = parser.Parse(source);

            CodeGraphTreeSitterExtractor engine = new(filePath, language, extractor, source);
            CodeGraphExtractionResult result = engine.Extract(tree);
            return MergeFrameworkExtraction(result, filePath, null, originalBytes, language, frameworks);
        }
        catch (CodeGraphParseException)
        {
            // Null tree: overwhelmingly the timeout guard firing (OOM / no-language
            // are ruled out by SetLanguage above). Name the budget in the diagnostic.
            return ErrorResult(
                $"Parse error: no tree within the {timeoutMicros / 1000}ms parse budget (timeout, OOM, or no language set)",
                "parse_error",
                filePath,
                sw.Elapsed.TotalMilliseconds);
        }
        catch (Exception ex)
        {
            return ErrorResult($"Parse error: {ex.Message}", "parse_error", filePath, sw.Elapsed.TotalMilliseconds);
        }
    }

    // The per-parse timeout budget, scaled for large files: base 10s + 10s per full
    // 100KB of source (parse-pool.ts:330-333 — the TS pool measures UTF-16 chars,
    // this port measures UTF-8 bytes; identical intent), converted to the
    // microseconds ts_parser_set_timeout_micros expects.
    internal static ulong ComputeParseTimeoutMicros(int sourceByteLength) =>
        (10_000UL + (ulong)(sourceByteLength / 100_000) * 10_000UL) * 1_000UL;

    // Framework-specific extraction merge (≙ tree-sitter.ts:6632-6655): after the base
    // extraction (grammar OR embedded), each DETECTED framework applicable to this
    // file's language contributes route/config nodes + references. They join the
    // file's own result so they persist with the file and are cleaned up by
    // DeleteNodesByFile on re-index. A throwing extractor degrades to a warning.
    private static CodeGraphExtractionResult MergeFrameworkExtraction(
        CodeGraphExtractionResult result,
        string filePath,
        string? content,
        byte[]? originalUtf8,
        string language,
        IReadOnlyList<ICodeGraphFrameworkResolver>? frameworks)
    {
        if (frameworks is null || frameworks.Count == 0)
        {
            return result;
        }

        foreach (ICodeGraphFrameworkResolver fw in frameworks)
        {
            if (fw.Languages is not null && !fw.Languages.Contains(language))
            {
                continue;
            }

            // Decode once, lazily — only when at least one framework applies. The
            // ORIGINAL source is used (upstream passes the pre-preParse string).
            content ??= Encoding.UTF8.GetString(originalUtf8 ?? Array.Empty<byte>());

            try
            {
                CodeGraphFrameworkExtraction? fx = fw.Extract(filePath, content);
                if (fx is null)
                {
                    continue;
                }
                result.Nodes.AddRange(fx.Nodes);
                result.UnresolvedReferences.AddRange(fx.References);
            }
            catch (Exception ex)
            {
                result.Errors.Add(new CodeGraphExtractionError(
                    $"Framework extractor '{fw.Name}' failed: {ex.Message}",
                    "warning",
                    filePath));
            }
        }

        return result;
    }

    private static CodeGraphExtractionResult ErrorResult(string message, string code, string filePath, double durationMs) =>
        new(
            new List<CodeGraphNode>(),
            new List<CodeGraphEdge>(),
            new List<CodeGraphUnresolvedReference>(),
            new List<CodeGraphExtractionError> { new(message, "error", filePath, null, null, code) },
            durationMs);

    // Route a file to its bespoke embedded-format extractor by detected language
    // (mirrors the TS extractFromSource branch). `xml` → MyBatis (non-mapper XML still
    // yields a lone file node); `liquid` → Liquid (incl. Shopify OS 2.0 JSON, which
    // detectLanguage maps to liquid); `pascal` → DFM only for `.dfm`/`.fmx` form files,
    // NOT `.pas`/`.dpr`/… source (which have no bespoke extractor and no grammar).
    private static EmbeddedFormat EmbeddedKind(string filePath, string language) => language switch
    {
        CodeGraphLanguage.Xml => EmbeddedFormat.MyBatis,
        CodeGraphLanguage.Liquid => EmbeddedFormat.Liquid,
        CodeGraphLanguage.Pascal when IsDfmFile(filePath) => EmbeddedFormat.Dfm,
        // SFC formats (Svelte/Vue/Astro): no grammar of their own — the extractor
        // regex-splits the file and delegates <script>/frontmatter to the TS/JS engine.
        CodeGraphLanguage.Svelte => EmbeddedFormat.Svelte,
        CodeGraphLanguage.Vue => EmbeddedFormat.Vue,
        CodeGraphLanguage.Astro => EmbeddedFormat.Astro,
        // Razor/Blazor (.cshtml/.razor) — bespoke markup + embedded-C# extractor.
        CodeGraphLanguage.Razor => EmbeddedFormat.Razor,
        // CFML (.cfc/.cfm → cfml, .cfs → cfscript) — the three-grammar dialect switcher
        // supersedes the plain config path: it walks the cfml markup and delegates
        // <cfscript>/<cfquery> bodies to the cfscript/cfquery grammars.
        CodeGraphLanguage.Cfml or CodeGraphLanguage.CfScript => EmbeddedFormat.Cfml,
        _ => EmbeddedFormat.None
    };

    private static bool IsDfmFile(string filePath) =>
        filePath.EndsWith(".dfm", StringComparison.OrdinalIgnoreCase) ||
        filePath.EndsWith(".fmx", StringComparison.OrdinalIgnoreCase);
}

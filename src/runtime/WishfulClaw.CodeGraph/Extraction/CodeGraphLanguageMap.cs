using System.Collections.Frozen;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphLanguageMap — file-extension → language detection (port of
// extraction/grammars.ts: EXTENSION_MAP, detectLanguage, isSourceFile, and the
// special-filename cases isPlayRoutesFile / isShopifyLiquidJson / isErlangAppFile).
//
// EXTENSION_MAP is the single source of truth for "should we index this file":
// IsSourceFile is derived from it so parser support and indexing selection never
// drift. Values are the CodeGraphLanguage.* vocabulary constants, verbatim from the
// TS map. Lookups lowercase the extension first (TS `.toLowerCase()`), so the
// FrozenDictionary keys are lowercase and compared Ordinal.
//
// `.h` is ambiguous (C / C++ / Objective-C): it defaults to C, but a content
// heuristic upgrades it to cpp/objc when the head of the file carries a construct
// unique to that dialect. The heuristic samples the first 8192 chars only.
// =============================================================================
internal static partial class CodeGraphLanguageMap
{
    // ext (lowercase, leading dot) -> CodeGraphLanguage.* (grammars.ts EXTENSION_MAP).
    public static readonly FrozenDictionary<string, string> ExtensionMap =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [".ts"] = CodeGraphLanguage.TypeScript,
            [".tsx"] = CodeGraphLanguage.Tsx,
            // ESM/CJS TypeScript module extensions — parsed as TS (no JSX).
            [".mts"] = CodeGraphLanguage.TypeScript,
            [".cts"] = CodeGraphLanguage.TypeScript,
            // ArkTS (HarmonyOS) — a TypeScript superset with its own grammar fork.
            [".ets"] = CodeGraphLanguage.ArkTs,
            [".js"] = CodeGraphLanguage.JavaScript,
            [".mjs"] = CodeGraphLanguage.JavaScript,
            [".cjs"] = CodeGraphLanguage.JavaScript,
            // SAP HANA XS Classic server-side JavaScript.
            [".xsjs"] = CodeGraphLanguage.JavaScript,
            [".xsjslib"] = CodeGraphLanguage.JavaScript,
            [".jsx"] = CodeGraphLanguage.Jsx,
            [".py"] = CodeGraphLanguage.Python,
            [".pyw"] = CodeGraphLanguage.Python,
            [".go"] = CodeGraphLanguage.Go,
            [".rs"] = CodeGraphLanguage.Rust,
            [".java"] = CodeGraphLanguage.Java,
            [".c"] = CodeGraphLanguage.C,
            [".h"] = CodeGraphLanguage.C, // could also be C++/Obj-C — see DetectLanguage
            [".cpp"] = CodeGraphLanguage.Cpp,
            [".cc"] = CodeGraphLanguage.Cpp,
            [".cxx"] = CodeGraphLanguage.Cpp,
            [".hpp"] = CodeGraphLanguage.Cpp,
            [".hxx"] = CodeGraphLanguage.Cpp,
            [".cs"] = CodeGraphLanguage.CSharp,
            // ASP.NET Razor / Blazor markup.
            [".cshtml"] = CodeGraphLanguage.Razor,
            [".razor"] = CodeGraphLanguage.Razor,
            [".php"] = CodeGraphLanguage.Php,
            // Drupal-specific PHP file extensions.
            [".module"] = CodeGraphLanguage.Php,
            [".install"] = CodeGraphLanguage.Php,
            [".theme"] = CodeGraphLanguage.Php,
            [".inc"] = CodeGraphLanguage.Php,
            // YAML (Drupal routing; no symbol extraction, file-level tracking only).
            [".yml"] = CodeGraphLanguage.Yaml,
            [".yaml"] = CodeGraphLanguage.Yaml,
            // Twig templates (file-level tracking only).
            [".twig"] = CodeGraphLanguage.Twig,
            [".rb"] = CodeGraphLanguage.Ruby,
            [".rake"] = CodeGraphLanguage.Ruby,
            [".swift"] = CodeGraphLanguage.Swift,
            [".kt"] = CodeGraphLanguage.Kotlin,
            [".kts"] = CodeGraphLanguage.Kotlin,
            [".dart"] = CodeGraphLanguage.Dart,
            [".liquid"] = CodeGraphLanguage.Liquid,
            [".svelte"] = CodeGraphLanguage.Svelte,
            [".vue"] = CodeGraphLanguage.Vue,
            [".astro"] = CodeGraphLanguage.Astro,
            [".r"] = CodeGraphLanguage.R,
            [".pas"] = CodeGraphLanguage.Pascal,
            [".dpr"] = CodeGraphLanguage.Pascal,
            [".dpk"] = CodeGraphLanguage.Pascal,
            [".lpr"] = CodeGraphLanguage.Pascal,
            [".dfm"] = CodeGraphLanguage.Pascal,
            [".fmx"] = CodeGraphLanguage.Pascal,
            [".scala"] = CodeGraphLanguage.Scala,
            [".sc"] = CodeGraphLanguage.Scala,
            [".lua"] = CodeGraphLanguage.Lua,
            [".luau"] = CodeGraphLanguage.Luau,
            [".m"] = CodeGraphLanguage.ObjC,
            [".mm"] = CodeGraphLanguage.ObjC,
            [".sol"] = CodeGraphLanguage.Solidity,
            // CFML: .cfc/.cfm parse with the tag-aware grammar; .cfs is pure CFScript.
            [".cfc"] = CodeGraphLanguage.Cfml,
            [".cfm"] = CodeGraphLanguage.Cfml,
            [".cfs"] = CodeGraphLanguage.CfScript,
            // Metal Shading Language / CUDA ≈ C++: parsed by the C++ grammar.
            [".metal"] = CodeGraphLanguage.Cpp,
            [".cu"] = CodeGraphLanguage.Cpp,
            [".cuh"] = CodeGraphLanguage.Cpp,
            [".nix"] = CodeGraphLanguage.Nix,
            // XML: file-level tracking; MyBatis mapper extractor emits SQL nodes.
            [".xml"] = CodeGraphLanguage.Xml,
            // COBOL: programs (.cbl/.cob) and copybooks (.cpy).
            [".cbl"] = CodeGraphLanguage.Cobol,
            [".cob"] = CodeGraphLanguage.Cobol,
            [".cobol"] = CodeGraphLanguage.Cobol,
            [".cpy"] = CodeGraphLanguage.Cobol,
            // VB.NET.
            [".vb"] = CodeGraphLanguage.VbNet,
            // Erlang: modules (.erl), headers (.hrl), escripts (native shebang node).
            [".erl"] = CodeGraphLanguage.Erlang,
            [".hrl"] = CodeGraphLanguage.Erlang,
            [".escript"] = CodeGraphLanguage.Erlang,
            // Spring config: application.properties / application-*.properties.
            [".properties"] = CodeGraphLanguage.Properties,
            // Terraform / OpenTofu / HCL config.
            [".tf"] = CodeGraphLanguage.Terraform,
            [".tfvars"] = CodeGraphLanguage.Terraform,
            [".tofu"] = CodeGraphLanguage.Terraform,
            // Shell scripts (bash grammar covers sh/bash/zsh-ish syntax).
            [".sh"] = CodeGraphLanguage.Bash,
            [".bash"] = CodeGraphLanguage.Bash,
            // Haskell modules.
            [".hs"] = CodeGraphLanguage.Haskell,
            // Julia.
            [".jl"] = CodeGraphLanguage.Julia
        }.ToFrozenDictionary(StringComparer.Ordinal);

    // Detect language from file extension (grammars.ts detectLanguage). `source`
    // (the decoded file head) is consulted ONLY for the `.h` C/C++/Obj-C heuristic;
    // every other extension is decided purely by suffix, so callers pass null.
    public static string DetectLanguage(string filePath, string? source = null)
    {
        // Play `conf/routes` has no grammar — route through the no-symbol (yaml) path.
        if (IsPlayRoutesFile(filePath))
        {
            return CodeGraphLanguage.Yaml;
        }

        string ext = ExtensionOf(filePath);

        // Shopify OS 2.0 JSON templates / section groups → the Liquid extractor.
        if (IsShopifyLiquidJson(filePath))
        {
            return CodeGraphLanguage.Liquid;
        }

        // OTP `.app`/`.app.src` resource files (last-dot ext `.src` is too generic).
        if (IsErlangAppFile(filePath))
        {
            return CodeGraphLanguage.Erlang;
        }

        string lang = ExtensionMap.TryGetValue(ext, out string? mapped)
            ? mapped
            : CodeGraphLanguage.Unknown;

        // .h files could be C, C++, or Objective-C — disambiguate by source content.
        if (lang == CodeGraphLanguage.C && ext == ".h" && source is not null)
        {
            if (LooksLikeCpp(source))
            {
                return CodeGraphLanguage.Cpp;
            }

            if (LooksLikeObjc(source))
            {
                return CodeGraphLanguage.ObjC;
            }
        }

        return lang;
    }

    // Whether a file is one CodeGraph can index, based purely on its path
    // (grammars.ts isSourceFile). Derived from EXTENSION_MAP + the special-filename
    // cases so parser support and indexing selection never drift.
    public static bool IsSourceFile(string filePath)
    {
        if (IsPlayRoutesFile(filePath))
        {
            return true; // Play `conf/routes` is extensionless
        }

        if (IsShopifyLiquidJson(filePath))
        {
            return true; // Shopify OS 2.0 JSON templates / section groups
        }

        if (IsErlangAppFile(filePath))
        {
            return true; // OTP `.app`/`.app.src` resource files
        }

        int dot = filePath.LastIndexOf('.');
        if (dot < 0)
        {
            return false;
        }

        return ExtensionMap.ContainsKey(filePath[dot..].ToLowerInvariant());
    }

    // Play Framework routes file: the extensionless `conf/routes` (and included
    // `conf/*.routes`). Route extraction is done by the Play resolver — no grammar.
    public static bool IsPlayRoutesFile(string filePath) =>
        filePath == "conf/routes" ||
        filePath.EndsWith("/conf/routes", StringComparison.Ordinal) ||
        filePath.EndsWith(".routes", StringComparison.Ordinal);

    // Shopify OS 2.0 JSON template (`templates/*.json`) or section group
    // (`sections/*.json`), including nested dirs. Linked by the Liquid extractor.
    public static bool IsShopifyLiquidJson(string filePath) =>
        ShopifyLiquidJsonRegex().IsMatch(filePath);

    // OTP application resource file: `<app>.app.src` or its compiled `<app>.app`.
    public static bool IsErlangAppFile(string filePath) =>
        ErlangAppRegex().IsMatch(filePath);

    // Lowercased extension incl. the leading dot ('' when the path has no dot).
    private static string ExtensionOf(string filePath)
    {
        int dot = filePath.LastIndexOf('.');
        return dot >= 0 ? filePath[dot..].ToLowerInvariant() : string.Empty;
    }

    // Heuristic: does a .h file contain C++ constructs? Samples the first 8192 chars
    // for patterns that are unique to C++ and never valid C (grammars.ts looksLikeCpp).
    private static bool LooksLikeCpp(string source) =>
        CppHeaderRegex().IsMatch(Sample(source));

    // Heuristic: does a .h file contain Objective-C constructs? (grammars.ts looksLikeObjc)
    private static bool LooksLikeObjc(string source) =>
        ObjcHeaderRegex().IsMatch(Sample(source));

    private static string Sample(string source) =>
        source.Length > 8192 ? source[..8192] : source;

    [GeneratedRegex(@"(^|/)(templates|sections)/.+\.json$", RegexOptions.IgnoreCase)]
    private static partial Regex ShopifyLiquidJsonRegex();

    [GeneratedRegex(@"\.app(?:\.src)?$", RegexOptions.IgnoreCase)]
    private static partial Regex ErlangAppRegex();

    // Case-sensitive by design (the ALL-CAPS export-macro branch relies on [A-Z]).
    [GeneratedRegex(@"\bnamespace\b|\bclass\s+\w+\s*[:{]|\b(?:class|struct)\s+[A-Z][A-Z0-9_]+\s+\w+\s*(?:final\s*)?[:{]|\btemplate\s*<|\b(?:public|private|protected)\s*:|\bvirtual\b|\busing\s+(?:namespace\b|\w+\s*=)")]
    private static partial Regex CppHeaderRegex();

    [GeneratedRegex(@"@(?:interface|implementation|protocol|synthesize)\b")]
    private static partial Regex ObjcHeaderRegex();
}

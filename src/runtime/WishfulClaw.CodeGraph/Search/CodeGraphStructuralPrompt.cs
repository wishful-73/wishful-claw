using System.Text.RegularExpressions;

// CodeGraphStructuralPrompt — the front-load hook's cheap, graph-free prompt-analysis
// helpers (≙ directory.ts). Decides whether a prompt is a structural / flow / impact /
// "where-how" question worth front-loading code context for, and — for a prompt issued
// from a directory — which indexed project to explore (the monorepo scanner).
//
//   hasStructuralKeyword — an explicit keyword in ~29 languages across Latin, Cyrillic,
//     Greek, CJK, Hangul, Arabic, Hebrew, Thai, and Devanagari scripts (#994, #1126).
//     A keyword is a self-contained signal: the hook fires on it directly.
//   extractCodeTokens — identifier-shaped tokens (camelCase, snake_case, name(, a.b).
//     CANDIDATES only: the hook verifies each against the actual index before firing
//     (a brand like `JavaScript` is token-shaped but isn't a symbol here).
//   isStructuralPrompt — keyword OR token: the zero-cost gate every prompt passes first.
//   planFrontload — where the .codegraph index(es) are relative to the cwd: an indexed
//     ancestor, or (the monorepo case #964) indexed sub-projects scanned downward.
//
// The three multilingual keyword tables are ported VERBATIM from directory.ts (STRUCTURAL_
// WORDS / STRUCTURAL_STEMS / STRUCTURAL_UNSEGMENTED). They are joined into regexes at
// static init rather than [GeneratedRegex] literals because the TS source itself builds
// them by joining arrays — keeping the array shape makes the 1:1 correspondence auditable.
// new Regex(...) is reflection-free / AOT-safe (interpreted engine). The Unicode
// word-boundary emulation (NOT_WORD_BEFORE/AFTER lookarounds) replaces JS's ASCII-only
// \b, which can never bound an accented or non-Latin keyword.
internal static partial class CodeGraphStructuralPrompt
{
    // "not flanked by a letter, digit, or underscore" — the script-independent
    // equivalent of \b (directory.ts:245-246).
    private const string NotWordBefore = @"(?<![\p{L}\p{N}_])";
    private const string NotWordAfter = @"(?![\p{L}\p{N}_])";

    // Structural keywords matched as EXACT words (boundary on both sides): short or
    // ambiguous tokens where prefix matching would false-positive ("flow" in "flower").
    // Grouped by language; a term appears once even when languages share it.
    // (directory.ts:255 STRUCTURAL_WORDS — ported verbatim.)
    private static readonly string[] StructuralWords =
    {
        // English
        "how", "where", "tracing", "flows?", "paths?", "reach(?:es|ed)?", "wired?", "breaks?", "why does",
        // French
        "comment", "où", "flux", "chemins?", "casse",
        // Spanish
        "cómo", "dónde", "donde", "flujos?", "rutas?", "caminos?", "rompe", "llaman", "quién llama", "quien llama",
        // Portuguese
        "como", "onde", "fluxos?", "caminhos?",
        // German
        "wie", "wo", "woher", "wohin", "pfade?", "fluss", "ablauf", "bricht", "kaputt", "ruft", "hängt",
        // Italian
        "dove", "flusso", "percors[oi]",
        // Russian
        "как", "где", "путь", "пути", "работает",
        // Ukrainian
        "як", "де", "потік", "працює",
        // Dutch
        "hoe", "waar", "roept", "werkt", "aangeroepen",
        // Polish + Czech
        "jak", "gdzie", "kde", "cesta",
        // Romanian
        "cum", "unde",
        // Hungarian
        "hogyan", "hol",
        // Turkish
        "nasıl", "mimari", "takip",
        // Indonesian/Malay
        "bagaimana", "di mana", "dimana", "alur", "jalur",
        // Vietnamese
        "làm sao", "thế nào", "ở đâu", "gọi", "phụ thuộc", "ảnh hưởng", "kiến trúc",
        "cấu trúc", "luồng", "đường dẫn", "hoạt động", "giải thích", "theo dõi",
        // Swedish / Danish / Norwegian
        "hur", "hvordan", "hvor", "beror", "flöde",
        // Finnish
        "miten", "missä", "toimii",
        // Greek
        "πώς", "πού", "καλεί", "δομή", "ροή",
        // Hindi
        "कैसे", "कहाँ", "कहां", "कॉल", "निर्भर", "संरचना", "प्रवाह",
    };

    // Structural keyword STEMS matched as word PREFIXES (boundary on the left only), so
    // derived forms match without enumerating each. The four bounded English entries
    // (call/trace/affect/connect) enumerate their structural suffixes + re-assert the
    // right boundary because they have ordinary-English completions (#1138).
    // (directory.ts:323 STRUCTURAL_STEMS — ported verbatim.)
    private static readonly string[] StructuralStems =
    {
        // English + Latin-script languages sharing the spelling
        "architect", "structur", "depend", "implement", "impact", "explain",
        "call(?:s|ing|ed|ers?|backs?|able|sites?)?" + NotWordAfter,
        "trace(?:s|d|rs?)?" + NotWordAfter,
        "affect(?:s|ed|ing)?" + NotWordAfter,
        "connect(?:s|ed|ing|ions?|ors?|ivity)?" + NotWordAfter,
        // French
        "appel", "dépend", "implément", "connex", "expliqu", "fonctionn",
        // Spanish
        "llamad", "afect", "conect", "conexi", "arquitec", "estructur", "funcion", "traza", "explica",
        // Portuguese
        "chama", "afeta", "arquitet", "estrutur", "quebra",
        // German
        "abhäng", "auswirkung", "beeinfluss", "verbind", "architekt", "struktur", "funktionier", "aufruf", "aufgerufen", "erklär", "verfolg",
        // Italian
        "chiam", "dipend", "impatt", "connett", "conness", "architett", "struttur", "funzion", "tracci", "spiega",
        // Russian
        "вызыва", "завис", "влия", "реализ", "структур", "архитектур", "трассир", "лома", "объясн", "поток",
        // Ukrainian
        "виклика", "залеж", "вплива", "архітектур", "реаліз", "поясн", "шлях",
        // Dutch
        "aanroep", "afhankelijk", "beïnvloed", "structuur", "uitleg",
        // Polish
        "wywoł", "zależ", "wpływ", "przepływ", "ścieżk", "działa", "wyjaśni", "śledz",
        // Czech
        "volá", "závis", "ovlivň", "funguj", "vysvětl",
        // Romanian
        "apel", "depind", "arhitectur", "funcțion", "explică",
        // Hungarian
        "hív", "függ", "működ", "struktúr", "magyaráz",
        // Turkish
        "nere", "çağır", "çağrı", "bağıml", "bağlant", "akış", "etkile", "etkisi",
        // Indonesian/Malay
        "panggil", "memanggil", "dipanggil", "bergantung", "tergantung", "pengaruh",
        "mempengaruhi", "memengaruhi", "arsitektur", "fungsi", "berfungsi", "jelaskan", "menjelaskan",
        // Swedish / Danish / Norwegian
        "anrop", "påverk", "påvirk", "afhæng", "avheng", "förklar", "forklar", "arkitektur", "funger",
        // Finnish
        "kutsu", "riippu", "arkkitehtuur", "rakente", "selit",
        // Greek
        "εξαρτ", "επηρε", "αρχιτεκτονικ", "διαδρομ", "εξηγ", "εξήγ",
        // Hindi
        "समझा", "आर्किटेक्चर",
    };

    private static readonly Regex StructuralWordsRegex = new(
        NotWordBefore + "(?:" + string.Join("|", StructuralWords) + ")" + NotWordAfter,
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex StructuralStemsRegex = new(
        NotWordBefore + "(?:" + string.Join("|", StructuralStems) + ")",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    // Structural keywords matched as bare SUBSTRINGS, for scripts with no word
    // separators (Chinese simplified+traditional, Japanese, Thai), Korean, and
    // Arabic/Farsi/Hebrew (proclitics attach to the word). \b can never fire between
    // Han characters — the #994 mechanism. (directory.ts:442 STRUCTURAL_UNSEGMENTED —
    // ported verbatim.)
    private static readonly Regex StructuralUnsegmentedRegex = new(
        "如何|怎么|怎麼|在哪|哪里|哪裡|追踪|跟踪|追蹤|追跡|トレース|流程|流向|流れ|路径|路徑|経路|调用|調用|呼び出|依赖|依賴|依存|影响|影響|实现|實現|実装|架构|架構|アーキテクチャ|结构|結構|構造|介绍|介紹|解析|分析|原理|机制|機制|仕組み|説明|動作|どうやって|どのように|어떻게|어디|호출|흐름|경로|의존|영향|구현|구조|아키텍처|추적|동작|작동|설명|كيف|أين|اين|يستدعي|استدعاء|يعتمد|تعتمد|يؤثر|تأثير|معماري|بنية|هيكل|تدفق|مسار|تتبع|يعمل|تعمل|اشرح|شرح|چگونه|چطور|کجا|فراخوان|وابسته|تأثیر|معماری|ساختار|مسیر|توضیح|איך|איפה|קורא|תלוי|משפיע|ארכיטקטור|מבנה|זרימה|נתיב|הסבר|อย่างไร|ยังไง|ที่ไหน|เรียกใช้|ขึ้นอยู่กับ|ผลกระทบ|สถาปัตยกรรม|โครงสร้าง|เส้นทาง|ติดตาม|ทำงาน|อธิบาย");

    // Does `prompt` contain an explicit structural keyword? A keyword is a strong,
    // self-contained signal, so the hook fires on it directly — no graph check.
    // (directory.ts:458 hasStructuralKeyword)
    internal static bool HasStructuralKeyword(string? prompt) =>
        !string.IsNullOrEmpty(prompt) &&
        (StructuralWordsRegex.IsMatch(prompt) ||
         StructuralStemsRegex.IsMatch(prompt) ||
         StructuralUnsegmentedRegex.IsMatch(prompt));

    // Doc/data/asset extensions — a `name.ext` of this kind is a file reference, not a
    // code symbol, so it must not trip the member-access signal. (directory.ts:446)
    [GeneratedRegex(@"\.(md|markdown|txt|rst|json|ya?ml|toml|lock|csv|tsv|log|ini|cfg|conf|env|xml|html?|png|jpe?g|gif|svg|pdf)$", RegexOptions.IgnoreCase)]
    private static partial Regex DocDataExtRegex();

    // Whole identifier runs (ASCII, ECMAScript \w semantics — no Unicode letters, to
    // match the TS /[A-Za-z_$][\w$]*/ under no-u-flag).
    [GeneratedRegex(@"[A-Za-z_$][A-Za-z0-9_$]*")]
    private static partial Regex IdentifierRunRegex();

    // An identifier directly before '(' — a call form. (directory.ts:491)
    [GeneratedRegex(@"([A-Za-z_$][A-Za-z0-9_$]*)\(")]
    private static partial Regex CallFormRegex();

    // Member access on identifiers (user.login). (directory.ts:493)
    [GeneratedRegex(@"([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)")]
    private static partial Regex MemberAccessRegex();

    // An inner lower->Upper transition (camelCase hump). (directory.ts:487)
    [GeneratedRegex(@"[a-z][A-Z]")]
    private static partial Regex InnerCapRegex();

    // An underscore flanked by alphanumerics (snake_case). (directory.ts:487)
    [GeneratedRegex(@"[A-Za-z0-9]_[A-Za-z0-9]")]
    private static partial Regex SnakeUnderscoreRegex();

    // Identifier-shaped tokens in `prompt` — camelCase/PascalCase-with-inner-cap,
    // snake_case, a name( call, or the two sides of an a.b member access. CANDIDATES,
    // not a verdict: the hook checks each against the index before firing. A doc/data
    // filename is excluded from the member-access form. Order-preserving, deduped.
    // (directory.ts:479 extractCodeTokens)
    internal static List<string> ExtractCodeTokens(string? prompt)
    {
        var output = new List<string>();
        if (string.IsNullOrEmpty(prompt))
        {
            return output;
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        void Add(string token)
        {
            if (seen.Add(token))
            {
                output.Add(token);
            }
        }

        foreach (Match m in IdentifierRunRegex().Matches(prompt))
        {
            var w = m.Value;
            if (InnerCapRegex().IsMatch(w) || SnakeUnderscoreRegex().IsMatch(w))
            {
                Add(w);
            }
        }

        foreach (Match m in CallFormRegex().Matches(prompt))
        {
            Add(m.Groups[1].Value);
        }

        foreach (Match m in MemberAccessRegex().Matches(prompt))
        {
            if (!DocDataExtRegex().IsMatch(m.Value))
            {
                Add(m.Groups[1].Value);
                Add(m.Groups[2].Value);
            }
        }

        return output;
    }

    // Cheap, graph-free candidate gate: could `prompt` be a structural / flow / impact /
    // "where-how" question worth front-loading for? Keyword OR identifier-shaped token.
    // (directory.ts:508 isStructuralPrompt)
    internal static bool IsStructuralPrompt(string? prompt) =>
        HasStructuralKeyword(prompt) || ExtractCodeTokens(prompt).Count > 0;

    // ===========================================================================
    // Monorepo front-load planning (directory.ts:179-583)
    // ===========================================================================

    // Heavy/irrelevant directory names the sub-project scan never descends into.
    // (directory.ts:180)
    private static readonly HashSet<string> SubprojectScanSkip = new(StringComparer.Ordinal)
    {
        "node_modules", ".git", ".svn", ".hg", "dist", "build", "out", "target",
        "vendor", "bin", "obj", ".next", ".nuxt", ".svelte-kit", ".cache", "coverage",
        ".venv", "venv", "__pycache__", ".turbo", ".idea", ".vscode", "tmp", "temp",
    };

    // Manifests that mark a directory as a project/workspace root — the down-scan is
    // gated on one so a non-project cwd is a cheap no-op. (directory.ts:189)
    private static readonly string[] WorkspaceRootManifests =
    {
        "package.json", "pnpm-workspace.yaml", "lerna.json", "nx.json", "turbo.json",
        "go.work", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts",
        "settings.gradle", "pyproject.toml", "composer.json", "Gemfile", "rush.json",
        "WORKSPACE", "WORKSPACE.bazel",
    };

    private static bool LooksLikeProjectRoot(string dir) =>
        WorkspaceRootManifests.Any(m => File.Exists(Path.Combine(dir, m)));

    // Indexed sub-project roots beneath `root` (bounded breadth-first scan). Descent
    // stops at the first indexed directory on a branch and is bounded by depth + count.
    // (directory.ts:212 findIndexedSubprojectRoots)
    internal static List<string> FindIndexedSubprojectRoots(string root, int maxDepth = 4, int max = 64)
    {
        var output = new List<string>();
        Walk(root, 1);
        return output;

        void Walk(string dir, int depth)
        {
            if (output.Count >= max || depth > maxDepth)
            {
                return;
            }

            IEnumerable<string> entries;
            try
            {
                entries = Directory.EnumerateDirectories(dir);
            }
            catch
            {
                return;
            }

            foreach (var child in entries)
            {
                if (output.Count >= max)
                {
                    return;
                }

                var name = Path.GetFileName(child);
                if (name.StartsWith('.') || SubprojectScanSkip.Contains(name))
                {
                    continue;
                }

                if (CodeGraphEngine.IsInitialized(child))
                {
                    output.Add(child); // don't descend into an indexed project
                    continue;
                }

                Walk(child, depth + 1);
            }
        }
    }

    // Decide what the front-load hook injects for a `prompt` issued from `cwd`, shaped
    // by where the index(es) actually are: (1) an indexed ancestor of cwd → that
    // project; (2) cwd looks like a workspace root → indexed sub-projects (the monorepo
    // case #964), picking the one the prompt names when several exist; (3) nothing
    // reachable → do nothing. (directory.ts:543 planFrontload)
    internal static CodeGraphFrontloadPlan PlanFrontload(string cwd, string prompt)
    {
        var none = new CodeGraphFrontloadPlan(null, Array.Empty<string>(), false);

        // 1. up-walk — nearest indexed ancestor (incl. cwd).
        var dir = Path.GetFullPath(cwd);
        for (var i = 0; i < 6; i++)
        {
            if (CodeGraphEngine.IsInitialized(dir))
            {
                return new CodeGraphFrontloadPlan(dir, Array.Empty<string>(), false);
            }

            var parent = Path.GetDirectoryName(dir);
            if (string.IsNullOrEmpty(parent) || parent == dir)
            {
                break;
            }

            dir = parent;
        }

        // 2. down-scan — only from something that looks like a workspace root.
        var basePath = Path.GetFullPath(cwd);
        if (!LooksLikeProjectRoot(basePath))
        {
            return none;
        }

        var subs = FindIndexedSubprojectRoots(basePath);
        if (subs.Count == 0)
        {
            return none;
        }

        if (subs.Count == 1)
        {
            return new CodeGraphFrontloadPlan(subs[0], Array.Empty<string>(), true);
        }

        // Several indexed sub-projects — pick the one the prompt points at, if any.
        var p = prompt.ToLowerInvariant();
        (string Root, int Score, int RelLen)? best = null;
        foreach (var s in subs)
        {
            var rel = Path.GetRelativePath(basePath, s);
            var relLc = rel.Replace(Path.DirectorySeparatorChar, '/').ToLowerInvariant();
            var name = Path.GetFileName(s).ToLowerInvariant();
            var score = 0;
            if (relLc.Length > 0 && p.Contains(relLc, StringComparison.Ordinal))
            {
                score = 10; // "packages/api"
            }
            else if (name.Length >= 3 &&
                     Regex.IsMatch(p, @"\b" + Regex.Escape(name) + @"\b"))
            {
                score = 5; // "api"
            }

            if (score > 0 &&
                (best is null || score > best.Value.Score ||
                 (score == best.Value.Score && rel.Length < best.Value.RelLen)))
            {
                best = (s, score, rel.Length);
            }
        }

        if (best is not null)
        {
            var chosen = best.Value.Root;
            return new CodeGraphFrontloadPlan(
                chosen,
                subs.Where(s => s != chosen).ToList(),
                true);
        }

        // No clear match — nudge the full list rather than front-load a guess.
        return new CodeGraphFrontloadPlan(null, subs, true);
    }
}

// What the front-load hook should do for a prompt issued from a directory.
// ExploreRoot: open + explore this project (null when there's no single project to
// front-load). NudgeProjects: indexed sub-projects to surface in a "pass projectPath"
// nudge. ViaSubScan: the plan came from scanning DOWN into sub-projects (the monorepo
// case, where a follow-up explore needs an explicit projectPath). (directory.ts:515)
internal sealed record CodeGraphFrontloadPlan(
    string? ExploreRoot,
    IReadOnlyList<string> NudgeProjects,
    bool ViaSubScan);

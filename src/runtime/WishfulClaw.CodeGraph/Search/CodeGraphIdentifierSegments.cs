using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

// CodeGraphIdentifierSegments — the identifier-segment subsystem (≙ CodeGraph
// src/search/identifier-segments.ts). Two halves of one keyless mechanism (no
// vocabulary list), cross-lingual on Latin script:
//
//   INDEX SIDE  — SplitIdentifierSegments: a symbol/file name -> the lowercase
//                 words a human would use for it in prose ("OrderStateMachine"
//                 -> order/state/machine). Materialized into name_segment_vocab at
//                 node-write time (CodeGraphStore.InsertNameSegments) because FTS5's
//                 tokenizer keeps camelCase as one token and cannot serve it.
//   QUERY SIDE  — ExtractProseCandidates + NormalizeProseWord + SegmentLookupVariants:
//                 a prompt -> candidate words -> plural-folded lookup keys for the
//                 name_segment_vocab gate (CodeGraph.getSegmentMatches). "state
//                 machine des commandes" -> OrderStateMachine, in any human language
//                 whose technical nouns are Latin script — no keyword list involved.
//
// Reflection-free / AOT: source-generated [GeneratedRegex]; Unicode mark tests via
// CharUnicodeInfo (no reflection). The field-qualified query parser
// (kind:/lang:/path:/name:) and boundedEditDistance already live in
// CodeGraphSearchScoring (CodeGraphStore.Search.cs) — not duplicated here.
internal static partial class CodeGraphIdentifierSegments
{
    // Split bounds (identifier-segments.ts:18-20). Segments outside them (minified
    // names, hashes) carry no prose signal.
    private const int MinSegmentChars = 2;
    private const int MaxSegmentChars = 32;
    private const int MaxSegmentsPerName = 12;

    // Prose-candidate bounds (identifier-segments.ts:62-64). MinProseChars doubles as
    // the plural-fold floor in SegmentLookupVariants.
    private const int MaxProseCandidates = 16;
    private const int MinProseChars = 4; // "the"/"des"/"fix" out; "auth"/"flow"/"path" in
    private const int MaxProseChars = 24; // an unsegmented-script sentence is one giant run — skip it

    /// <summary>
    /// Split a symbol or file name into lowercase word segments — the words a human
    /// would use for it in prose. Handles camelCase / PascalCase (inner lower→Upper),
    /// acronym runs ("HTMLParser" → html/parser), snake_case / kebab-case / dotted
    /// names (non-alphanumerics separate), and keeps digits glued to their word
    /// ("base64Encode" → base64/encode). Digit-only fragments and out-of-bound lengths
    /// are dropped; deduped in insertion order; capped at MaxSegmentsPerName.
    /// (identifier-segments.ts:30 splitIdentifierSegments)
    /// </summary>
    internal static List<string> SplitIdentifierSegments(string name)
    {
        var result = new List<string>();
        if (string.IsNullOrEmpty(name))
        {
            return result;
        }

        var seen = new HashSet<string>();
        foreach (Match run in AlphanumericRunRegex().Matches(name))
        {
            foreach (var part in SegmentBoundaryRegex().Split(run.Value))
            {
                if (seen.Count >= MaxSegmentsPerName)
                {
                    return result;
                }

                var segment = part.ToLowerInvariant();
                if (segment.Length < MinSegmentChars || segment.Length > MaxSegmentChars)
                {
                    continue;
                }

                if (DigitsOnlyRegex().IsMatch(segment))
                {
                    continue;
                }

                if (seen.Add(segment))
                {
                    result.Add(segment);
                }
            }
        }

        return result;
    }

    /// <summary>
    /// Normalize a prose word for segment lookup: decompose (NFD), drop combining
    /// marks, then lowercase — so "références" matches the segment "references" and
    /// "résolution" matches "resolution". Identifier segments are overwhelmingly
    /// ASCII, so this is what buys Latin-script languages their cross-lingual reach on
    /// loanwords. (identifier-segments.ts:56 normalizeProseWord)
    /// </summary>
    internal static string NormalizeProseWord(string word)
    {
        var decomposed = word.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(decomposed.Length);
        foreach (var ch in decomposed)
        {
            // \p{M} = {Mn, Mc, Me}. The combining acute/grave/etc. produced by NFD.
            var category = CharUnicodeInfo.GetUnicodeCategory(ch);
            if (category is UnicodeCategory.NonSpacingMark
                or UnicodeCategory.SpacingCombiningMark
                or UnicodeCategory.EnclosingMark)
            {
                continue;
            }

            sb.Append(ch);
        }

        return sb.ToString().ToLowerInvariant();
    }

    /// <summary>
    /// Candidate words from a prompt for segment-vocabulary lookup, in order of
    /// appearance: Unicode letter/digit runs, normalized via NormalizeProseWord,
    /// length-bounded, digit-only dropped, EnglishProseStopwords dropped, deduped
    /// (insertion order), capped at MaxProseCandidates. Everything that survives is
    /// judged per-repo by the rarity / co-occurrence rules in getSegmentMatches —
    /// there is no domain-word list. (identifier-segments.ts:114 extractProseCandidates)
    /// </summary>
    internal static List<string> ExtractProseCandidates(string prompt)
    {
        var result = new List<string>();
        if (string.IsNullOrEmpty(prompt))
        {
            return result;
        }

        var seen = new HashSet<string>();
        foreach (Match run in AlphanumericRunRegex().Matches(prompt))
        {
            if (seen.Count >= MaxProseCandidates)
            {
                break;
            }

            // CJK↔Latin boundaries split first: unsegmented prose glues onto embedded
            // identifiers ("修复OrderStateMachine的bug" is ONE [\p{L}\p{N}]+ run),
            // which used to drop the identifier together with the over-long run.
            foreach (var piece in SplitByScriptBoundary(run.Value))
            {
                if (seen.Count >= MaxProseCandidates)
                {
                    break;
                }

                // The segment vocabulary is ASCII-identifier-derived; a CJK piece can
                // never match it.
                if (ContainsCjk(piece))
                {
                    continue;
                }

                // Gate on the RAW piece length first — an unsegmented-script sentence
                // is one giant run and normalizing it buys nothing (matches TS: length
                // check before normalize).
                if (piece.Length > MaxProseChars)
                {
                    continue;
                }

                var w = NormalizeProseWord(piece);
                if (w.Length < MinProseChars || w.Length > MaxProseChars)
                {
                    continue;
                }

                if (DigitsOnlyRegex().IsMatch(w))
                {
                    continue;
                }

                if (EnglishProseStopwords.Contains(w))
                {
                    continue;
                }

                if (seen.Add(w))
                {
                    result.Add(w);
                }
            }
        }

        return result;
    }

    /// <summary>
    /// Lookup variants for a prose word: the word itself plus light plural folding (a
    /// trailing s/es strip only), so common plurals still hit their singular segment.
    /// The strips are keyed on English plural spelling (identifier-segments.ts:147), in
    /// three classes:
    ///  - UNAMBIGUOUS -es (after x/sh/ss/zz: boxes, hashes, classes, quizzes) — strip 2
    ///    only. Stripping 1 minted a bogus sibling ("classes" → classe).
    ///  - AMBIGUOUS -es (ch/s/z/o: patches vs caches, lenses vs databases, heroes vs
    ///    shoes) — emit BOTH candidate keys and let the vocab lookup decide.
    ///  - Everything else ending in bare -s (services, machines, cookies) — strip 1
    ///    only. A trailing -ss is a singular (class, process): no strip.
    /// </summary>
    internal static List<string> SegmentLookupVariants(string word)
    {
        var variants = new List<string> { word };
        var canStrip2 = word.Length >= MinProseChars + 2;
        var canStrip1 = word.Length >= MinProseChars + 1;

        if (word.EndsWith("xes", StringComparison.Ordinal) ||
            word.EndsWith("shes", StringComparison.Ordinal) ||
            word.EndsWith("sses", StringComparison.Ordinal) ||
            word.EndsWith("zzes", StringComparison.Ordinal))
        {
            if (canStrip2)
            {
                variants.Add(word.Substring(0, word.Length - 2));
            }
        }
        else if (word.EndsWith("ches", StringComparison.Ordinal) ||
                 word.EndsWith("ses", StringComparison.Ordinal) ||
                 word.EndsWith("zes", StringComparison.Ordinal) ||
                 word.EndsWith("oes", StringComparison.Ordinal))
        {
            if (canStrip2)
            {
                variants.Add(word.Substring(0, word.Length - 2));
            }

            if (canStrip1)
            {
                variants.Add(word.Substring(0, word.Length - 1));
            }
        }
        else if (word.EndsWith("s", StringComparison.Ordinal) &&
                 !word.EndsWith("ss", StringComparison.Ordinal))
        {
            if (canStrip1)
            {
                variants.Add(word.Substring(0, word.Length - 1));
            }
        }

        return variants;
    }

    // Runs of Unicode letters/numbers (identifier-segments.ts:33,117).
    [GeneratedRegex(@"[\p{L}\p{N}]+")]
    private static partial Regex AlphanumericRunRegex();

    /// <summary>Han / Kana / Hangul — scripts written without word separators.</summary>
    internal static bool IsCjk(char c) =>
        (c >= '\u4E00' && c <= '\u9FFF') || // CJK Unified Ideographs
        (c >= '\u3400' && c <= '\u4DBF') || // CJK Extension A
        (c >= '\uF900' && c <= '\uFAFF') || // CJK Compatibility Ideographs
        (c >= '\u3040' && c <= '\u30FF') || // Hiragana + Katakana
        (c >= '\uAC00' && c <= '\uD7AF');   // Hangul Syllables

    internal static bool ContainsCjk(string s)
    {
        foreach (var c in s)
        {
            if (IsCjk(c))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Split one letter/digit run at CJK↔non-CJK transitions. CJK prose has no word
    /// separators, so an embedded Latin identifier is glued into the same run
    /// ("修复OrderStateMachine的bug"); a run with no CJK returns itself unsplit.
    /// </summary>
    internal static List<string> SplitByScriptBoundary(string run)
    {
        if (!ContainsCjk(run))
        {
            return new List<string> { run };
        }

        var pieces = new List<string>();
        var start = 0;
        for (var i = 1; i <= run.Length; i++)
        {
            if (i == run.Length || IsCjk(run[i]) != IsCjk(run[start]))
            {
                pieces.Add(run[start..i]);
                start = i;
            }
        }

        return pieces;
    }

    // Split before an Upper following lower/digit (camelCase hump), and before the
    // last Upper of an acronym run when a lowercase follows ("HTMLParser" → HTML |
    // Parser). (identifier-segments.ts:37)
    [GeneratedRegex(@"(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})")]
    private static partial Regex SegmentBoundaryRegex();

    // Digit-only fragment (identifier-segments.ts:42,122).
    [GeneratedRegex(@"^\p{N}+$")]
    private static partial Regex DigitsOnlyRegex();

    // English prompt words that are never evidence a symbol was NAMED, however rare
    // their segment happens to be in a given repo: function words, filler, hyper-common
    // dev verbs, and words ABOUT code rather than OF it ("rename this file"). Measured
    // FPs that motivated this: "fix THIS typo" matched resolveDeferredThisMemberRefs,
    // "WRITE a haiku" matched writeConfig. English-only ON PURPOSE — identifiers are
    // written in English, so only English prose can accidentally collide with segments;
    // other languages' function words match nothing and need no list. Domain nouns
    // ("state", "checkout", "order") stay OUT — the rarity/co-occurrence rules judge
    // them per-repo. (identifier-segments.ts:81 ENGLISH_PROSE_STOPWORDS; ported
    // verbatim — the duplicate "again" is folded by the set.)
    private static readonly HashSet<string> EnglishProseStopwords = new(StringComparer.Ordinal)
    {
        "about", "above", "actually", "after", "again", "against", "almost", "along", "also", "always",
        "another", "anything", "around", "away", "back", "because", "been", "before", "behind", "being",
        "below", "best", "better", "between", "both", "cannot", "come", "could", "does", "doing", "done",
        "down", "each", "either", "else", "even", "ever", "every", "everything", "fine", "first", "from",
        "getting", "give", "goes", "going", "gone", "good", "great", "have", "having", "help", "here",
        "inside", "instead", "into", "just", "keep", "know", "last", "least", "less", "like", "likely",
        "little", "look", "looking", "made", "make", "making", "many", "maybe", "mind", "more", "most",
        "much", "must", "need", "needs", "never", "next", "nice", "none", "nothing", "okay", "only",
        "onto", "other", "otherwise", "over", "please", "pretty", "probably", "quite", "rather", "really",
        "right", "same", "seem", "seems", "should", "show", "since", "some", "someone", "something",
        "somewhere", "soon", "still", "such", "sure", "take", "than", "thank", "thanks", "that", "their",
        "them", "then", "there", "these", "they", "thing", "things", "think", "this", "those", "though",
        "tried", "tries", "trying", "under", "until", "upon", "very", "want", "wants", "well", "went",
        "were", "what", "when", "which", "while", "will", "wish", "with", "within", "without", "would",
        "wrong", "your", "yours",
        // words ABOUT code, not OF it — present in a huge share of prompts while almost
        // never naming the symbol the user means
        "again", "change", "changes", "check", "class", "classes", "code", "detail", "details",
        "directory", "error", "errors", "example", "examples", "file", "files", "folder", "function",
        "functions", "issue", "issues", "line", "lines", "method", "methods", "name", "names", "problem",
        "problems", "project", "question", "questions", "rename", "test", "tests", "type", "types",
        "update", "value", "values", "warning", "warnings", "work", "working", "write", "writing"
    };
}

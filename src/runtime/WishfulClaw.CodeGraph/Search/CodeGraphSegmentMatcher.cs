// CodeGraphSegmentMatcher — graph-derived prompt matching for the front-load hook's
// MEDIUM tier (≙ CodeGraph.getSegmentMatches, index.ts:1127). Answers "which indexed
// symbols do these prose words NAME?" — "state machine des commandes" ->
// OrderStateMachine, in any human language whose technical nouns are Latin script,
// with no keyword list involved.
//
// Precision comes from the repo's OWN naming statistics, not a vocabulary:
//   CO-OCCURRENCE (Tier A): >=2 prompt words that are segments of the SAME name
//     ("state" + "machine" -> OrderStateMachine) is strong evidence and always
//     qualifies. minWords=2 counts distinct PROMPT WORDS (the SQL folds plural
//     variants back to their word, #1146), so `service`+`services` can't fake a
//     two-word hit.
//   RARITY (Tier B): a single matched word qualifies only when its segment is
//     discriminative here (>=2 and <= SegmentRarityCeiling(25) distinct names) —
//     "checkout" in a shop backend yes, "state" in a react app no — the word is
//     >=5 chars, and the candidate name has >=2 segments. Tier B runs ONLY when
//     Tier A found nothing (co-occurrence is categorically stronger).
//
// Every candidate is re-verified against `nodes` (the honesty gate) before it is
// returned: vocab rows are proposals, deletes leave orphans by design, and a name
// whose only nodes are file/import kind has no real definition to surface (#1144).
internal static class CodeGraphSegmentMatcher
{
    // A single word ("state") can match hundreds of names in a big repo — noise, not
    // signal. Ceiling for the single-word tier; co-occurrence is exempt (two words on
    // one name is already discriminative). (index.ts:1208 SEGMENT_RARITY_CEILING)
    private const int SegmentRarityCeiling = 25;

    internal static List<CodeGraphSegmentMatch> GetSegmentMatches(
        CodeGraphStore store,
        IReadOnlyList<string> words,
        int limit = 6)
    {
        var output = new List<CodeGraphSegmentMatch>();
        if (words.Count == 0)
        {
            return output;
        }

        // Variant -> original word (plural folding), for coverage accounting. A Dictionary
        // preserves first-insertion order (the TS Map iteration order getSegmentMatches
        // relies on for the rare-tier tie-break); first writer wins per variant.
        var variantToWord = new Dictionary<string, string>(StringComparer.Ordinal);
        var variants = new List<string>();
        foreach (var word in words)
        {
            foreach (var variant in CodeGraphIdentifierSegments.SegmentLookupVariants(word))
            {
                if (variantToWord.TryAdd(variant, word))
                {
                    variants.Add(variant);
                }
            }
        }

        // Tier A: co-occurrence. The SQL folds variants back to their word, so
        // minWords=2 means two distinct PROMPT WORDS; the re-check below recomputes
        // the fold from LIVE segments as the honesty layer.
        var variantPairs = new List<(string Segment, string Word)>(variants.Count);
        foreach (var variant in variants)
        {
            variantPairs.Add((variant, variantToWord[variant]));
        }

        var candidates = new List<(string Name, HashSet<string> MatchedWords)>();
        foreach (var hit in store.GetSegmentCoOccurrence(variantPairs, 2, 24))
        {
            var matched = WordsMatchingName(hit.Name, variantToWord);
            if (matched.Count >= 2)
            {
                candidates.Add((hit.Name, matched));
            }
        }

        // Tier B: single rare word — only when co-occurrence found nothing, and under
        // stricter rules (one word is thin evidence). Word >=5 chars; segment in >=2
        // and <= ceiling names; candidate name has >=2 segments.
        if (candidates.Count == 0)
        {
            var singleWordVariants = variants.Where(v => variantToWord[v].Length >= 5).ToList();
            var counts = store.GetSegmentNameCounts(singleWordVariants);
            var rare = counts
                .Where(kv => kv.Value >= 2 && kv.Value <= SegmentRarityCeiling)
                .OrderBy(kv => kv.Value)
                .Take(2);
            foreach (var kv in rare)
            {
                var word = variantToWord[kv.Key];
                foreach (var name in store.GetNamesForSegment(kv.Key, 12))
                {
                    if (CodeGraphIdentifierSegments.SplitIdentifierSegments(name).Count < 2)
                    {
                        continue;
                    }

                    candidates.Add((name, new HashSet<string>(StringComparer.Ordinal) { word }));
                }
            }
        }

        // Verify against nodes (the honesty gate) and pick a representative definition
        // per name. OrderBy/ThenBy are stable (matches JS's stable Array.sort): more
        // matched words first, then shorter name.
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var ordered = candidates
            .OrderByDescending(c => c.MatchedWords.Count)
            .ThenBy(c => c.Name.Length);
        foreach (var candidate in ordered)
        {
            if (output.Count >= limit)
            {
                break;
            }

            if (!seen.Add(candidate.Name))
            {
                continue;
            }

            var nodes = store.GetNodesByName(candidate.Name);
            if (nodes.Count == 0)
            {
                continue; // orphaned vocab row — name no longer exists
            }

            var rep = nodes.FirstOrDefault(n =>
                n.Kind != CodeGraphNodeKind.File && n.Kind != CodeGraphNodeKind.Import);
            if (rep is null)
            {
                continue; // no real definition — don't surface an import/file as one
            }

            output.Add(new CodeGraphSegmentMatch(
                candidate.Name,
                rep.Kind,
                rep.FilePath,
                rep.StartLine,
                candidate.MatchedWords.OrderBy(w => w, StringComparer.Ordinal).ToList()));
        }

        return output;
    }

    // Which of the prompt's original words match `name`'s segments (via variants).
    // Segments are recomputed here — a name-keyed vocab lookup would scan the
    // (segment, name) primary key. (index.ts:1213 wordsMatchingName)
    private static HashSet<string> WordsMatchingName(
        string name,
        Dictionary<string, string> variantToWord)
    {
        var segments = new HashSet<string>(
            CodeGraphIdentifierSegments.SplitIdentifierSegments(name),
            StringComparer.Ordinal);
        var matched = new HashSet<string>(StringComparer.Ordinal);
        foreach (var pair in variantToWord)
        {
            if (segments.Contains(pair.Key))
            {
                matched.Add(pair.Value);
            }
        }

        return matched;
    }
}

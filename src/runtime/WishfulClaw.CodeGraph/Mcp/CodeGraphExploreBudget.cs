// =============================================================================
// CodeGraphExploreBudget — the size-tiered explore budgets (port of
// getExploreBudget / getExploreOutputBudget, mcp/tools.ts:134/:192; analysis/04
// §3.2). Two knobs, both scaled to the indexed file count and sharing the same
// tier breakpoints so a project sits in the SAME tier across both:
//
//   * CALL budget — the recommended number of codegraph_explore calls, surfaced
//     as a dynamic suffix on the explore tool description in tools-list
//     ("Budget: make at most N calls …", tools.ts:1013).
//   * OUTPUT budget — the per-call rendering caps. Smaller codebases get a
//     tighter total cap / fewer default files / smaller per-file cap so a
//     focused query on a 100-file project doesn't dump a whole file's source
//     into the agent's context; large repos keep the generous defaults but cap
//     at ~24K chars, UNDER the host's inline tool-result ceiling (~25K) — above
//     it the result is externalized to a file the agent Reads back (#185).
//     Meta-text toggles (relationships / additional-files / completeness /
//     budget note) are gated off for tiny projects where one rich call is the
//     whole story. Invariant: a larger tier never gets a smaller MaxCharsPerFile
//     than a smaller tier.
//
// The record is IN-PROCESS only (never crosses the wire), so it is not
// registered in CodeGraphJsonContext.
// =============================================================================
internal static class CodeGraphExploreBudget
{
    // getExploreBudget (tools.ts:134): recommended explore CALLS by project size.
    public static int GetCallBudget(int fileCount)
    {
        if (fileCount < 500)
        {
            return 1;
        }

        if (fileCount < 5_000)
        {
            return 2;
        }

        if (fileCount < 15_000)
        {
            return 3;
        }

        return fileCount < 25_000 ? 4 : 5;
    }

    // getExploreOutputBudget (tools.ts:192): per-call output caps by project size.
    // Tier values ported verbatim (including the deliberately identical large and
    // very-large tiers — upstream keeps them distinct branches, mirrored here).
    public static CodeGraphExploreOutputBudget GetOutputBudget(int fileCount)
    {
        if (fileCount < 150)
        {
            // ITER3 shape (13K/4/3.8K) + the test-file hard-exclude: the cost lever
            // for this tier is steering the agent to stop after 1-2 calls, not the
            // per-file cap (a 2.5K cap forced Read fallbacks).
            return new CodeGraphExploreOutputBudget(
                MaxOutputChars: 13_000,
                DefaultMaxFiles: 4,
                MaxCharsPerFile: 3_800,
                GapThreshold: 7,
                MaxSymbolsInFileHeader: 5,
                MaxEdgesPerRelationshipKind: 4,
                IncludeRelationships: false,
                IncludeAdditionalFiles: false,
                IncludeCompletenessSignal: false,
                IncludeBudgetNote: false,
                ExcludeLowValueFiles: true);
        }

        if (fileCount < 500)
        {
            return new CodeGraphExploreOutputBudget(
                MaxOutputChars: 18_000,
                DefaultMaxFiles: 5,
                MaxCharsPerFile: 3_800,
                GapThreshold: 8,
                MaxSymbolsInFileHeader: 6,
                MaxEdgesPerRelationshipKind: 6,
                IncludeRelationships: false,
                IncludeAdditionalFiles: false,
                IncludeCompletenessSignal: false,
                IncludeBudgetNote: false,
                ExcludeLowValueFiles: true);
        }

        if (fileCount < 5_000)
        {
            // ~150-line per-file windows × ~6 files, capped at the ~24K inline
            // ceiling. Per-file stays ≥ the <500 tier (monotonic).
            return new CodeGraphExploreOutputBudget(
                MaxOutputChars: 24_000,
                DefaultMaxFiles: 8,
                MaxCharsPerFile: 6_500,
                GapThreshold: 12,
                MaxSymbolsInFileHeader: 10,
                MaxEdgesPerRelationshipKind: 10,
                IncludeRelationships: true,
                IncludeAdditionalFiles: true,
                IncludeCompletenessSignal: true,
                IncludeBudgetNote: true,
                ExcludeLowValueFiles: false);
        }

        // Large + very-large repos: SAME ~24K inline ceiling — more files indexed
        // means more CALLS (GetCallBudget), never a bigger single response.
        return new CodeGraphExploreOutputBudget(
            MaxOutputChars: 24_000,
            DefaultMaxFiles: 8,
            MaxCharsPerFile: 7_000,
            GapThreshold: 15,
            MaxSymbolsInFileHeader: 15,
            MaxEdgesPerRelationshipKind: 15,
            IncludeRelationships: true,
            IncludeAdditionalFiles: true,
            IncludeCompletenessSignal: true,
            IncludeBudgetNote: true,
            ExcludeLowValueFiles: false);
    }
}

// One tier of the adaptive explore output budget (≙ ExploreOutputBudget,
// tools.ts:161). Fields the simplified C# renderer does not consume yet
// (GapThreshold, header/edge caps, the relationships/additional-files toggles,
// ExcludeLowValueFiles) are still ported so the tiers stay byte-faithful to the
// upstream tuning and light up as the formatter grows into them.
internal sealed record CodeGraphExploreOutputBudget(
    int MaxOutputChars,
    int DefaultMaxFiles,
    int MaxCharsPerFile,
    int GapThreshold,
    int MaxSymbolsInFileHeader,
    int MaxEdgesPerRelationshipKind,
    bool IncludeRelationships,
    bool IncludeAdditionalFiles,
    bool IncludeCompletenessSignal,
    bool IncludeBudgetNote,
    bool ExcludeLowValueFiles);

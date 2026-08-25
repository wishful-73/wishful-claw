// =============================================================================
// CodeGraphFileClassifier — path-only file classification for the scanner
// (analysis/05 §2.6 / §6.4). A thin façade over the already-ported detectors so the
// scanning slice has one home for the three questions it asks of a path:
//
//   * IsSourceFile — should we index this file at all? Reuses
//     CodeGraphLanguageMap.IsSourceFile (the EXTENSION_MAP-derived answer) and folds
//     in the project's custom `codegraph.json` `extensions` overrides, matching the
//     TS isSourceFile(filePath, overrides) contract.
//   * IsGenerated — a ranking hint (generated stubs rank last). Reuses
//     CodeGraphGeneratedDetection.
//   * IsTest — a ranking/relevance hint. Reuses CodeGraphSearchScoring.IsTestFile
//     (the query-utils.isTestFile port that already lives in the search slice).
//
// All three are pure and path-only — no file content is read here.
// =============================================================================
internal static class CodeGraphFileClassifier
{
    // Whether `filePath` is one CodeGraph can index, honoring the project's custom
    // extension overrides. Built-in support is the EXTENSION_MAP (+ special-filename
    // cases); a `codegraph.json` extension makes its files indexable too.
    // (grammars.ts isSourceFile with overrides)
    public static bool IsSourceFile(string filePath, CodeGraphProjectConfig config)
    {
        if (CodeGraphLanguageMap.IsSourceFile(filePath))
        {
            return true;
        }

        if (config.Extensions.Count == 0)
        {
            return false;
        }

        var dot = filePath.LastIndexOf('.');
        if (dot < 0)
        {
            return false;
        }

        return config.Extensions.ContainsKey(filePath[dot..].ToLowerInvariant());
    }

    // Whether `filePath` looks tool-generated (`.pb.go`, `.g.dart`, `_pb2.py`, …).
    // A relevance hint, never a hard filter. (generated-detection.ts isGenerated)
    public static bool IsGenerated(string filePath) =>
        CodeGraphGeneratedDetection.IsGeneratedFile(filePath);

    // Whether `filePath` is a test/spec/non-production source file. (query-utils.ts
    // isTestFile, already ported into the search scoring helpers.)
    public static bool IsTest(string filePath) =>
        CodeGraphSearchScoring.IsTestFile(filePath);
}

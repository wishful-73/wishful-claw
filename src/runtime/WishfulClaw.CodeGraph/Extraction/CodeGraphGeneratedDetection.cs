using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphGeneratedDetection — path-only tool-generated-file classifier (port of
// extraction/generated-detection.ts).
//
// A pure suffix-pattern classifier: whether a filename looks tool-generated
// (`.pb.go`, `_grpc.pb.go`, `.g.dart`, `_pb2.py`, `Grpc.cs`, …). This is a RANKING
// HINT ONLY, consulted at symbol-disambiguation time so generated stubs rank LAST
// when a real implementation shares their name — never a hard filter. Path-only; it
// does not read content.
//
// Case-sensitivity matches the TS regexes verbatim: several patterns are
// case-sensitive (`Grpc.cs`, `OuterClass.java`, `^mock_…`), and [GeneratedRegex]
// is case-sensitive by default, so no options are set.
// =============================================================================
internal static partial class CodeGraphGeneratedDetection
{
    // Tested against the ORIGINAL-case path (generated-detection.ts GENERATED_PATTERNS).
    private static readonly Regex[] Patterns =
    {
        // Go — protobuf / gRPC / pulsar / mockgen.
        PbGoRegex(),
        PulsarGoRegex(),
        GrpcPbGoRegex(),
        MockGoRegex(),
        MocksGoRegex(),
        MockPrefixGoRegex(),
        // TypeScript / JavaScript — common codegen suffixes.
        GeneratedTsRegex(),
        GenTsRegex(),
        PbTsRegex(),
        PbUnderscoreTsRegex(),
        GrpcPbTsRegex(),
        MinJsRegex(),
        // Python — protobuf / gRPC.
        Pb2PyRegex(),
        Pb2PyiRegex(),
        // C++ — protobuf.
        PbCcHRegex(),
        // C# — protobuf / gRPC.
        GCsRegex(),
        GrpcCsRegex(),
        // Java — protobuf / gRPC.
        OuterClassJavaRegex(),
        GrpcJavaRegex(),
        // Swift — protobuf.
        PbSwiftRegex(),
        // Dart — build_runner / freezed / json_serializable / chopper.
        GDartRegex(),
        FreezedDartRegex(),
        PbDartRegex(),
        PbgrpcDartRegex(),
        ChopperDartRegex(),
        // Rust — in-tree generated files.
        GeneratedRsRegex()
    };

    // Whether `filePath` looks like a tool-generated source file based on its
    // filename. Path-only — does not read content. A relevance hint, not a hard claim.
    public static bool IsGeneratedFile(string filePath)
    {
        foreach (Regex pattern in Patterns)
        {
            if (pattern.IsMatch(filePath))
            {
                return true;
            }
        }

        return false;
    }

    [GeneratedRegex(@"\.pb\.go$")] private static partial Regex PbGoRegex();
    [GeneratedRegex(@"\.pulsar\.go$")] private static partial Regex PulsarGoRegex();
    [GeneratedRegex(@"_grpc\.pb\.go$")] private static partial Regex GrpcPbGoRegex();
    [GeneratedRegex(@"_mock\.go$")] private static partial Regex MockGoRegex();
    [GeneratedRegex(@"_mocks\.go$")] private static partial Regex MocksGoRegex();
    [GeneratedRegex(@"^mock_[^/]+\.go$")] private static partial Regex MockPrefixGoRegex();
    [GeneratedRegex(@"\.generated\.[jt]sx?$")] private static partial Regex GeneratedTsRegex();
    [GeneratedRegex(@"\.gen\.[jt]sx?$")] private static partial Regex GenTsRegex();
    [GeneratedRegex(@"\.pb\.[jt]s$")] private static partial Regex PbTsRegex();
    [GeneratedRegex(@"_pb\.[jt]s$")] private static partial Regex PbUnderscoreTsRegex();
    [GeneratedRegex(@"_grpc_pb\.[jt]s$")] private static partial Regex GrpcPbTsRegex();
    [GeneratedRegex(@"\.min\.m?js$")] private static partial Regex MinJsRegex();
    [GeneratedRegex(@"_pb2(_grpc)?\.py$")] private static partial Regex Pb2PyRegex();
    [GeneratedRegex(@"_pb2\.pyi$")] private static partial Regex Pb2PyiRegex();
    [GeneratedRegex(@"\.pb\.(cc|h)$")] private static partial Regex PbCcHRegex();
    [GeneratedRegex(@"\.g\.cs$")] private static partial Regex GCsRegex();
    [GeneratedRegex(@"Grpc\.cs$")] private static partial Regex GrpcCsRegex();
    [GeneratedRegex(@"OuterClass\.java$")] private static partial Regex OuterClassJavaRegex();
    [GeneratedRegex(@"Grpc\.java$")] private static partial Regex GrpcJavaRegex();
    [GeneratedRegex(@"\.pb\.swift$")] private static partial Regex PbSwiftRegex();
    [GeneratedRegex(@"\.g\.dart$")] private static partial Regex GDartRegex();
    [GeneratedRegex(@"\.freezed\.dart$")] private static partial Regex FreezedDartRegex();
    [GeneratedRegex(@"\.pb\.dart$")] private static partial Regex PbDartRegex();
    [GeneratedRegex(@"\.pbgrpc\.dart$")] private static partial Regex PbgrpcDartRegex();
    [GeneratedRegex(@"\.chopper\.dart$")] private static partial Regex ChopperDartRegex();
    [GeneratedRegex(@"\.generated\.rs$")] private static partial Regex GeneratedRsRegex();
}

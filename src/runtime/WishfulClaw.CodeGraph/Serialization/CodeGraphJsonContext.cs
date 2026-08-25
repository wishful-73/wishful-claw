using System.Text.Json.Serialization;

// Dedicated AOT source-generation context for CodeGraph DTOs (analysis/06 §4.2 and
// M0-A step A2 both prescribe a dedicated context rather than appending to
// WorkerJsonContext). Options mirror WorkerJsonContext exactly: Metadata generation
// mode, PascalCase C# props -> camelCase JSON, and null members omitted.
//
// Every serialized type needs its own [JsonSerializable] entry; each future List<T>
// result needs a SEPARATE entry with a stable TypeInfoPropertyName = "ListCodeGraphX"
// (mirror WorkerJsonContext's ListProjectRow pattern). Access the generated metadata
// via CodeGraphJsonContext.Default.<TypeName>.
[JsonSourceGenerationOptions(
    GenerationMode = JsonSourceGenerationMode.Metadata,
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(CodeGraphStatusResult))]
[JsonSerializable(typeof(CodeGraphDbSmokeResult))]
// M5 tool surface (reference/02 §4). Tool-shaped result (all 8 query RPCs), the two
// structured index/sync results, the two streamed progress/complete events, the
// instructions result, and the tools-list definition graph. Nested tool-def records
// (InputSchema/Property/Annotations) + the Dictionary/array members each get an
// explicit entry (source-gen resolves each JsonTypeInfo; no reflection fallback).
[JsonSerializable(typeof(CodeGraphToolResult))]
[JsonSerializable(typeof(CodeGraphIndexResponse))]
[JsonSerializable(typeof(CodeGraphSyncResponse))]
[JsonSerializable(typeof(CodeGraphInstructionsResult))]
[JsonSerializable(typeof(CodeGraphIndexProgressEvent))]
[JsonSerializable(typeof(CodeGraphIndexComplete))]
[JsonSerializable(typeof(CodeGraphToolsListResult))]
[JsonSerializable(typeof(CodeGraphProjectListResult))]
[JsonSerializable(typeof(CodeGraphProjectInfo))]
[JsonSerializable(typeof(CodeGraphRemoveProjectResult))]
// Structured-read DTOs for the visualization UI (plan/codex-graph/07 §2). Each result
// record + its nested element records get an entry (source-gen wires the IReadOnlyList
// members once the element type is registered — the CodeGraphProjectListResult pattern).
[JsonSerializable(typeof(CodeGraphIndexStatus))]
[JsonSerializable(typeof(CodeGraphStatsResult))]
[JsonSerializable(typeof(CodeGraphAnalyticsResult))]
[JsonSerializable(typeof(CodeGraphPromptContextResult))]
[JsonSerializable(typeof(CodeGraphCountBucket))]
[JsonSerializable(typeof(CodeGraphSubgraphResult))]
[JsonSerializable(typeof(CodeGraphNodeView))]
[JsonSerializable(typeof(CodeGraphEdgeView))]
[JsonSerializable(typeof(CodeGraphFilesResult))]
[JsonSerializable(typeof(CodeGraphFileNode))]
[JsonSerializable(typeof(CodeGraphNodeListResult))]
[JsonSerializable(typeof(CodeGraphToolDefinition))]
[JsonSerializable(typeof(CodeGraphToolDefinition[]))]
[JsonSerializable(typeof(CodeGraphToolInputSchema))]
[JsonSerializable(typeof(CodeGraphToolProperty))]
[JsonSerializable(typeof(Dictionary<string, CodeGraphToolProperty>))]
[JsonSerializable(typeof(CodeGraphToolAnnotations))]
// List<string> underpins the reflection-free string[] JSON-column codec in
// CodeGraphStore (nodes.decorators / nodes.type_parameters / unresolved_refs.
// candidates). Required because JsonSerializerIsReflectionEnabledByDefault=false:
// every (de)serialize must resolve a source-gen JsonTypeInfo. TypeInfoPropertyName
// mirrors WorkerJsonContext's "ListX" convention (reference/01 §3).
[JsonSerializable(typeof(List<string>), TypeInfoPropertyName = "ListString")]
internal sealed partial class CodeGraphJsonContext : JsonSerializerContext;

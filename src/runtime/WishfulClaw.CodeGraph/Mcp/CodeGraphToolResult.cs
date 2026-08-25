// =============================================================================
// CodeGraph tool/RPC result + event DTOs (M5 tool surface; reference/02 §4,
// analysis/04 §3.1). Global namespace, CodeGraph* prefix, internal, reflection-free.
// Every type here is serialized via CodeGraphJsonContext (source-gen, camelCase,
// null-props-omitted). Positional-record params (PascalCase) serialize as camelCase.
//
// THE error convention (reference/02 §1.3, load-bearing): WorkerResponse.Error
// RESOLVES on the JS side — it does not reject. So success/failure is modeled
// EXPLICITLY in the DTO (Success / Error / ErrorKind), and callers must inspect the
// payload. WorkerResponse.Error(...) is reserved for a truly-unexpected throw.
// =============================================================================

// The `errorKind` string vocabulary (reference/02 §4.1). String constants, not a C#
// enum — they cross the wire verbatim and are shared with the renderer.
internal static class CodeGraphErrorKind
{
    // project never indexed / no default project -> SUCCESS-shaped guidance (never
    // isError). An early hard error teaches session-long abandonment of the toolset.
    public const string NotIndexed = "not_indexed";

    // refused/sensitive root ($HOME, /, /etc) -> HARD (isError, no retry text).
    public const string PathRefusal = "path_refusal";

    // missing/invalid required field.
    public const string InvalidArgs = "invalid_args";

    // handler threw unexpectedly -> isError WITH "retry once, else continue" text.
    public const string Internal = "internal";
}

// ---------------------------------------------------------------------------
// Tool result shape (reference/02 §4.2) — backs codegraph/explore|search|node|
// callers|callees|impact|files|status. Mirrors the MCP tool output
// { content:[{type:'text',text}], isError? } so the renderer routes the same-named
// MCP tool straight through: it adapts Text -> content[0].text and IsError -> isError.
// IsError is true ONLY for hard failures (path_refusal, internal); not_indexed is
// success-shaped (Success:true, IsError:false, ErrorKind:"not_indexed").
// ---------------------------------------------------------------------------
internal sealed record CodeGraphToolResult(
    bool Success,
    string Text,
    bool IsError,
    string? ErrorKind = null,
    string[]? Notices = null);

// ---------------------------------------------------------------------------
// codegraph/index result (reference/02 §2.1). Structured envelope: Success + optional
// Error/ErrorKind. Distinct name from the in-process facade CodeGraphIndexResult
// (the facade record is projected into this wire DTO).
// ---------------------------------------------------------------------------
internal sealed record CodeGraphIndexResponse(
    bool Success,
    string IndexId,
    string State,
    int FilesIndexed,
    int NodeCount,
    int EdgeCount,
    int UnresolvedCount,
    long DurationMs,
    string? IndexedWithVersion = null,
    string? Error = null,
    string? ErrorKind = null);

// codegraph/sync result (reference/02 §2.1).
internal sealed record CodeGraphSyncResponse(
    bool Success,
    int FilesChanged,
    int FilesAdded,
    int FilesRemoved,
    int NodesUpdated,
    int EdgesUpdated,
    long DurationMs,
    string? Error = null,
    string? ErrorKind = null);

// codegraph/instructions result (reference/02 §2.5). Selects the indexed vs no-root
// playbook variant surfaced in the agent system prompt.
internal sealed record CodeGraphInstructionsResult(
    bool Success,
    string Instructions,
    bool Indexed);

// ---------------------------------------------------------------------------
// Streaming event payloads (reference/02 §3). Emitted mid-request via
// ctx.EmitEventAsync while codegraph/index runs; the final WorkerResponse is still
// returned in addition. Numbers must be finite (the msgpack transcoder throws on
// NaN/Infinity).
// ---------------------------------------------------------------------------

// codegraph/index-progress (0..n per run). Phase: scan | extract | resolve |
// synthesize | maintenance | recreate | sync.
internal sealed record CodeGraphIndexProgressEvent(
    string IndexId,
    string Phase,
    int FilesDone,
    int FilesTotal,
    int NodeCount,
    int EdgeCount,
    string? Message = null);

// codegraph/index-complete (exactly 1, terminal). State: complete | partial | failed
// | cancelled. Flushed even on cancellation (EmitEventIgnoringCancellationAsync).
internal sealed record CodeGraphIndexComplete(
    string IndexId,
    string State,
    int FilesIndexed,
    int NodeCount,
    int EdgeCount,
    long DurationMs,
    string? Error = null);

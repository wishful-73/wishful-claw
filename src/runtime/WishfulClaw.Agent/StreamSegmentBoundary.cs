using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// S-142: emits the explicit block boundaries the renderer needs in order to tell
/// "this delta continues the open block" from "this delta opens a new block".
///
/// Why this exists: the main-process batcher coalesces text and thinking deltas
/// into two accumulators and drains them in a fixed order (text first, thinking
/// second). A thinking block that was still streaming when the first text delta
/// arrived therefore reached the renderer <em>after</em> that text, and the
/// renderer — which only sees bare deltas — opened a second thinking paragraph.
/// One thinking block rendered as [thinking, text, thinking-tail].
///
/// Boundary events are control events on the wire: the batcher flushes its
/// buffered deltas before passing them through, so a block can no longer be
/// drained out of arrival order. Providers call <see cref="BeforeDelta"/> ahead of
/// every text / thinking delta and <see cref="AtEnd"/> once the turn's stream is
/// over (closing a thinking block that never switched to text).
/// </summary>
internal sealed class StreamSegmentBoundary
{
    internal const string TextKind = "text";
    internal const string ThinkingKind = "thinking";

    /// <summary>Wire event names — must match src/shared/agent-stream-protocol.ts.</summary>
    internal const string TextStartEvent = "text_start";
    internal const string ThinkingStartEvent = "thinking_start";
    internal const string ThinkingEndEvent = "thinking_end";

    private string? _openKind;

    /// <summary>
    /// Boundary events to emit before a delta of <paramref name="kind"/>
    /// (<see cref="TextKind"/> / <see cref="ThinkingKind"/>). Empty when the delta
    /// continues the block that is already open. Used by the OpenAI-style
    /// providers, where the block kind is implied by which delta field arrived.
    /// </summary>
    internal string[] BeforeDelta(string kind)
    {
        if (_openKind == kind)
        {
            return [];
        }

        var startsNewKind = kind == ThinkingKind ? ThinkingStartEvent : TextStartEvent;
        var events = _openKind == ThinkingKind
            ? new[] { ThinkingEndEvent, startsNewKind }
            : [startsNewKind];
        _openKind = kind;
        return events;
    }

    /// <summary>
    /// Block opened explicitly (Anthropic's <c>content_block_start</c>): same shape
    /// as <see cref="BeforeDelta"/>, the caller already knows the kinds so the
    /// boundary needs no kind-switch guessing.
    /// </summary>
    internal string[] OpenBlock(string kind) => BeforeDelta(kind);

    /// <summary>
    /// Block closed explicitly (Anthropic's <c>content_block_stop</c>). A text block
    /// needs no boundary here — only thinking has an end event — but the open kind is
    /// still cleared so the next deltas re-open with a fresh start.
    /// </summary>
    internal string[] CloseBlock(string kind)
    {
        if (_openKind == kind)
        {
            _openKind = null;
        }

        return kind == ThinkingKind ? [ThinkingEndEvent] : [];
    }

    /// <summary>
    /// Boundary events to emit when the stream is over: closes an open thinking
    /// block, so the renderer does not have to wait for the next text delta (or for
    /// message_end) to mark it complete.
    /// </summary>
    internal string[] AtEnd()
    {
        if (_openKind != ThinkingKind)
        {
            return [];
        }

        _openKind = null;
        return [ThinkingEndEvent];
    }

    /// <summary>Emits the boundary events in order. No-op for an empty list.</summary>
    internal static async Task EmitAsync(
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        string[] boundaryTypes)
    {
        foreach (var boundaryType in boundaryTypes)
        {
            await AgentRuntimeTools.EmitAsync(state, context, new AgentRuntimeStreamEvent(boundaryType));
        }
    }
}

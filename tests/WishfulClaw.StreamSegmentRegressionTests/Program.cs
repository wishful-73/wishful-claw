using WishfulClaw.Agent;

namespace WishfulClaw.StreamSegmentRegressionTests;

/// <summary>
/// S-142: the text / thinking block boundary tracker.
///
/// The renderer assembles content segments from these events, so the exact
/// sequence is the contract. The event names mirror
/// src/shared/agent-stream-protocol.ts and src/renderer/src/stores/chat-store —
/// renaming one without the other silently stops the boundaries from landing.
/// </summary>
internal static class Program
{
    private static int _checks;

    public static int Main()
    {
        try
        {
            RunKindSwitchSuite();
            RunExplicitBlockSuite();
            RunEndOfStreamSuite();
            Console.WriteLine($"Stream segment boundary regression checks passed ({_checks} assertions).");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Stream segment boundary regression test failed: {ex}");
            return 1;
        }
    }

    /// <summary>
    /// OpenAI-style providers: the block kind is implied by which delta field
    /// arrived, so the tracker derives the boundary from the switch itself.
    /// </summary>
    private static void RunKindSwitchSuite()
    {
        var tracker = new StreamSegmentBoundary();

        AssertSequence(
            tracker.BeforeDelta(StreamSegmentBoundary.ThinkingKind),
            [StreamSegmentBoundary.ThinkingStartEvent],
            "the first thinking delta opens a thinking block");

        AssertSequence(
            tracker.BeforeDelta(StreamSegmentBoundary.ThinkingKind),
            [],
            "a following thinking delta continues the same block — no boundary");

        AssertSequence(
            tracker.BeforeDelta(StreamSegmentBoundary.TextKind),
            [StreamSegmentBoundary.ThinkingEndEvent, StreamSegmentBoundary.TextStartEvent],
            "switching to text closes the thinking block and opens a text block");

        AssertSequence(
            tracker.BeforeDelta(StreamSegmentBoundary.TextKind),
            [],
            "a following text delta continues the same block — no boundary");

        AssertSequence(
            tracker.BeforeDelta(StreamSegmentBoundary.ThinkingKind),
            [StreamSegmentBoundary.ThinkingStartEvent],
            "a later thinking block opens with thinking_start (text has no end event)");
    }

    /// <summary>
    /// Anthropic states the kind of every content block up front, so the boundary
    /// comes from content_block_start / content_block_stop instead of a switch.
    /// </summary>
    private static void RunExplicitBlockSuite()
    {
        var tracker = new StreamSegmentBoundary();

        AssertSequence(
            tracker.OpenBlock(StreamSegmentBoundary.TextKind),
            [StreamSegmentBoundary.TextStartEvent],
            "an explicit text block opens with text_start");

        AssertSequence(
            tracker.CloseBlock(StreamSegmentBoundary.TextKind),
            [],
            "closing a text block needs no boundary — text has no end event");

        AssertSequence(
            tracker.OpenBlock(StreamSegmentBoundary.ThinkingKind),
            [StreamSegmentBoundary.ThinkingStartEvent],
            "an explicit thinking block opens with thinking_start");

        AssertSequence(
            tracker.CloseBlock(StreamSegmentBoundary.ThinkingKind),
            [StreamSegmentBoundary.ThinkingEndEvent],
            "closing a thinking block emits thinking_end");

        AssertSequence(
            tracker.CloseBlock(StreamSegmentBoundary.ThinkingKind),
            [StreamSegmentBoundary.ThinkingEndEvent],
            "a repeated close is idempotent on the wire — the renderer closes segments idempotently");

        AssertSequence(
            tracker.OpenBlock(StreamSegmentBoundary.TextKind),
            [StreamSegmentBoundary.TextStartEvent],
            "a text block after a closed thinking block opens without a stale thinking_end");

        AssertSequence(
            tracker.OpenBlock(StreamSegmentBoundary.ThinkingKind),
            [StreamSegmentBoundary.ThinkingStartEvent],
            "a thinking block after a closed text block opens without a stale boundary");
    }

    private static void RunEndOfStreamSuite()
    {
        var openThinking = new StreamSegmentBoundary();
        openThinking.BeforeDelta(StreamSegmentBoundary.ThinkingKind);
        AssertSequence(
            openThinking.AtEnd(),
            [StreamSegmentBoundary.ThinkingEndEvent],
            "a thinking block still open at the end of the stream is closed");
        AssertSequence(
            openThinking.AtEnd(),
            [],
            "closing at the end of the stream happens once");

        var openText = new StreamSegmentBoundary();
        openText.BeforeDelta(StreamSegmentBoundary.TextKind);
        AssertSequence(
            openText.AtEnd(),
            [],
            "a text block at the end of the stream produces no boundary");

        AssertSequence(
            new StreamSegmentBoundary().AtEnd(),
            [],
            "a stream that produced no block produces no boundary");
    }

    private static void AssertSequence(string[] actual, string[] expected, string message)
    {
        _checks++;
        if (actual.Length != expected.Length || !actual.SequenceEqual(expected))
        {
            throw new InvalidOperationException(
                $"Assertion failed: {message} — expected [{string.Join(", ", expected)}], " +
                $"got [{string.Join(", ", actual)}]");
        }
    }
}

using System.Text.Json;
using WishfulClaw.Agent;
using WishfulClaw.Contracts;

namespace WishfulClaw.CompactionSnapshotRegressionTests;

/// <summary>
/// iter-33 S-95: context compression must implement a ROLLING summary — the result keeps
/// exactly one summary (the new one) and every prior summary folds into it. These checks
/// lock the two rules that used to be wrong:
///   1. PinnedPrefixLen pinned a run of leading summaries into the verbatim prefix, so they
///      never entered the fold and the new summary could not absorb them (1 → 2 → … → 53);
///   2. PartitionFold routed every summary to "kept", and a short summary (under the 1500-char
///      pin budget) additionally matched the small-user-turn rule — so dropping only the first
///      rule would still leak short summaries back into the result.
/// </summary>
internal static class SummaryRollingChecks
{
    private const string Tag = "<compaction-summary>";

    private static int _passed;

    public static void Run()
    {
        var provider = Json("""{"type":"nonexistent-provider","contextLength":200000}""");

        // ── PartitionFold: every summary folds, however short ──────────────
        var shortSummary = SummaryOf("short", repeat: 1);   // far below the 1500-char pin budget
        var longSummary = SummaryOf("long", repeat: 40);    // above it
        var smallUser = AgentRuntimeChatMessage.User("a small user turn");
        var region = new List<AgentRuntimeChatMessage>
        {
            smallUser,
            shortSummary,
            Message("assistant", "assistant work"),
            longSummary,
        };

        var (kept, fold) = ContextCompression.PartitionFold(region, provider);

        AssertEqual(1, kept.Count, "only the small user turn is kept verbatim");
        Assert(ReferenceEquals(kept[0], smallUser), "the kept message is the small user turn");
        AssertEqual(3, fold.Count, "everything else folds");
        Assert(fold.Contains(shortSummary), "a SHORT prior summary folds (it must not leak into kept)");
        Assert(fold.Contains(longSummary), "a long prior summary folds");
        Assert(!kept.Any(IsSummary), "no prior summary survives in kept");

        // ── PinnedPrefixLen: summaries are not pinned into the prefix ──────
        var conversation = new List<AgentRuntimeChatMessage>
        {
            Message("system", "system prompt"),
            smallUser,
            longSummary,
            shortSummary,
            Message("assistant", "later work"),
            AgentRuntimeChatMessage.User("recent tail"),
        };

        AssertEqual(2, ContextCompression.PinnedPrefixLen(conversation, provider),
            "head stops after system + first user; prior summaries are NOT pinned");

        // ── The 53-summary session rolls over in one pass ─────────────────
        var pathological = new List<AgentRuntimeChatMessage>
        {
            Message("system", "system"),
            smallUser,
        };
        for (var i = 0; i < 53; i++)
            pathological.Add(SummaryOf($"summary-{i}", repeat: 3));
        pathological.Add(Message("assistant", new string('x', 600)));

        var head = ContextCompression.PinnedPrefixLen(pathological, provider);
        var (pathKept, pathFold) = ContextCompression.PartitionFold(
            pathological.Skip(head).ToList(), provider);

        AssertEqual(53, pathFold.Count(IsSummary), "all 53 prior summaries fold in a single pass");
        AssertEqual(0, pathKept.Count(IsSummary), "none of the 53 summaries is kept");

        // ── CompactAsync failure path: prior summaries survive, user turns survive ──
        // The summarizer cannot run (unknown provider type), so this exercises the
        // mechanical-digest branch end to end — the branch that MUST keep the old
        // summaries, since the digest itself carries no information.
        var keptUser = AgentRuntimeChatMessage.User("keep me verbatim");
        var failureConversation = new List<AgentRuntimeChatMessage>
        {
            Message("system", "system prompt"),
            AgentRuntimeChatMessage.User("first user turn"),
            SummaryOf("older", repeat: 3),
            SummaryOf("newer", repeat: 3),
            Message("assistant", new string('y', 800)),
            keptUser,
            Message("assistant", new string('z', 800)),
        };

        var outcome = ContextCompression.CompactAsync(
                failureConversation,
                failureConversation.Select(m => Wire(m.Role, m.Text)).ToList(),
                provider,
                SilentRequestContext.Instance,
                CancellationToken.None,
                preserveTail: false)
            .GetAwaiter().GetResult();

        Assert(outcome.Compacted, "a foldable region compacts");
        Assert(outcome.SummarizerFailed, "an unusable provider degrades to the mechanical digest");
        AssertEqual(3, outcome.Conversation.Count(IsSummary),
            "failure path keeps both prior summaries plus the mechanical digest");
        Assert(outcome.Conversation.Any(m => ReferenceEquals(m, keptUser)),
            "failure path keeps the small user turn verbatim");

        Console.WriteLine($"Summary rolling checks passed: {_passed}");
    }

    private static AgentRuntimeChatMessage Message(string role, string text) => new(role, text, [], []);

    private static AgentRuntimeChatMessage SummaryOf(string label, int repeat)
        => AgentRuntimeChatMessage.User(
            $"{Tag}\n{string.Join('\n', Enumerable.Repeat($"{label} content line", repeat))}\n</compaction-summary>");

    private static bool IsSummary(AgentRuntimeChatMessage message)
        => message.Role == "user" && message.Text.TrimStart().StartsWith(Tag, StringComparison.Ordinal);

    private static JsonElement Wire(string role, string text)
    {
        var json = $"{{\"role\":{JsonSerializer.Serialize(role)},\"content\":{JsonSerializer.Serialize(text)}}}";
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private sealed class SilentRequestContext : IWorkerRequestContext
    {
        public static SilentRequestContext Instance { get; } = new();
        public CancellationToken CancellationToken => CancellationToken.None;
        public CancellationToken ConnectionCancellationToken => CancellationToken.None;
        public IWorkerRequestContext ForBackgroundOperation() => this;
        public ValueTask EmitEventAsync<T>(string eventName, T parameters, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo)
            => ValueTask.CompletedTask;
        public ValueTask EmitEventIgnoringCancellationAsync<T>(string eventName, T parameters, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo)
            => ValueTask.CompletedTask;
        public ValueTask EmitMessagePackEventAsync(string eventName, ReadOnlyMemory<byte> payload)
            => ValueTask.CompletedTask;
    }

    private static JsonElement Json(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static void Assert(bool condition, string name)
    {
        if (!condition)
            throw new InvalidOperationException($"Summary rolling check failed: {name}");
        _passed++;
        Console.WriteLine($"PASS: {name}");
    }

    private static void AssertEqual<T>(T expected, T actual, string name)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new InvalidOperationException($"Summary rolling check failed: {name}: expected={expected}, actual={actual}");
        Assert(true, name);
    }
}

using System.Text.Json;
using WishfulClaw.Agent;

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

        Console.WriteLine($"Summary rolling checks passed: {_passed}");
    }

    private static AgentRuntimeChatMessage Message(string role, string text) => new(role, text, [], []);

    private static AgentRuntimeChatMessage SummaryOf(string label, int repeat)
        => AgentRuntimeChatMessage.User(
            $"{Tag}\n{string.Join('\n', Enumerable.Repeat($"{label} content line", repeat))}\n</compaction-summary>");

    private static bool IsSummary(AgentRuntimeChatMessage message)
        => message.Role == "user" && message.Text.TrimStart().StartsWith(Tag, StringComparison.Ordinal);

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

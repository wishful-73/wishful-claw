using System.Text.Json;
using WishfulClaw.Agent;

namespace WishfulClaw.CompactionSnapshotRegressionTests;

/// <summary>
/// S-161: a compaction product must not carry the <em>pre-compaction</em> <c>usage</c>
/// of the messages it kept. ConversationCodec.FindRecentContextUsage reads the tail
/// entry's usage as the compression gate's numerator, so a stale high value left in
/// the tail makes the next send compress an already-compacted context — the case that
/// shows up when a turn is aborted right after compaction, before a fresh usage
/// arrives to overwrite it.
///
/// S-141 fixed the restore path (snapshot wire); this suite locks the in-process path
/// (<c>CompactAsync</c> / <c>TruncateMessages</c>) to the same rule.
/// </summary>
internal static class UsageStripChecks
{
    private static int _passed;

    public static void Run()
    {
        StripUsageDropsOnlyUsage();
        StripUsageLeavesCleanMessagesAlone();
        TruncatedProductCarriesNoUsage();

        Console.WriteLine($"Compaction usage-strip checks passed: {_passed}");
    }

    // ── StripUsage itself ──────────────────────────────────────────────────

    private static void StripUsageDropsOnlyUsage()
    {
        using var doc = JsonDocument.Parse(
            """{"role":"assistant","id":"wc_1","content":"hi","usage":{"contextTokens":144083}}""");
        var stripped = ContextCompression.StripUsage(doc.RootElement);

        AssertFalse(stripped.TryGetProperty("usage", out _), "usage is gone");
        AssertEqual("assistant", stripped.GetProperty("role").GetString(), "role survives");
        AssertEqual("wc_1", stripped.GetProperty("id").GetString(), "id survives");
        AssertEqual("hi", stripped.GetProperty("content").GetString(), "content survives");
    }

    private static void StripUsageLeavesCleanMessagesAlone()
    {
        using var doc = JsonDocument.Parse("""{"role":"user","content":"no usage here"}""");
        var same = ContextCompression.StripUsage(doc.RootElement);
        AssertFalse(same.TryGetProperty("usage", out _), "message without usage stays without one");
        AssertEqual("no usage here", same.GetProperty("content").GetString(), "content untouched");

        using var scalar = JsonDocument.Parse("\"just a string\"");
        var passthrough = ContextCompression.StripUsage(scalar.RootElement);
        AssertEqual(JsonValueKind.String, passthrough.ValueKind, "a non-object is returned as-is");
    }

    // ── The product of a compaction ────────────────────────────────────────

    private static void TruncatedProductCarriesNoUsage()
    {
        // 16 > PreserveHeadCount(2) + PreserveTailCount(12), so truncation really runs.
        var conversation = new List<AgentRuntimeChatMessage>();
        var wire = new List<JsonElement>();
        for (var i = 0; i < 16; i++)
        {
            conversation.Add(AgentRuntimeChatMessage.User($"message {i}"));
            wire.Add(WireWithUsage(i, 144083));
        }

        using var providerDoc = JsonDocument.Parse("{}");
        var (_, newWire) = ContextCompression.TruncateMessages(conversation, wire, providerDoc.RootElement);

        AssertEqual(14, newWire.Count, "head(2) + tail(12) are kept");

        for (var i = 0; i < newWire.Count; i++)
        {
            AssertFalse(newWire[i].TryGetProperty("usage", out _), $"kept message #{i} carries no usage");
        }
    }

    private static JsonElement WireWithUsage(int index, long contextTokens)
    {
        var json = "{\"role\":\"user\",\"id\":\"wc_" + index + "\",\"content\":\"message " + index
            + "\",\"usage\":{\"contextTokens\":" + contextTokens + "}}";
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    // ── Assertions ─────────────────────────────────────────────────────────

    private static void AssertEqual(object? expected, object? actual, string name)
    {
        if (!Equals(expected, actual))
        {
            throw new InvalidOperationException(
                $"Usage strip check failed: {name}\r\n  expected: {expected ?? "<null>"}\r\n  actual:   {actual ?? "<null>"}");
        }

        _passed++;
    }

    private static void AssertFalse(bool value, string name)
    {
        if (value)
        {
            throw new InvalidOperationException($"Usage strip check failed: {name}");
        }

        _passed++;
    }
}

using WishfulClaw.Agent;

namespace WishfulClaw.CompactionSnapshotRegressionTests;

/// <summary>
/// iter-29 T-13: the renderer stores a collapsed long paste as a
/// <c>&lt;pasted-block&gt;{"label":…,"text":…}&lt;/pasted-block&gt;</c> chip so the transcript can
/// collapse it (the payload is JSON with <c>&amp;lt;</c>/<c>&amp;gt;</c>/<c>&amp;amp;</c> escaped).
/// This suite locks down the restore-side counterpunch: the model must be handed the
/// verbatim body, and a payload we cannot parse must never cost us the surrounding text.
/// </summary>
internal static class PastedBlockRestoreChecks
{
    private static int _passed;

    public static void Run()
    {
        // ── Untouched paths ────────────────────────────────────────────────
        AssertEqual("hello world", SessionRestoreTools.ExpandPastedBlocks("hello world"),
            "plain text passes through");
        AssertEqual(string.Empty, SessionRestoreTools.ExpandPastedBlocks(""),
            "empty text stays empty");
        AssertEqual(string.Empty, SessionRestoreTools.ExpandPastedBlocks(null),
            "null becomes empty");

        // ── Round trip: escaped chip -> verbatim body ──────────────────────
        // Mirrors createPastedBlockTag: JSON.stringify then &/</> escaping.
        const string tag =
            "<pasted-block>{\"label\":\"paste \\u00b7 2 lines\",\"text\":\"line1\\nline2 &lt;b&gt; &amp; more\"}</pasted-block>";
        AssertEqual("line1\nline2 <b> & more", SessionRestoreTools.ExpandPastedBlocks(tag),
            "escaped payload decodes back to the verbatim body");

        // ── Only pastes are rewritten ──────────────────────────────────────
        const string fileTag = "<select-file>src/a.ts</select-file>";
        AssertEqual(
            $"see {fileTag} then:\nline1\nline2 <b> & more\nend",
            SessionRestoreTools.ExpandPastedBlocks($"see {fileTag} then:\n{tag}\nend"),
            "select-file tags stay raw while the paste expands");
        AssertEqual(fileTag, SessionRestoreTools.ExpandPastedBlocks(fileTag),
            "a message without pastes is unchanged");

        // ── Malformed payloads never drop text ─────────────────────────────
        const string malformed = "<pasted-block>not json</pasted-block>";
        AssertEqual(malformed, SessionRestoreTools.ExpandPastedBlocks(malformed),
            "unparsable payload is left untouched");
        const string noBody = "<pasted-block>{\"label\":\"x\"}</pasted-block>";
        AssertEqual(noBody, SessionRestoreTools.ExpandPastedBlocks(noBody),
            "payload without a body is left untouched");
        const string unclosed = "<pasted-block>{\"text\":\"x\"}";
        AssertEqual(unclosed, SessionRestoreTools.ExpandPastedBlocks(unclosed),
            "unclosed tag is left untouched");
        AssertEqual($"before {malformed} after", SessionRestoreTools.ExpandPastedBlocks($"before {malformed} after"),
            "surrounding text survives a malformed tag");

        // ── Multiple pastes in one message ─────────────────────────────────
        const string two =
            "<pasted-block>{\"text\":\"AAA\"}</pasted-block> / <pasted-block>{\"text\":\"BBB\"}</pasted-block>";
        AssertEqual("AAA / BBB", SessionRestoreTools.ExpandPastedBlocks(two),
            "every paste in a message is expanded");

        Console.WriteLine($"Pasted block restore checks passed: {_passed}");
    }

    private static void AssertEqual(string expected, string actual, string name)
    {
        if (!string.Equals(expected, actual, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Pasted block restore check failed: {name}\n  expected: {Show(expected)}\n  actual:   {Show(actual)}");
        }

        _passed++;
    }

    private static string Show(string value)
    {
        return value.Replace("\r", "\\r").Replace("\n", "\\n");
    }
}

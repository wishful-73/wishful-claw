using System.Text;
using WishfulClaw.Agent;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.ProviderHeaderRegressionTests;

/// <summary>
/// R-3.3 verification support: snapshots the visible tool set for every preset × run-context
/// combination, so a refactor of the admission logic can be proven to change nothing.
///
/// The B-scope rule for this iteration is "mechanism only, zero behaviour change". An eyeball review
/// cannot establish that across ~7 presets × ~13 contexts, so the sweep prints a stable digest that
/// can be diffed before and after the change.
/// </summary>
internal static class VisibilitySnapshot
{
    /// <summary>
    /// Run contexts covering the R-3.C scenarios. Kept as raw JSON so the snapshot exercises
    /// <c>AgentRunContextPolicy.Resolve</c> the same way production does, rather than constructing
    /// an <c>AgentRunContext</c> directly and bypassing the normalization under test.
    ///
    /// Each label must be the 档 that actually resolves. A project context without
    /// <c>collaborationMode</c> normalizes to <c>cowork</c>, so omitting the field here would make a
    /// "project:chat" row a silent duplicate of the cowork row — which is how the project chat
    /// allowlist branch escaped coverage the first time. Only <c>project:cowork-by-default</c> may
    /// omit it, and only because pinning that normalization is its job.
    /// </summary>
    private static readonly (string Name, string Json)[] Scenarios =
    [
        ("project:chat", """{"sessionMode":"chat","scope":"project","projectId":"p1","collaborationMode":"chat"}"""),
        ("project:cowork", """{"sessionMode":"agent","scope":"project","projectId":"p1","collaborationMode":"cowork"}"""),
        ("project:cowork-by-default", """{"sessionMode":"chat","scope":"project","projectId":"p1"}"""),
        ("global:chat", """{"sessionMode":"global","scope":"global"}"""),
        ("global:channel", """{"sessionMode":"channel","channelSession":true,"scope":"global","pluginId":"feishu","externalChatId":"oc_1"}"""),
        ("global:chat@subagent", """{"sessionMode":"subAgent","scope":"global"}"""),
        ("project:chat@subagent", """{"sessionMode":"subAgent","scope":"project","projectId":"p1","collaborationMode":"chat"}"""),
        ("project:cowork@subagent", """{"sessionMode":"subAgent","scope":"project","projectId":"p1","collaborationMode":"cowork"}"""),
        ("project:cowork@goalrunner", """{"sessionMode":"goal","scope":"project","projectId":"p1","collaborationMode":"cowork"}"""),
        ("project:cowork@goalsubagent", """{"sessionMode":"goalSubAgent","scope":"project","projectId":"p1","collaborationMode":"cowork"}"""),
        ("global:chat@automation", """{"sessionMode":"global","scope":"global","runtimeRole":"automation"}"""),
        ("project:cowork@automation", """{"sessionMode":"agent","scope":"project","projectId":"p1","collaborationMode":"cowork","runtimeRole":"automation"}"""),
        ("global:chat@pet", """{"sessionMode":"global","scope":"global","runtimeRole":"pet"}"""),
        ("project:chat@providerturn", """{"sessionMode":"chat","scope":"project","projectId":"p1","collaborationMode":"chat","runtimeRole":"providerturn"}"""),
        ("project:chat@translation", """{"sessionMode":"chat","scope":"project","projectId":"p1","collaborationMode":"chat","runtimeRole":"translation"}"""),
    ];

    private static readonly string[] Presets = ["full", "chat", "coding", "channel", "automation", "minimal", "skill-installer"];

    /// <summary>
    /// One swept run context, resolved exactly the way production resolves it.
    ///
    /// <see cref="ContextString"/> is carried alongside so other suites (the declaration census) can
    /// ask "does this pattern match any context we actually sweep" without re-deriving the vocabulary.
    /// </summary>
    internal readonly record struct Scenario(
        string Name,
        AgentRunContext Context,
        bool ChannelSession,
        string AvailableMode,
        string ContextString);

    /// <summary>
    /// Resolves <see cref="Scenarios"/> through <c>AgentRunContextPolicy</c> — the same call sequence
    /// <see cref="Build"/> uses, so the sweep and any consumer of it share one vocabulary of contexts.
    /// </summary>
    internal static IReadOnlyList<Scenario> ResolveScenarios()
    {
        var resolved = new List<Scenario>(Scenarios.Length);

        foreach (var (name, json) in Scenarios)
        {
            var parameters = Parse(json);
            var context = AgentRunContextPolicy.Resolve(parameters);
            var channelSession = AgentRunContextPolicy.IsChannelSession(parameters);
            resolved.Add(new Scenario(
                name,
                context,
                channelSession,
                AgentRunContextPolicy.ResolveAvailableMode(parameters, context),
                ToolVisibilityPolicy.RenderContext(context, channelSession)));
        }

        return resolved;
    }

    /// <summary>
    /// Builds the full digest: for each preset × scenario, the sorted list of tool names that survive
    /// both the preset filter and the admission filter.
    /// </summary>
    public static string Build(ToolRegistry registry)
    {
        var builder = new StringBuilder();
        var scenarios = ResolveScenarios();

        foreach (var presetId in Presets)
        {
            var preset = ToolPreset.BuiltIn[presetId];
            builder.Append("preset=").Append(presetId).Append('\n');

            foreach (var scenario in scenarios)
            {
                var presetVisible = registry.GetToolDefinitions(preset, scenario.AvailableMode);
                var admitted = AgentRunContextPolicy.FilterToolDefinitions(
                    presetVisible, registry, scenario.Context, scenario.ChannelSession);

                var names = admitted
                    .Select(definition => definition.Name)
                    .OrderBy(value => value, StringComparer.Ordinal)
                    .ToList();

                builder.Append("  ").Append(scenario.Name).Append(" = ").Append(names.Count).Append(" [")
                    .Append(string.Join(",", names)).Append("]\n");
            }
        }

        return builder.ToString();
    }

    /// <summary>
    /// Checked-in digest of the visible tool sets, copied to the output directory by the csproj.
    /// </summary>
    public const string ExpectedFileName = "visibility-snapshot.expected.txt";

    /// <summary>
    /// Guards the B-scope rule ("mechanism only") against future sessions, not just the one refactor
    /// it was introduced for. A visible-set change is only acceptable when it is a deliberate
    /// behaviour change belonging to its own requirement, so the golden has to be rewritten by hand.
    /// </summary>
    public static void AssertMatchesGolden(ToolRegistry registry)
    {
        var goldenPath = Path.Combine(AppContext.BaseDirectory, ExpectedFileName);
        if (!File.Exists(goldenPath))
        {
            throw new InvalidOperationException(
                $"Golden visibility snapshot is missing at {goldenPath}. " +
                $"Regenerate with: --dump-snapshot <test project>/{ExpectedFileName}");
        }

        // Checked-in golden goes through git's line-ending normalization, while Build() always emits
        // '\n'. Without this a CRLF checkout would read as every line differing at once.
        var expected = File.ReadAllText(goldenPath).Replace("\r\n", "\n");
        var actual = Build(registry);
        AssertNonTrivial(actual);

        if (string.Equals(expected, actual, StringComparison.Ordinal))
        {
            return;
        }

        throw new InvalidOperationException(
            "Visible tool sets changed against the golden snapshot. If this is a deliberate " +
            "behaviour change, regenerate the golden file; otherwise the refactor leaked.\n" +
            FirstDifference(expected, actual));
    }

    /// <summary>
    /// Logs the per-context count table, which is the readable form of the same data. Used by the
    /// R-3.3 test to assert the digest is non-trivial (a snapshot that is empty everywhere would
    /// make the before/after comparison meaningless).
    /// </summary>
    public static void AssertNonTrivial(string digest)
    {
        var nonEmpty = 0;

        foreach (var line in digest.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            // Context lines look like: "  project:chat = 27 [Read, Write, ...]".
            var equals = line.IndexOf(" = ", StringComparison.Ordinal);
            if (equals < 0)
            {
                continue;
            }

            var end = line.IndexOf(' ', equals + 3);
            if (end < 0)
            {
                continue;
            }

            if (int.TryParse(line[(equals + 3)..end], out var count) && count > 0)
            {
                nonEmpty++;
            }
        }

        if (nonEmpty < 20)
        {
            throw new InvalidOperationException(
                $"Visibility snapshot is trivial: only {nonEmpty} non-empty context/preset pairs. " +
                "A before/after comparison over this data would prove nothing.");
        }
    }

    private static string FirstDifference(string expected, string actual)
    {
        var expectedLines = expected.Split('\n');
        var actualLines = actual.Split('\n');
        var shared = Math.Min(expectedLines.Length, actualLines.Length);

        for (var i = 0; i < shared; i++)
        {
            if (!string.Equals(expectedLines[i], actualLines[i], StringComparison.Ordinal))
            {
                return $"First difference at line {i + 1}:\n" +
                       $"  expected: {Truncate(expectedLines[i])}\n" +
                       $"  actual:   {Truncate(actualLines[i])}";
            }
        }

        return $"First difference is length: expected {expectedLines.Length} lines, actual {actualLines.Length} lines.";
    }

    private static string Truncate(string line) =>
        line.Length <= 240 ? line : line[..240] + "…";

    private static System.Text.Json.JsonElement Parse(string json)
    {
        using var document = System.Text.Json.JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }
}

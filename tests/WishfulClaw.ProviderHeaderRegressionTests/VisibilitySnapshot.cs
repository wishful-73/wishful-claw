using WishfulClaw.Agent;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.ProviderHeaderRegressionTests;

/// <summary>
/// The R-3.C run-context vocabulary, shared by every visibility suite in this project.
///
/// This used to also carry a golden digest of the per-context direct-injection tool sets
/// (<c>visibility-snapshot.expected.txt</c>). That golden was a one-off safety net for the R-3.3
/// refactor — it proved "mechanism only, zero behaviour change" across ~16 contexts for that single
/// change — and it was dropped once the admission model moved on. What remains is the part that
/// still earns its keep: one shared list of contexts, so the suites cannot drift apart on which
/// contexts they sweep.
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
        // CodeGraph is the first conditionally-core tool: eligible for direct injection, but its
        // run-level switch has to be on before it appears. Without a scenario that turns the switch
        // on, no swept context could admit it and the reachability check below could not tell a
        // working gate from a broken one.
        ("project:cowork@codegraph", """{"sessionMode":"agent","scope":"project","projectId":"p1","collaborationMode":"cowork","codegraphEnabled":true}"""),
        ("project:cowork-by-default", """{"sessionMode":"chat","scope":"project","projectId":"p1"}"""),
        ("global:chat", """{"sessionMode":"global","scope":"global"}"""),
        ("global:channel", """{"sessionMode":"channel","channelSession":true,"scope":"global","pluginId":"feishu","externalChatId":"oc_1"}"""),
        ("global:chat@subagent", """{"sessionMode":"subAgent","scope":"global"}"""),
        ("project:chat@subagent", """{"sessionMode":"subAgent","scope":"project","projectId":"p1","collaborationMode":"chat"}"""),
        ("project:cowork@subagent", """{"sessionMode":"subAgent","scope":"project","projectId":"p1","collaborationMode":"cowork"}"""),
        ("project:cowork@goalrunner", """{"sessionMode":"goal","scope":"project","projectId":"p1","collaborationMode":"cowork"}"""),
        ("project:cowork@goalsubagent", """{"sessionMode":"goalSubAgent","scope":"project","projectId":"p1","collaborationMode":"cowork"}"""),
        ("global:cowork@automation", """{"sessionMode":"global","scope":"global","runtimeRole":"automation"}"""),
        ("project:cowork@automation", """{"sessionMode":"agent","scope":"project","projectId":"p1","collaborationMode":"cowork","runtimeRole":"automation"}"""),
        ("global:chat@pet", """{"sessionMode":"global","scope":"global","runtimeRole":"pet"}"""),
        ("project:chat@providerturn", """{"sessionMode":"chat","scope":"project","projectId":"p1","collaborationMode":"chat","runtimeRole":"providerturn"}"""),
        ("project:chat@translation", """{"sessionMode":"chat","scope":"project","projectId":"p1","collaborationMode":"chat","runtimeRole":"translation"}"""),
    ];

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
    /// Resolves <see cref="Scenarios"/> through <c>AgentRunContextPolicy</c>, so every consumer
    /// shares one vocabulary of contexts rather than re-deriving it.
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

    private static System.Text.Json.JsonElement Parse(string json)
    {
        using var document = System.Text.Json.JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }
}

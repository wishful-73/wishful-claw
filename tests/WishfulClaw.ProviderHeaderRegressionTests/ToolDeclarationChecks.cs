using System.Text.Json;
using WishfulClaw.Agent;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.ProviderHeaderRegressionTests;

/// <summary>
/// R-3.1 regression checks: the declaration fields <c>VisibleScopes</c> / <c>IsCore</c> must
/// survive the trip executor → registry → ToolDefinition, and their defaults must stay
/// permissive so adding a tool never silently loses it.
///
/// These checks are deliberately about the *declaration layer* only. Whether a declaration is
/// enforced is decided by the single visibility entry point (later R-3 steps), so nothing here
/// asserts visibility behaviour.
/// </summary>
internal static class ToolDeclarationChecks
{
    public static void Run()
    {
        RunDefaultSemanticsSuite();
        RunPlaceholderPassthroughSuite();
        RunRegistryPassthroughSuite();
        RunShellDeclarationSuite();
        RunUncategorizedPassesThroughSuite();
        RunCapabilityCatalogSuite();
        RunCoreCategoryReachableSuite();
        CodeGraphGateChecks.Run();
        RunDeclarationCensusSuite();
    }

    /// <summary>
    /// Census over the <i>production</i> registry, now that the declaration is the only mechanism.
    ///
    /// Two failures matter. A tool that declares nothing used to fall back onto central name tables;
    /// with those gone it is visible in every run, including the unattended ones, so silence is a leak
    /// and has to fail the build. And a pattern no swept context can match ("golbal:chat", a renamed
    /// segment, a stale copy-paste) sits in the source looking authoritative while the tool quietly
    /// never gets its grant — the synthetic suites above prove the matching algorithm, only this
    /// census notices dead text.
    /// </summary>
    private static void RunDeclarationCensusSuite()
    {
        var registry = VisibilitySnapshotDump.BuildProductionRegistry();
        var scenarios = VisibilitySnapshot.ResolveScenarios();
        var undeclared = new List<string>();

        foreach (var definition in registry.GetToolDefinitions())
        {
            var visibleScopes = definition.VisibleScopes;
            var excludedScopes = definition.ExcludedScopes;

            if (visibleScopes is null or { Length: 0 } && excludedScopes is null or { Length: 0 })
            {
                undeclared.Add(definition.Name);
                continue;
            }

            foreach (var pattern in (visibleScopes ?? []).Concat(excludedScopes ?? []))
            {
                Assert(
                    scenarios.Any(scenario => ToolVisibilityPolicy.MatchesPattern(pattern, scenario.ContextString)),
                    $"declaration \"{pattern}\" on {definition.Name} matches none of the " +
                    $"{scenarios.Count} swept run contexts — it is stale, mistyped, or a new context " +
                    "needs adding to VisibilitySnapshot.Scenarios");
            }

            Assert(
                scenarios.Any(scenario => ToolVisibilityPolicy.IsVisible(
                    scenario.Context, scenario.ChannelSession, visibleScopes, excludedScopes)),
                $"{definition.Name} declares [{string.Join(", ", visibleScopes ?? [])}] with " +
                $"[{string.Join(", ", excludedScopes ?? [])}] vetoed yet is visible in no swept context — " +
                "its own declarations make it unreachable");
        }

        Assert(undeclared.Count == 0,
            $"{undeclared.Count} production tool(s) declare no visibility at all and are therefore visible " +
            $"in every run: {string.Join(", ", undeclared)}. Each tool must state where it belongs " +
            "(ToolVisibilityScopes for the shared shapes, an inline pattern for a one-off).");
    }

    /// <summary>
    /// The two defaults that make this change behaviour-neutral: an undeclared tool is visible
    /// everywhere (null, not "denied"), and it is not core (no prompt space claimed).
    /// </summary>
    private static void RunDefaultSemanticsSuite()
    {
        var definition = new ToolDefinition("X", "d", Schema());

        Assert(definition.VisibleScopes is null, "undeclared ToolDefinition.VisibleScopes is null (= visible everywhere)");
        Assert(!definition.IsCore, "undeclared ToolDefinition.IsCore is false (= not in the prompt core set)");
        Assert(definition.AvailableModes is null, "existing AvailableModes default is unchanged");

        // Positional compatibility: the two new parameters are appended, so every existing
        // 6-argument call site keeps compiling and keeps its meaning.
        var positional = new ToolDefinition("X", "d", Schema(), ["normal"], "file", 10);
        Assert(positional.VisibleScopes is null, "6-argument construction still leaves VisibleScopes null");
        Assert(!positional.IsCore, "6-argument construction still leaves IsCore false");
    }

    private static void RunPlaceholderPassthroughSuite()
    {
        var bare = new ToolDefinitionPlaceholder("Bare", "d", Schema());
        Assert(bare.VisibleScopes is null, "placeholder without the new arguments reports VisibleScopes null");
        Assert(!bare.IsCore, "placeholder without the new arguments reports IsCore false");

        var declared = new ToolDefinitionPlaceholder(
            "Declared", "d", Schema(), ["normal"], ["project:cowork", "*:chat@subagent"], isCore: true);
        Assert(declared.VisibleScopes is { Length: 2 }, "placeholder carries the declared VisibleScopes");
        Assert(declared.VisibleScopes![0] == "project:cowork", "placeholder preserves VisibleScopes order");
        Assert(declared.IsCore, "placeholder carries the declared IsCore");

        // Regression guard for the older 4-argument form used by ~100 providers.
        var legacy = new ToolDefinitionPlaceholder("Legacy", "d", Schema(), ["global"]);
        Assert(legacy.AvailableModes is { Length: 1 } && legacy.AvailableModes![0] == "global",
            "legacy 4-argument form still sets AvailableModes");
        Assert(legacy.VisibleScopes is null && !legacy.IsCore,
            "legacy 4-argument form leaves the new fields at their defaults");
    }

    private static void RunRegistryPassthroughSuite()
    {
        var registry = new ToolRegistry();
        registry.Register(new ToolDefinitionPlaceholder(
            "Scoped", "d", Schema(), ["normal"], ["project:cowork"], isCore: true), "file");
        registry.Register(new ToolDefinitionPlaceholder("Plain", "d", Schema()), "search");

        var byName = registry.GetToolDefinitions().ToDictionary(d => d.Name, StringComparer.Ordinal);

        var scoped = byName["Scoped"];
        Assert(scoped.VisibleScopes is { Length: 1 } && scoped.VisibleScopes![0] == "project:cowork",
            "registry propagates VisibleScopes to ToolDefinition");
        Assert(scoped.IsCore, "registry propagates IsCore to ToolDefinition");
        Assert(scoped.Category == "file", "registry still stamps Category alongside the new fields");

        var plain = byName["Plain"];
        Assert(plain.VisibleScopes is null, "registry leaves an undeclared tool's VisibleScopes null");
        Assert(!plain.IsCore, "registry leaves an undeclared tool's IsCore false");
    }

    /// <summary>
    /// Bash uses the same declaration path as every other tool: core-ness is metadata and the shared
    /// all-context scope is enforced by the ordinary visibility policy.
    /// </summary>
    private static void RunShellDeclarationSuite()
    {
        var registry = VisibilitySnapshotDump.BuildProductionRegistry();
        var shell = registry.GetToolDefinitions().Single(definition => definition.Name == "Bash");

        Assert(shell.IsCore, "Bash is part of the core tool set");
        Assert(shell.VisibleScopes is { Length: 1 } && shell.VisibleScopes[0] == "*",
            "Bash declares visibility in every run context through the shared scope");

        foreach (var scenario in VisibilitySnapshot.ResolveScenarios())
        {
            Assert(ToolVisibilityPolicy.IsVisible(
                    scenario.Context, scenario.ChannelSession, shell.VisibleScopes, shell.ExcludedScopes),
                $"Bash is visible in {scenario.ContextString}");
        }
    }

    /// <summary>
    /// A tool registered without a category still travels through the registry with its new fields
    /// intact — the category lookup is a separate axis and must not gate the declarations.
    /// </summary>
    private static void RunUncategorizedPassesThroughSuite()
    {
        var registry = new ToolRegistry();
        registry.Register(new ToolDefinitionPlaceholder(
            "NoCategory", "d", Schema(), null, ["global:chat"], isCore: true));

        var definition = registry.GetToolDefinitions().Single();

        Assert(definition.Category is null, "uncategorized tool keeps a null category");
        Assert(definition.Priority == ToolCategoryCatalog.UnknownPriority,
            "uncategorized tool falls back to the unknown priority");
        Assert(definition.VisibleScopes is { Length: 1 } && definition.VisibleScopes![0] == "global:chat",
            "uncategorized tool still carries VisibleScopes");
        Assert(definition.IsCore, "uncategorized tool still carries IsCore");
    }

    /// <summary>
    /// R-3.8b regression checks: the description's category directory is derived from the same
    /// catalog/proxy intersection and run-context predicate used by proxy discovery. A scoped tool
    /// disappearing from the list must disappear from the description at the same time.
    /// </summary>
    private static void RunCapabilityCatalogSuite()
    {
        var registry = new ToolRegistry();
        // The fixture carries the same veto production declares on its browser tools: the shared
        // sub-agent exclusion is a declaration now, not a rule the visibility layer knows by name.
        registry.Register(new ToolDefinitionPlaceholder(
            "BrowserNavigate", "browser", Schema(), excludedScopes: ToolVisibilityScopes.UnattendedRoles), "browser");
        registry.Register(new ToolDefinitionPlaceholder("list_goals", "goals", Schema()), "goal");
        registry.Register(new ToolDefinitionPlaceholder(
            "list_projects", "plugin", Schema(), null, ["global:chat"]), "plugin");

        var projectContext = new AgentRunContext("project", "cowork", "sessionagent");
        var visible = AgentRuntimeUseCapabilityExecutor.GetVisibleProxiedCategoryNames(
            registry, projectContext, "normal", channelSession: false);
        Assert(visible.SequenceEqual(["browser", "goal"]),
            "visible proxy categories follow ToolCategoryCatalog order and include only visible registered categories");

        var description = AgentRuntimeUseCapabilityExecutor.BuildCapabilityDescription(
            registry, projectContext, "normal", channelSession: false);
        Assert(description.Contains("browser, goal", StringComparison.Ordinal),
            "use_capability description uses the visible proxy category directory");

        var subAgentContext = new AgentRunContext("project", "cowork", "subagent");
        var subAgentDescription = AgentRuntimeUseCapabilityExecutor.BuildCapabilityDescription(
            registry, subAgentContext, "subAgent", channelSession: false);
        Assert(!subAgentDescription.Contains("browser", StringComparison.Ordinal),
            "a sub-agent description omits the foreground-browser category rejected by action=list");

        var globalContext = new AgentRunContext("global", "chat", "sessionagent");
        var globalDescription = AgentRuntimeUseCapabilityExecutor.BuildCapabilityDescription(
            registry, globalContext, "global", channelSession: false);
        Assert(globalDescription.Contains("plugin", StringComparison.Ordinal),
            "a category declared for global:chat appears in the global description");
        Assert(globalDescription.Contains("browser, plugin, goal", StringComparison.Ordinal),
            "the description is recomputed for the active run context rather than reused globally");

        var catalogNames = ToolCategoryCatalog.All
            .Where(category => AgentRuntimeUseCapabilityExecutor.GetProxiedCategoryNames()
                .Contains(category.Name, StringComparer.OrdinalIgnoreCase))
            .Select(category => category.Name)
            .ToArray();
        Assert(AgentRuntimeUseCapabilityExecutor.GetProxiedCategoryNames().SequenceEqual(catalogNames),
            "proxy category names are the ToolCategoryCatalog intersection, not a second display list");
    }

    /// <summary>
    /// A category marked core claims permanent space in the direct tool list, so at least one of its
    /// tools has to survive the whole admission chain in a run that actually does work. Only the run
    /// context's scope veto can drop one now. A category that clears the registry's <c>IsCore</c> but
    /// reaches no real session is reachable on <i>neither</i> surface: direct injection is where it
    /// belongs, and the <c>use_capability</c> proxy hides everything that is core.
    ///
    /// Splitting <c>todo</c> out of <c>task</c> did exactly that. The registry read as core, the proxy
    /// list hid it for that reason, and the session preset of the day still filtered it out, so the tool
    /// was invisible in a real session while every piece of evidence looked self-consistent. That failure
    /// needed two admission layers to happen at all, which is why iter-30 deleted the allowlist half:
    /// the rule below is anchored on the swept run contexts — what production actually resolves — not on
    /// a preset name.
    /// </summary>
    private static void RunCoreCategoryReachableSuite()
    {
        var registry = VisibilitySnapshotDump.BuildProductionRegistry();
        var scenarios = VisibilitySnapshot.ResolveScenarios();

        // The run contexts an ordinary session actually resolves to. A core category only has to reach
        // one of them — plan tools, for instance, are work-only by declaration and are absent from the
        // plain chat context on purpose. The CodeGraph row is the same idea for a run-level switch
        // instead of a declaration: the category is core, but only a run that turned the switch on can
        // admit it, so the switch-on context has to be swept or the check would demand the impossible.
        string[] sessionContexts = ["project:chat", "project:cowork", "project:cowork@codegraph"];

        var admittedCategories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var contextName in sessionContexts)
        {
            var scenario = scenarios.Single(item => item.Name == contextName);
            var admitted = AgentRunContextPolicy.ResolveDirectInjection(
                registry, scenario.AvailableMode, scenario.Context, scenario.ChannelSession);

            foreach (var category in admitted.Select(definition => registry.GetCategory(definition.Name)))
            {
                if (category is not null)
                {
                    admittedCategories.Add(category);
                }
            }
        }

        foreach (var category in ToolCategoryCatalog.Core)
        {
            Assert(admittedCategories.Contains(category),
                $"core category \"{category}\" reaches no direct tool in " +
                $"{string.Join(" / ", sessionContexts)}: every tool in it is filtered out, so the " +
                "category would be core in the registry and unreachable in a real session");
        }
    }

    private static JsonElement Schema()
    {
        using var document = JsonDocument.Parse("""{"type":"object"}""");
        return document.RootElement.Clone();
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException($"Assertion failed: {message}");
        }
    }
}

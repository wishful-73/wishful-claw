using System.Text.Json;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

internal readonly record struct AgentRunContext(
    string Scope,
    string CollaborationMode,
    string RuntimeRole,
    bool CodegraphEnabled = false);

/// <summary>
/// Turns a worker request into the run context the admission check reads, and answers "is this tool
/// allowed in this run?".
///
/// The answer comes from the tool's own declarations and nothing else (R-3): <c>VisibleScopes</c>
/// grants, <c>ExcludedScopes</c> vetoes, no declaration means visible. This type used to keep four
/// more name tables beside that — a per-role bypass plus a chat allowlist per scope — and every one of
/// them was a second opinion about tools that had already stated where they belong. They are gone, so
/// adding a tool means declaring its own scopes and there is no central list to remember.
/// </summary>
internal static class AgentRunContextPolicy
{
    public static AgentRunContext Resolve(JsonElement parameters)
    {
        var sessionMode = Normalize(JsonHelpers.GetString(parameters, "sessionMode")) switch
        {
            "agent" or "chat" => "normal",
            var mode => mode
        };
        var projectId = Normalize(JsonHelpers.GetString(parameters, "projectId"));
        var workingFolder = Normalize(JsonHelpers.GetString(parameters, "workingFolder"));
        var scope = Normalize(JsonHelpers.GetString(parameters, "scope"));
        if (sessionMode == "channel")
        {
            // A channel is a global session whose replies leave through a chat plugin: same scope
            // and same available-mode as global, plus channel-only tools and no interactive ones.
            scope = "global";
        }
        else if (scope is not ("global" or "project"))
        {
            scope = sessionMode == "global" || (projectId.Length == 0 && workingFolder.Length == 0)
                ? "global"
                : "project";
            WorkerLog.Warn($"AgentRunContextPolicy: inferred scope={scope}; callers should provide an explicit scope");
        }
        else if (scope == "project" && projectId.Length == 0)
        {
            throw new InvalidOperationException("scope=project requires projectId");
        }

        var collaborationMode = Normalize(JsonHelpers.GetString(parameters, "collaborationMode"));
        if (scope == "global")
        {
            collaborationMode = "chat";
        }
        else if (collaborationMode is not ("chat" or "cowork"))
        {
            collaborationMode = "cowork";
        }

        var runtimeRole = Normalize(JsonHelpers.GetString(parameters, "runtimeRole"));

        // A background automation run is a work run: it was asked to do a job on its own, so it gets
        // the same breadth a cowork session has, including in the global scope where it has no project
        // of its own. The other unattended roles (pet, translation, providerTurn) ask for "chat"
        // already and need no mapping.
        if (runtimeRole == "automation")
        {
            collaborationMode = "cowork";
        }

        if (runtimeRole.Length == 0)
        {
            runtimeRole = sessionMode switch
            {
                "goal" => "goalrunner",
                "subagent" => "subagent",
                "goalsubagent" => "goalsubagent",
                _ => "sessionagent"
            };
        }

        return new AgentRunContext(
            scope,
            collaborationMode,
            runtimeRole,
            JsonHelpers.GetBool(parameters, "codegraphEnabled", false));
    }

    public static string ResolveAvailableMode(JsonElement parameters, AgentRunContext context)
    {
        var sessionMode = Normalize(JsonHelpers.GetString(parameters, "sessionMode"));
        if (sessionMode is "agent" or "chat")
            return "normal";
        // A channel is a global session with extra tools, not a fourth mode. Resolve already forces
        // its scope to "global"; returning the literal here was the one layer that disagreed, and
        // it silently dropped every tool whose availableModes says "global".
        if (sessionMode == "channel")
            return "global";
        if (sessionMode.Length > 0)
            return sessionMode;

        if (context.Scope == "global")
            return "global";

        return context.RuntimeRole switch
        {
            "goalrunner" => "goal",
            "subagent" => "subAgent",
            "goalsubagent" => "goalSubAgent",
            _ => "normal"
        };
    }

    /// <summary>
    /// Whether this run answers a message that arrived from a messaging channel.
    ///
    /// Only the inbound paths count, and both say so on the request. Inferring it from <c>pluginId</c>
    /// also caught a scheduled task that merely *delivers* its result into a chat — that run is a work
    /// run, and rendering it as a channel hid every write tool from it.
    /// </summary>
    public static bool IsChannelSession(JsonElement parameters) =>
        JsonHelpers.GetBool(parameters, "channelSession", false) ||
        Normalize(JsonHelpers.GetString(parameters, "sessionMode")) == "channel";

    /// <summary>
    /// Admission check for a single tool in a single run context.
    ///
    /// This is the enforcement layer, not the declaration layer, and it holds no opinion of its own:
    /// it reads both declarations off the registered executor and hands them to
    /// <see cref="ToolVisibilityPolicy"/>. The registry is therefore required — a call site that
    /// dropped it would not crash, it would read every tool as undeclared and admit all of them.
    /// </summary>
    public static bool IsToolAllowed(
        AgentRunContext context,
        string toolName,
        ToolRegistry? registry,
        bool channelSession = false)
    {
        if (registry is not null && registry.TryGetExecutor(toolName, out var executor) && executor is not null)
        {
            return ToolVisibilityPolicy.IsVisible(
                context,
                channelSession,
                executor.VisibleScopes,
                executor.ExcludedScopes);
        }

        // Unknown name: an MCP or skill tool registered after the snapshot, or a call the model
        // invented. Nothing declared it away, so the default-visible rule decides.
        return ToolVisibilityPolicy.IsVisible(context, channelSession, visibleScopes: null, excludedScopes: null);
    }

    public static IReadOnlyList<ToolDefinition> FilterToolDefinitions(
        IReadOnlyList<ToolDefinition> definitions,
        ToolRegistry? registry,
        AgentRunContext context,
        bool channelSession = false)
    {
        var filtered = new List<ToolDefinition>(definitions.Count);
        foreach (var definition in definitions)
        {
            if (IsToolAllowed(context, definition.Name, registry, channelSession))
            {
                filtered.Add(definition);
            }
        }
        return filtered;
    }

    /// <summary>
    /// The direct-injection pipeline, in one place so the AgentLoop and the regression sweep
    /// cannot drift: visibility filters per run context, and <c>IsCore</c> decides what the LLM
    /// actually sees as a direct tool definition (iter-28 tool narrowing). Non-core tools are NOT
    /// lost here — they stay registered and are reached through the <c>use_capability</c> proxy,
    /// which never consults IsCore.
    ///
    /// There is deliberately no scenario allowlist ahead of this. One existed (the pet and
    /// skill-installer narrow lists), and keeping two mechanisms in agreement is what let a core
    /// tool be admitted by one and filtered out by the other.
    /// </summary>
    public static IReadOnlyList<ToolDefinition> ResolveDirectInjection(
        ToolRegistry registry,
        string? sessionMode,
        AgentRunContext context,
        bool channelSession = false)
    {
        var definitions = FilterToolDefinitions(
            registry.GetToolDefinitions(sessionMode), registry, context, channelSession);
        var core = new List<ToolDefinition>(definitions.Count);
        foreach (var definition in definitions)
        {
            if (definition.IsCore)
            {
                core.Add(definition);
            }
        }
        return core;
    }

    private static string Normalize(string? value) => value?.Trim().ToLowerInvariant() ?? string.Empty;
}

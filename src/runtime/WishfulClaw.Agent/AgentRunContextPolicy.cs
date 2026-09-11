using System.Text.Json;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

internal readonly record struct AgentRunContext(
    string Scope,
    string CollaborationMode,
    string RuntimeRole);

internal static class AgentRunContextPolicy
{
    private static readonly HashSet<string> IndependentRuntimeRoles = new(StringComparer.OrdinalIgnoreCase)
    {
        "automation",
        "pet",
        "providerturn",
        "translation"
    };

    private static readonly HashSet<string> SharedChatTools = new(StringComparer.OrdinalIgnoreCase)
    {
        "AskUserQuestion",
        "BrowserGetContent",
        "BrowserNavigate",
        "BrowserScreenshot",
        "BrowserScroll",
        "BrowserSearch",
        "BrowserSnapshot",
        "Glob",
        "Grep",
        "LS",
        "Read",
        "SubAgentDetail",
        "SubAgentStatus",
        "WebFetch",
        "WebSearch",
        "codegraph_explore",
        "get_goal",
        "get_goal_history",
        "get_project_details",
        "list_goals",
        "list_installed_skills",
        "list_projects",
        "memory_hot_read",
        "memory_search",
        "visualize_show_widget",
        "use_capability"
    };

    private static readonly HashSet<string> ProjectChatTools = new(SharedChatTools, StringComparer.OrdinalIgnoreCase)
    {
        "TaskCreate",
        "TaskGet",
        "TaskList",
        "TaskUpdate",
        "reply_global_dispatch"
    };

    private static readonly HashSet<string> GlobalChatTools = new(SharedChatTools, StringComparer.OrdinalIgnoreCase)
    {
        "TaskCreate",
        "TaskGet",
        "TaskList",
        "TaskUpdate",
        "create_global_task",
        "create_session",
        "list_global_dispatches",
        "list_global_tasks",
        "memory_append",
        "memory_hot_write",
        "memory_update",
        "send_session_message",
        "send_work_request",
        "update_dispatch",
        "update_global_task"
    };

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

        return new AgentRunContext(scope, collaborationMode, runtimeRole);
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

    public static bool IsChannelSession(JsonElement parameters) =>
        JsonHelpers.GetBool(parameters, "channelSession", false) ||
        (!string.IsNullOrWhiteSpace(JsonHelpers.GetString(parameters, "pluginId")) &&
         (!string.IsNullOrWhiteSpace(JsonHelpers.GetString(parameters, "externalChatId")) ||
          !string.IsNullOrWhiteSpace(JsonHelpers.GetString(parameters, "pluginChatId"))));

    /// <summary>
    /// Admission check for a single tool in a single run context.
    ///
    /// This is the enforcement layer, not the declaration layer. The declaration
    /// (<see cref="IToolExecutor.VisibleScopes"/>) is authoritative when present: a tool that names
    /// this context owns its own admission, which is what replaced the old per-feature name tables.
    /// Undeclared tools fall through to the chat-scope allowlists, the one rule that still cannot be
    /// expressed at registration time because it has to cover tools registered dynamically
    /// (MCP servers and skills) — see R-3.11's accounting.
    ///
    /// The registry is taken rather than the declaration itself on purpose: a call site that forwarded
    /// the wrong (or no) <c>VisibleScopes</c> would not crash, it would just deny a channel-only tool
    /// and look like a policy change. One lookup cannot be forgotten.
    /// </summary>
    public static bool IsToolAllowed(
        AgentRunContext context,
        string toolName,
        string? category,
        bool channelSession = false,
        ToolRegistry? registry = null)
    {
        var outcome = ToolVisibilityPolicy.Evaluate(
            context,
            channelSession,
            toolName,
            category,
            DeclaredScopesOf(registry, toolName));

        if (outcome == VisibilityOutcome.Blocked)
            return false;
        if (outcome == VisibilityOutcome.Declared)
            return true;

        return IsAllowedByChatAllowlist(context, toolName);
    }

    private static string[]? DeclaredScopesOf(ToolRegistry? registry, string toolName) =>
        registry is not null && registry.TryGetExecutor(toolName, out var executor) && executor is not null
            ? executor.VisibleScopes
            : null;

    /// <summary>
    /// The one place the chat-scope allowlists are consulted.
    ///
    /// Earlier this rule existed twice — once inline in <see cref="IsToolAllowed"/> and once as a
    /// short-circuit in <see cref="FilterToolDefinitions"/> — with subtly different guard conditions.
    /// Both now route through here, so a change to the rule cannot land in one path only.
    /// </summary>
    private static bool IsAllowedByChatAllowlist(AgentRunContext context, string toolName)
    {
        // A channel session reaches here for its undeclared tools only: Resolve() forces its
        // collaboration mode to "chat", which is what routes it to the allowlist rather than to the
        // early return below.
        if (IndependentRuntimeRoles.Contains(context.RuntimeRole))
            return true;

        if (!string.Equals(context.CollaborationMode, "chat", StringComparison.OrdinalIgnoreCase))
            return true;

        return ChatTools(context).Contains(toolName);
    }

    /// <summary>
    /// Whether the run context bypasses the chat-scope allowlists entirely.
    ///
    /// <see cref="FilterToolDefinitions"/> uses this to skip per-tool evaluation, which is why it
    /// must read the same conditions as <see cref="IsAllowedByChatAllowlist"/> rather than restate
    /// them.
    /// </summary>
    private static bool BypassesChatAllowlist(AgentRunContext context) =>
        IndependentRuntimeRoles.Contains(context.RuntimeRole) ||
        !string.Equals(context.CollaborationMode, "chat", StringComparison.OrdinalIgnoreCase);

    private static HashSet<string> ChatTools(AgentRunContext context) =>
        string.Equals(context.Scope, "global", StringComparison.OrdinalIgnoreCase)
            ? GlobalChatTools
            : ProjectChatTools;

    public static IReadOnlyList<ToolDefinition> FilterToolDefinitions(
        IReadOnlyList<ToolDefinition> definitions,
        ToolRegistry? registry,
        AgentRunContext context,
        bool channelSession = false)
    {
        // Same short-circuit as before, but expressed through the shared predicate so it can no
        // longer disagree with IsToolAllowed. A channel session is never bypassed: it has its own
        // allowlist, which is why the flag is part of the condition.
        if (!channelSession && BypassesChatAllowlist(context))
        {
            return definitions;
        }

        var filtered = new List<ToolDefinition>(definitions.Count);
        foreach (var definition in definitions)
        {
            if (IsToolAllowed(
                    context,
                    definition.Name,
                    registry?.GetCategory(definition.Name),
                    channelSession,
                    registry))
            {
                filtered.Add(definition);
            }
        }
        return filtered;
    }

    private static string Normalize(string? value) => value?.Trim().ToLowerInvariant() ?? string.Empty;
}

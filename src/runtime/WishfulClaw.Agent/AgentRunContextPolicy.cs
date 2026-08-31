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
        if (scope is not ("global" or "project"))
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

    public static bool IsToolAllowed(
        AgentRunContext context,
        string toolName,
        string? category)
    {
        if (IndependentRuntimeRoles.Contains(context.RuntimeRole))
            return true;

        if (!string.Equals(context.CollaborationMode, "chat", StringComparison.OrdinalIgnoreCase))
            return true;

        var allowed = string.Equals(context.Scope, "global", StringComparison.OrdinalIgnoreCase)
            ? GlobalChatTools
            : ProjectChatTools;
        return allowed.Contains(toolName);
    }

    public static IReadOnlyList<ToolDefinition> FilterToolDefinitions(
        IReadOnlyList<ToolDefinition> definitions,
        ToolRegistry? registry,
        AgentRunContext context)
    {
        if (IndependentRuntimeRoles.Contains(context.RuntimeRole) ||
            !string.Equals(context.CollaborationMode, "chat", StringComparison.OrdinalIgnoreCase))
        {
            return definitions;
        }

        var filtered = new List<ToolDefinition>(definitions.Count);
        foreach (var definition in definitions)
        {
            if (IsToolAllowed(context, definition.Name, registry?.GetCategory(definition.Name)))
                filtered.Add(definition);
        }
        return filtered;
    }

    private static string Normalize(string? value) => value?.Trim().ToLowerInvariant() ?? string.Empty;
}

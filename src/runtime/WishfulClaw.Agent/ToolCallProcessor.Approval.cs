using System.Text.Json;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Agent;

/// <summary>
/// The approval policy half of <see cref="ToolCallProcessor"/>: which tool calls pause
/// for the user before they run, per run context (main loop / sub-agent / channel session).
/// </summary>
public static partial class ToolCallProcessor
{
    /// <summary>
    /// Tools that require user approval when executed inside a sub-agent.
    /// Sub-agents run autonomously — routine file operations and commands
    /// should NOT require approval. Only interactive tools (like AskUserQuestion)
    /// pause for user input, and those are handled by their own executor, not here.
    /// </summary>
    private static readonly HashSet<string> SubAgentApprovalTools = new(StringComparer.Ordinal)
    {
        // Empty — sub-agents execute tools freely without per-call approval.
        // If specific tools need approval in the future, add them here.
    };

    private static bool RequiresSubAgentApproval(string toolName)
    {
        return SubAgentApprovalTools.Contains(toolName);
    }

    /// <summary>
    /// The shell subset of <see cref="DefaultModeApprovalTools"/>. It is split out because
    /// it is the only group a channel session may waive approval for, and the approval set
    /// is built from it so the two lists cannot drift apart.
    /// </summary>
    private static readonly HashSet<string> ShellApprovalTools = new(StringComparer.Ordinal)
    {
        "Bash", "Shell", "ShellExec", "PowerShell"
    };

    /// <summary>
    /// Tools that require user confirmation in "default" permission mode:
    /// write/delete/execute class operations. Read/search class tools
    /// (Read/Glob/Grep/LS/webfetch/web search/memory search) run freely.
    /// </summary>
    private static readonly HashSet<string> DefaultModeApprovalTools = BuildDefaultModeApprovalTools();

    private static HashSet<string> BuildDefaultModeApprovalTools()
    {
        var tools = new HashSet<string>(StringComparer.Ordinal)
        {
            // File writes (incl. notebook rewrites)
            "Write", "Edit", "NotebookEdit",
            // Desktop input (executes real UI actions on the user's machine)
            "DesktopClick", "DesktopType", "DesktopScroll"
        };
        tools.UnionWith(ShellApprovalTools);
        return tools;
    }

    private static bool RequiresApprovalBeforeExecution(
        AgentRuntimeNativeToolCall toolCall,
        AgentRuntimeRunState state,
        bool defaultModeApproval)
    {
        // fullAccess/YOLO must never pause for approval, including future
        // sub-agent approval rules inherited by the main run.
        if (!defaultModeApproval)
        {
            return false;
        }

        // Channel sessions cannot complete a remote approval dialog. The
        // channel file/image tools are therefore explicitly non-interactive
        // for those runs, while desktop sessions retain their normal policy.
        if (IsChannelSession(state.Parameters) && IsChannelFileTool(toolCall.Name))
        {
            return false;
        }

        // Shell from a channel is the one approval the user can switch off globally:
        // the tool stays visible and callable, only the confirmation step disappears.
        if (IsChannelShellApprovalWaived(toolCall.Name, IsChannelSession(state.Parameters)))
        {
            return false;
        }

        if (state.SuppressTransportEvents && RequiresSubAgentApproval(toolCall.Name))
        {
            return true;
        }

        // Default-mode approval applies to the main agent loop (sub-agents keep
        // their own autonomous policy).
        return defaultModeApproval
            && !state.SuppressTransportEvents
            && IsDefaultModeApprovalTool(toolCall.Name);
    }

    /// <summary>
    /// The three inputs of the channel shell waiver, split out so a regression test can pin
    /// them without constructing a run state. Reads the same store the settings panel writes.
    /// </summary>
    internal static bool IsChannelShellApprovalWaived(string toolName, bool isChannelSession) =>
        isChannelSession && ShellApprovalTools.Contains(toolName) &&
        !GlobalChannelSettingsStore.Read().ShellRequiresApproval;

    /// <summary>
    /// Exposed for the use_capability proxy: a proxied built-in tool must be
    /// checked against the same default-mode approval set as direct calls.
    /// </summary>
    public static bool IsDefaultModeApprovalTool(string toolName)
    {
        return DefaultModeApprovalTools.Contains(toolName);
    }

    private static bool IsChannelSession(JsonElement parameters) =>
        JsonHelpers.GetBool(parameters, "channelSession", false);

    private static bool IsChannelFileTool(string toolName) =>
        toolName is "ChannelSendImage" or "ChannelSendFile" or
                   "WeixinSendImage" or "WeixinSendFile" or
                   "FeishuSendImage" or "FeishuSendFile";
}

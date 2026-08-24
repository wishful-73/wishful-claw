using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// Unified capability executor — handles use_capability tool calls.
///
/// Actions:
///   list    — returns all available MCP servers, their tools, Skills, and proxied built-in tools
///   inspect — returns the input schema for a specific capability
///   call    — executes an MCP tool, Skill, or built-in tool by capability_id
///
/// Capability ID formats:
///   mcp-server:name      — MCP server (inspect only)
///   mcp-tool:server/tool — MCP tool (inspect, call)
///   skill:name           — Skill (inspect, call)
///   builtin:ToolName     — Built-in Worker tool in a proxied category (inspect, call)
///
/// Inspired by Reasonix's UseCapabilityTool.
/// </summary>
internal static partial class AgentRuntimeUseCapabilityExecutor
{
    private const string ToolName = "use_capability";

    /// <summary>
    /// Tool categories that are NOT directly registered in chat/coding presets.
    /// Tools in these categories are accessible only via use_capability.
    /// </summary>
    private static readonly HashSet<string> ProxiedCategories = new(StringComparer.OrdinalIgnoreCase)
    {
        "desktop", "cron", "image-generate",
        "notebook", "widget", "team",
        "channel-plugin", "plugin", "ssh", "skill-management", "project"
    };

    private static readonly HashSet<string> ProxiedBuiltinTools = new(StringComparer.Ordinal)
    {
        "list_goals",
        "get_goal_history",
        "reopen_goal"
    };

    public static bool IsUseCapabilityTool(string toolName)
    {
        return string.Equals(toolName, ToolName, StringComparison.Ordinal);
    }

    public static async Task<string> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        ToolRegistry? registry,
        string? workingFolder,
        string? projectId,
        string? sshConnectionId,
        CancellationToken cancellationToken)
    {
        var action = (JsonHelpers.GetString(call.Input, "action") ?? "list").Trim().ToLowerInvariant();
        var capabilityId = (JsonHelpers.GetString(call.Input, "capability_id") ?? string.Empty).Trim();
        var sessionMode = JsonHelpers.GetString(state.Parameters, "sessionMode");

        return action switch
        {
            "list" => await ListCapabilitiesAsync(call.Input, context, registry, sessionMode, cancellationToken),
            "inspect" => await InspectCapabilityAsync(context, registry, sessionMode, capabilityId, cancellationToken),
            "call" => await CallCapabilityAsync(call, state, context, registry, workingFolder, projectId, sshConnectionId, sessionMode, capabilityId, cancellationToken),
            _ => EncodeError($"Unknown action: {action}. Use list, inspect, or call.")
        };
    }

    // ── list ──

    private static async Task<string> ListCapabilitiesAsync(
        JsonElement input,
        IWorkerRequestContext context,
        ToolRegistry? registry,
        string? sessionMode,
        CancellationToken cancellationToken)
    {
        try
        {
            // Ask renderer for MCP server/tool metadata
            var mcpResult = await AgentRuntimeReverseRequests.RequestAsync(
                context,
                "mcp:capability-list",
                CreateEmptyObject(),
                cancellationToken);

            return EncodeListResponse(mcpResult, registry, sessionMode, ParseListOptions(input));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return EncodeError($"Failed to list capabilities: {ex.Message}");
        }
    }

    // ── inspect ──

    private static async Task<string> InspectCapabilityAsync(
        IWorkerRequestContext context,
        ToolRegistry? registry,
        string? sessionMode,
        string capabilityId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(capabilityId))
        {
            return EncodeError("capability_id is required for action=inspect");
        }

        // MCP tool: mcp-tool:server/toolName
        if (capabilityId.StartsWith("mcp-tool:", StringComparison.Ordinal))
        {
            var (serverId, toolName) = ParseMcpToolId(capabilityId);
            if (serverId is null)
            {
                return EncodeError($"Invalid MCP tool capability_id: {capabilityId}");
            }

            try
            {
                var result = await AgentRuntimeReverseRequests.RequestAsync(
                    context,
                    "mcp:capability-inspect",
                    CreateInspectRequest(serverId, toolName),
                    cancellationToken);

                return EncodeInspectResponse(capabilityId, result);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                return EncodeError($"Failed to inspect MCP tool: {ex.Message}");
            }
        }

        // MCP server: mcp-server:name
        if (capabilityId.StartsWith("mcp-server:", StringComparison.Ordinal))
        {
            var serverName = capabilityId["mcp-server:".Length..];
            try
            {
                var result = await AgentRuntimeReverseRequests.RequestAsync(
                    context,
                    "mcp:capability-list",
                    CreateEmptyObject(),
                    cancellationToken);

                var serverInfo = FindServer(result, serverName);
                if (serverInfo is null)
                {
                    return EncodeError($"MCP server not found: {serverName}");
                }
                return EncodeInspectResponse(capabilityId, serverInfo.Value);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                return EncodeError($"Failed to inspect MCP server: {ex.Message}");
            }
        }

        // Skill: skill:name
        if (capabilityId.StartsWith("skill:", StringComparison.Ordinal))
        {
            var skillName = capabilityId["skill:".Length..];
            return EncodeSkillInspectResponse(skillName);
        }

        // Built-in tool: builtin:ToolName
        if (capabilityId.StartsWith("builtin:", StringComparison.Ordinal))
        {
            var toolName = capabilityId["builtin:".Length..];
            return EncodeBuiltinInspectResponse(registry, sessionMode, toolName);
        }

        return EncodeError($"Unknown capability_id format: {capabilityId}");
    }

    // ── call ──

    private static async Task<string> CallCapabilityAsync(
        AgentRuntimeNativeToolCall call,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        ToolRegistry? registry,
        string? workingFolder,
        string? projectId,
        string? sshConnectionId,
        string? sessionMode,
        string capabilityId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(capabilityId))
        {
            return EncodeError("capability_id is required for action=call");
        }

        // Extract arguments
        var arguments = call.Input.TryGetProperty("arguments", out var argsEl) && argsEl.ValueKind == JsonValueKind.Object
            ? argsEl
            : CreateEmptyObject();

        // MCP tool: mcp-tool:server/toolName → mcp__server__toolName
        if (capabilityId.StartsWith("mcp-tool:", StringComparison.Ordinal))
        {
            var (serverId, toolName) = ParseMcpToolId(capabilityId);
            if (serverId is null)
            {
                return EncodeError($"Invalid MCP tool capability_id: {capabilityId}");
            }

            var mcpToolCall = new AgentRuntimeNativeToolCall(
                call.Id,
                $"mcp__{serverId}__{toolName}",
                arguments);

            return await AgentRuntimeMcpExecutor.ExecuteAsync(mcpToolCall, context, cancellationToken);
        }

        // Skill: skill:name → Skill tool with SkillName
        if (capabilityId.StartsWith("skill:", StringComparison.Ordinal))
        {
            var skillName = capabilityId["skill:".Length..];
            var skillCall = new AgentRuntimeNativeToolCall(
                call.Id,
                "Skill",
                CreateSkillInput(skillName));

            return await AgentRuntimeSkillExecutor.ExecuteAsync(skillCall, cancellationToken);
        }

        // Built-in tool: builtin:ToolName → dispatch via ToolDispatchRouter
        if (capabilityId.StartsWith("builtin:", StringComparison.Ordinal))
        {
            var toolName = capabilityId["builtin:".Length..];
            if (registry is null || !registry.IsRegistered(toolName))
            {
                return EncodeError($"Built-in tool not found: {toolName}");
            }

            // Verify the tool is explicitly exposed through the capability proxy.
            var category = registry.GetCategory(toolName);
            if (category is null || !IsProxiedBuiltinTool(toolName, category)
                || !registry.IsAvailableInMode(toolName, sessionMode))
            {
                return EncodeError($"Tool '{toolName}' is not available through the capability proxy in this session mode.");
            }

            // Approval parity: a proxied built-in tool must honor the same
            // default-mode approval policy as a direct call. Without this,
            // write-class tools (NotebookEdit, Desktop*, …) bypass the user
            // confirmation the permission mode promises.
            var permissionMode = JsonHelpers.GetString(state.Parameters, "permissionMode");
            var needsApproval = string.Equals(permissionMode, "default", StringComparison.OrdinalIgnoreCase)
                && !state.SuppressTransportEvents
                && ToolCallProcessor.IsDefaultModeApprovalTool(toolName);
            if (needsApproval)
            {
                var approved = await RequestProxyApprovalAsync(
                    call.Id, toolName, arguments, state, context, cancellationToken);
                if (!approved)
                {
                    return EncodeError($"Tool call rejected by user: {toolName} (via use_capability)");
                }
            }

            var builtinCall = new AgentRuntimeNativeToolCall(
                call.Id,
                toolName,
                arguments);

            var (output, isError) = await ToolDispatchRouter.DispatchAsync(
                builtinCall, state, context, registry, workingFolder, projectId, sshConnectionId);

            return output;
        }

        return EncodeError($"Unknown capability_id format for call: {capabilityId}");
    }

    /// <summary>
    /// Approval parity for proxied built-in tools: sends the same reverse-request
    /// the main loop uses and waits for the user's decision.
    /// </summary>
    private static async Task<bool> RequestProxyApprovalAsync(
        string toolCallId,
        string toolName,
        JsonElement arguments,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var approvalParams = WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("toolCallId", toolCallId);
            w.WriteString("toolName", toolName);
            w.WriteString("source", "default-mode");
            w.WriteString("viaProxy", "use_capability");
            w.WritePropertyName("input");
            arguments.WriteTo(w);
            w.WriteEndObject();
        });

        var approvalResult = await AgentRuntimeReverseRequests.RequestAsync(
            context, "sub-agent:approve-tool", approvalParams, cancellationToken);

        return approvalResult.ValueKind == JsonValueKind.Object &&
               approvalResult.TryGetProperty("approved", out var approvedVal) &&
               approvedVal.ValueKind == JsonValueKind.True;
    }
}

using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// Routes tool calls to the appropriate executor.
/// Extracted from ToolCallProcessor for maintainability.
/// </summary>
public static class ToolDispatchRouter
{
    /// <summary>
    /// Dispatches a single tool call to the matching executor.
    /// Returns (toolOutput, isToolError).
    /// </summary>
    public static async Task<(string Output, bool IsError)> DispatchAsync(
        AgentRuntimeNativeToolCall toolCall,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        ToolRegistry? registry,
        string? workingFolder,
        string? projectId,
        string? sshConnectionId)
    {
        var toolOutput = string.Empty;
        var isToolError = false;

        // Cron/background runs are non-interactive: never wait for a renderer/user
        // answer. Return a tool error so the model can continue autonomously.
        if (AgentRuntimeAskUserExecutor.IsAskUserTool(toolCall.Name) &&
            JsonHelpers.GetBool(state.Parameters, "nonInteractive", false))
        {
            const string message = "This is a background scheduled task and cannot wait for user answers. Continue without asking the user.";
            return (message, true);
        }

        // AskUserQuestion: route to renderer via reverse-request
        if (AgentRuntimeAskUserExecutor.IsAskUserTool(toolCall.Name))
        {
            try
            {
                var result = await AgentRuntimeAskUserExecutor.ExecuteAsync(
                toolCall, state.Parameters, context, state.CancellationToken);
                toolOutput = result.Content.ValueKind == JsonValueKind.String
                ? result.Content.GetString() ?? string.Empty
                : result.Content.ToString();
                isToolError = result.IsError;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                toolOutput = $"AskUser tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // Desktop control: route to main process via reverse-request
        else if (AgentRuntimeDesktopExecutor.IsDesktopTool(toolCall.Name))
        {
            try
            {
                var result = await AgentRuntimeDesktopExecutor.ExecuteAsync(
                toolCall, context, state.CancellationToken);
                toolOutput = result.Content.ValueKind == JsonValueKind.String
                ? result.Content.GetString() ?? string.Empty
                : result.Content.ToString();
                isToolError = result.IsError;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                toolOutput = $"Desktop tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // use_capability: unified proxy for MCP tools and Skills
        else if (AgentRuntimeUseCapabilityExecutor.IsUseCapabilityTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeUseCapabilityExecutor.ExecuteAsync(
                    toolCall, state, context, registry, workingFolder, projectId, sshConnectionId, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"use_capability execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // WebSearch: executed directly in Worker (HTTP request)
        else if (AgentRuntimeWebSearchExecutor.IsWebSearchTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeWebSearchExecutor.ExecuteAsync(
                toolCall, state.Parameters, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                toolOutput = $"Web search execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // WebFetch: executed directly in Worker (HTTP request)
        else if (AgentRuntimeWebFetchExecutor.IsWebFetchTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeWebFetchExecutor.ExecuteAsync(
                toolCall, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                toolOutput = $"Web fetch execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // Browser tool calls: route to renderer via reverse-request
        else if (AgentRuntimeBrowserExecutor.IsBrowserTool(toolCall.Name))
        {
            try
            {
                var result = await AgentRuntimeBrowserExecutor.ExecuteAsync(
                toolCall, state.Parameters, state.RunId, context, state.CancellationToken);
                toolOutput = result.Content.ValueKind == JsonValueKind.String
                ? result.Content.GetString() ?? string.Empty
                : result.Content.ToString();
                isToolError = result.IsError;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                toolOutput = $"Browser tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // Widget: pure Worker, no I/O
        else if (AgentRuntimeWidgetExecutor.IsWidgetTool(toolCall.Name))
        {
            toolOutput = AgentRuntimeWidgetExecutor.Execute(toolCall);
            isToolError = IsJsonError(toolOutput);
        }
        // Skill: reads SKILL.md from disk
        else if (AgentRuntimeSkillExecutor.IsSkillTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeSkillExecutor.ExecuteAsync(toolCall, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"Skill tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // NotebookEdit: Jupyter notebook cell editing
        else if (AgentRuntimeNotebookEditExecutor.IsNotebookEditTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeNotebookEditExecutor.ExecuteAsync(toolCall, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"NotebookEdit tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // Goal: SQLite persistence plus Orchestrator runtime state
        else if (AgentRuntimeGoalExecutor.IsGoalTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeGoalExecutor.ExecuteAsync(
                toolCall, state, context);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"Goal tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // Task: session-scoped agent Todo (SQLite-backed, OpenCowork semantics)
        else if (AgentRuntimeTaskExecutor.IsTaskTool(toolCall.Name))
        {
            toolOutput = AgentRuntimeTaskExecutor.Execute(toolCall, state.Parameters);
            isToolError = IsJsonError(toolOutput);
        }
        // PlanMode: file-based plan management
        else if (AgentRuntimePlanExecutor.IsPlanTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimePlanExecutor.ExecuteAsync(
                toolCall, state.Parameters, state.RunId, context, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);

            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"Plan tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // CodeCompatible: PowerShell / Monitor
        else if (AgentRuntimeCodeCompatibleExecutor.IsCodeCompatibleTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeCodeCompatibleExecutor.ExecuteAsync(
                toolCall, state.Parameters, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"Code compatible tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // CodeGraph: reverse-request to Main process
        else if (AgentRuntimeCodeGraphExecutor.IsCodeGraphTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeCodeGraphExecutor.ExecuteAsync(
                toolCall, state.Parameters, context, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"CodeGraph tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // MCP: reverse-request to Main/renderer
        else if (AgentRuntimeMcpExecutor.IsMcpTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeMcpExecutor.ExecuteAsync(
                toolCall, context, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"MCP tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // Extension: reverse-request to Main/renderer
        else if (AgentRuntimeExtensionExecutor.IsExtensionTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeExtensionExecutor.ExecuteAsync(
                toolCall, context, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"Extension tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // Notify: reverse-request to Main process
        else if (AgentRuntimeNotifyExecutor.IsNotifyTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeNotifyExecutor.ExecuteAsync(
                toolCall, context, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"Notify tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // ImageGenerate: reverse-request to Main process
        else if (AgentRuntimeImageGenerateExecutor.IsImageGenerateTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeImageGenerateExecutor.ExecuteAsync(
                toolCall, state.Parameters, context, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"ImageGenerate tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // Team: in-memory + reverse-request
        else if (AgentRuntimeTeamExecutor.IsTeamTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeTeamExecutor.ExecuteAsync(
                toolCall, state.Parameters, context, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"Team tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // Cron: reverse-request to Main process
        else if (AgentRuntimeCronExecutor.IsCronTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeCronExecutor.ExecuteAsync(
                toolCall, state.Parameters, context, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"Cron tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // Plugin: reverse-request to Main process
        else if (AgentRuntimePluginExecutor.IsPluginTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimePluginExecutor.ExecuteAsync(
                toolCall, state.Parameters, context, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"Plugin tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // ChannelPlugin: reverse-request to Main process
        else if (AgentRuntimeChannelPluginExecutor.IsChannelPluginTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeChannelPluginExecutor.ExecuteAsync(
                toolCall, state.Parameters, context, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"Channel plugin tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // Skill management: reverse-request to renderer
        else if (AgentRuntimeSkillManagementExecutor.IsSkillManagementTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeSkillManagementExecutor.ExecuteAsync(
                    toolCall, context, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"Skill management tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // SSH info: list connections via reverse-request to Main process
        else if (AgentRuntimeSshToolExecutor.IsSshInfoTool(toolCall.Name))
        {
            try
            {
                (toolOutput, isToolError) = await AgentRuntimeSshToolExecutor.ExecuteListConnectionsAsync(
                    context, state.CancellationToken);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"SSH info tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // SSH remote execution: route Bash/Shell to remote server when sshConnectionId is present
        else if (AgentRuntimeSshToolExecutor.ShouldRouteToSsh(
            toolCall.Name, toolCall.Input, state.Parameters))
        {
            try
            {
                (toolOutput, isToolError) = await AgentRuntimeSshToolExecutor.ExecuteAsync(
                    toolCall, state.Parameters, context, state.CancellationToken);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"SSH tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        // Project management tools: list_projects / get_project_details / create_session / send_session_message
        else if (AgentRuntimeProjectExecutor.IsProjectTool(toolCall.Name))
        {
            try
            {
                toolOutput = await AgentRuntimeProjectExecutor.ExecuteAsync(
                toolCall, state.Parameters, context, state.CancellationToken);
                isToolError = IsJsonError(toolOutput);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"Project tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        else if (SubAgentExecutor.IsTaskTool(toolCall.Name))
        {
            try
            {
                var result = await SubAgentExecutor.ExecuteAsync(
                toolCall.Input, state.Parameters, state, context, toolCall.Id);
                toolOutput = result.Content;
                isToolError = result.IsError;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                toolOutput = $"Sub-agent execution failed: {ex.Message}";
                isToolError = true;
            }
        }
        else if (GoalProgressTool.IsGoalProgressTool(toolCall.Name))
        {
            try
            {
                toolOutput = await GoalProgressTool.ExecuteAsync(toolCall, state, context);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                toolOutput = $"Goal progress recording failed: {ex.Message}";
                isToolError = true;
            }
        }
        else if (registry is not null && registry.TryGetExecutor(toolCall.Name, out var executor))
        {
            try
            {
                var toolContext = new ToolExecutionContext(
                workingFolder, state.SessionId, state.RunId, projectId, sshConnectionId, state.CancellationToken);
                var result = await executor!.ExecuteAsync(toolCall.Input, toolContext);
                toolOutput = result.Content;
                isToolError = result.IsError;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                toolOutput = $"Tool execution failed: {ex.Message}";
                isToolError = true;
            }
        }

        return (toolOutput, isToolError);
    }

    /// <summary>
    /// Checks if a JSON string contains an "error" property with a meaningful
    /// value. TL-5: an "error": null (or empty) key is a success convention in
    /// many APIs and must not be flagged as a tool error.
    /// </summary>
    public static bool IsJsonError(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty("error", out var errorEl) &&
                   errorEl.ValueKind != JsonValueKind.Null &&
                   errorEl.ValueKind != JsonValueKind.Undefined &&
                   (errorEl.ValueKind != JsonValueKind.String || !string.IsNullOrWhiteSpace(errorEl.GetString()));
        }
        catch
        {
            return false;
        }
    }
}

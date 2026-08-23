using System.Text.Json;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools;

/// <summary>
/// Query the status of any sub-agent (foreground or background).
/// Returns: ID, name, description, mode, status, tool call count, iterations, elapsed.
/// For finished sub-agents the final report is included (truncated at 2000 chars).
/// </summary>
public sealed class SubAgentStatusTool : IToolExecutor
{
    public string Name => "SubAgentStatus";

    public string Description =>
        "Check a sub-agent's status by toolUseId; includes its final report (truncated) when finished. " +
        "Omit toolUseId to list all sub-agents. Use SubAgentDetail for the full report and tool call log.";

    public JsonElement InputSchema { get; } = JsonDocument.Parse(
        """
        {
          "type": "object",
          "properties": {
            "toolUseId": {
              "type": "string",
              "description": "The sub-agent's toolUseId (returned when the sub-agent was started). If omitted, lists all sub-agents."
            }
          },
          "required": []
        }
        """).RootElement.Clone();

    public Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)
    {
        var toolUseId = ToolHelpers.GetString(input, "toolUseId");

        if (string.IsNullOrWhiteSpace(toolUseId))
        {
            var all = Agent.BackgroundSubAgentRegistry.GetAll();
            if (all.Count == 0)
            {
                return Task.FromResult(new ToolResult("No sub-agents registered."));
            }

            var lines = new List<string> { $"Sub-Agents ({all.Count}):" };
            foreach (var r in all)
            {
                lines.Add($"  {Agent.BackgroundSubAgentRegistry.FormatBrief(r)}");
            }
            return Task.FromResult(new ToolResult(string.Join("\n", lines)));
        }

        var record = Agent.BackgroundSubAgentRegistry.Get(toolUseId!);
        if (record is null)
        {
            return Task.FromResult(new ToolResult(
                $"No sub-agent found with toolUseId '{toolUseId}'.", true));
        }

        return Task.FromResult(new ToolResult(
            Agent.BackgroundSubAgentRegistry.FormatStatusInfo(record)));
    }
}

/// <summary>
/// Query the full execution detail of any sub-agent (foreground or background).
/// Returns: status info + complete output report + step-by-step tool call log.
/// </summary>
public sealed class SubAgentDetailTool : IToolExecutor
{
    public string Name => "SubAgentDetail";

    public string Description =>
        "Get a sub-agent's full execution detail by toolUseId: complete output report and step-by-step tool call log. " +
        "For a quick status check, use SubAgentStatus instead.";

    public JsonElement InputSchema { get; } = JsonDocument.Parse(
        """
        {
          "type": "object",
          "properties": {
            "toolUseId": {
              "type": "string",
              "description": "The sub-agent's toolUseId (returned when the sub-agent was started)."
            }
          },
          "required": ["toolUseId"]
        }
        """).RootElement.Clone();

    public Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)
    {
        var toolUseId = ToolHelpers.GetString(input, "toolUseId");
        if (string.IsNullOrWhiteSpace(toolUseId))
        {
            return Task.FromResult(new ToolResult(
                "SubAgentDetail requires a 'toolUseId' parameter.", true));
        }

        var record = Agent.BackgroundSubAgentRegistry.Get(toolUseId!);
        if (record is null)
        {
            return Task.FromResult(new ToolResult(
                $"No sub-agent found with toolUseId '{toolUseId}'.", true));
        }

        return Task.FromResult(new ToolResult(
            Agent.BackgroundSubAgentRegistry.FormatDetail(record)));
    }
}

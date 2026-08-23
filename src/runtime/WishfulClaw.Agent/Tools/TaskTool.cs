using System.Text;
using System.Text.Json;
using WishfulClaw.Core.Tools;
using WishfulClaw.Agent;

namespace WishfulClaw.Agent.Tools;

/// <summary>
/// Task tool — the entry point for launching sub-agents.
///
/// This tool's description and inputSchema are built dynamically from the
/// SubAgentRegistry so the LLM can see all available agent types.
/// Execution is intercepted by ToolDispatchRouter → SubAgentExecutor;
/// ExecuteAsync here should never be reached.
///
/// Design (mirrors WishfulClaw's create-tool.ts):
/// - Task is the unified entry point; subagent_type selects which SubAgent to run.
/// - "custom" is always available as the general-purpose fallback.
/// - Sub-agent definitions are registered in SubAgentRegistry at startup.
/// </summary>
public sealed class TaskTool : IToolExecutor
{
    public string Name => "Task";

    public string Description { get; }

    public JsonElement InputSchema { get; }

    public TaskTool()
    {
        Description = BuildDescription();
        InputSchema = BuildSchema();
    }

    public Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)
    {
        // This should never be called — ToolDispatchRouter intercepts Task tool calls
        // and routes them to SubAgentExecutor before reaching the registry.
        return Task.FromResult(new ToolResult(
            "Task tool execution should be handled by SubAgentExecutor.",
            IsError: true));
    }

    /// <summary>
    /// Build the tool description listing all available sub-agent types.
    /// Mirrors WishfulClaw's buildTaskDescription().
    /// </summary>
    private static string BuildDescription()
    {
        var agents = SubAgentRegistry.GetAll();
        var sb = new StringBuilder();

        sb.AppendLine("Launch a sub-agent to handle a complex, multi-step task autonomously.");
        sb.AppendLine("It runs in its own session, inherits the parent's tools, and only returns its final answer.");
        sb.AppendLine();
        sb.AppendLine("Available agent types:");

        if (agents.Count == 0)
        {
            sb.AppendLine("- custom: General-purpose sub-agent with a built-in default system prompt.");
        }
        else
        {
            foreach (var a in agents)
            {
                sb.AppendLine($"- {a.Name}: {a.Description}");
            }
            sb.AppendLine("- custom: General-purpose fallback when no specialized agent fits.");
        }

        sb.AppendLine();
        sb.AppendLine("Usage notes:");
        sb.AppendLine("- Delegate complex tasks immediately; do simple 1-3 step tasks yourself.");
        sb.AppendLine("- Sub-agents are stateless and do not see this conversation — write self-contained prompts with all needed context.");
        sb.AppendLine("- Set background=true to run without blocking; check progress with SubAgentStatus/SubAgentDetail.");

        return sb.ToString().TrimEnd();
    }

    /// <summary>
    /// Build the input schema with a dynamic subagent_type enum.
    /// </summary>
    private static JsonElement BuildSchema()
    {
        var names = SubAgentRegistry.GetNames();
        var enumItems = string.Join(", ", names.Select(n => $"\"{n}\""));

        var json = $$"""
        {
          "type": "object",
          "properties": {
            "description": {
              "type": "string",
              "description": "A short (3-5 word) description of the task, used for display"
            },
            "prompt": {
              "type": "string",
              "description": "The task for the sub-agent to perform. Self-contained — the sub-agent does not see this conversation."
            },
            "subagent_type": {
              "type": "string",
              "enum": [{{enumItems}}],
              "default": "custom",
              "description": "The type of sub-agent to use. Defaults to 'custom' for general-purpose tasks."
            },
            "background": {
              "type": "boolean",
              "default": false,
              "description": "If true, runs in the background and returns a sub-agent ID immediately; check progress with SubAgentStatus. If false (default), waits for completion."
            }
          },
          "required": ["description", "prompt"],
          "additionalProperties": false
        }
        """;

        return JsonDocument.Parse(json).RootElement.Clone();
    }
}

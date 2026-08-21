using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// LLM-related operations for GoalOrchestrator.
/// Uses sub-agents to perform LLM calls (goal decomposition, self-evaluation).
/// </summary>
public static partial class GoalOrchestrator
{
    /// <summary>
    /// Decompose a goal into plans using a sub-agent LLM call.
    /// The sub-agent receives the goal text and returns a JSON array of plans.
    /// </summary>
    private static async Task<GoalDecompositionResult> DecomposeGoalAsync(
        string goalText,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var prompt = GoalPromptTemplates.BuildDecompositionUserPrompt(goalText, null);

        var input = CreateTaskInput(
            prompt,
            "Goal Decomposition",
            "goal-decomposer",
            GoalPromptTemplates.DecompositionSystemPrompt);
        var toolCallId = $"goal-decompose-{Guid.NewGuid():N}";

        var result = await SubAgentExecutor.ExecuteAsync(
            input, parameters, parentState, context, toolCallId);
        cancellationToken.ThrowIfCancellationRequested();

        var output = result.Content?.Trim() ?? string.Empty;

        // Strip markdown code fences if present
        if (output.StartsWith("```"))
        {
            var firstNewline = output.IndexOf('\n');
            if (firstNewline >= 0)
                output = output.Substring(firstNewline + 1);
            if (output.EndsWith("```"))
                output = output.Substring(0, output.Length - 3);
            output = output.Trim();
        }

        // Parse JSON array from output
        try
        {
            var plans = new List<GoalPlanItem>();
            using var doc = JsonDocument.Parse(output);
            foreach (var element in doc.RootElement.EnumerateArray())
            {
                var planId = $"plan-{Guid.NewGuid():N}".Substring(0, 16);
                plans.Add(new GoalPlanItem
                {
                    PlanId = planId,
                    Title = element.TryGetProperty("title", out var t) ? t.GetString() ?? "Untitled" : "Untitled",
                    Description = element.TryGetProperty("description", out var d) ? d.GetString() ?? "" : "",
                    Status = GoalPlanStatusValues.Pending
                });
            }

            return new GoalDecompositionResult
            {
                Success = plans.Count > 0,
                Plans = plans,
                Error = plans.Count == 0 ? "No plans generated" : null
            };
        }
        catch (Exception ex)
        {
            return new GoalDecompositionResult
            {
                Success = false,
                Error = $"Failed to parse decomposition result: {ex.Message}. Raw output: {output.Substring(0, Math.Min(500, output.Length))}"
            };
        }
    }

    /// <summary>
    /// Build the execution prompt for a plan using GoalPromptTemplates.
    /// </summary>
    internal static string BuildPlanExecutionPrompt(string title, string description)
    {
        return GoalPromptTemplates.BuildExecutionUserPrompt(title, description);
    }

    /// <summary>
    /// Evaluate a plan execution result using LLM.
    /// Returns whether the plan's requirements are satisfied.
    /// </summary>
    private static async Task<EvaluationResult> EvaluateViaLlmAsync(
        string goalText,
        string planTitle,
        string planDescription,
        string executionResult,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        CancellationToken ct)
    {
        var prompt = GoalPromptTemplates.BuildEvaluationUserPrompt(
            goalText, planTitle, planDescription, executionResult);

        var input = CreateTaskInput(
            prompt,
            "Goal Evaluation",
            "goal-evaluator",
            GoalPromptTemplates.EvaluationSystemPrompt);
        var toolCallId = $"goal-eval-{Guid.NewGuid():N}";

        try
        {
            var result = await SubAgentExecutor.ExecuteAsync(
                input, parameters, parentState, context, toolCallId);
            ct.ThrowIfCancellationRequested();

            var output = result.Content?.Trim() ?? string.Empty;

            // Strip markdown code fences
            if (output.StartsWith("```"))
            {
                var firstNewline = output.IndexOf('\n');
                if (firstNewline >= 0)
                    output = output.Substring(firstNewline + 1);
                if (output.EndsWith("```"))
                    output = output.Substring(0, output.Length - 3);
                output = output.Trim();
            }

            // Parse JSON evaluation result
            using var doc = JsonDocument.Parse(output);
            var root = doc.RootElement;

            return new EvaluationResult
            {
                Satisfied = root.TryGetProperty("satisfied", out var s) && s.GetBoolean(),
                Reasoning = root.TryGetProperty("reasoning", out var r) ? r.GetString() : "No reasoning provided",
                NextAction = root.TryGetProperty("nextAction", out var na) ? na.GetString() ?? "proceed" : "proceed",
                AdjustedDescription = root.TryGetProperty("adjustedDescription", out var ad) ? ad.GetString() : null
            };
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Fallback to heuristic evaluation if LLM fails
            return new EvaluationResult
            {
                Satisfied = false,
                Reasoning = $"LLM evaluation failed: {ex.Message}. Falling back to heuristic.",
                NextAction = "retry"
            };
        }
    }

    /// <summary>
    /// Create a Task tool input JSON for spawning a sub-agent.
    /// </summary>
    private static JsonElement CreateTaskInput(
        string prompt,
        string description,
        string subagentType,
        string systemPrompt)
    {
        using var stream = new MemoryStream();
        using (var w = new Utf8JsonWriter(stream))
        {
            w.WriteStartObject();
            w.WriteString("subagent_type", subagentType);
            w.WriteString("description", description);
            w.WriteString("prompt", prompt);
            w.WriteString("systemPrompt", systemPrompt);
            w.WriteBoolean("background", false);
            w.WriteEndObject();
        }
        var json = System.Text.Encoding.UTF8.GetString(stream.ToArray());
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}

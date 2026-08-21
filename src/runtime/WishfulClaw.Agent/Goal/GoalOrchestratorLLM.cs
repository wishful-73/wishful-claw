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
        bool executionSucceeded,
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

            // The evaluator sub-agent may itself fail and answer in prose
            // ("Sub-agent failed: ..."). Try to salvage a JSON object from the
            // text before giving up — otherwise a broken evaluator poisons
            // every retry and the plan can never complete.
            var jsonCandidate = ExtractJsonObject(output) ?? output;
            if (jsonCandidate.Length == 0)
                return HeuristicEvaluation(executionSucceeded, "evaluator returned no output");

            // Parse JSON evaluation result
            using var doc = JsonDocument.Parse(jsonCandidate);
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
            return HeuristicEvaluation(executionSucceeded, ex.Message);
        }
    }

    /// <summary>
    /// Fallback when the evaluator LLM call fails or returns unparseable
    /// output. Trusts the executor's own success flag instead of forcing a
    /// retry — a broken evaluator must not turn a completed plan into an
    /// endless retry loop.
    /// </summary>
    private static EvaluationResult HeuristicEvaluation(bool executionSucceeded, string reason)
    {
        return new EvaluationResult
        {
            Satisfied = executionSucceeded,
            Reasoning = $"LLM evaluation failed ({reason}). Falling back to executor result.",
            NextAction = executionSucceeded ? "proceed" : "retry"
        };
    }

    /// <summary>
    /// Extract the first balanced {...} block from free-form text, or null.
    /// </summary>
    private static string? ExtractJsonObject(string text)
    {
        var start = text.IndexOf('{');
        if (start < 0) return null;
        var depth = 0;
        var inString = false;
        for (var i = start; i < text.Length; i++)
        {
            var c = text[i];
            if (inString)
            {
                if (c == '\\') i++;
                else if (c == '"') inString = false;
                continue;
            }
            if (c == '"') inString = true;
            else if (c == '{') depth++;
            else if (c == '}')
            {
                depth--;
                if (depth == 0) return text.Substring(start, i - start + 1);
            }
        }
        return null;
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

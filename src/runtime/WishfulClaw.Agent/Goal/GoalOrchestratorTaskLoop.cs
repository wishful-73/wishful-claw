using System.Diagnostics;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Task-level decomposition and execution for GoalOrchestrator.
/// Each Plan is decomposed into Tasks before execution; Tasks are
/// materialized to goal_tasks and executed sequentially.
/// </summary>
public static partial class GoalOrchestrator
{
    /// <summary>
    /// Detects provider rate-limit failures from error text. Matches only
    /// structured HTTP-status patterns (e.g. "HTTP 429" as emitted by
    /// ProviderHttpException) plus the canonical "Too Many Requests" reason
    /// phrase — a bare "429" substring would false-positive on natural
    /// language output that merely mentions the number.
    /// </summary>
    private static bool IsRateLimitText(string? text)
    {
        if (string.IsNullOrEmpty(text)) return false;
        return text.Contains("HTTP 429", StringComparison.OrdinalIgnoreCase)
            || text.Contains("status code 429", StringComparison.OrdinalIgnoreCase)
            || text.Contains("Too Many Requests", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Decompose a plan into tasks using a sub-agent LLM call.
    /// Returns a list of (taskId, title, description) tuples.
    /// </summary>
    private static async Task<List<(string taskId, string title, string description)>> DecomposePlanToTasksAsync(
        GoalContext goal,
        GoalPlanItem plan,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var prompt = GoalPromptTemplates.BuildTaskDecompositionUserPrompt(
            goal.GoalText, plan.Title, plan.Description);

        var input = CreateTaskInput(
            prompt,
            "Task Decomposition",
            "task-decomposer",
            GoalPromptTemplates.TaskDecompositionSystemPrompt);
        var toolCallId = $"task-decompose-{plan.PlanId}-{Guid.NewGuid():N}";

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

        var tasks = new List<(string taskId, string title, string description)>();
        try
        {
            using var doc = JsonDocument.Parse(output);
            foreach (var element in doc.RootElement.EnumerateArray())
            {
                var taskId = $"task-{Guid.NewGuid():N}".Substring(0, 21);
                var title = element.TryGetProperty("title", out var t)
                    ? t.GetString() ?? "Untitled"
                    : "Untitled";
                var desc = element.TryGetProperty("description", out var d)
                    ? d.GetString() ?? ""
                    : "";
                tasks.Add((taskId, title, desc));
            }
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"Task decomposition parse failed: {ex.Message}");
            // Fallback: single task = the plan itself
            var fallbackTaskId = $"task-{Guid.NewGuid():N}".Substring(0, 21);
            tasks.Add((fallbackTaskId, plan.Title, plan.Description));
        }

        // Fallback: parse failure or an empty array both degrade to a single
        // task = the plan itself, so the loop never evaluates an empty input.
        if (tasks.Count == 0)
        {
            var fallbackTaskId = $"task-{Guid.NewGuid():N}".Substring(0, 21);
            tasks.Add((fallbackTaskId, plan.Title, plan.Description));
        }

        return tasks;
    }

    /// <summary>
    /// Execute a single task via sub-agent and return the result.
    /// </summary>
    private static async Task<PlanExecutionResult> ExecuteTaskAsync(
        GoalContext goal,
        GoalPlanItem plan,
        (string taskId, string title, string description) task,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var stopwatch = Stopwatch.StartNew();

        var prompt = GoalPromptTemplates.BuildTaskExecutionUserPrompt(
            plan.Title, task.title, task.description);
        var input = CreateTaskInput(
            prompt,
            $"Task: {task.title}",
            "custom",
            GoalPromptTemplates.TaskExecutionSystemPrompt);
        var toolCallId = $"goal-task-{task.taskId}-{Guid.NewGuid():N}";

        parentState.GoalEventContext = new GoalEventContext(
            goal.GoalId, plan.PlanId, plan.RetryCount + 1, task.title);

        try
        {
            var result = await SubAgentExecutor.ExecuteAsync(
                input, parameters, parentState, context, toolCallId);
            ct.ThrowIfCancellationRequested();

            stopwatch.Stop();
            var output = result.Content?.Trim() ?? string.Empty;

            if (IsRateLimitText(output))
            {
                return new PlanExecutionResult
                {
                    PlanId = plan.PlanId,
                    Title = task.title,
                    Status = GoalExecutionAttemptStatusValues.Failed,
                    Error = output,
                    Is429 = true,
                    RetryCount = plan.RetryCount,
                    ElapsedMs = stopwatch.ElapsedMilliseconds
                };
            }

            return new PlanExecutionResult
            {
                PlanId = plan.PlanId,
                Title = task.title,
                Status = GoalPlanStatusValues.Complete,
                Summary = output.Length > 500 ? output.Substring(0, 500) + "..." : output,
                RetryCount = plan.RetryCount,
                ElapsedMs = stopwatch.ElapsedMilliseconds
            };
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            stopwatch.Stop();
            throw;
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            return new PlanExecutionResult
            {
                PlanId = plan.PlanId,
                Title = task.title,
                Status = GoalExecutionAttemptStatusValues.Failed,
                Error = ex.Message,
                Is429 = IsRateLimitText(ex.Message),
                RetryCount = plan.RetryCount,
                ElapsedMs = stopwatch.ElapsedMilliseconds
            };
        }
        finally
        {
            // Always clear the goal context — a leftover context would mis-tag
            // the next unrelated sub-agent call's events as goal_activity.
            parentState.GoalEventContext = null;
        }
    }
}

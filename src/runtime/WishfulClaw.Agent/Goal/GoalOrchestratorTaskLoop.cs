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
            parentState.GoalEventContext = null;
            ct.ThrowIfCancellationRequested();

            stopwatch.Stop();
            var output = result.Content?.Trim() ?? string.Empty;

            if (output.Contains("429") || output.Contains("Too Many Requests", StringComparison.OrdinalIgnoreCase))
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
                Is429 = ex.Message.Contains("429") || ex.Message.Contains("Too Many Requests", StringComparison.OrdinalIgnoreCase),
                RetryCount = plan.RetryCount,
                ElapsedMs = stopwatch.ElapsedMilliseconds
            };
        }
    }
}

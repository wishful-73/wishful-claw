using System.Diagnostics;
using System.Text;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Free-form adaptive orchestration loop (user-directed redesign): the goal is
/// NOT pre-decomposed into a fixed plan list. Instead, each step an LLM
/// decision call sees the objective plus everything executed so far and picks
/// the next action — execute a task, declare complete, or declare failure.
/// This lets the run adapt to what it discovers mid-flight.
///
/// DB compatibility: everything is recorded under one synthetic plan row
/// ("Adaptive execution") so the existing goal_plans/goal_tasks tables and
/// the panel's query path keep working unchanged.
/// </summary>
public static partial class GoalOrchestrator
{
    private const int AdaptiveMaxSteps = 24;
    private const int AdaptiveMaxConsecutiveParseFailures = 3;

    /// <summary>
    /// One entry in the adaptive execution log fed back to every decision call.
    /// </summary>
    private sealed record AdaptiveStepRecord(int Step, string Title, string Description, string Outcome);

    internal static Func<
        GoalContext,
        JsonElement,
        AgentRuntimeRunState,
        IWorkerRequestContext,
        Task>? RunAdaptiveOverride { get; set; }

    /// <summary>
    /// Adaptive replacement for the fixed-pipeline RunAsync. Entry point used
    /// by RunOwnedAsync via RunAsync routing.
    /// </summary>
    private static async Task<GoalRunOutcome> RunAdaptiveAsync(
        GoalContext goal,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context)
    {
        var ct = parentState.CancellationToken;
        await ReachSafePointAsync(goal, context, ct);
        if (RunAdaptiveOverride != null)
        {
            await RunAdaptiveOverride(goal, parameters, parentState, context);
            return new GoalRunOutcome(
                GoalStatusValues.Complete,
                GoalEventType.GoalCompleted,
                "All plans completed successfully");
        }

        // ── Synthetic plan: keeps DB three-tier + panel queries compatible ──
        var plan = new GoalPlanItem
        {
            PlanId = GoalIds.NewPlanId(),
            Title = "Adaptive execution",
            Description = goal.GoalText,
            Status = GoalPlanStatusValues.Active
        };
        goal.Plans = [plan];
        goal.CurrentPlanIndex = 0;
        SyncGoalToDb(goal, parameters);
        GoalOrchestratorMaterialize.MaterializePlans(goal, parameters);
        WriteGoalState(goal);

        var log = new List<AdaptiveStepRecord>();
        var consecutiveParseFailures = 0;
        var stopwatch = Stopwatch.StartNew();

        for (var step = 1; step <= AdaptiveMaxSteps; step++)
        {
            await ReachSafePointAsync(goal, context, ct);

            // ── Decide the next action ──
            var decision = await DecideNextActionAsync(
                goal, log, step, parameters, parentState, context, ct);
            await ReachSafePointAsync(goal, context, ct);

            if (decision == null)
            {
                consecutiveParseFailures++;
                WorkerLog.Warn($"adaptive decide failed ({consecutiveParseFailures}/{AdaptiveMaxConsecutiveParseFailures})");
                if (consecutiveParseFailures >= AdaptiveMaxConsecutiveParseFailures)
                {
                    return FailAdaptive(goal, plan, parameters,
                        $"Orchestrator decision failed {consecutiveParseFailures} times in a row after {log.Count} executed step(s).");
                }
                continue;
            }
            consecutiveParseFailures = 0;

            if (decision.Action == "complete")
            {
                plan.Status = GoalPlanStatusValues.Complete;
                plan.ResultSummary = decision.Summary ?? "Goal completed";
                FinishAdaptivePlan(goal, plan, parameters);
                return new GoalRunOutcome(
                    GoalStatusValues.Complete,
                    GoalEventType.GoalCompleted,
                    decision.Summary ?? "Goal completed");
            }

            if (decision.Action == "failed")
            {
                return FailAdaptive(goal, plan, parameters,
                    decision.Summary ?? decision.Reason ?? "Goal failed by orchestrator decision");
            }

            // ── action == "execute": run the task via the existing pipeline ──
            var task = (taskId: GoalIds.NewTaskId(),
                        taskTitle: decision.Title ?? $"Step {step}",
                        taskDescription: decision.Description ?? goal.GoalText);
            var result = await ExecuteTaskAsync(goal, plan, task, parameters, parentState, context, ct);
            await ReachSafePointAsync(goal, context, ct);

            // 429: hand over to the shared backoff, then retry this step.
            if (result.Is429)
            {
                var backoffOutcome = await Handle429BackoffAsync(
                    goal, plan, 0,
                    new PlanExecutionResult { Is429 = true, Error = result.Error, RetryAfterHint = result.RetryAfterHint },
                    parameters, parentState, context, ct);
                await ReachSafePointAsync(goal, context, ct);
                if (backoffOutcome == BackoffOutcome.Timeout)
                {
                    return FailAdaptive(goal, plan, parameters, "Rate limit timeout after 6 hours");
                }
                step--; // retry the same step index; the decision will re-run
                continue;
            }

            var outcomeText = result.Status == GoalPlanStatusValues.Complete
                ? $"DONE. Report:\n{result.Summary}"
                : $"FAILED. Error:\n{result.Error ?? "(no error text)"}";
            log.Add(new AdaptiveStepRecord(step, task.taskTitle, task.taskDescription, outcomeText));

            // Record into goal_plan_tasks / goal_execution_runs for panel queries.
            RecordAdaptiveRound(goal, plan, step, task.taskTitle,
                result.Status == GoalPlanStatusValues.Complete, result.Summary ?? result.Error, parameters);

            WriteGoalState(goal);
        }

        return FailAdaptive(goal, plan, parameters,
            $"Reached the {AdaptiveMaxSteps}-step limit without completing the goal.");
    }

    private static GoalRunOutcome FailAdaptive(
        GoalContext goal, GoalPlanItem plan, JsonElement parameters, string reason)
    {
        plan.ResultSummary = reason;
        FinishAdaptivePlan(goal, plan, parameters);
        return new GoalRunOutcome(GoalStatusValues.Active, GoalEventType.GoalFailed, reason);
    }

    /// <summary>
    /// Mark the synthetic plan terminal and persist (best-effort mirrors the
    /// fixed pipeline's bookkeeping).
    /// </summary>
    private static void FinishAdaptivePlan(
        GoalContext goal, GoalPlanItem plan, JsonElement parameters)
    {
        GoalOrchestratorMaterialize.UpdatePlanStatus(goal, plan, plan.Status, plan.ResultSummary);
        GoalPlanTracker.FinishPlan(goal.WorkingFolder, goal.GoalId, plan);
        WriteGoalState(goal);
        SyncGoalToDb(goal, parameters);
    }

    /// <summary>
    /// Persist one adaptive step as a round record (goal_plan_tasks +
    /// goal_execution_runs) so the panel can show per-step history.
    /// </summary>
    private static void RecordAdaptiveRound(
        GoalContext goal, GoalPlanItem plan, int step, string title,
        bool succeeded, string? summary, JsonElement parameters)
    {
        var attemptId = GoalOrchestratorMaterialize.StartExecutionAttempt(goal, plan, step);
        var roundTaskId = GoalPlanRecorder.StartRound(parameters, goal, plan, step);
        GoalOrchestratorMaterialize.FinishExecutionAttempt(
            goal, plan, attemptId,
            succeeded ? GoalExecutionAttemptStatusValues.Completed : GoalExecutionAttemptStatusValues.Failed,
            summary, null);
        GoalPlanRecorder.FinishRound(parameters, roundTaskId,
            succeeded ? GoalExecutionAttemptStatusValues.Completed : GoalExecutionAttemptStatusValues.Failed,
            summary, null, succeeded);
    }

    /// <summary>
    /// LLM decision call: given the goal and the full step log, pick the next
    /// action. Returns null when the output cannot be parsed.
    /// </summary>
    private static async Task<AdaptiveDecision?> DecideNextActionAsync(
        GoalContext goal,
        List<AdaptiveStepRecord> log,
        int step,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var stepLog = RenderStepLog(log);
        var prompt = GoalPromptTemplates.BuildAdaptiveDecisionUserPrompt(
            goal.GoalText, stepLog, log.Count, AdaptiveMaxSteps);

        var input = CreateTaskInput(
            prompt,
            "Next action decision",
            "goal-orchestrator",
            GoalPromptTemplates.AdaptiveOrchestratorSystemPrompt);
        var toolCallId = $"goal-decide-{Guid.NewGuid():N}";

        try
        {
            var result = await SubAgentExecutor.ExecuteAsync(
                input, parameters, parentState, context, toolCallId);
            ct.ThrowIfCancellationRequested();

            var output = StripCodeFence(result.Content?.Trim() ?? string.Empty);
            var jsonCandidate = ExtractJsonObject(output) ?? output;
            if (jsonCandidate.Length == 0) return null;

            using var doc = JsonDocument.Parse(jsonCandidate);
            var root = doc.RootElement;
            var action = root.TryGetProperty("action", out var a) ? a.GetString() ?? "" : "";
            if (action is not ("execute" or "complete" or "failed")) return null;

            return new AdaptiveDecision(
                Action: action,
                Title: root.TryGetProperty("title", out var t) ? t.GetString() : null,
                Description: root.TryGetProperty("description", out var d) ? d.GetString() : null,
                Summary: root.TryGetProperty("summary", out var s) ? s.GetString() : null,
                Reason: root.TryGetProperty("reason", out var r) ? r.GetString() : null);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"adaptive decision call failed: {ex.Message}");
            return null;
        }
    }

    private static string RenderStepLog(List<AdaptiveStepRecord> log)
    {
        if (log.Count == 0)
            return "(nothing executed yet — this is the first action)";

        const int maxCharsPerStep = 3000;
        var sb = new StringBuilder();
        foreach (var entry in log)
        {
            sb.AppendLine($"--- Step {entry.Step}: {entry.Title} ---");
            sb.AppendLine(HeadTail(entry.Outcome, maxCharsPerStep));
            sb.AppendLine();
        }
        return sb.ToString();
    }

    private sealed record AdaptiveDecision(
        string Action,
        string? Title,
        string? Description,
        string? Summary,
        string? Reason);
}

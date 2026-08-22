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
        var live = new GoalAdaptiveLiveState();
        goal.AdaptiveLive = live;

        for (var step = 1; step <= AdaptiveMaxSteps; step++)
        {
            await ReachSafePointAsync(goal, context, ct);
            live.SetCurrent("deciding", null);

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
                // Back off between decision retries — a rate-limited provider
                // must not have its 3 attempts burned within one millisecond.
                await DelayInterruptibleAsync(goal, 2 * consecutiveParseFailures, ct);
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
            live.SetCurrent("executing", task.taskTitle);
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
            live.AddStep(step, task.taskTitle, result.Status == GoalPlanStatusValues.Complete, result.Summary ?? result.Error);

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
    /// action. Returns null when the output cannot be parsed (counted against
    /// the circuit breaker). A provider 429 is NOT a parse failure: it runs
    /// the shared backoff loop and then retries the decision transparently.
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

        while (true)
        {
            string output;
            try
            {
                var result = await SubAgentExecutor.ExecuteAsync(
                    input, parameters, parentState, context, toolCallId);
                ct.ThrowIfCancellationRequested();
                output = StripCodeFence(result.Content?.Trim() ?? string.Empty);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                output = ex.Message;
            }

            // Provider rate-limited: run the shared backoff (fast → minute
            // polling → 6h timeout) and retry the same decision. This is not a
            // parse failure and must not consume circuit-breaker attempts.
            if (IsRateLimitText(output))
            {
                var backoffOutcome = await Handle429BackoffAsync(
                    goal, goal.Plans.Count > 0 ? goal.Plans[0] : new GoalPlanItem { PlanId = GoalIds.NewPlanId(), Title = "Adaptive execution", Description = goal.GoalText },
                    step - 1,
                    new PlanExecutionResult { Is429 = true, Error = output },
                    parameters, parentState, context, ct);
                await ReachSafePointAsync(goal, context, ct);
                if (backoffOutcome == BackoffOutcome.Timeout)
                {
                    return null; // caller's breaker will fail the goal with the count
                }
                continue;
            }

            var jsonCandidate = ExtractJsonObject(output) ?? output;
            if (jsonCandidate.Length == 0)
            {
                WorkerLog.Warn($"adaptive decide unparseable output: {HeadTail(output, 300)}");
                return null;
            }

            try
            {
                using var doc = JsonDocument.Parse(jsonCandidate);
                var root = doc.RootElement;
                var action = root.TryGetProperty("action", out var a) ? a.GetString() ?? "" : "";
                if (action is not ("execute" or "complete" or "failed"))
                {
                    WorkerLog.Warn($"adaptive decide unknown action: {HeadTail(output, 300)}");
                    return null;
                }

                return new AdaptiveDecision(
                    Action: action,
                    Title: root.TryGetProperty("title", out var t) ? t.GetString() : null,
                    Description: root.TryGetProperty("description", out var d) ? d.GetString() : null,
                    Summary: root.TryGetProperty("summary", out var s) ? s.GetString() : null,
                    Reason: root.TryGetProperty("reason", out var r) ? r.GetString() : null);
            }
            catch (JsonException)
            {
                WorkerLog.Warn($"adaptive decide unparseable JSON: {HeadTail(output, 300)}");
                return null;
            }
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

using System.Diagnostics;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Orchestration loop for GoalOrchestrator.
/// Manages the serial execution of plans via sub-agents with:
/// - Self-check evaluation (LLM evaluates sub-agent results)
/// - Failure retry (adjust plan → re-spawn sub-agent, max 3 retries)
/// - 429 backoff (fast → minute polling → timeout)
/// </summary>
public static partial class GoalOrchestrator
{
    private const int MaxPlanRetries = 3;

    private static async Task<GoalRunOutcome> RunAsync(
        GoalContext goal,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context)
    {
        var ct = parentState.CancellationToken;
        await ReachSafePointAsync(goal, context, ct);

        // 1. Decompose goal into plans (skip if already has plans from DB recovery)
        if (goal.Plans.Count == 0)
        {
            var decomposition = await DecomposeGoalAsync(
                goal.GoalText, parameters, parentState, context, ct);
            await ReachSafePointAsync(goal, context, ct);

            if (!decomposition.Success || decomposition.Plans.Count == 0)
            {
                return new GoalRunOutcome(
                    GoalStatusValues.Active,
                    GoalEventType.GoalFailed,
                    $"Goal failed: {decomposition.Error ?? "No plans generated"}");
            }

            goal.Plans = decomposition.Plans;
            // Persist immediately so the panel shows the plan list while
            // the first plan is still executing (not 30 min later).
            SyncGoalToDb(goal, parameters);
            // Materialize all plans to goal_plans (best-effort, pending)
            GoalOrchestratorMaterialize.MaterializePlans(goal, parameters);
            await EmitGoalEventAsync(goal, GoalEventType.GoalStarted,
                $"Goal started: {goal.GoalText}. {goal.Plans.Count} plans generated.", context);
        }
        else
        {
            await EmitGoalEventAsync(goal, GoalEventType.GoalStarted,
                $"Goal resumed: {goal.GoalText}. Resuming from plan {Math.Max(0, goal.CurrentPlanIndex) + 1} of {goal.Plans.Count}.", context);
        }

        WriteGoalState(goal);
        SyncGoalToDb(goal, parameters);

        // 2. Serial execution loop — start from where we left off
        var startIndex = goal.Plans.Count > 0 && goal.CurrentPlanIndex >= 0
            ? goal.CurrentPlanIndex + 1 // resume from next plan
            : 0;
        // If the current plan was still executing (not completed/failed), re-execute it
        if (goal.CurrentPlanIndex >= 0 && goal.CurrentPlanIndex < goal.Plans.Count
            && goal.Plans[goal.CurrentPlanIndex].Status is GoalPlanStatusValues.Pending or GoalPlanStatusValues.Active)
        {
            startIndex = goal.CurrentPlanIndex;
        }

        for (int i = startIndex; i < goal.Plans.Count; i++)
        {
            await ReachSafePointAsync(goal, context, ct);
            goal.CurrentPlanIndex = i;
            var plan = goal.Plans[i];

            // Mark the plan as executing and sync immediately so the panel
            // reflects "executing" (and an up-to-date progress count) while
            // the round runs, not only after it finishes.
            if (plan.Status != GoalPlanStatusValues.Complete
                && plan.Status != GoalPlanStatusValues.Aborted)
            {
                plan.Status = GoalPlanStatusValues.Active;
                GoalOrchestratorMaterialize.UpdatePlanStatus(goal, plan, GoalPlanStatusValues.Active, null);
                SyncGoalToDb(goal, parameters);
            }

            // Execute plan with retry + evaluation loop
            await ExecutePlanWithRetryAsync(goal, plan, i, parameters, parentState, context, ct);
            await ReachSafePointAsync(goal, context, ct);
        }

        // 3. Goal completion check
        var allCompleted = goal.Plans.All(p => p.Status == GoalPlanStatusValues.Complete);
        if (allCompleted)
        {
            return new GoalRunOutcome(
                GoalStatusValues.Complete,
                GoalEventType.GoalCompleted,
                "All plans completed successfully");
        }

        var failedCount = goal.Plans.Count(p => p.Status != GoalPlanStatusValues.Complete);
        return new GoalRunOutcome(
            GoalStatusValues.Active,
            GoalEventType.GoalFailed,
            $"Goal failed with {failedCount} incomplete plan(s)");
    }

    private static async Task ExecutePlanWithRetryAsync(
        GoalContext goal,
        GoalPlanItem plan,
        int planIndex,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        CancellationToken ct)
    {
        var maxRetries = MaxPlanRetries;

        // Decompose plan into tasks and materialize them before execution.
        // This happens once per plan (not per retry). On retry/adjust, the
        // same task set is re-executed with updated descriptions.
        var tasks = await DecomposePlanToTasksAsync(goal, plan, parameters, parentState, context, ct);
        await ReachSafePointAsync(goal, context, ct);
        GoalOrchestratorMaterialize.MaterializeTasks(goal, plan, parameters, tasks);
        await EmitGoalEventAsync(goal, GoalEventType.PlanStarted,
            $"Plan {planIndex + 1} decomposed into {tasks.Count} task(s): {plan.Title}", context);

        while (plan.RetryCount <= maxRetries)
        {
            await ReachSafePointAsync(goal, context, ct);

            // Execute tasks sequentially
            var taskResults = new List<string>();
            var allTasksSucceeded = true;
            string? lastError = null;
            bool was429 = false;

            foreach (var task in tasks)
            {
                await ReachSafePointAsync(goal, context, ct);

                // Mark task as active
                GoalOrchestratorMaterialize.UpdateTaskStatus(goal, plan, task.taskId, GoalPlanStatusValues.Active, null);

                // Start execution attempt
                string? attemptId = GoalOrchestratorMaterialize.StartExecutionAttempt(goal, plan, plan.RetryCount + 1);

                // Mirror into goal_plan_tasks (legacy round records)
                var roundTaskId = GoalPlanRecorder.StartRound(parameters, goal, plan, plan.RetryCount + 1);

                // Execute the task
                var result = await ExecuteTaskAsync(goal, plan, task, parameters, parentState, context, ct);
                await ReachSafePointAsync(goal, context, ct);

                // Handle 429
                if (result.Is429)
                {
                    was429 = true;
                    lastError = result.Error;
                    GoalOrchestratorMaterialize.FinishExecutionAttempt(goal, plan, attemptId, GoalExecutionAttemptStatusValues.Interrupted, result.Summary, "429");
                    GoalPlanRecorder.FinishRound(parameters, roundTaskId, GoalExecutionAttemptStatusValues.Failed, result.Summary, "429 backoff", false);
                    GoalOrchestratorMaterialize.UpdateTaskStatus(goal, plan, task.taskId, GoalPlanStatusValues.Active, "429 backoff");
                    break;
                }

                // Finish attempt and round record
                var attemptStatus = result.Status == GoalPlanStatusValues.Complete
                    ? GoalExecutionAttemptStatusValues.Completed
                    : GoalExecutionAttemptStatusValues.Failed;
                GoalOrchestratorMaterialize.FinishExecutionAttempt(goal, plan, attemptId, attemptStatus, result.Summary, result.Error);
                GoalPlanRecorder.FinishRound(parameters, roundTaskId, attemptStatus, result.Summary, result.Error, attemptStatus == GoalExecutionAttemptStatusValues.Completed);

                if (result.Status == GoalPlanStatusValues.Complete)
                {
                    GoalOrchestratorMaterialize.UpdateTaskStatus(goal, plan, task.taskId, GoalPlanStatusValues.Complete, result.Summary);
                    taskResults.Add($"✓ {task.title}: {result.Summary}");
                }
                else
                {
                    allTasksSucceeded = false;
                    lastError = result.Error;
                    GoalOrchestratorMaterialize.UpdateTaskStatus(goal, plan, task.taskId, GoalPlanStatusValues.Active, result.Error);
                    taskResults.Add($"✗ {task.title}: {result.Error}");
                    break;
                }
            }

            // Handle 429 backoff
            if (was429)
            {
                var (backoffOutcome, backoffResult) = await Handle429BackoffAsync(
                    goal, plan, planIndex,
                    new PlanExecutionResult { Is429 = true, Error = lastError, RetryAfterHint = null },
                    parameters, parentState, context, ct);
                await ReachSafePointAsync(goal, context, ct);

                if (backoffOutcome == BackoffOutcome.Timeout)
                {
                    plan.Status = GoalPlanStatusValues.Active;
                    plan.ResultSummary = "Rate limit timeout after 6 hours";
                    GoalOrchestratorMaterialize.UpdatePlanStatus(goal, plan, GoalPlanStatusValues.Active, plan.ResultSummary);
                    await EmitGoalEventAsync(goal, GoalEventType.PlanFailed,
                        $"Plan {planIndex + 1} failed: rate limit timeout", context);
                    return;
                }
                if (backoffResult != null)
                {
                    // 429 resolved — continue to retry the remaining tasks
                    continue;
                }
                continue;
            }

            // Self-check evaluation of the combined task results
            var combinedResult = string.Join("\n", taskResults);
            var evaluation = await EvaluateResultAsync(
                goal, plan,
                new PlanExecutionResult { Summary = combinedResult, Status = allTasksSucceeded ? GoalPlanStatusValues.Complete : GoalExecutionAttemptStatusValues.Failed },
                parameters, parentState, context, ct);
            await ReachSafePointAsync(goal, context, ct);

            if (evaluation.Satisfied)
            {
                plan.Status = GoalPlanStatusValues.Complete;
                plan.ResultSummary = evaluation.Reasoning ?? combinedResult;
                GoalOrchestratorMaterialize.UpdatePlanStatus(goal, plan, GoalPlanStatusValues.Complete, plan.ResultSummary);
                GoalPlanTracker.FinishPlan(goal.WorkingFolder, goal.GoalId, plan);
                await EmitGoalEventAsync(goal, GoalEventType.PlanCompleted,
                    $"Plan {planIndex + 1} completed: {plan.Title}. {plan.ResultSummary}", context);
                WriteGoalState(goal);
                SyncGoalToDb(goal, parameters);
                return;
            }

            // Not satisfied: retry or adjust
            if (plan.RetryCount >= maxRetries)
            {
                plan.Status = GoalPlanStatusValues.Active;
                plan.ResultSummary = $"Failed after {maxRetries} retries: {evaluation.Reasoning}";
                GoalOrchestratorMaterialize.UpdatePlanStatus(goal, plan, GoalPlanStatusValues.Active, plan.ResultSummary);
                GoalPlanTracker.FinishPlan(goal.WorkingFolder, goal.GoalId, plan);
                await EmitGoalEventAsync(goal, GoalEventType.PlanFailed,
                    $"Plan {planIndex + 1} failed after {maxRetries} retries: {evaluation.Reasoning}", context);
                WriteGoalState(goal);
                SyncGoalToDb(goal, parameters);
                return;
            }

            // Adjust plan based on evaluation
            await ReachSafePointAsync(goal, context, ct);
            plan.RetryCount++;
            if (evaluation.NextAction == "adjust" && !string.IsNullOrEmpty(evaluation.AdjustedDescription))
            {
                plan.Description = evaluation.AdjustedDescription;
                plan.OriginalPlanId ??= plan.PlanId;
                plan.PlanId = $"plan-{Guid.NewGuid():N}".Substring(0, 16);
                await EmitGoalEventAsync(goal, GoalEventType.PlanAdjusted,
                    $"Plan {planIndex + 1} adjusted (retry {plan.RetryCount}): {evaluation.Reasoning}", context);
                GoalPlanTracker.AppendLog(goal.WorkingFolder, goal.GoalId, plan.PlanId, $"Adjusted (retry {plan.RetryCount}): {evaluation.Reasoning}");
            }
            else
            {
                await EmitGoalEventAsync(goal, GoalEventType.PlanRetried,
                    $"Plan {planIndex + 1} retry {plan.RetryCount}: {evaluation.Reasoning}", context);
                GoalPlanTracker.AppendLog(goal.WorkingFolder, goal.GoalId, plan.PlanId, $"Retry {plan.RetryCount}: {evaluation.Reasoning}");
            }

            WriteGoalState(goal);
            SyncGoalToDb(goal, parameters);
        }
    }

    // ─── 429 Backoff ───

    private enum BackoffOutcome { Resolved, Timeout }

    private static async Task<(BackoffOutcome outcome, PlanExecutionResult? result)> Handle429BackoffAsync(
        GoalContext goal,
        GoalPlanItem plan,
        int planIndex,
        PlanExecutionResult result,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        CancellationToken ct)
    {
        var attempt = 0;
        var totalWaitedSeconds = 0L;

        while (true)
        {
            await ReachSafePointAsync(goal, context, ct);

            var (delaySeconds, phase) = GoalBackoffStrategy.CalculateBackoff(
                attempt, result.RetryAfterHint);

            if (phase == "timeout")
            {
                await EmitGoalEventAsync(goal, GoalEventType.BackoffStarted,
                    GoalBackoffStrategy.GetStatusMessage(attempt, phase, totalWaitedSeconds), context);
                GoalPlanTracker.AppendLog(goal.WorkingFolder, goal.GoalId, plan.PlanId, $"429 backoff: {GoalBackoffStrategy.GetStatusMessage(attempt, phase, totalWaitedSeconds)}");
                return (BackoffOutcome.Timeout, null);
            }

            await EmitGoalEventAsync(goal, GoalEventType.BackoffStarted,
                GoalBackoffStrategy.GetStatusMessage(attempt, phase, totalWaitedSeconds), context);

            await Task.Delay(delaySeconds * 1000, ct);
            totalWaitedSeconds += delaySeconds;
            await ReachSafePointAsync(goal, context, ct);

            // Try a quick test request to see if 429 is resolved
            // Re-execute the plan — if it succeeds, backoff is resolved
            // If it fails with 429 again, continue the backoff loop
            var retryResult = await ExecutePlanAsync(
                goal, plan, parameters, parentState, context, ct);
            await ReachSafePointAsync(goal, context, ct);

            if (!retryResult.Is429)
            {
                await EmitGoalEventAsync(goal, GoalEventType.BackoffResolved,
                    $"Rate limit resolved after {totalWaitedSeconds / 60} min", context);
                // Return the test result so the caller can use it for evaluation
                return (BackoffOutcome.Resolved, retryResult);
            }

            attempt++;
            await EmitGoalEventAsync(goal, GoalEventType.BackoffProgress,
                GoalBackoffStrategy.GetStatusMessage(attempt, phase, totalWaitedSeconds), context);
        }
    }

    // ─── Self-check Evaluation ───

    private static async Task<EvaluationResult> EvaluateResultAsync(
        GoalContext goal,
        GoalPlanItem plan,
        PlanExecutionResult result,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        CancellationToken ct)
    {
        // Use LLM-based evaluation via sub-agent
        var executionResultText = !string.IsNullOrEmpty(result.Summary)
            ? result.Summary
            : result.Error ?? "No output";

        ct.ThrowIfCancellationRequested();
        var evaluation = await EvaluateViaLlmAsync(
            goal.GoalText,
            plan.Title,
            plan.Description,
            executionResultText,
            parameters,
            parentState,
            context,
            ct);
        ct.ThrowIfCancellationRequested();
        return evaluation;
    }

    // ─── Plan Execution ───

    private static async Task<PlanExecutionResult> ExecutePlanAsync(
        GoalContext goal,
        GoalPlanItem plan,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var stopwatch = Stopwatch.StartNew();
        await EmitGoalEventAsync(goal, GoalEventType.PlanStarted,
            $"Plan started: {plan.Title}", context);

        GoalPlanTracker.StartPlan(goal.WorkingFolder, goal.GoalId, plan);
        var prompt = BuildPlanExecutionPrompt(plan.Title, plan.Description);
        var input = CreateTaskInput(
            prompt,
            $"Plan: {plan.Title}",
            "custom",
            GoalPromptTemplates.ExecutionSystemPrompt);
        var toolCallId = $"goal-plan-{plan.PlanId}-{Guid.NewGuid():N}";

        // Tag this run with the goal context so forwarded sub-agent events
        // also reach the Goal panel as goal_activity events (live feed).
        parentState.GoalEventContext = new GoalEventContext(
            goal.GoalId, plan.PlanId, plan.RetryCount + 1, plan.Title);

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
                    Title = plan.Title,
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
                Title = plan.Title,
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
                Title = plan.Title,
                Status = GoalExecutionAttemptStatusValues.Failed,
                Error = ex.Message,
                Is429 = ex.Message.Contains("429") || ex.Message.Contains("Too Many Requests", StringComparison.OrdinalIgnoreCase),
                RetryCount = plan.RetryCount,
                ElapsedMs = stopwatch.ElapsedMilliseconds
            };
        }
    }


    // ─── State Persistence ───

    private static void WriteGoalState(GoalContext goal)
    {
        if (string.IsNullOrEmpty(goal.WorkingFolder))
            return;

        GoalFileTools.WriteGoalFile(goal.WorkingFolder, goal.GoalId, goal.GoalText, goal.Plans);
        var state = GoalFileTools.ReadGoalState(goal.WorkingFolder, goal.GoalId) ?? new GoalState
        {
            GoalId = goal.GoalId,
            GoalText = goal.GoalText,
            CreatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };

        state.Status = goal.Status;
        state.CurrentPlanIndex = goal.CurrentPlanIndex;
        state.Plans = goal.Plans;
        state.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        GoalFileTools.WriteGoalState(goal.WorkingFolder, goal.GoalId, state);
    }

    // ─── DB Persistence ───

    private static void SyncGoalToDb(
        GoalContext goal,
        JsonElement parameters,
        string? statusEventMessage = null)
    {
        try
        {
            // Build the update parameters: exact persisted identity + patch fields.
            var updateParams = WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                w.WriteString("sessionId", goal.SessionId);
                w.WriteString("goalId", goal.GoalId);
                if (!string.IsNullOrEmpty(statusEventMessage))
                    w.WriteString("statusEventMessage", statusEventMessage);
                w.WriteStartObject("patch");
                w.WriteString("status", goal.Status);
                w.WriteNumber("currentPlanIndex", goal.CurrentPlanIndex);
                w.WriteNumber("planCount", goal.Plans.Count);
                w.WriteNumber("completedPlanCount", goal.Plans.Count(p => p.Status == GoalPlanStatusValues.Complete));
                if (goal.Plans.Count > 0)
                {
                    w.WritePropertyName("plansJson");
                    JsonSerializer.Serialize(w, goal.Plans, AgentRuntimeJsonContext.Default.ListGoalPlanItem);
                }
                w.WriteEndObject();
                w.WriteEndObject();
            });

            DbGoalTools.Update(updateParams);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"Failed to sync goal to DB: {ex.Message}");
        }
    }

    /// <summary>
    /// Stop at a lifecycle safe point. Abort is immediate; Pause waits without
    /// cancelling the current sub-agent and resumes from the same control point.
    /// </summary>
    private static async Task ReachSafePointAsync(
        GoalContext goal, IWorkerRequestContext context, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if (goal.RunState != GoalRunStateValues.Paused)
            return;

        await EmitGoalEventAsync(goal, GoalEventType.GoalPaused, "Goal paused", context);
        while (goal.RunState == GoalRunStateValues.Paused)
        {
            await Task.Delay(250, ct);
        }

        ct.ThrowIfCancellationRequested();
        await EmitGoalEventAsync(goal, GoalEventType.GoalResumed, "Goal resumed", context);
    }
}

// ─── Evaluation Result Model ───

public sealed class EvaluationResult
{
    public bool Satisfied { get; set; }
    public string? Reasoning { get; set; }
    public string NextAction { get; set; } = "proceed"; // proceed | retry | adjust
    public string? AdjustedDescription { get; set; }
}

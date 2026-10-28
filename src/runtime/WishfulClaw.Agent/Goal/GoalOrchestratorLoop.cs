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

    /// <summary>
    /// Orchestration entry point. Routes to the free-form adaptive loop
    /// (LLM decides every step, plans adapt mid-flight). The legacy fixed
    /// pipeline (decompose → fixed plan list → sequential tasks) is superseded;
    /// kept until iter-20 cleanup confirms the adaptive loop in production.
    /// </summary>
    private static Task<GoalRunOutcome> RunAsync(
        GoalContext goal,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context)
    {
        return RunAdaptiveAsync(goal, parameters, parentState, context);
    }

    /// <summary>
    /// SUPERSEDED fixed pipeline — kept for reference only. See
    /// GoalOrchestratorAdaptive.RunAdaptiveAsync for the active orchestration.
    /// </summary>
#pragma warning disable CS8321 // unused local function retained deliberately
    private static async Task<GoalRunOutcome> RunLegacyFixedPipelineAsync(
        GoalContext goal,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context)
#pragma warning restore CS8321
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

        // Cross-round state: completed tasks survive retries and 429 backoff so
        // the foreach below resumes from the first incomplete task instead of
        // re-executing everything from scratch.
        var completedTaskIds = new HashSet<string>();
        var taskResultsById = new Dictionary<string, string>();

        while (plan.RetryCount <= maxRetries)
        {
            await ReachSafePointAsync(goal, context, ct);

            // Execute tasks sequentially
            var allTasksSucceeded = true;
            string? lastError = null;
            bool was429 = false;

            foreach (var task in tasks)
            {
                await ReachSafePointAsync(goal, context, ct);

                // Resume support: skip tasks already completed in an earlier round.
                if (completedTaskIds.Contains(task.taskId)) continue;

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
                    completedTaskIds.Add(task.taskId);
                    taskResultsById[task.taskId] = $"✓ {task.title}: {result.Summary}";
                }
                else
                {
                    allTasksSucceeded = false;
                    lastError = result.Error;
                    GoalOrchestratorMaterialize.UpdateTaskStatus(goal, plan, task.taskId, GoalPlanStatusValues.Active, result.Error);
                    taskResultsById[task.taskId] = $"✗ {task.title}: {result.Error}";
                    break;
                }
            }

            // Handle 429 backoff
            if (was429)
            {
                var backoffOutcome = await Handle429BackoffAsync(
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
                // 429 resolved — the while loop re-enters the foreach, which
                // resumes from the first incomplete task (completed ones skip).
                continue;
            }

            // Self-check evaluation of the combined task results
            var combinedResult = string.Join("\n", taskResultsById.Values);
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
                // Close the DB loop before switching identity: mark the old
                // goal_plans row superseded, re-parent its tasks to the new
                // id, then insert the new plan row so subsequent
                // UpdatePlanStatus / UpdateTaskStatus calls find real rows.
                var oldPlanId = plan.PlanId;
                var newPlanId = GoalIds.NewPlanId();
                var supersededSummary = $"Superseded by adjust (retry {plan.RetryCount}): {evaluation.Reasoning}";
                GoalOrchestratorMaterialize.MarkPlanSuperseded(goal, oldPlanId, supersededSummary);
                GoalOrchestratorMaterialize.ReparentTasksToPlan(goal, oldPlanId, newPlanId);

                plan.Description = evaluation.AdjustedDescription;
                plan.OriginalPlanId ??= oldPlanId;
                plan.PlanId = newPlanId;
                GoalOrchestratorMaterialize.InsertAdjustedPlan(goal, plan, planIndex);
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
}

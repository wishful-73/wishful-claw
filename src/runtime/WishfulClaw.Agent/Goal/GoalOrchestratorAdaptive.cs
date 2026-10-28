using System.Diagnostics;
using System.Text;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Free-form adaptive orchestration loop (user-directed redesign): the goal is
/// a long-running autonomous sub-agent that may run for days. It is NOT
/// pre-decomposed into a fixed plan list; each step an LLM decision call sees
/// the objective plus everything executed so far and picks the next action —
/// execute a task, declare complete, or declare failure.
///
/// Termination contract (user-confirmed):
///   - the LLM itself declares complete/failed,
///   - the user aborts the goal, or
///   - (future) the optional token budget runs out.
/// Infrastructure failures NEVER terminate the run: decision failures retry
/// with exponential backoff (capped at 10 minutes); 429s use the shared
/// backoff. A repetition-detector injects system reminders when the loop
/// spins instead of hard-killing it.
///
/// DB compatibility: everything is recorded under one synthetic plan row
/// ("Adaptive execution") so the existing goal_plans/goal_tasks tables and
/// the panel's query path keep working unchanged.
/// </summary>
public static partial class GoalOrchestrator
{
    /// <summary>Backoff ceiling for decision retries (10 minutes).</summary>
    private const int AdaptiveDecisionRetryCapSeconds = 600;
    /// <summary>Consecutive near-identical actions before a spin reminder is injected.</summary>
    private const int AdaptiveSpinReminderThreshold = 5;
    /// <summary>A milestone event is recorded every N successful steps.</summary>
    private const int AdaptiveMilestoneEverySuccesses = 5;


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
        // Idempotent per goal: reuse the existing adaptive plan row instead of
        // inserting a new one on every start/resume (multiple "Adaptive
        // execution" rows made the panel show several concurrent plans).
        var plan = goal.Plans.FirstOrDefault(p => p.Title == "Adaptive execution")
            ?? goal.Plans.FirstOrDefault();
        if (plan == null)
        {
            plan = new GoalPlanItem
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
            PersistAdaptiveProgressStrict(goal, plan, parameters);
        }
        else if (plan.Status != GoalPlanStatusValues.Active)
        {
            plan.Status = GoalPlanStatusValues.Active;
            GoalOrchestratorMaterialize.UpdatePlanStatus(goal, plan, GoalPlanStatusValues.Active, null);
            SyncGoalToDb(goal, parameters);
        }
        WriteGoalState(goal);

        var log = new List<AdaptiveStepRecord>();
        var decisionRetrySeconds = 0;
        var successesSinceMilestone = 0;
        var milestoneBase = 0;
        var live = new GoalAdaptiveLiveState();
        goal.AdaptiveLive = live;
        var step = 0;

        // One continuous AgentLoop conversation owns the Goal. Each turn gets
        // its own execution ledger row, but the Goal context remains stable.
        while (true)
        {
            step++;
            await ReachSafePointAsync(goal, context, ct);
            live.SetCurrent(GoalPlanStatusValues.Active, "Goal sub-agent turn");
            var attemptId = DbGoalExecutionRunTools.InsertRun(goal.GoalId, plan.PlanId, null, step);
            var turnPrompt = BuildGoalTurnPrompt(goal, plan, log, step);
            GoalSubAgentExecutor.TurnResult turn;
            try
            {
                turn = await GoalSubAgentExecutor.ExecuteTurnAsync(
                    goal, parameters, parentState, context, turnPrompt);
                var output = turn.Output?.Trim() ?? string.Empty;
                var complete = TryReadGoalCompletion(output, out var completionSummary);
                var summary = string.IsNullOrWhiteSpace(output) ? "Goal turn produced no report" : output;
                var turnSucceeded = !string.IsNullOrWhiteSpace(output);
                var finish = DbGoalExecutionRunTools.FinishRun(
                    attemptId,
                    turnSucceeded ? GoalExecutionAttemptStatusValues.Completed : GoalExecutionAttemptStatusValues.Failed,
                    summary,
                    turnSucceeded ? null : "Goal turn produced no report");
                EnsureExecutionPersisted(finish, attemptId);

                log.Add(new AdaptiveStepRecord(step, "Goal sub-agent turn", turnPrompt, summary));
                live.AddStep(step, "Goal sub-agent turn", complete, summary);
                plan.ResultSummary = summary;
                plan.Status = complete ? GoalPlanStatusValues.Complete : GoalPlanStatusValues.Active;
                PersistAdaptiveProgressStrict(goal, plan, parameters);

                if (complete)
                {
                    return new GoalRunOutcome(
                        GoalStatusValues.Complete,
                        GoalEventType.GoalCompleted,
                        completionSummary ?? summary);
                }

                decisionRetrySeconds = 0;
                successesSinceMilestone++;
                if (successesSinceMilestone >= AdaptiveMilestoneEverySuccesses)
                {
                    RecordAdaptiveMilestone(goal, parameters, milestoneBase + successesSinceMilestone, log);
                    milestoneBase += successesSinceMilestone;
                    successesSinceMilestone = 0;
                }
                live.SetCurrent("idle", null);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                var finish = DbGoalExecutionRunTools.FinishRun(
                    attemptId, GoalExecutionAttemptStatusValues.Interrupted,
                    "Goal turn interrupted", "Cancellation requested");
                EnsureExecutionPersisted(finish, attemptId);
                throw;
            }
            catch (Exception ex)
            {
                var finish = DbGoalExecutionRunTools.FinishRun(
                    attemptId, GoalExecutionAttemptStatusValues.Failed,
                    null, ex.Message);
                EnsureExecutionPersisted(finish, attemptId);
                log.Add(new AdaptiveStepRecord(step, "Goal sub-agent turn", turnPrompt, $"FAILED. Error:\n{ex.Message}"));
                live.AddStep(step, "Goal sub-agent turn", false, ex.Message);
                plan.Status = GoalPlanStatusValues.Active;
                plan.ResultSummary = ex.Message;
                PersistAdaptiveProgressStrict(goal, plan, parameters);

                decisionRetrySeconds = decisionRetrySeconds == 0
                    ? 2
                    : Math.Min(decisionRetrySeconds * 2, AdaptiveDecisionRetryCapSeconds);
                WorkerLog.Warn($"goal sub-agent turn failed; Goal remains active and retries in {decisionRetrySeconds}s");
                live.SetCurrent("idle", null);
                await DelayInterruptibleAsync(goal, decisionRetrySeconds, ct);
            }
        }
    }

    private static string BuildGoalTurnPrompt(
        GoalContext goal,
        GoalPlanItem plan,
        List<AdaptiveStepRecord> log,
        int step)
    {
        var history = RenderStepLog(log);
        return $"Goal: {goal.GoalText}\n\n" +
               $"Current turn: {step}\n" +
               $"Persisted plan: {plan.Title}\n{plan.Description}\n\n" +
               $"Previous Goal Agent reports:\n{HeadTail(history, 12000)}\n\n" +
               "Continue from the current workspace and Goal context. Make one concrete, verifiable unit of progress in this turn, then report evidence and the next continuation point.";
    }

    private static bool TryReadGoalCompletion(string output, out string? summary)
    {
        summary = null;
        const string prefix = "<goal-complete>";
        const string suffix = "</goal-complete>";
        var start = output.LastIndexOf(prefix, StringComparison.OrdinalIgnoreCase);
        if (start < 0) return false;
        var end = output.IndexOf(suffix, start + prefix.Length, StringComparison.OrdinalIgnoreCase);
        if (end < 0) return false;
        summary = output[(start + prefix.Length)..end].Trim();
        return summary.Length > 0;
    }

    private static void EnsureExecutionPersisted(
        ExecutionRunMutationResult result,
        string attemptId)
    {
        if (!result.Success)
            throw new InvalidOperationException(
                $"Execution persistence failed for {attemptId}: {result.Error ?? "unknown error"}");
    }

    private static void PersistAdaptiveProgressStrict(
        GoalContext goal,
        GoalPlanItem plan,
        JsonElement parameters)
    {
        var plansJson = JsonSerializer.Serialize(
            goal.Plans,
            AgentRuntimeJsonContext.Default.ListGoalPlanItem);
        var updateParams = WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("sessionId", goal.SessionId);
            writer.WriteString("goalId", goal.GoalId);
            writer.WriteString("statusEventMessage", "Goal sub-agent progress persisted");
            writer.WriteStartObject("patch");
            writer.WriteString("status", GoalStatusValues.Active);
            writer.WriteNumber("currentPlanIndex", goal.CurrentPlanIndex);
            writer.WriteNumber("planCount", goal.Plans.Count);
            writer.WriteNumber("completedPlanCount", goal.Plans.Count(p => p.Status == GoalPlanStatusValues.Complete));
            if (!string.IsNullOrWhiteSpace(goal.ModelConfigJson))
                writer.WriteString("modelConfigJson", goal.ModelConfigJson);
            writer.WriteString("plansJson", plansJson);
            writer.WriteEndObject();
            writer.WriteEndObject();
        });

        var updatedGoal = DbGoalTools.UpdateByGoalId(updateParams)
            ?? throw new InvalidOperationException($"Goal persistence failed for {goal.GoalId}");
        if (!string.Equals(updatedGoal.Status, GoalStatusValues.Active, StringComparison.Ordinal))
            throw new InvalidOperationException($"Goal persistence returned unexpected status {updatedGoal.Status}");

        var planMutation = DbGoalPlanTools.UpdatePlanStatus(
            plan.PlanId, goal.GoalId, goal.SessionId, plan.Status, plan.ResultSummary);
        if (planMutation is null)
            throw new InvalidOperationException($"Plan status persistence failed for {plan.PlanId}");

        var snapshotJson = JsonSerializer.Serialize(
            plan,
            AgentRuntimeJsonContext.Default.GoalPlanItem);
        var snapshot = DbGoalPlanTools.UpdatePlanSnapshot(
            plan.PlanId, goal.GoalId, goal.SessionId, snapshotJson);
        if (!snapshot.Success)
            throw new InvalidOperationException(
                $"Plan snapshot persistence failed for {plan.PlanId}: {snapshot.Error ?? "unknown error"}");
    }

    /// <summary>
    /// Record a milestone goal_event summarizing the last N successful steps —
    /// a lightweight timeline entry for long runs (no notification spam).
    /// </summary>
    private static void RecordAdaptiveMilestone(
        GoalContext goal, JsonElement parameters, int stepsDone, List<AdaptiveStepRecord> log)
    {
        try
        {
            var recentTitles = string.Join("; ", log.TakeLast(AdaptiveMilestoneEverySuccesses).Select(s => s.Title));
            var message = $"Milestone: {stepsDone} steps completed. Recent: {recentTitles}";
            var eventParams = WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                w.WriteString("sessionId", goal.SessionId);
                w.WriteString("goalId", goal.GoalId);
                w.WriteString("eventType", "goal_milestone");
                w.WriteString("message", message);
                w.WriteNumber("timestamp", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                w.WriteEndObject();
            });
            DbGoalTools.AddEvent(eventParams);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"adaptive milestone event failed: {ex.Message}");
        }
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
}

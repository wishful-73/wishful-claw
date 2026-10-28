using System.Diagnostics;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Goal state persistence (file lock + DB sync), safe points and self-check evaluation,
/// plus the namespace-level EvaluationResult type they share.
/// Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
public static partial class GoalOrchestrator
{
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

        // Give the evaluator the host-observed receipts alongside the model's
        // own report: claims are checked against what actually ran.
        if (!string.IsNullOrEmpty(result.EvidenceDigest))
        {
            executionResultText += "\n\n=== Host-observed evidence (from the tool runtime, not the model) ===\n"
                + result.EvidenceDigest;
        }

        // Head+tail bound for the evaluation prompt: keeps the report's tail
        // (Verification lines) instead of a head-only Substring cut.
        executionResultText = StripCodeFence(HeadTail(executionResultText));

        ct.ThrowIfCancellationRequested();
        var evaluation = await EvaluateViaLlmAsync(
            goal.GoalText,
            plan.Title,
            plan.Description,
            executionResultText,
            result.Status == GoalPlanStatusValues.Complete,
            parameters,
            parentState,
            context,
            ct);
        ct.ThrowIfCancellationRequested();
        return evaluation;
    }

    // ─── State Persistence ───

    /// <summary>
    /// Serialize state.json writes: the read-modify-write cycle in
    /// UpdatePlanInState is not concurrency-safe, so concurrent Goals sharing
    /// one working folder must not interleave (single-goal sessions never hit
    /// this, but the lock costs nothing).
    /// Scope note: this guards the FILE archive only. The DB sync
    /// (SyncGoalToDb) is an independent best-effort channel and is
    /// deliberately NOT under this lock — file and DB archives are not
    /// required to be transactionally consistent with each other.
    /// </summary>
    private static readonly object GoalStateFileSync = new();

    private static void WriteGoalState(GoalContext goal)
    {
        if (string.IsNullOrEmpty(goal.WorkingFolder))
            return;

        try
        {
            lock (GoalStateFileSync)
            {
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
        }
        catch (Exception ex)
        {
            // File archive is best-effort — same contract as the DB sync below.
            // A read-only folder or locked file must not kill the orchestration loop.
            WorkerLog.Warn($"Failed to write goal state file (goal={goal.GoalId}): {ex.Message}");
        }
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
                if (!string.IsNullOrWhiteSpace(goal.ModelConfigJson))
                    w.WriteString("modelConfigJson", goal.ModelConfigJson);
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

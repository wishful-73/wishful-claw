/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Goal creation confirmation flow: await user confirmation, abort pending goal, finalize failure. Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
public static partial class AgentRuntimeGoalExecutor
{
    private static async Task<string> AwaitGoalConfirmationAsync(
        string goalId,
        string sessionId,
        string goalText,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        // Notify the frontend of the pending goal via reverse request (blocking)
        // The agent waits until the user confirms or discards the goal.
        var confirmParams = WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("goalId", goalId);
            w.WriteString("sessionId", sessionId);
            w.WriteString("objective", goalText);
            w.WriteString("status", "pending");
            w.WriteEndObject();
        });

        try
        {
            var response = await AgentRuntimeReverseRequests.RequestAsync(
                context, "goal/confirm-request", confirmParams, cancellationToken);

            var confirmed = response.TryGetProperty("confirmed", out var c) && c.GetBoolean();
            var modelConfigJson = response.TryGetProperty("modelConfig", out var modelConfig)
                ? BuildGoalModelConfigJson(modelConfig)
                : null;
            if (confirmed && string.IsNullOrWhiteSpace(modelConfigJson))
                return EncodeError("A provider and model must be selected before confirming the Goal.");
            if (confirmed)
            {
                var pending = GoalOrchestrator.GetPendingGoal(goalId);
                if (pending == null)
                    return EncodeError("Pending goal no longer exists.");

                var row = DbGoalTools.ConfirmByGoalId(
                    goalId,
                    sessionId,
                    modelConfigJson,
                    "Goal confirmed and started");
                if (row == null)
                    return EncodeError("Pending goal changed before confirmation.");

                var started = await GoalOrchestrator.ConfirmGoalAsync(
                    goalId,
                    sessionId,
                    pending.WorkingFolder,
                    pending.Parameters,
                    context,
                    modelConfigJson);
                if (!started)
                {
                    GoalOrchestrator.RemovePendingGoal(goalId);
                    DbGoalTools.SetStatusByGoalId(
                        goalId,
                        sessionId,
                        GoalStatusValues.Active,
                        GoalStatusValues.Active,
                        "Goal confirmation could not start the orchestrator; Goal remains resumable");
                    return EncodeError("Goal confirmation could not start the orchestrator.");
                }

                // Same event contract as the HTTP confirm path (GoalModule):
                // the frontend run badge must flip to running immediately,
                // not when the first goal_progress arrives after decomposition.
                await GoalOrchestrator.EmitRunStateChangedAsync(
                    sessionId,
                    new GoalActionResult(
                        true,
                        "started",
                        GoalStatusValues.Active,
                        GoalRunStateValues.Running,
                        goalId),
                    context);

                return EncodePersistedGoal(row);
            }

            AbortPendingGoal(goalId, sessionId, "Goal was cancelled before confirmation");
            return EncodeError("Goal was cancelled by user.");
        }
        catch (OperationCanceledException)
        {
            FinalizeConfirmationFailure(
                goalId,
                sessionId,
                GoalStatusValues.Aborted,
                "Goal confirmation was cancelled");
            return EncodeError("Goal confirmation was cancelled.");
        }
        catch (Exception ex)
        {
            // Startup failure is a system-side event: the business status
            // stays active (only a user cancel produces aborted). The goal
            // remains resumable; FinalizeConfirmationFailure only clears the
            // pending-goal memory and records the failure event.
            FinalizeConfirmationFailure(
                goalId,
                sessionId,
                GoalStatusValues.Active,
                $"Goal confirmation failed: {ex.Message}");
            return EncodeError($"Goal confirmation failed: {ex.Message}");
        }
    }

    private static void AbortPendingGoal(
        string goalId,
        string sessionId,
        string message)
    {
        DbGoalTools.SetStatusByGoalId(
            goalId,
            sessionId,
            GoalStatusValues.Pending,
            GoalStatusValues.Aborted,
            message);
        GoalOrchestrator.RemovePendingGoal(goalId);
    }

    private static void FinalizeConfirmationFailure(
        string goalId,
        string sessionId,
        string activeTerminalStatus,
        string message)
    {
        // A system-side confirmation failure must not turn the Goal into a
        // terminal aborted record. Keep it active and resumable; only an
        // explicit user cancellation uses the pending -> aborted transition.
        DbGoalTools.SetStatusByGoalId(
            goalId,
            sessionId,
            GoalStatusValues.Pending,
            activeTerminalStatus,
            message);
        DbGoalTools.SetStatusByGoalId(
            goalId,
            sessionId,
            GoalStatusValues.Active,
            activeTerminalStatus,
            message);
        GoalOrchestrator.RemovePendingGoal(goalId);
    }
}

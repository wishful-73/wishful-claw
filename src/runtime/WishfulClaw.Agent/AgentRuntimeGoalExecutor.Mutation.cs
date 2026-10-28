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
/// Goal tool mutations: create/reopen/update/pause/resume/abort and their result encoders. Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
public static partial class AgentRuntimeGoalExecutor
{
    private static async Task<string> CreateGoalAsync(
        JsonElement input,
        string sessionId,
        JsonElement parameters,
        CancellationToken cancellationToken,
        IWorkerRequestContext context)
    {
        var objective = JsonHelpers.GetString(input, "objective")?.Trim() ?? string.Empty;
        if (objective.Length == 0)
            return EncodeError("create_goal requires a non-empty objective.");

        var pendingGoalId = GoalOrchestrator.GetPendingGoalId(sessionId);
        if (pendingGoalId != null)
        {
            var pending = GoalOrchestrator.GetPendingGoal(pendingGoalId);
            if (pending != null)
            {
                await GoalOrchestrator.EmitPendingGoalAsync(
                    pending.GoalId,
                    sessionId,
                    pending.GoalText,
                    context);
                return EncodeResult(new GoalToolResult(
                    PendingGoal(pending),
                    PendingProgress()));
            }
        }

        var persisted = DbGoalTools.GetBySessionId(sessionId);
        if (persisted != null && !GoalStatusValues.IsTerminal(persisted.Status))
            return EncodePersistedGoal(persisted);

        var workingFolder = JsonHelpers.GetString(parameters, "workingFolder");
        var goalId = GoalIds.NewGoalId();
        try
        {
            DbGoalTools.CreateCurrentGoal(BuildCreateParameters(
                sessionId,
                goalId,
                objective,
                workingFolder,
                GoalStatusValues.Pending));
        }
        catch (Exception ex)
        {
            return EncodeError($"Goal could not be created: {ex.Message}");
        }

        GoalOrchestrator.CreatePendingGoal(
            goalId,
            objective,
            sessionId,
            workingFolder,
            parameters);
        return await AwaitGoalConfirmationAsync(
            goalId,
            sessionId,
            objective,
            context,
            cancellationToken);
    }

    private static async Task<string> ReopenGoalAsync(
        JsonElement input,
        string sessionId,
        JsonElement parameters,
        CancellationToken cancellationToken,
        IWorkerRequestContext context)
    {
        var sourceGoalId = JsonHelpers.GetString(input, "goalId")?.Trim() ?? string.Empty;
        if (sourceGoalId.Length == 0)
            return EncodeError("reopen_goal requires goalId.");

        var result = DbGoalTools.ReopenGoal(
            BuildReopenParameters(input, parameters, sessionId, sourceGoalId));
        if (!result.Success || result.Goal == null)
            return EncodeError(result.Error ?? "Goal could not be reopened.");

        var reopened = result.Goal;
        try
        {
            GoalOrchestrator.CreatePendingGoal(
                reopened.GoalId,
                reopened.Objective,
                sessionId,
                reopened.WorkingFolder,
                parameters);
        }
        catch (Exception ex)
        {
            DbGoalTools.SetStatusByGoalId(
                reopened.GoalId,
                sessionId,
                GoalStatusValues.Pending,
                GoalStatusValues.Active,
                $"Reopened goal could not enter pending runtime state: {ex.Message}");
            return EncodeError($"Reopened goal could not enter pending runtime state: {ex.Message}");
        }

        return await AwaitGoalConfirmationAsync(
            reopened.GoalId,
            sessionId,
            reopened.Objective,
            context,
            cancellationToken);
    }

    private static async Task<string> UpdateGoalAsync(
        JsonElement input,
        string sessionId,
        JsonElement parameters,
        IWorkerRequestContext context)
    {
        var row = DbGoalTools.GetBySessionId(sessionId);
        if (row == null)
            return EncodeError("No goal to update. Call create_goal first.");

        var status = JsonHelpers.GetString(input, "status")?.Trim();
        var objective = JsonHelpers.GetString(input, "objective")?.Trim();
        if (string.IsNullOrEmpty(status) && string.IsNullOrEmpty(objective))
            return EncodeError("update_goal requires objective or status.");

        if (!string.IsNullOrEmpty(status)
            && status is not GoalStatusValues.Active
                and not GoalStatusValues.Complete
                and not GoalStatusValues.Aborted)
        {
            return EncodeError($"Unsupported goal status: {status}");
        }

        if (GoalStatusValues.IsTerminal(row.Status)
            && !string.IsNullOrEmpty(status))
        {
            return EncodeError("Terminal goal status cannot be updated.");
        }

        var activeContext = GoalOrchestrator.GetContext(row.GoalId);
        if (!string.IsNullOrEmpty(objective)
            && status is GoalStatusValues.Complete or GoalStatusValues.Aborted)
        {
            var objectiveParams = BuildUpdateParameters(
                parameters,
                sessionId,
                row.GoalId,
                objective,
                null);
            row = DbGoalTools.UpdateByGoalId(objectiveParams)
                ?? throw new InvalidOperationException("Goal disappeared during objective update.");
            if (activeContext != null)
                activeContext.GoalText = objective;
        }

        GoalActionResult? action = null;
        if (status is GoalStatusValues.Complete or GoalStatusValues.Aborted)
        {
            if (GoalOrchestrator.GetContext(row.GoalId) == null
                && !GoalStatusValues.IsTerminal(row.Status))
            {
                await GoalOrchestrator.ResumeFromDb(row.GoalId, sessionId);
            }

            action = await GoalOrchestrator.SetTerminalStatusFromToolAsync(
                row.GoalId,
                status,
                context);
            if (!action.Success)
                return EncodeActionFailure(row, action);

            var terminalRow = DbGoalTools.GetByGoalId(row.GoalId, sessionId);
            return EncodeResult(new GoalToolResult(
                terminalRow != null ? PersistedGoal(terminalRow) : PersistedGoal(row),
                RuntimeProgress(terminalRow ?? row),
                action));
        }

        var updateParams = BuildUpdateParameters(
            parameters,
            sessionId,
            row.GoalId,
            objective,
            status);
        var updated = DbGoalTools.UpdateByGoalId(updateParams);
        if (updated == null)
            return EncodeError("Goal not found during update.");

        if (activeContext != null && !string.IsNullOrEmpty(objective))
            activeContext.GoalText = objective;

        return EncodeResult(new GoalToolResult(
            PersistedGoal(updated),
            RuntimeProgress(updated)));
    }

    private static async Task<string> PauseGoalAsync(
        string sessionId,
        IWorkerRequestContext context)
    {
        var row = DbGoalTools.GetBySessionId(sessionId);
        if (row == null)
            return EncodeError("No goal to pause.");

        var action = GoalOrchestrator.Pause(row.GoalId);
        // Same event contract as the HTTP path (GoalModule): the frontend run
        // badge must update no matter which path performed the action.
        await GoalOrchestrator.EmitRunStateChangedAsync(sessionId, action, context);
        return action.Success
            ? EncodeActionResult(row, action)
            : EncodeActionFailure(row, action);
    }

    private static async Task<string> ResumeGoalViaToolAsync(
        string sessionId,
        IWorkerRequestContext context)
    {
        var row = DbGoalTools.GetBySessionId(sessionId);
        if (row == null)
            return EncodeError("No goal to resume.");

        var action = GoalOrchestrator.Resume(row.GoalId, sessionId, context);
        await GoalOrchestrator.EmitRunStateChangedAsync(sessionId, action, context);
        return action.Success
            ? EncodeActionResult(row, action)
            : EncodeActionFailure(row, action);
    }

    private static async Task<string> AbortGoalAsync(
        string sessionId,
        IWorkerRequestContext context)
    {
        var row = DbGoalTools.GetBySessionId(sessionId);
        if (row == null)
            return EncodeError("No goal to abort.");

        if (GoalOrchestrator.GetContext(row.GoalId) == null
            && !GoalStatusValues.IsTerminal(row.Status))
        {
            await GoalOrchestrator.ResumeFromDb(row.GoalId, sessionId);
        }

        var action = await GoalOrchestrator.AbortAsync(row.GoalId, context);
        return action.Success
            ? EncodeActionResult(row, action)
            : EncodeActionFailure(row, action);
    }

    private static string EncodeActionResult(
        GoalRow row,
        GoalActionResult action)
    {
        var current = DbGoalTools.GetByGoalId(row.GoalId, row.SessionId) ?? row;
        return EncodeResult(new GoalToolResult(
            PersistedGoal(current),
            RuntimeProgress(current),
            action));
    }

    private static string EncodeActionFailure(
        GoalRow row,
        GoalActionResult action)
    {
        var current = DbGoalTools.GetByGoalId(row.GoalId, row.SessionId) ?? row;
        return EncodeResult(new GoalToolResult(
            PersistedGoal(current),
            RuntimeProgress(current),
            action,
            action.Error ?? $"Goal action failed: {action.Action}"));
    }
}

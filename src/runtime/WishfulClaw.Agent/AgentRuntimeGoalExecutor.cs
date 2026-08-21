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
/// Goal tool executor — get/create/update goals.
/// CreateGoal triggers GoalOrchestrator.StartAsync to start the orchestration loop.
/// </summary>
public static partial class AgentRuntimeGoalExecutor
{
    public static bool IsGoalTool(string toolName) =>
        toolName is "get_goal" or "list_goals" or "get_goal_history" or "create_goal" or "reopen_goal" or "update_goal" or "pause_goal" or "resume_goal" or "abort_goal";

    public static async Task<string> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        var sessionId = JsonHelpers.GetString(state.Parameters, "sessionId")?.Trim() ?? string.Empty;
        if (sessionId.Length == 0)
            return EncodeError("No active session.");

        DbClient.EnsureInitialized(state.Parameters);
        return call.Name switch
        {
            "get_goal" => await GetGoalAsync(sessionId, context),
            "list_goals" => ListGoals(call.Input, sessionId, state.Parameters),
            "get_goal_history" => GetGoalHistory(call.Input, sessionId, state.Parameters),
            "create_goal" => await CreateGoalAsync(
                call.Input,
                sessionId,
                state.Parameters,
                state.CancellationToken,
                context),
            "reopen_goal" => await ReopenGoalAsync(
                call.Input,
                sessionId,
                state.Parameters,
                state.CancellationToken,
                context),
            "update_goal" => await UpdateGoalAsync(
                call.Input,
                sessionId,
                state.Parameters,
                context),
            "pause_goal" => PauseGoal(sessionId),
            "resume_goal" => ResumeGoal(sessionId, context),
            "abort_goal" => await AbortGoalAsync(sessionId, context),
            _ => EncodeError($"Unsupported goal tool: {call.Name}")
        };
    }

    private static async Task<string> GetGoalAsync(
        string sessionId,
        IWorkerRequestContext context)
    {
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

        return EncodePersistedGoal(DbGoalTools.GetBySessionId(sessionId));
    }

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
        var goalId = $"goal-{Guid.NewGuid():N}".Substring(0, 21);
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
            if (confirmed)
            {
                var pending = GoalOrchestrator.GetPendingGoal(goalId);
                if (pending == null)
                    return EncodeError("Pending goal no longer exists.");

                var row = DbGoalTools.SetStatusByGoalId(
                    goalId,
                    sessionId,
                    GoalStatusValues.Pending,
                    GoalStatusValues.Active,
                    "Goal confirmed and started");
                if (row == null)
                    return EncodeError("Pending goal changed before confirmation.");

                var started = await GoalOrchestrator.ConfirmGoalAsync(
                    goalId,
                    sessionId,
                    pending.WorkingFolder,
                    pending.Parameters,
                    context);
                if (!started)
                {
                    DbGoalTools.SetStatusByGoalId(
                        goalId,
                        sessionId,
                        GoalStatusValues.Active,
                        GoalStatusValues.Active,
                        "Goal confirmation could not start the orchestrator");
                    return EncodeError("Goal confirmation could not start the orchestrator.");
                }

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

    private static string ListGoals(
        JsonElement input,
        string sessionId,
        JsonElement parameters)
    {
        var page = DbGoalTools.QueryGoalPage(BuildGoalPageParameters(input, parameters, sessionId));
        return EncodeGoalPage(new GoalToolPageResult(
            page.Items.Select(PersistedGoal).ToList(),
            page.HasMore,
            page.NextCurrentRank,
            page.NextUpdatedAt,
            page.NextGoalId));
    }

    private static string GetGoalHistory(
        JsonElement input,
        string sessionId,
        JsonElement parameters)
    {
        var goalId = JsonHelpers.GetString(input, "goalId")?.Trim() ?? string.Empty;
        if (goalId.Length == 0)
            return EncodeGoalHistory(new GoalToolHistoryResult(null, [], false, Error: "goalId is required."));

        var goal = DbGoalTools.GetByGoalId(goalId, sessionId);
        if (goal == null)
            return EncodeGoalHistory(new GoalToolHistoryResult(null, [], false, Error: "Goal not found."));

        var page = DbGoalTools.QueryGoalEventPage(
            BuildGoalHistoryParameters(input, parameters, sessionId, goalId));
        var events = page.Items.Select(item => new GoalToolEvent(
            item.Id,
            item.EventType,
            item.Message,
            item.MetadataJson,
            item.CreatedAt)).ToList();
        return EncodeGoalHistory(new GoalToolHistoryResult(
            PersistedGoal(goal),
            events,
            page.HasMore,
            page.NextCreatedAt,
            page.NextEventId));
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

    private static string EncodePersistedGoal(GoalRow? row)
        => row == null
            ? EncodeResult(new GoalToolResult())
            : EncodeResult(new GoalToolResult(
                PersistedGoal(row),
                RuntimeProgress(row)));

    private static GoalToolGoal PersistedGoal(GoalRow row)
    {
        var context = GoalOrchestrator.GetContext(row.GoalId);
        return new GoalToolGoal(
            row.SessionId,
            row.GoalId,
            context?.GoalText ?? row.Objective,
            context?.Status ?? row.Status,
            row.UpdatedAt,
            row.TokenBudget,
            row.TokensUsed,
            row.TimeUsedSeconds);
    }

    private static GoalToolProgress RuntimeProgress(GoalRow row)
    {
        var context = GoalOrchestrator.GetContext(row.GoalId);
        if (context != null)
        {
            return new GoalToolProgress(
                context.Plans.Count,
                context.CurrentPlanIndex,
                context.Plans.Count(p => p.Status == GoalPlanStatusValues.Complete),
                context.Plans.Count(p => p.Status == GoalPlanStatusValues.Aborted),
                context.Status,
                context.RunState,
                context.StartedAt.ToString("O"));
        }

        var failedPlans = 0;
        if (!string.IsNullOrEmpty(row.PlansJson))
        {
            try
            {
                var plans = JsonSerializer.Deserialize(
                    row.PlansJson,
                    AgentRuntimeJsonContext.Default.ListGoalPlanItem);
                failedPlans = plans?.Count(p => p.Status == GoalPlanStatusValues.Aborted) ?? 0;
            }
            catch (JsonException)
            {
                failedPlans = 0;
            }
        }

        return new GoalToolProgress(
            row.PlanCount,
            row.CurrentPlanIndex,
            row.CompletedPlanCount,
            failedPlans,
            row.Status,
            GoalRunStateValues.Idle);
    }

    private static GoalToolGoal PendingGoal(PendingGoal pending)
        => new(
            pending.SessionId,
            pending.GoalId,
            pending.GoalText,
            "pending",
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());

    private static GoalToolProgress PendingProgress()
        => new(0, -1, 0, 0, "pending", GoalRunStateValues.Idle);

    private static string PauseGoal(string sessionId)
    {
        var row = DbGoalTools.GetBySessionId(sessionId);
        if (row == null)
            return EncodeError("No goal to pause.");

        var action = GoalOrchestrator.Pause(row.GoalId);
        return action.Success
            ? EncodeActionResult(row, action)
            : EncodeActionFailure(row, action);
    }

    private static string ResumeGoal(
        string sessionId,
        IWorkerRequestContext context)
    {
        var row = DbGoalTools.GetBySessionId(sessionId);
        if (row == null)
            return EncodeError("No goal to resume.");

        var action = GoalOrchestrator.Resume(row.GoalId, sessionId, context);
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
        var pending = DbGoalTools.SetStatusByGoalId(
            goalId,
            sessionId,
            GoalStatusValues.Pending,
            GoalStatusValues.Aborted,
            message);
        if (pending == null)
        {
            DbGoalTools.SetStatusByGoalId(
                goalId,
                sessionId,
                GoalStatusValues.Active,
                activeTerminalStatus,
                message);
        }
        GoalOrchestrator.RemovePendingGoal(goalId);
    }

}

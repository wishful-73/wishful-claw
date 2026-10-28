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
/// Read-only goal tool queries: current goal, list, history and their encoders. Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
public static partial class AgentRuntimeGoalExecutor
{
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
}

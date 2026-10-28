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
            "pause_goal" => await PauseGoalAsync(sessionId, context),
            "resume_goal" => await ResumeGoalViaToolAsync(sessionId, context),
            "abort_goal" => await AbortGoalAsync(sessionId, context),
            _ => EncodeError($"Unsupported goal tool: {call.Name}")
        };
    }
}

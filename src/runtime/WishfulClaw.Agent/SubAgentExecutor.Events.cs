/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Buffers;
using System.Text;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// Sub-agent event emission (queued/dequeued/started) and goal-activity forwarding. Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
public static partial class SubAgentExecutor
{
    // Sub-agent events are an observation channel only: a failed emission is logged and
    // swallowed. It must never fail the run — and, because the caller may already hold a
    // concurrency lease by then, it must never leak that lease either.
    private static async Task TryEmitSubAgentEventAsync(
        string eventName,
        string toolCallId,
        Func<Task> emit)
    {
        try
        {
            await emit();
        }
        catch (Exception ex)
        {
            WorkerLog.Warn(
                $"sub-agent {eventName} event emit failed toolUseId={toolCallId} " +
                $"error={ex.GetType().Name}: {ex.Message}");
        }
    }

    private static Task EmitSubAgentQueuedAsync(
        SubAgentDefinition definition,
        string toolCallId,
        JsonElement input,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context)
    {
        return AgentRuntimeTools.EmitAsync(
            parentState, context,
            new AgentRuntimeStreamEvent(
                "sub_agent_queued",
                SubAgentName: definition.Name,
                ToolUseId: toolCallId,
                Input: input.Clone()));
    }

    private static Task EmitSubAgentDequeuedAsync(
        SubAgentDefinition definition,
        string toolCallId,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context)
    {
        return AgentRuntimeTools.EmitAsync(
            parentState, context,
            new AgentRuntimeStreamEvent(
                "sub_agent_dequeued",
                SubAgentName: definition.Name,
                ToolUseId: toolCallId));
    }

    private static Task EmitSubAgentStartedAsync(
        SubAgentDefinition definition,
        string toolCallId,
        JsonElement input,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context)
    {
        return AgentRuntimeTools.EmitAsync(
            parentState, context,
            new AgentRuntimeStreamEvent(
                "sub_agent_start",
                SubAgentName: definition.Name,
                ToolUseId: toolCallId,
                Input: input.Clone()));
    }

    /// <summary>
    /// Build a "goal_activity" stream event from a sub-agent event for the Goal
    /// panel. Only meaningful activity is forwarded: tool calls (name + brief
    /// input summary) and iterations. Text deltas are NOT forwarded at all
    /// (they caused thousands of events per minute); live progress text is
    /// dropped for goal runs — the final report arrives with sub_agent_end.
    /// </summary>
    private static AgentRuntimeStreamEvent? BuildGoalActivityEvent(
        GoalEventContext goalCtx,
        AgentRuntimeStreamEvent evt)
    {
        switch (evt.Type)
        {
            case "sub_agent_tool_call":
                if (evt.ToolCall is not { } toolCall) return null;
                return new AgentRuntimeStreamEvent(
                    "goal_activity",
                    ToolUseId: goalCtx.GoalId,
                    SubAgentName: goalCtx.PlanTitle,
                    Input: WorkerJsonHelper.BuildJsonElement(w =>
                    {
                        w.WriteStartObject();
                        w.WriteString("goalId", goalCtx.GoalId);
                        w.WriteString("planId", goalCtx.PlanId);
                        w.WriteNumber("round", goalCtx.Round);
                        w.WriteString("kind", "tool_call");
                        w.WriteString("toolCallId", toolCall.Id);
                        w.WriteString("toolName", toolCall.Name);
                        w.WriteString("status", toolCall.Status);
                        w.WriteEndObject();
                    }));

            case "sub_agent_tool_call_result":
                if (evt.ToolCall is not { } doneCall) return null;
                return new AgentRuntimeStreamEvent(
                    "goal_activity",
                    ToolUseId: goalCtx.GoalId,
                    SubAgentName: goalCtx.PlanTitle,
                    Input: WorkerJsonHelper.BuildJsonElement(w =>
                    {
                        w.WriteStartObject();
                        w.WriteString("goalId", goalCtx.GoalId);
                        w.WriteString("planId", goalCtx.PlanId);
                        w.WriteNumber("round", goalCtx.Round);
                        w.WriteString("kind", "tool_result");
                        w.WriteString("toolCallId", doneCall.Id);
                        w.WriteString("toolName", doneCall.Name);
                        w.WriteString("status", doneCall.Status);
                        w.WriteEndObject();
                    }));

            case "sub_agent_iteration":
                return new AgentRuntimeStreamEvent(
                    "goal_activity",
                    Iteration: evt.Iteration,
                    ToolUseId: goalCtx.GoalId,
                    SubAgentName: goalCtx.PlanTitle,
                    Input: WorkerJsonHelper.BuildJsonElement(w =>
                    {
                        w.WriteStartObject();
                        w.WriteString("goalId", goalCtx.GoalId);
                        w.WriteString("planId", goalCtx.PlanId);
                        w.WriteNumber("round", goalCtx.Round);
                        w.WriteString("kind", "iteration");
                        w.WriteNumber("iteration", evt.Iteration ?? 0);
                        w.WriteEndObject();
                    }));

            default:
                return null;
        }
    }
}

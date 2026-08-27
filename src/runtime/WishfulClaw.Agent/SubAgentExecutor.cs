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
/// Executes sub-agent (Task) tool calls.
/// Creates a child AgentRuntimeRunState, builds child parameters, runs a full
/// AgentLoop, and returns the final assistant message as the tool result.
///
/// Architecture references:
/// - WishfulClaw: AgentRuntimeSubAgentExecutor.cs (child state, event emission, prompt building)
/// - Reasonix: task.go (system prompt design, tool filtering, depth limiting)
/// </summary>
public static partial class SubAgentExecutor
{
    private const string TaskToolName = "Task";
    private const string CustomSubAgentType = "custom";
    private const int MaxSubAgentDepth = 2;

    public static bool IsTaskTool(string toolName)
    {
        return string.Equals(toolName, TaskToolName, StringComparison.Ordinal);
    }

    /// <summary>
    /// Executes a Task tool call by spawning a child agent loop.
    /// </summary>
    public static async Task<ToolResult> ExecuteAsync(
        JsonElement input,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        string toolCallId)
    {
        // Sub-agent type is optional — defaults to "custom" (general-purpose).
        // The .md file preset mechanism is available but not required.
        var subAgentType = JsonHelpers.GetString(input, "subagent_type")?.Trim() ?? CustomSubAgentType;
        var definition = ResolveDefinition(subAgentType, parameters, input);
        if (definition is null)
        {
            return ErrorResult($"Unknown subagent_type \"{subAgentType}\".");
        }

        // Depth check — prevent infinite recursion
        var currentDepth = GetSubAgentDepth(parameters);
        if (currentDepth >= MaxSubAgentDepth)
        {
            return ErrorResult(
                $"Maximum sub-agent depth ({MaxSubAgentDepth}) reached. " +
                "Cannot spawn another sub-agent.");
        }

        var prompt = BuildPromptText(input);
        if (string.IsNullOrWhiteSpace(prompt))
        {
            return ErrorResult("Task requires a non-empty prompt.");
        }

        // Background mode: fire-and-forget, return immediately
        var isBackground = JsonHelpers.GetBool(input, "background", false);

        // Emit sub_agent_start event to parent's stream
        await AgentRuntimeTools.EmitAsync(
            parentState, context,
            new AgentRuntimeStreamEvent(
                "sub_agent_start",
                SubAgentName: definition.Name,
                ToolUseId: toolCallId,
                Input: input.Clone()));

        if (isBackground)
        {
            return await ExecuteBackgroundAsync(
                input, parameters, definition, prompt,
                currentDepth, parentState, context, toolCallId);
        }

        return await ExecuteForegroundAsync(
            input, parameters, definition, prompt,
            currentDepth, parentState, context, toolCallId);
    }

    // ── Foreground execution (main conversation waits) ──

    private static async Task<ToolResult> ExecuteForegroundAsync(
        JsonElement input,
        JsonElement parameters,
        SubAgentDefinition definition,
        string prompt,
        int currentDepth,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        string toolCallId)
    {
        var description = JsonHelpers.GetString(input, "description") ?? definition.Name;

        // Register in the registry so SubAgentStatus/SubAgentDetail can query it
        BackgroundSubAgentRegistry.Register(
            toolUseId: toolCallId, agentName: definition.Name,
            description: description, prompt: prompt, isBackground: false);

        var childParameters = BuildChildParameters(
            parameters, definition, prompt, currentDepth + 1);

        var childRunId = $"subagent-{toolCallId}-{Guid.NewGuid():N}";
        var childState = new AgentRuntimeRunState(childRunId, parentState.SessionId);
        childState.SuppressTransportEvents = true;

        var collector = CreateCollector(parentState, context, definition.Name, toolCallId);
        childState.EventObserver = collector.ObserveAsync;
        childState.ReplaceParameters(childParameters);

        using var parentCancellationRegistration = parentState.CancellationToken.Register(
            static state => ((AgentRuntimeRunState)state!).Cancel("parent"),
            childState);

        string subAgentOutput;
        bool subAgentError = false;

        try
        {
            using var concurrencyLease = await SubAgentConcurrencyLimiter.AcquireAsync(
                childState.CancellationToken);
            await AgentLoop.ExecuteLoopAsync(childParameters, childState, context);
            subAgentOutput = collector.GetFinalOutput();

            if (string.IsNullOrWhiteSpace(subAgentOutput))
            {
                subAgentOutput = "Sub-agent completed but produced no output.";
                subAgentError = true;
            }
        }
        catch (OperationCanceledException) when (childState.IsCancellationRequested)
        {
            subAgentOutput = "Sub-agent was cancelled.";
            subAgentError = true;
        }
        catch (Exception ex)
        {
            WorkerLog.Warn(
                $"sub-agent failed parentRunId={parentState.RunId} toolUseId={toolCallId} " +
                $"error={ex.GetType().Name}: {ex.Message}");
            subAgentOutput = $"Sub-agent failed: {ex.Message}";
            subAgentError = true;
        }
        finally
        {
            // The sub-agent conversation is isolated under its runId (see
            // AgentLoop); remove it so isolated conversations don't leak.
            SessionConversationManager.Remove($"__subagent__{childRunId}");
            childState.Dispose();
        }

        // Update registry with final state
        if (subAgentError && childState.IsCancellationRequested)
        {
            BackgroundSubAgentRegistry.Cancel(toolCallId);
        }
        else if (subAgentError)
        {
            BackgroundSubAgentRegistry.Fail(
                toolCallId, subAgentOutput, collector.ToolCallCount,
                collector.Iterations, BuildToolCallEntries(collector.ToolCallSummaries));
        }
        else
        {
            BackgroundSubAgentRegistry.Complete(
                toolCallId, subAgentOutput, collector.ToolCallCount,
                collector.Iterations, BuildToolCallEntries(collector.ToolCallSummaries));
        }

        // Goal-orchestrated run: hand the host-observed tool receipts to the
        // orchestrator's evidence sink so the evaluator sees what actually ran.
        if (parentState.GoalEvidenceSink is { } sink)
        {
            foreach (var s in collector.ToolCallSummaries)
            {
                sink.Record(s.Name, ExtractKeyParam(s.Name, s.Input), s.Status == "completed");
            }
        }

        var toolCallSummary = BuildToolCallSummary(collector.ToolCallSummaries);
        var toolResultText = string.IsNullOrEmpty(toolCallSummary)
            ? subAgentOutput
            : subAgentOutput + "\n\n" + toolCallSummary;

        var resultJson = BuildResultJson(
            definition.Name, toolCallId, subAgentOutput, !subAgentError, childState.StopReason,
            collector.ToolCallCount, collector.Iterations);

        await AgentRuntimeTools.EmitAsync(
            parentState, context,
            new AgentRuntimeStreamEvent(
                "sub_agent_end",
                SubAgentName: definition.Name,
                ToolUseId: toolCallId,
                Result: resultJson));

        WorkerLog.Info(
            $"sub-agent end parentRunId={parentState.RunId} toolUseId={toolCallId} " +
            $"agent={definition.Name} success={!subAgentError} " +
            $"outputLen={subAgentOutput.Length} toolCalls={collector.ToolCallCount} " +
            $"iterations={collector.Iterations} background=false");

        return new ToolResult(toolResultText, subAgentError);
    }

    // ── Background execution (fire-and-forget, non-blocking) ──


    private static SubAgentRunCollector CreateCollector(
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        string agentName,
        string toolCallId)
    {
        return new SubAgentRunCollector
        {
            ForwardEvent = async (evt) =>
            {
                // Goal-orchestrated runs are background-only (user-directed
                // redesign): no per-event forwarding at all — no text deltas,
                // no tool_call/iteration goal_activity feed. The panel is a
                // pull-based checker (polls the DB); the final report lands in
                // goal_plan_tasks via the orchestrator. This kills the seq
                // flood and the push traffic entirely for goal runs.
                if (parentState.GoalEventContext is not null)
                {
                    return;
                }

                var wrappedEvent = evt with
                {
                    SubAgentName = agentName,
                    ToolUseId = toolCallId
                };

                // The parent run may have finalized (completed normally or
                // stopped) while a background sub-agent is still running; its
                // transport/observer are disposed at that point. A forwarding
                // failure must NEVER propagate into the child loop or the
                // whole sub-agent would die just because the parent went away
                // — swallow and keep running so it can still deliver its
                // result through the session notification path.
                try
                {
                    await AgentRuntimeTools.EmitAsync(parentState, context, wrappedEvent);

                    // Goal-orchestrated execution: also tag the event with the goal
                    // context so the Goal panel can render a live activity feed.
                    if (parentState.GoalEventContext is { } goalCtx)
                    {
                        var activity = BuildGoalActivityEvent(goalCtx, evt);
                        if (activity is not null)
                        {
                            await AgentRuntimeTools.EmitAsync(parentState, context, activity);
                        }
                    }
                }
                catch (Exception ex)
                {
                    WorkerLog.Debug(
                        $"sub-agent event forward skipped parentGone=true toolUseId={toolCallId} " +
                        $"eventType={evt.Type} error={ex.GetType().Name}: {ex.Message}");
                }
            }
        };
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

    /// <summary>
    /// Builds a user message that gets injected into the parent conversation
    /// when a background sub-agent completes.
    /// </summary>


    private static int GetSubAgentDepth(JsonElement parameters)
    {
        return JsonHelpers.GetInt(parameters, "subAgentDepth", 0);
    }

    private static ToolResult ErrorResult(string message)
    {
        return new ToolResult(message, IsError: true, Error: message);
    }

    private static readonly JsonWriterOptions WriteOptions = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };
}

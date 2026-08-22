using System.Buffers;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Native tool available ONLY inside a Goal orchestrator sub-agent.
/// The agent calls it after finishing each step so progress is persisted to
/// the DB (goal_plans / goal_plan_tasks) — enforced by the host, not by
/// prompt compliance. The orchestrator loop also force-syncs state at
/// loop end as a safety net.
/// </summary>
public static class GoalProgressTool
{
    public const string ToolName = "update_goal_progress";

    private static readonly HashSet<string> ValidStatuses = new(StringComparer.Ordinal)
    {
        GoalPlanStatusValues.Pending,
        GoalPlanStatusValues.Active,
        GoalPlanStatusValues.Complete,
    };

    public static bool IsGoalProgressTool(string toolName) =>
        string.Equals(toolName, ToolName, StringComparison.Ordinal);

    public static async Task<string> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        var goalCtx = state.GoalEventContext;
        if (goalCtx is null)
        {
            return ErrorResult($"{ToolName} is only available inside a Goal run.");
        }

        var stepTitle = JsonHelpers.GetString(call.Input, "stepTitle")?.Trim() ?? string.Empty;
        var status = JsonHelpers.GetString(call.Input, "status")?.Trim() ?? string.Empty;
        var summary = JsonHelpers.GetString(call.Input, "summary")?.Trim();

        if (stepTitle.Length == 0)
            return ErrorResult("stepTitle is required.");
        if (!ValidStatuses.Contains(status))
            return ErrorResult($"status must be one of: {string.Join(", ", ValidStatuses)}.");

        try
        {
            var parameters = state.Parameters;

            // Record the step as a round in goal_plan_tasks (panel timeline).
            var roundId = DbGoalPlanTaskRoundTools.InsertPlanTask(
                parameters,
                goalCtx.SessionId ?? string.Empty,
                goalCtx.GoalId,
                planId: goalCtx.PlanId,
                originalPlanId: null,
                planTitle: goalCtx.PlanTitle,
                round: goalCtx.Round,
                description: stepTitle,
                steps: null);

            if (roundId > 0)
            {
                DbGoalPlanTaskRoundTools.FinishPlanTask(
                    parameters, roundId,
                    status == GoalPlanStatusValues.Complete
                        ? GoalExecutionAttemptStatusValues.Completed
                        : GoalExecutionAttemptStatusValues.Executing,
                    summary,
                    evaluationReasoning: null,
                    evaluationSatisfied: null);
            }

            return EncodeOk(stepTitle, status);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"goal progress tool failed: {ex.Message}");
            return ErrorResult($"Failed to record progress: {ex.Message}");
        }
    }

    private static string EncodeOk(string stepTitle, string status)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteBoolean("ok", true);
            writer.WriteString("recorded", stepTitle);
            writer.WriteString("status", status);
            writer.WriteEndObject();
        }
        return System.Text.Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    private static string ErrorResult(string message) =>
        System.Text.Json.JsonSerializer.Serialize(new GoalProgressErrorPayload(false, message),
            AgentRuntimeJsonContext.Default.GoalProgressErrorPayload);
}

public sealed record GoalProgressErrorPayload(bool Ok, string Error);

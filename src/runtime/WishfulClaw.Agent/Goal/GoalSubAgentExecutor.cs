using System.Buffers;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Runs one turn of the long-lived Goal sub-agent. The child run state is
/// disposable, while AgentLoop's conversation is keyed by GoalContextId and
/// therefore survives across turns and worker-owned orchestration cycles.
/// </summary>
internal static class GoalSubAgentExecutor
{
    internal sealed record TurnResult(string Output, int Iterations, int ToolCalls);

    public static async Task<TurnResult> ExecuteTurnAsync(
        GoalContext goal,
        JsonElement parentParameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        string prompt)
    {
        var childRunId = $"goal-turn-{goal.GoalId}-{Guid.NewGuid():N}";
        var childParameters = BuildParameters(parentParameters, goal, prompt);
        using var childState = new AgentRuntimeRunState(childRunId, parentState.SessionId)
        {
            SuppressTransportEvents = true
        };
        var collector = new SubAgentRunCollector();
        childState.EventObserver = collector.ObserveAsync;
        childState.ReplaceParameters(childParameters);

        using var cancellationRegistration = parentState.CancellationToken.Register(
            static state => ((AgentRuntimeRunState)state!).Cancel("goal parent"),
            childState);

        // Pause must interrupt an in-flight turn (including a provider retry
        // loop inside it), otherwise Pause only takes effect between turns and
        // a stuck retry cycle never reaches the safe point. Polling RunState
        // and cancelling the child state drops the turn; the adaptive loop
        // then parks at ReachSafePointAsync until Resume.
        goal.CurrentTurnState = childState;
        using var pauseWatcher = new Timer(
            static s => { var g = (GoalContext)s!; if (g.RunState == GoalRunStateValues.Paused) g.CurrentTurnState?.Cancel("goal paused"); },
            goal, TimeSpan.FromMilliseconds(250), TimeSpan.FromMilliseconds(250));

        try
        {
            using var concurrencyLease = await SubAgentConcurrencyLimiter.AcquireAsync(
                childState.CancellationToken);
            await AgentLoop.ExecuteLoopAsync(childParameters, childState, context);
            return new TurnResult(
                collector.GetFinalOutput(),
                collector.Iterations,
                collector.ToolCallCount);
        }
        catch (OperationCanceledException) when (parentState.IsCancellationRequested || childState.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"goal sub-agent turn failed goal={goal.GoalId} error={ex.GetType().Name}: {ex.Message}");
            throw;
        }
        finally
        {
            goal.CurrentTurnState = null;
        }
    }

    private static JsonElement BuildParameters(
        JsonElement parentParameters,
        GoalContext goal,
        string prompt)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            if (parentParameters.ValueKind == JsonValueKind.Object)
            {
                foreach (var property in parentParameters.EnumerateObject())
                {
                    if (property.NameEquals("messages") ||
                        property.NameEquals("provider") ||
                        property.NameEquals("personaId") ||
                        property.NameEquals("userRules") ||
                        property.NameEquals("providerTurnOnly") ||
                        property.NameEquals("sessionMode") ||
                        property.NameEquals("goalContextId"))
                    {
                        continue;
                    }
                    property.WriteTo(writer);
                }
            }

            writer.WriteString("sessionMode", "goalSubAgent");
            writer.WriteString("goalContextId", goal.GoalContextId);
            writer.WriteNumber("maxIterations", 12);
            writer.WriteBoolean("providerTurnOnly", false);

            var provider = AgentLoop.GetObject(parentParameters, "provider");
            writer.WritePropertyName("provider");
            writer.WriteStartObject();
            var hasSystemPrompt = false;
            if (provider.ValueKind == JsonValueKind.Object)
            {
                foreach (var property in provider.EnumerateObject())
                {
                    if (property.NameEquals("systemPrompt"))
                    {
                        writer.WriteString("systemPrompt", GoalSubAgentPrompt.SystemPrompt);
                        hasSystemPrompt = true;
                    }
                    else
                    {
                        property.WriteTo(writer);
                    }
                }
            }
            if (!hasSystemPrompt)
                writer.WriteString("systemPrompt", GoalSubAgentPrompt.SystemPrompt);
            writer.WriteEndObject();

            writer.WritePropertyName("messages");
            writer.WriteStartArray();
            writer.WriteStartObject();
            writer.WriteString("id", $"wc_goal_turn_{Guid.NewGuid():N}");
            writer.WriteString("role", "user");
            writer.WritePropertyName("content");
            writer.WriteStartArray();
            writer.WriteStartObject();
            writer.WriteString("type", "text");
            writer.WriteString("text", prompt);
            writer.WriteEndObject();
            writer.WriteEndArray();
            writer.WriteNumber("createdAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            writer.WriteEndObject();
            writer.WriteEndArray();
            writer.WriteEndObject();
        }

        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }
}

internal static class GoalSubAgentPrompt
{
    public const string SystemPrompt = @"You are the continuous autonomous Agent for a confirmed Goal.

Work directly toward the Goal using the available tools. You own the working context across turns: inspect the current state before acting, preserve successful work, and adapt when a previous attempt failed. Do not ask the user for confirmation during execution. Do not use plan-mode ceremony.

Each turn must make concrete progress or verify existing progress. If the Goal is fully satisfied with concrete evidence, finish your response with exactly: <goal-complete>brief summary</goal-complete>. If it is not complete, report what changed and what should be continued next turn; do not emit the completion marker. Never claim completion without evidence.";
}

using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Agent;

/// <summary>
/// Resume path: the three Resume overloads, ResumeFromDb and the context/parameter rebuild
/// helpers they depend on. Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
public static partial class GoalOrchestrator
{
    /// <summary>
    /// Resume an existing paused loop without requiring a worker request context.
    /// Idle goals must use the overload that supplies a request context.
    /// </summary>
    public static GoalActionResult Resume(string goalId)
    {
        if (!ActiveGoals.TryGetValue(goalId, out var goal))
            return GoalActionNotFound("resume", goalId);

        lock (goal.LifecycleSync)
        {
            if (!IsCurrentGoalContext(goal))
                return GoalActionNotFound("resume", goalId);

            if (GoalStatusValues.IsTerminal(goal.Status))
                return GoalActionTerminal("resume", goal);

            if (goal.RunState == GoalRunStateValues.Paused
                && goal.RunTask is { IsCompleted: false })
            {
                goal.RunState = GoalRunStateValues.Running;
                return GoalAction(goal, true, "resumed");
            }

            if (goal.RunState == GoalRunStateValues.Running
                && goal.RunTask is { IsCompleted: false })
            {
                return GoalAction(goal, true, "already_running");
            }

            return GoalAction(goal, false, "idle", "Starting an idle goal requires a worker request context.");
        }
    }

    /// <summary>
    /// Atomically resume an in-memory goal or restore it from DB before starting.
    /// A paused goal only wakes its existing loop; an idle goal creates one owned loop.
    /// </summary>
    public static GoalActionResult Resume(
        string goalId,
        string? sessionId,
        IWorkerRequestContext context)
    {
        return Resume(goalId, sessionId, null, context);
    }

    /// <summary>
    /// Resume with an optional provider override supplied by the frontend.
    /// providerOverride is used when the goal has no saved parameters and no
    /// active session run to inherit from (e.g. DB-restored goal after restart).
    /// </summary>
    public static GoalActionResult Resume(
        string goalId,
        string? sessionId,
        JsonElement? providerOverride,
        IWorkerRequestContext context)
    {
        if (!ActiveGoals.TryGetValue(goalId, out var goal))
        {
            if (string.IsNullOrEmpty(sessionId))
                return GoalActionNotFound("resume", goalId);

            var row = DbGoalTools.GetByGoalId(goalId, sessionId);
            if (row == null)
                return GoalActionNotFound("resume", goalId);

            if (GoalStatusValues.IsTerminal(row.Status))
            {
                return new GoalActionResult(
                    false,
                    "terminal",
                    row.Status,
                    GoalRunStateValues.Idle,
                    goalId,
                    "Terminal goals cannot be resumed.");
            }

            if (!string.Equals(row.Status, GoalStatusValues.Active, StringComparison.Ordinal))
            {
                return new GoalActionResult(
                    false,
                    "not_resumable",
                    row.Status,
                    GoalRunStateValues.Idle,
                    goalId,
                    "Only active Goals are restored after a worker restart.");
            }

            var restoredGoal = RestoreGoalContext(row);
            ActiveGoals.TryAdd(goalId, restoredGoal);
            if (!ActiveGoals.TryGetValue(goalId, out goal))
                return GoalActionNotFound("resume", goalId);
        }

        var parameters = BuildResumeParameters(goal, providerOverride);
        return StartOrResumeRun(goal, parameters, context);
    }

    /// <summary>
    /// Restore an active goal from DB as idle after process restart.
    /// The orchestration loop starts only after an explicit Resume call.
    /// </summary>
    public static Task<bool> ResumeFromDb(string goalId, string sessionId)
    {
        if (ActiveGoals.ContainsKey(goalId))
            return Task.FromResult(true);

        var row = DbGoalTools.GetByGoalId(goalId, sessionId);
        if (row == null || !string.Equals(row.Status, GoalStatusValues.Active, StringComparison.Ordinal))
        {
            return Task.FromResult(false);
        }

        var goal = RestoreGoalContext(row);
        var restored = ActiveGoals.TryAdd(goalId, goal) || ActiveGoals.ContainsKey(goalId);
        if (restored)
        {
            WorkerLog.Info($"ResumeFromDb: restored goal {goalId} session={sessionId} status={goal.Status} planCount={goal.Plans.Count} runState=idle");
        }
        return Task.FromResult(restored);
    }

    private static GoalContext RestoreGoalContext(GoalRow row)
    {
        List<GoalPlanItem> plans = new();
        if (!string.IsNullOrEmpty(row.PlansJson))
        {
            try
            {
                plans = JsonSerializer.Deserialize(
                    row.PlansJson,
                    AgentRuntimeJsonContext.Default.ListGoalPlanItem) ?? new();
                foreach (var plan in plans)
                {
                    if (string.IsNullOrEmpty(plan.PlanId))
                        plan.PlanId = GoalIds.NewPlanId();
                }
            }
            catch (Exception ex)
            {
                WorkerLog.Warn($"ResumeFromDb: failed to deserialize plans: {ex.Message}");
            }
        }

        return new GoalContext
        {
            GoalId = row.GoalId,
            GoalContextId = $"goal-context:{row.GoalId}",
            SessionId = row.SessionId,
            GoalText = row.Objective,
            WorkingFolder = row.WorkingFolder,
            ModelConfigJson = row.ModelConfigJson,
            // Deliberate: "paused" is not preserved across restart. A restored
            // goal comes back as active-idle so it is visible/resumable via the
            // normal Resume path; the user re-issues Pause if still wanted.
            Status = row.Status == GoalStatusValues.Paused ? GoalStatusValues.Active : row.Status,
            RunState = GoalRunStateValues.Idle,
            Plans = plans,
            CurrentPlanIndex = plans.Count > 0 ? row.CurrentPlanIndex : -1,
            StartedAt = DateTime.UtcNow
        };
    }

    private static JsonElement BuildResumeParameters(
        GoalContext goal,
        JsonElement? providerOverride = null)
    {
        // A confirmed Goal owns its provider/model. The optional frontend provider
        // is only a legacy fallback for Goals created before model_config_json.
        if (!string.IsNullOrWhiteSpace(goal.ModelConfigJson))
        {
            return BuildGoalOwnedParameters(goal);
        }

        // Legacy fallback: use the original in-memory parameters before session state.
        if (goal.OriginalParameters.HasValue
            && goal.OriginalParameters.Value.ValueKind == JsonValueKind.Object)
        {
            return goal.OriginalParameters.Value.Clone();
        }

        if (providerOverride.HasValue
            && providerOverride.Value.ValueKind == JsonValueKind.Object)
        {
            return WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                if (!string.IsNullOrEmpty(goal.WorkingFolder))
                    w.WriteString("workingFolder", goal.WorkingFolder);
                w.WritePropertyName("provider");
                providerOverride.Value.WriteTo(w);
                w.WriteEndObject();
            });
        }

        // Last provider fallback for old Goals: current session Agent parameters.
        if (AgentRuntimeTools.TryGetSessionParameters(goal.SessionId, out var sessionParams)
            && sessionParams.ValueKind == JsonValueKind.Object)
        {
            return sessionParams.Clone();
        }

        // 4. 最后兜底：只传 workingFolder（子 Agent 可能因缺少 provider 而失败）
        return string.IsNullOrEmpty(goal.WorkingFolder)
            ? new JsonElement()
            : WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                w.WriteString("workingFolder", goal.WorkingFolder);
                w.WriteEndObject();
            });
    }

    internal static JsonElement BuildParametersForConfirmedGoal(
        JsonElement parameters,
        string modelConfigJson,
        string? workingFolder)
    {
        using var configDocument = JsonDocument.Parse(modelConfigJson);
        var config = configDocument.RootElement;
        var providerId = JsonHelpers.GetString(config, "providerId") ?? string.Empty;
        var provider = ProviderStore.GetProviderJson(providerId);
        if (!provider.HasValue || provider.Value.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException($"Goal provider is no longer available: {providerId}");
        return MergeGoalProvider(parameters, provider.Value, config, workingFolder);
    }

    private static JsonElement BuildGoalOwnedParameters(GoalContext goal)
    {
        using var configDocument = JsonDocument.Parse(goal.ModelConfigJson!);
        var config = configDocument.RootElement;
        var providerId = JsonHelpers.GetString(config, "providerId") ?? string.Empty;
        var provider = ProviderStore.GetProviderJson(providerId);
        if (!provider.HasValue || provider.Value.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException($"Goal provider is no longer available: {providerId}");

        var baseParameters = goal.OriginalParameters is { ValueKind: JsonValueKind.Object } original
            ? original
            : AgentRuntimeTools.TryGetSessionParameters(goal.SessionId, out var sessionParameters)
                && sessionParameters.ValueKind == JsonValueKind.Object
                ? sessionParameters
                : default;
        return MergeGoalProvider(baseParameters, provider.Value, config, goal.WorkingFolder);
    }

    private static JsonElement MergeGoalProvider(
        JsonElement baseParameters,
        JsonElement provider,
        JsonElement config,
        string? workingFolder)
        => WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            if (baseParameters.ValueKind == JsonValueKind.Object)
            {
                foreach (var property in baseParameters.EnumerateObject())
                {
                    if (property.NameEquals("provider")) continue;
                    property.WriteTo(w);
                }
            }
            if (!string.IsNullOrEmpty(workingFolder))
            {
                w.WriteString("workingFolder", workingFolder);
            }
            w.WritePropertyName("provider");
            w.WriteStartObject();
            foreach (var property in provider.EnumerateObject())
            {
                if (property.NameEquals("type") || property.NameEquals("model") || property.NameEquals("baseUrl"))
                    continue;
                property.WriteTo(w);
            }
            foreach (var property in config.EnumerateObject())
            {
                if (property.NameEquals("providerId")) continue;
                var name = property.NameEquals("providerType") ? "type" : property.Name;
                w.WritePropertyName(name);
                property.Value.WriteTo(w);
            }
            w.WriteEndObject();
            w.WriteEndObject();
        });

    private static bool IsCurrentGoalContext(GoalContext goal)
        => ActiveGoals.TryGetValue(goal.GoalId, out var activeGoal)
            && ReferenceEquals(activeGoal, goal);
}

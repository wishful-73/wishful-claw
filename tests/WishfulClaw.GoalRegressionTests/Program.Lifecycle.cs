using System.Text.Json;
using WishfulClaw.Agent;
using WishfulClaw.Agent.Tools.Providers;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Tools;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.GoalRegressionTests;

internal static partial class Program
{
    private static void RunLifecycleRegressionSuite(string dbPath)
    {
        var db = DbClient.GetClient();
        db.Execute(
            "INSERT INTO sessions (id, project_id, title, mode, created_at, updated_at) " +
            "VALUES ('session-lifecycle', 'project-a', 'Lifecycle', 'chat', 600, 600)");

        var runStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseRun = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var runCount = 0;
        GoalOrchestrator.OwnedRunOverride = async (_, _, runtimeState, _) =>
        {
            Interlocked.Increment(ref runCount);
            runStarted.TrySetResult();
            await releaseRun.Task.WaitAsync(runtimeState.CancellationToken);
        };

        try
        {
            var confirmContext = new ReverseRequestContext(confirmed: true);
            var confirmedResult = ExecuteCreateGoal(
                dbPath,
                "session-lifecycle",
                "confirm lifecycle",
                confirmContext);
            var confirmedGoalId = confirmedResult
                .GetProperty("goal")
                .GetProperty("goalId")
                .GetString();
            Assert(!string.IsNullOrEmpty(confirmedGoalId),
                "pending confirmation returns the persisted goalId");
            AssertEqual(confirmedGoalId, confirmContext.GoalId,
                "pending confirmation keeps goalId unchanged");
            AssertEqual(GoalStatusValues.Active,
                DbGoalTools.GetByGoalId(confirmedGoalId!, "session-lifecycle")?.Status,
                "pending confirmation persists active");
            runStarted.Task.Wait(TimeSpan.FromSeconds(5));
            AssertEqual(1, Volatile.Read(ref runCount),
                "confirmed goal starts one owned loop");

            var pauseResult = GoalOrchestrator.Pause(confirmedGoalId!);
            Assert(pauseResult.Success && pauseResult.RunState == GoalRunStateValues.Paused,
                "pause keeps the owned loop and enters paused run state");
            var pausedResume = GoalOrchestrator.Resume(
                confirmedGoalId!,
                "session-lifecycle",
                SilentRequestContext.Instance);
            Assert(pausedResume.Success && pausedResume.Action == "resumed",
                "resume wakes the paused owned loop");
            AssertEqual(1, Volatile.Read(ref runCount),
                "pause and resume do not replace the owned loop");

            var duplicateResume = GoalOrchestrator.Resume(
                confirmedGoalId!,
                "session-lifecycle",
                SilentRequestContext.Instance);
            Assert(duplicateResume.Success && duplicateResume.Action == "already_running",
                "resume while running reuses the owned loop");
            AssertEqual(1, Volatile.Read(ref runCount),
                "duplicate resume does not start another loop");

            var abortTask = GoalOrchestrator.AbortAsync(
                confirmedGoalId!,
                SilentRequestContext.Instance);
            Assert(abortTask.Wait(TimeSpan.FromSeconds(5)),
                "active abort waits for the owned loop to exit");
            var abortResult = abortTask.GetAwaiter().GetResult();
            Assert(abortResult.Success && abortResult.Status == GoalStatusValues.Aborted,
                "running active goal cancels through orchestrator");
            Assert(GoalOrchestrator.GetContext(confirmedGoalId!) == null,
                "running cancellation removes runtime context");
            AssertEqual(GoalStatusValues.Aborted,
                DbGoalTools.GetByGoalId(confirmedGoalId!, "session-lifecycle")?.Status,
                "running cancellation persists aborted");

            var discardResult = ExecuteCreateGoal(
                dbPath,
                "session-lifecycle",
                "discard lifecycle",
                new ReverseRequestContext(confirmed: false));
            Assert(discardResult.TryGetProperty("error", out _),
                "pending discard returns a tool error result");
            var discarded = DbGoalTools.GetBySessionId("session-lifecycle");
            Assert(discarded == null,
                "pending discard leaves no current goal");
            AssertEqual(0, AgentRuntimeReverseRequests.PendingCount,
                "pending discard releases the reverse resolver");
            Assert(GoalOrchestrator.GetPendingGoalId("session-lifecycle") == null,
                "pending discard releases pending goal memory");

            var failingContext = new ReverseRequestContext(
                confirmed: true,
                failBackgroundContext: true);
            var failedResult = ExecuteCreateGoal(
                dbPath,
                "session-lifecycle",
                "startup failure",
                failingContext);
            Assert(failedResult.TryGetProperty("error", out _),
                "confirmation startup failure returns a tool error result");
            var failedGoalId = failingContext.GoalId;
            Assert(!string.IsNullOrEmpty(failedGoalId),
                "startup failure still identifies the pending goal");
            // Startup failure is a system-side event: the business status
            // stays active (only a user cancel produces aborted); the goal
            // remains resumable and no runtime zombie is left behind.
            AssertEqual(GoalStatusValues.Active,
                DbGoalTools.GetByGoalId(failedGoalId!, "session-lifecycle")?.Status,
                "confirmation startup failure keeps the goal active");
            Assert(GoalOrchestrator.GetContext(failedGoalId!) == null,
                "confirmation startup failure leaves no active zombie");
            AssertEqual(0, AgentRuntimeReverseRequests.PendingCount,
                "confirmation startup failure releases the reverse resolver");
            Assert(GoalOrchestrator.GetPendingGoalId("session-lifecycle") == null,
                "confirmation startup failure releases pending goal memory");

            // The startup-failure goal legitimately stays active (system
            // failures never produce aborted). Simulate the user cancelling
            // it so later steps get a clean current-goal slot.
            var cancelledAfterFailure = DbGoalTools.SetStatusByGoalId(
                failedGoalId!,
                "session-lifecycle",
                GoalStatusValues.Active,
                GoalStatusValues.Aborted,
                "Startup-failure goal cancelled by regression cleanup");
            AssertEqual(GoalStatusValues.Aborted, cancelledAfterFailure?.Status,
                "user cancel archives the startup-failure goal");

            var listResult = ExecuteGoalTool(
                dbPath,
                "session-lifecycle",
                "list_goals",
                writer => writer.WriteNumber("limit", 2),
                SilentRequestContext.Instance);
            Assert(listResult.GetProperty("goals").GetArrayLength() == 2
                   && listResult.GetProperty("hasMore").GetBoolean(),
                "list_goals executes cursor pagination through the agent dispatcher");

            var historySourceId = failingContext.GoalId!;
            var historyResult = ExecuteGoalTool(
                dbPath,
                "session-lifecycle",
                "get_goal_history",
                writer =>
                {
                    writer.WriteString("goalId", historySourceId);
                    writer.WriteNumber("limit", 1);
                },
                SilentRequestContext.Instance);
            AssertEqual(historySourceId,
                historyResult.GetProperty("goal").GetProperty("goalId").GetString(),
                "get_goal_history stays scoped to the current session");
            Assert(historyResult.GetProperty("events").GetArrayLength() == 1,
                "get_goal_history returns a paged audit trail");

            var reopenedResult = ExecuteGoalTool(
                dbPath,
                "session-lifecycle",
                "reopen_goal",
                writer =>
                {
                    writer.WriteString("goalId", historySourceId);
                    writer.WriteString("objective", "reopened through agent tool");
                },
                new ReverseRequestContext(confirmed: false));
            Assert(reopenedResult.TryGetProperty("error", out _),
                "reopen_goal uses the same confirmation boundary as create_goal");
            Assert(DbGoalTools.GetBySessionId("session-lifecycle") == null,
                "reopen_goal cancellation leaves no current goal");
            AssertEqual(GoalStatusValues.Aborted,
                ScalarString(DbClient.GetClient(),
                    "SELECT status FROM goals WHERE session_id = 'session-lifecycle' " +
                    "AND objective = 'reopened through agent tool' ORDER BY created_at DESC LIMIT 1"),
                "reopen_goal cancellation archives the new goal");
            AssertEqual(1L, DbClient.GetClient().QueryScalar<long>(
                "SELECT COUNT(*) FROM goal_events WHERE goal_id = @goalId AND event_type = 'reopened'",
                new Microsoft.Data.Sqlite.SqliteParameter("@goalId", historySourceId)),
                "reopen_goal persists source audit metadata through the agent dispatcher");

            RunUseCapabilityGoalRegressionSuite(dbPath, historySourceId);

            foreach (var terminalStatus in new[]
                     {
                         GoalStatusValues.Complete,
                         GoalStatusValues.Aborted
                     })
            {
                var terminalGoalId = $"goal-terminal-{terminalStatus}";
                DbGoalTools.CreateCurrentGoal(GoalParameters(
                    dbPath,
                    "session-lifecycle",
                    terminalGoalId,
                    $"terminal {terminalStatus}",
                    terminalStatus));
                Assert(!GoalOrchestrator.ResumeFromDb(terminalGoalId, "session-lifecycle")
                        .GetAwaiter()
                        .GetResult(),
                    $"worker restart does not restore {terminalStatus} goals");
                Assert(GoalOrchestrator.GetContext(terminalGoalId) == null,
                    $"{terminalStatus} goal remains outside runtime memory");
            }
        }
        finally
        {
            releaseRun.TrySetResult();
            GoalOrchestrator.OwnedRunOverride = null;
        }
    }

    private static void RunUseCapabilityGoalRegressionSuite(
        string dbPath,
        string historySourceId)
    {
        var registry = new ToolRegistry();
        registry.PushCategory("goal");
        new GoalToolProvider().RegisterTools(registry);
        registry.PopCategory();

        var capabilityContext = new CapabilityRequestContext(confirmed: false);
        var listed = ExecuteUseCapability(
            dbPath,
            "session-lifecycle",
            registry,
            capabilityContext,
            "list");
        var goalTools = listed.GetProperty("capabilities")
            .EnumerateArray()
            .Where(capability => capability.GetProperty("category").GetString() == "goal")
            .Select(capability => capability.GetProperty("name").GetString())
            .Where(name => name != null)
            .Cast<string>()
            .ToList();
        AssertEqual(3, goalTools.Count,
            "use_capability lists exactly the explicitly proxied goal tools");
        AssertEqual(3, goalTools.Distinct(StringComparer.Ordinal).Count(),
            "use_capability goal tools contain no duplicates");
        Assert(goalTools.Contains("list_goals", StringComparer.Ordinal)
               && goalTools.Contains("get_goal_history", StringComparer.Ordinal)
               && goalTools.Contains("reopen_goal", StringComparer.Ordinal),
            "use_capability discovers goal history and reopen tools");
        Assert(!goalTools.Contains("create_goal", StringComparer.Ordinal),
            "use_capability does not expose goal control tools implicitly");

        var inspected = ExecuteUseCapability(
            dbPath,
            "session-lifecycle",
            registry,
            capabilityContext,
            "inspect",
            "builtin:get_goal_history");
        AssertEqual("get_goal_history", inspected.GetProperty("name").GetString(),
            "use_capability inspects a proxied goal tool schema");
        Assert(inspected.GetProperty("input_schema").GetProperty("properties")
                .TryGetProperty("goalId", out _),
            "use_capability inspection preserves the goal tool input schema");

        var rejected = ExecuteUseCapability(
            dbPath,
            "session-lifecycle",
            registry,
            capabilityContext,
            "inspect",
            "builtin:create_goal");
        Assert(rejected.TryGetProperty("error", out _),
            "use_capability rejects non-whitelisted goal tools");

        var listCall = ExecuteUseCapability(
            dbPath,
            "session-lifecycle",
            registry,
            capabilityContext,
            "call",
            "builtin:list_goals",
            writer => writer.WriteNumber("limit", 2));
        Assert(listCall.GetProperty("goals").GetArrayLength() == 2,
            "use_capability calls list_goals through the tool dispatcher");

        var historyCall = ExecuteUseCapability(
            dbPath,
            "session-lifecycle",
            registry,
            capabilityContext,
            "call",
            "builtin:get_goal_history",
            writer =>
            {
                writer.WriteString("goalId", historySourceId);
                writer.WriteNumber("limit", 1);
            });
        AssertEqual(historySourceId,
            historyCall.GetProperty("goal").GetProperty("goalId").GetString(),
            "use_capability calls get_goal_history through the tool dispatcher");

        var reopenCall = ExecuteUseCapability(
            dbPath,
            "session-lifecycle",
            registry,
            capabilityContext,
            "call",
            "builtin:reopen_goal",
            writer =>
            {
                writer.WriteString("goalId", historySourceId);
                writer.WriteString("objective", "reopened through use_capability");
            });
        Assert(reopenCall.TryGetProperty("error", out _),
            "use_capability reopen_goal keeps the user confirmation boundary");
        AssertEqual(GoalStatusValues.Aborted,
            ScalarString(DbClient.GetClient(),
                "SELECT status FROM goals WHERE session_id = 'session-lifecycle' " +
                "AND objective = 'reopened through use_capability' ORDER BY created_at DESC LIMIT 1"),
            "use_capability reopen cancellation archives the new goal");

        RunUseCapabilityDiscoveryRegressionSuite(dbPath, capabilityContext);
    }

    private static void RunUseCapabilityDiscoveryRegressionSuite(
        string dbPath,
        IWorkerRequestContext context)
    {
        var registry = new ToolRegistry();
        registry.PushCategory("goal");
        new GoalToolProvider().RegisterTools(registry);
        registry.PopCategory();
        registry.PushCategory("project");
        new ProjectToolsProvider().RegisterTools(registry);
        registry.PopCategory();
        registry.PushCategory("capability");
        new UseCapabilityToolProvider().RegisterTools(registry);
        registry.PopCategory();

        foreach (var presetId in new[] { "full", "chat", "coding", "channel", "automation", "minimal", "skill-installer" })
        {
            var presetDefinitions = registry.GetToolDefinitions(ToolPreset.BuiltIn[presetId], "global");
            Assert(presetDefinitions.Any(definition => definition.Name == "use_capability"),
                $"{presetId} preset exposes use_capability as the unified entry point");
        }

        var firstPage = ExecuteUseCapability(
            dbPath, "session-lifecycle", registry, context, "list",
            writeInput: writer => writer.WriteNumber("page_size", 2));
        AssertEqual(2, firstPage.GetProperty("capabilities").GetArrayLength(),
            "use_capability list honors page_size");
        Assert(firstPage.GetProperty("has_more").GetBoolean()
               && firstPage.GetProperty("next_cursor").ValueKind == JsonValueKind.String,
            "use_capability list returns a continuation cursor");

        var secondPage = ExecuteUseCapability(
            dbPath, "session-lifecycle", registry, context, "list",
            writeInput: writer =>
            {
                writer.WriteNumber("page_size", 100);
                writer.WriteString("cursor", firstPage.GetProperty("next_cursor").GetString());
            });
        var pagedIds = firstPage.GetProperty("capabilities").EnumerateArray()
            .Concat(secondPage.GetProperty("capabilities").EnumerateArray())
            .Select(capability => capability.GetProperty("capability_id").GetString())
            .Where(id => id != null)
            .Cast<string>()
            .ToList();
        AssertEqual(firstPage.GetProperty("total").GetInt32(),
            pagedIds.Distinct(StringComparer.Ordinal).Count(),
            "use_capability pagination has no duplicates or omissions");

        var filtered = ExecuteUseCapability(
            dbPath, "session-lifecycle", registry, context, "list",
            writeInput: writer =>
            {
                writer.WriteString("type", "builtin");
                writer.WriteString("category", "goal");
                writer.WriteString("query", "get_goal_history");
            });
        AssertEqual(1, filtered.GetProperty("total").GetInt32(),
            "use_capability list combines type, category, and query filters");
        AssertEqual("builtin:get_goal_history",
            filtered.GetProperty("capabilities")[0].GetProperty("capability_id").GetString(),
            "use_capability filters return the expected capability");

        var globalProjects = ExecuteUseCapability(
            dbPath, "session-lifecycle", registry, context, "list",
            sessionMode: "global",
            writeInput: writer => writer.WriteString("category", "project"),
            projectId: null,
            scope: "global",
            collaborationMode: "chat",
            runtimeRole: "sessionAgent");
        Assert(globalProjects.GetProperty("total").GetInt32() == 4,
            "global Chat sessions can discover global tools through use_capability");

        var normalProjects = ExecuteUseCapability(
            dbPath, "session-lifecycle", registry, context, "list",
            sessionMode: "normal",
            writeInput: writer => writer.WriteString("category", "project"),
            projectId: "project-a",
            scope: "project",
            collaborationMode: "cowork",
            runtimeRole: "sessionAgent");
        AssertEqual(0, normalProjects.GetProperty("total").GetInt32(),
            "normal sessions cannot discover global project tools");

        var rejectedProjectInspect = ExecuteUseCapability(
            dbPath, "session-lifecycle", registry, context, "inspect",
            "builtin:list_projects", sessionMode: "normal",
            projectId: "project-a",
            scope: "project",
            collaborationMode: "cowork",
            runtimeRole: "sessionAgent");
        Assert(rejectedProjectInspect.TryGetProperty("error", out _),
            "normal sessions cannot inspect global project tools");

        var globalProjectInspect = ExecuteUseCapability(
            dbPath, "session-lifecycle", registry, context, "inspect",
            "builtin:list_projects", sessionMode: "global",
            projectId: null,
            scope: "global",
            collaborationMode: "chat",
            runtimeRole: "sessionAgent");
        Assert(globalProjectInspect.GetProperty("name").GetString() == "list_projects",
            "global Chat sessions can inspect global tool schemas through use_capability");

        registry.Register(new ProjectModeProbeTool(), "project");
        var globalProjectCall = ExecuteUseCapability(
            dbPath, "session-lifecycle", registry, context, "call",
            "builtin:project_mode_probe", sessionMode: "global",
            projectId: null,
            scope: "global",
            collaborationMode: "chat",
            runtimeRole: "sessionAgent");
        Assert(globalProjectCall.GetProperty("ok").GetBoolean(),
            "global Chat sessions can call global tools through use_capability");

        var rejectedProjectCall = ExecuteUseCapability(
            dbPath, "session-lifecycle", registry, context, "call",
            "builtin:project_mode_probe", sessionMode: "normal",
            projectId: "project-a",
            scope: "project",
            collaborationMode: "cowork",
            runtimeRole: "sessionAgent");
        Assert(rejectedProjectCall.TryGetProperty("error", out _),
            "normal sessions cannot call global project tools");

        var longJson = "{\"payload\":\"" + new string('x', 40_000) + "\"}";
        var listCall = new AgentRuntimeNativeToolCall(
            "limit-list", "use_capability", WorkerJsonHelper.BuildJsonElement(writer =>
            {
                writer.WriteStartObject();
                writer.WriteString("action", "list");
                writer.WriteEndObject();
            }));
        var capabilityListOutput = ToolCallProcessor.ApplyToolOutputLimit(listCall, longJson);
        using (JsonDocument.Parse(capabilityListOutput)) { }
        AssertEqual(longJson.Length, capabilityListOutput.Length,
            "use_capability list bypasses destructive string truncation");

        var inspectCall = new AgentRuntimeNativeToolCall(
            "limit-inspect", "use_capability", WorkerJsonHelper.BuildJsonElement(writer =>
            {
                writer.WriteStartObject();
                writer.WriteString("action", "inspect");
                writer.WriteEndObject();
            }));
        var capabilityInspectOutput = ToolCallProcessor.ApplyToolOutputLimit(inspectCall, longJson);
        using (JsonDocument.Parse(capabilityInspectOutput)) { }
        AssertEqual(longJson.Length, capabilityInspectOutput.Length,
            "use_capability inspect preserves complete schema JSON");

        var invalidCursor = ExecuteUseCapability(
            dbPath, "session-lifecycle", registry, context, "list",
            writeInput: writer => writer.WriteString("cursor", "not-a-cursor"));
        Assert(invalidCursor.TryGetProperty("error", out _),
            "use_capability list returns valid JSON errors for invalid cursors");

        var callCall = new AgentRuntimeNativeToolCall(
            "limit-call", "use_capability", WorkerJsonHelper.BuildJsonElement(writer =>
            {
                writer.WriteStartObject();
                writer.WriteString("action", "call");
                writer.WriteEndObject();
            }));
        var capabilityCallOutput = ToolCallProcessor.ApplyToolOutputLimit(callCall, longJson);
        Assert(capabilityCallOutput.Contains("[truncated ", StringComparison.Ordinal),
            "use_capability call results retain the ordinary output limit");
        AssertThrows<JsonException>(() => JsonDocument.Parse(capabilityCallOutput),
            "ordinary head-tail truncation is not used for discovery JSON");
    }

    private static JsonElement ExecuteUseCapability(
        string dbPath,
        string sessionId,
        ToolRegistry registry,
        IWorkerRequestContext context,
        string action,
        string? capabilityId = null,
        Action<Utf8JsonWriter>? writeArguments = null,
        string sessionMode = "goal",
        Action<Utf8JsonWriter>? writeInput = null,
        string? projectId = "project-a",
        string scope = "project",
        string collaborationMode = "cowork",
        string runtimeRole = "goalRunner")
    {
        using var state = new AgentRuntimeRunState($"test-{Guid.NewGuid():N}", sessionId);
        state.ReplaceParameters(WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("dbPath", dbPath);
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("sessionMode", sessionMode);
            if (projectId != null)
                writer.WriteString("projectId", projectId);
            writer.WriteString("scope", scope);
            writer.WriteString("collaborationMode", collaborationMode);
            writer.WriteString("runtimeRole", runtimeRole);
            writer.WriteEndObject();
        }));
        var call = new AgentRuntimeNativeToolCall(
            $"call-{Guid.NewGuid():N}",
            "use_capability",
            WorkerJsonHelper.BuildJsonElement(writer =>
            {
                writer.WriteStartObject();
                writer.WriteString("action", action);
                if (capabilityId != null)
                    writer.WriteString("capability_id", capabilityId);
                writeInput?.Invoke(writer);
                if (writeArguments != null)
                {
                    writer.WriteStartObject("arguments");
                    writeArguments(writer);
                    writer.WriteEndObject();
                }
                writer.WriteEndObject();
            }));
        var json = AgentRuntimeUseCapabilityExecutor.ExecuteAsync(
                call,
                state,
                context,
                registry,
                null,
                null,
                null,
                state.CancellationToken)
            .GetAwaiter()
            .GetResult();
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static JsonElement ExecuteCreateGoal(
        string dbPath,
        string sessionId,
        string objective,
        IWorkerRequestContext context)
        => ExecuteGoalTool(
            dbPath,
            sessionId,
            "create_goal",
            writer => writer.WriteString("objective", objective),
            context);

    private static JsonElement ExecuteGoalTool(
        string dbPath,
        string sessionId,
        string toolName,
        Action<Utf8JsonWriter> writeInput,
        IWorkerRequestContext context)
    {
        using var state = new AgentRuntimeRunState($"test-{Guid.NewGuid():N}", sessionId);
        state.ReplaceParameters(WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("dbPath", dbPath);
            writer.WriteString("sessionId", sessionId);
            writer.WriteEndObject();
        }));
        var call = new AgentRuntimeNativeToolCall(
            $"call-{Guid.NewGuid():N}",
            toolName,
            WorkerJsonHelper.BuildJsonElement(writer =>
            {
                writer.WriteStartObject();
                writeInput(writer);
                writer.WriteEndObject();
            }));
        var json = AgentRuntimeGoalExecutor.ExecuteAsync(call, state, context)
            .GetAwaiter()
            .GetResult();
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }
}

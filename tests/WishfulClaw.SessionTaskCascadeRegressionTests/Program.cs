using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using Microsoft.Data.Sqlite;
using WishfulClaw.Agent;
using WishfulClaw.Agent.Tools.Providers;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Tools;
using WishfulClaw.Infrastructure;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.SessionTaskCascadeRegressionTests;

/// <summary>
/// Local AOT context for the global-task executor result records (registered in
/// WishfulClawJsonContext at runtime; mirrored here so the test can resolve them).
/// </summary>
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(GlobalTaskCreateToolResult))]
[JsonSerializable(typeof(GlobalTaskMutationToolResult))]
[JsonSerializable(typeof(GlobalDispatchCreateToolResult))]
[JsonSerializable(typeof(GlobalDispatchUpdateToolResult))]
internal partial class RegressionJsonContext : JsonSerializerContext
{
}

/// <summary>
/// Regression: session-scoped agent tasks (tasks table) must be cascade-deleted
/// together with messages whenever a session/conversation/project is removed,
/// while ClearAll must keep plugin-bound sessions and their tasks intact.
/// </summary>
internal static class Program
{
    private static int _passed;

    public static async Task<int> Main()
    {
        try
        {
            WorkerJsonHelper.ConfigureAotResolver(JsonTypeInfoResolver.Combine(
                InfrastructureJsonContext.Default, RegressionJsonContext.Default));
            var testRoot = Path.Combine(Path.GetTempPath(), $"wishful-task-cascade-regression-{Guid.NewGuid():N}");
            Directory.CreateDirectory(testRoot);
            try
            {
                var dbPath = Path.Combine(testRoot, "regression.db");
                var initialization = DbClient.Initialize(dbPath);
                Assert(initialization.Success, $"database initializes: {initialization.Error}");
                var db = DbClient.GetClient();

                AssertEqual(1L, db.QueryScalar<long>(
                        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tasks'"),
                    "tasks table exists");
                AssertEqual(1L, db.QueryScalar<long>(
                        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='global_tasks'"),
                    "global_tasks table exists");
                AssertEqual(1L, db.QueryScalar<long>(
                        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='global_task_dispatches'"),
                    "global_task_dispatches table exists");

                RunSessionDeleteSuite(dbPath, db);
                RunResetConversationSuite(dbPath, db);
                RunProjectDeleteSuite(dbPath, db);
                RunPluginSessionSuite(dbPath, db);
                RunClearAllSuite(dbPath, db);
                RunGlobalTaskSuite(dbPath, db);
                RunGlobalToolProviderSuite();
                await RunGlobalTaskExecutorSuiteAsync(dbPath);
                RunDeleteBySessionSuite(dbPath, db);
            }
            finally
            {
                TryDeleteDirectory(testRoot);
            }

            Console.WriteLine($"Session task cascade regression passed: {_passed}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Session task cascade regression failed: {ex}");
            return 1;
        }
    }

    // ─── Suite: DbSessionTools.Delete cascade ───

    private static void RunSessionDeleteSuite(string dbPath, DbService db)
    {
        CreateSession(dbPath, "s-del", title: "Delete Suite", projectId: null);
        SeedTask(dbPath, "s-del", "s-del-t1");
        SeedTask(dbPath, "s-del", "s-del-t2");
        AssertEqual(2L, TaskCount(db, "s-del"), "session delete suite seeds two tasks");

        ExpectNoError(DbSessionTools.Delete(Params(dbPath, w => w.WriteString("id", "s-del"))), "DbSessionTools.Delete succeeds");
        AssertEqual(0L, TaskCount(db, "s-del"), "session delete removes all session tasks");
        AssertEqual(0L, db.QueryScalar<long>("SELECT COUNT(*) FROM sessions WHERE id = 's-del'"), "session row removed");
    }

    // ─── Suite: ResetConversation keeps session, drops tasks ───

    private static void RunResetConversationSuite(string dbPath, DbService db)
    {
        CreateSession(dbPath, "s-reset", title: "Reset Suite", projectId: null);
        SeedTask(dbPath, "s-reset", "s-reset-t1");
        AssertEqual(1L, TaskCount(db, "s-reset"), "reset suite seeds one task");

        ExpectNoError(DbSessionTools.ResetConversation(Params(dbPath, w => w.WriteString("sessionId", "s-reset"))), "ResetConversation succeeds");
        AssertEqual(0L, TaskCount(db, "s-reset"), "reset conversation removes session tasks");
        AssertEqual(1L, db.QueryScalar<long>("SELECT COUNT(*) FROM sessions WHERE id = 's-reset'"), "reset conversation keeps the session row");
    }

    // ─── Suite: DbProjectTools.Delete cascade ───

    private static void RunProjectDeleteSuite(string dbPath, DbService db)
    {
        ExpectNoError(DbProjectTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "p-del");
            w.WriteString("name", "Cascade Project");
        })), "project created");
        CreateSession(dbPath, "s-proj", title: "Project Session", projectId: "p-del");
        SeedTask(dbPath, "s-proj", "s-proj-t1");
        AssertEqual(1L, TaskCount(db, "s-proj"), "project suite seeds one task");

        ExpectNoError(DbProjectTools.Delete(Params(dbPath, w => w.WriteString("id", "p-del"))), "DbProjectTools.Delete succeeds");
        AssertEqual(0L, TaskCount(db, "s-proj"), "project delete removes tasks of project sessions");
        AssertEqual(0L, db.QueryScalar<long>("SELECT COUNT(*) FROM sessions WHERE id = 's-proj'"), "project delete removes sessions");
    }

    // ─── Suite: plugin session clear/delete cascade ───

    private static void RunPluginSessionSuite(string dbPath, DbService db)
    {
        ExpectNoError(DbPluginSessionTools.CreatePluginSession(Params(dbPath, w =>
        {
            w.WriteString("id", "s-plugin");
            w.WriteString("pluginId", "plugin-x");
            w.WriteString("title", "Plugin Session");
        })), "plugin session created");
        SeedTask(dbPath, "s-plugin", "s-plugin-t1");
        AssertEqual(1L, TaskCount(db, "s-plugin"), "plugin suite seeds one task");

        ExpectNoError(DbPluginSessionTools.ClearPluginSession(Params(dbPath, w => w.WriteString("sessionId", "s-plugin"))), "ClearPluginSession succeeds");
        AssertEqual(0L, TaskCount(db, "s-plugin"), "clear plugin session removes tasks");
        AssertEqual(1L, db.QueryScalar<long>("SELECT COUNT(*) FROM sessions WHERE id = 's-plugin'"), "clear plugin session keeps the session row");

        SeedTask(dbPath, "s-plugin", "s-plugin-t2");
        ExpectNoError(DbPluginSessionTools.DeletePluginSession(Params(dbPath, w => w.WriteString("sessionId", "s-plugin"))), "DeletePluginSession succeeds");
        AssertEqual(0L, TaskCount(db, "s-plugin"), "delete plugin session removes tasks");
        AssertEqual(0L, db.QueryScalar<long>("SELECT COUNT(*) FROM sessions WHERE id = 's-plugin'"), "delete plugin session removes the session row");
    }

    // ─── Suite: ClearAll only wipes non-plugin sessions ───

    private static void RunClearAllSuite(string dbPath, DbService db)
    {
        CreateSession(dbPath, "s-clear", title: "ClearAll Suite", projectId: null);
        SeedTask(dbPath, "s-clear", "s-clear-t1");
        ExpectNoError(DbPluginSessionTools.CreatePluginSession(Params(dbPath, w =>
        {
            w.WriteString("id", "s-keep");
            w.WriteString("pluginId", "plugin-y");
            w.WriteString("title", "Kept Plugin Session");
        })), "plugin session for ClearAll created");
        SeedTask(dbPath, "s-keep", "s-keep-t1");

        ExpectNoError(DbSessionTools.ClearAll(Params(dbPath)), "ClearAll succeeds");
        AssertEqual(0L, TaskCount(db, "s-clear"), "ClearAll removes tasks of normal sessions");
        AssertEqual(0L, db.QueryScalar<long>("SELECT COUNT(*) FROM sessions WHERE id = 's-clear'"), "ClearAll removes normal session rows");
        AssertEqual(1L, TaskCount(db, "s-keep"), "ClearAll keeps plugin session tasks");
        AssertEqual(1L, db.QueryScalar<long>("SELECT COUNT(*) FROM sessions WHERE id = 's-keep'"), "ClearAll keeps plugin session rows");
    }

    // ─── Suite: global tasks + dispatches CRUD, constraints, archive ───

    private static void RunGlobalTaskSuite(string dbPath, DbService db)
    {
        // Create + basic list
        ExpectNoError(DbGlobalTaskTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "gt-1");
            w.WriteString("title", "Ship the roadmap");
            w.WriteString("description", "Cross-project coordination");
            w.WriteString("priority", "high");
            w.WritePropertyName("tags");
            w.WriteStartArray();
            w.WriteStringValue("roadmap");
            w.WriteEndArray();
        })), "global task created");

        var listed = ResultArray(DbGlobalTaskTools.List(Params(dbPath)));
        AssertEqual(1, listed.Count, "global task list returns the created task");
        AssertEqual("gt-1", listed[0].GetProperty("id").GetString(), "global task row id roundtrips");
        AssertEqual("high", listed[0].GetProperty("priority").GetString(), "global task row priority roundtrips");
        AssertEqual("[\"roadmap\"]", listed[0].GetProperty("tags").GetString(), "global task tags stored as JSON array text");

        // Update via patch
        ExpectNoError(DbGlobalTaskTools.Update(Params(dbPath, w =>
        {
            w.WriteString("id", "gt-1");
            w.WritePropertyName("patch");
            w.WriteStartObject();
            w.WriteString("status", "in_progress");
            w.WriteNumber("dueAt", 123456789);
            w.WriteEndObject();
        })), "global task updated");
        var updated = listed = ResultArray(DbGlobalTaskTools.List(Params(dbPath, w => w.WriteString("status", "in_progress"))));
        AssertEqual(1, updated.Count, "status filter returns the updated task");
        AssertEqual(123456789L, updated[0].GetProperty("due_at").GetInt64(), "due_at roundtrips in snake_case");

        // Dispatch creation constraints
        CreateSession(dbPath, "s-gt", title: "Global Dispatch Target", projectId: null);
        var missingSession = DbGlobalTaskDispatchTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "gd-missing-session");
            w.WriteString("globalTaskId", "gt-1");
            w.WriteString("sessionId", "no-such-session");
        }));
        ExpectFailure(missingSession, "Target session not found", "dispatch rejects missing target session");
        var missingTask = DbGlobalTaskDispatchTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "gd-missing-task");
            w.WriteString("globalTaskId", "no-such-task");
            w.WriteString("sessionId", "s-gt");
        }));
        ExpectFailure(missingTask, "Global task not found", "dispatch rejects missing global task");

        // Valid dispatch (project inferred from the session)
        ExpectNoError(DbGlobalTaskDispatchTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "gd-1");
            w.WriteString("globalTaskId", "gt-1");
            w.WriteString("sessionId", "s-gt");
            w.WriteString("kind", "work_request");
            w.WriteString("instruction", "Implement the export feature");
        })), "dispatch created");

        // Update dispatch report/status
        ExpectNoError(DbGlobalTaskDispatchTools.Update(Params(dbPath, w =>
        {
            w.WriteString("id", "gd-1");
            w.WritePropertyName("patch");
            w.WriteStartObject();
            w.WriteString("status", "completed");
            w.WriteString("latestReport", "Export feature shipped");
            w.WriteNumber("completedAt", 999);
            w.WriteEndObject();
        })), "dispatch updated");
        var dispatch = ResultArray(DbGlobalTaskDispatchTools.List(Params(dbPath, w => w.WriteString("globalTaskId", "gt-1"))));
        AssertEqual(1, dispatch.Count, "dispatch list filters by global task");
        AssertEqual("Export feature shipped", dispatch[0].GetProperty("latest_report").GetString(), "latest_report roundtrips");
        AssertEqual(999L, dispatch[0].GetProperty("completed_at").GetInt64(), "completed_at roundtrips");

        // Cancel refuses completed dispatches
        ExpectFailure(DbGlobalTaskDispatchTools.Cancel(Params(dbPath, w => w.WriteString("id", "gd-1"))),
            "already completed/cancelled", "cancel refuses a completed dispatch");

        // Archive hides from default list but keeps the row
        ExpectNoError(DbGlobalTaskTools.Archive(Params(dbPath, w => w.WriteString("id", "gt-1"))), "global task archived");
        AssertEqual(0, ResultArray(DbGlobalTaskTools.List(Params(dbPath))).Count, "archived task hidden from default list");
        AssertEqual(1, ResultArray(DbGlobalTaskTools.List(Params(dbPath, w => w.WriteBoolean("includeArchived", true)))).Count,
            "archived task visible with includeArchived");

        // Dispatch records are permanent: session delete must NOT remove them
        ExpectNoError(DbSessionTools.Delete(Params(dbPath, w => w.WriteString("id", "s-gt"))), "dispatch target session deleted");
        AssertEqual(1, ResultArray(DbGlobalTaskDispatchTools.List(Params(dbPath, w => w.WriteString("globalTaskId", "gt-1")))).Count,
            "dispatch record survives target session deletion");
    }

    // ─── Suite: GlobalTaskToolsProvider registration ───

    private static void RunGlobalToolProviderSuite()
    {
        var registry = new ToolRegistry();
        new GlobalTaskToolsProvider().RegisterTools(registry);
        var definitions = registry.GetToolDefinitions();
        AssertEqual(6, definitions.Count, "global task provider registers 6 tools");

        var expected = new HashSet<string>
        {
            "list_global_tasks", "create_global_task", "update_global_task",
            "list_global_dispatches", "send_work_request", "update_dispatch"
        };
        foreach (var definition in definitions)
        {
            Assert(expected.Contains(definition.Name), $"registered global tool name: {definition.Name}");
            Assert(registry.IsAvailableInMode(definition.Name, "global"),
                $"{definition.Name} is available in global mode");
            Assert(!registry.IsAvailableInMode(definition.Name, "normal"),
                $"{definition.Name} is hidden in normal mode");
        }
    }

    // ─── Suite: AgentRuntimeGlobalTaskExecutor glue (CRUD paths) ───

    private static async Task RunGlobalTaskExecutorSuiteAsync(string dbPath)
    {
        CreateSession(dbPath, "s-gtx", title: "Executor Target", projectId: null);

        // create_global_task generates its own id and returns an AOT-safe envelope
        var createJson = await AgentRuntimeGlobalTaskExecutor.ExecuteAsync(
            ToolCall("create_global_task", w =>
            {
                w.WriteString("title", "Executor task");
                w.WriteString("priority", "urgent");
                w.WritePropertyName("tags");
                w.WriteStartArray();
                w.WriteStringValue("exec");
                w.WriteEndArray();
            }),
            default, null!, CancellationToken.None);
        using (var document = JsonDocument.Parse(createJson))
        {
            var root = document.RootElement;
            Assert(!root.TryGetProperty("error", out _), "executor create_global_task succeeds");
            AssertEqual("Executor task", root.GetProperty("title").GetString(), "executor create returns title");
            AssertEqual("pending", root.GetProperty("status").GetString(), "executor create returns pending status");
            Assert(root.GetProperty("taskId").GetString()!.StartsWith("gt_", StringComparison.Ordinal),
                "executor create generates gt_ prefixed id");
        }

        // list_global_tasks sees the created task
        var taskId = JsonDocument.Parse(createJson).RootElement.GetProperty("taskId").GetString()!;
        var listJson = await AgentRuntimeGlobalTaskExecutor.ExecuteAsync(
            ToolCall("list_global_tasks", w => w.WriteString("keyword", "Executor")),
            default, null!, CancellationToken.None);
        Assert(listJson.Contains(taskId), "executor list_global_tasks returns the created task");

        // update_global_task patch roundtrip (archive semantics covered at DB level)
        var updateJson = await AgentRuntimeGlobalTaskExecutor.ExecuteAsync(
            ToolCall("update_global_task", w =>
            {
                w.WriteString("taskId", taskId);
                w.WritePropertyName("patch");
                w.WriteStartObject();
                w.WriteString("status", "completed");
                w.WriteEndObject();
            }),
            default, null!, CancellationToken.None);
        using (var document = JsonDocument.Parse(updateJson))
        {
            var root = document.RootElement;
            Assert(root.GetProperty("success").GetBoolean(), "executor update_global_task succeeds");
            AssertEqual(taskId, root.GetProperty("taskId").GetString(), "executor update echoes task id");
        }

        // send_work_request without delivery: missing target session fails cleanly
        var badDispatchJson = await AgentRuntimeGlobalTaskExecutor.ExecuteAsync(
            ToolCall("send_work_request", w =>
            {
                w.WriteString("globalTaskId", taskId);
                w.WriteString("sessionId", "no-such-session");
                w.WriteString("instruction", "do something");
            }),
            default, null!, CancellationToken.None);
        using (var document = JsonDocument.Parse(badDispatchJson))
        {
            Assert(document.RootElement.TryGetProperty("error", out var error)
                    && error.GetString()!.Contains("Target session not found", StringComparison.OrdinalIgnoreCase),
                "executor send_work_request rejects missing session without context");
        }

        // update_dispatch stamps completedAt automatically when absent
        CreateSession(dbPath, "s-gtx2", title: "Executor Target 2", projectId: null);
        ExpectNoError(DbGlobalTaskDispatchTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "gd-exec");
            w.WriteString("globalTaskId", taskId);
            w.WriteString("sessionId", "s-gtx2");
            w.WriteString("kind", "work_request");
            w.WriteString("instruction", "seeded for executor test");
        })), "executor suite seeds dispatch gd-exec");

        var dispatchUpdateJson = await AgentRuntimeGlobalTaskExecutor.ExecuteAsync(
            ToolCall("update_dispatch", w =>
            {
                w.WriteString("dispatchId", "gd-exec");
                w.WritePropertyName("patch");
                w.WriteStartObject();
                w.WriteString("status", "completed");
                w.WriteString("latestReport", "done by executor test");
                w.WriteEndObject();
            }),
            default, null!, CancellationToken.None);
        using (var document = JsonDocument.Parse(dispatchUpdateJson))
        {
            Assert(document.RootElement.GetProperty("success").GetBoolean(), "executor update_dispatch succeeds");
        }
        var dispatchRows = ResultArray(DbGlobalTaskDispatchTools.List(Params(dbPath, w => w.WriteString("status", "completed"))));
        var gdExec = dispatchRows.Single(row => row.GetProperty("id").GetString() == "gd-exec");
        Assert(gdExec.GetProperty("completed_at").GetInt64() > 0,
            "executor auto-stamps completed_at when patch omits it");
    }

    // ─── Suite: DbTaskTools.DeleteBySession ───

    private static void RunDeleteBySessionSuite(string dbPath, DbService db)
    {
        CreateSession(dbPath, "s-dbs", title: "DeleteBySession Suite", projectId: null);
        SeedTask(dbPath, "s-dbs", "s-dbs-t1");
        SeedTask(dbPath, "s-dbs", "s-dbs-t2");
        AssertEqual(2L, TaskCount(db, "s-dbs"), "delete-by-session suite seeds two tasks");

        ExpectNoError(DbTaskTools.DeleteBySession(Params(dbPath, w => w.WriteString("sessionId", "s-dbs"))), "DeleteBySession succeeds");
        AssertEqual(0L, TaskCount(db, "s-dbs"), "DeleteBySession removes all session tasks");
        AssertEqual(1L, db.QueryScalar<long>("SELECT COUNT(*) FROM sessions WHERE id = 's-dbs'"), "DeleteBySession keeps the session row");
    }

    // ─── Helpers ───

    private static void CreateSession(string dbPath, string id, string title, string? projectId)
    {
        ExpectNoError(DbSessionTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", id);
            w.WriteString("title", title);
            if (projectId is not null)
                w.WriteString("projectId", projectId);
        })), $"session {id} created");
    }

    private static void SeedTask(string dbPath, string sessionId, string taskId)
    {
        ExpectNoError(DbTaskTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", taskId);
            w.WriteString("sessionId", sessionId);
            w.WriteString("subject", $"Task {taskId}");
        })), $"task {taskId} created");
    }

    private static long TaskCount(DbService db, string sessionId)
        => db.QueryScalar<long>("SELECT COUNT(*) FROM tasks WHERE session_id = @sid",
            new SqliteParameter("@sid", sessionId));

    private static AgentRuntimeNativeToolCall ToolCall(string name, Action<Utf8JsonWriter> writeProperties)
        => new("tc-test", name, WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writeProperties(writer);
            writer.WriteEndObject();
        }));

    private static JsonElement Params(string dbPath, Action<Utf8JsonWriter>? writeProperties = null)
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("dbPath", dbPath);
            writeProperties?.Invoke(writer);
            writer.WriteEndObject();
        });

    private static List<JsonElement> ResultArray(WorkerResponse response)
    {
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        return document.RootElement.GetProperty("result").EnumerateArray().Select(item => item.Clone()).ToList();
    }

    private static void ExpectFailure(WorkerResponse response, string expectedErrorFragment, string name)
    {
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        var result = document.RootElement.GetProperty("result");
        var error = result.TryGetProperty("error", out var errorProp) ? errorProp.GetString() : null;
        if (error is null || !error.Contains(expectedErrorFragment, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"{name}: expected error containing '{expectedErrorFragment}', got {result.GetRawText()}");
        Assert(true, name);
    }

    private static void ExpectNoError(WorkerResponse response, string name)
    {
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        var root = document.RootElement;
        if (root.TryGetProperty("error", out var error))
            throw new InvalidOperationException($"{name}: {error.GetRawText()}");
        if (root.TryGetProperty("result", out var result)
            && result.ValueKind == JsonValueKind.Object)
        {
            if (result.TryGetProperty("error", out var resultError)
                && resultError.ValueKind == JsonValueKind.String
                && !string.IsNullOrEmpty(resultError.GetString()))
                throw new InvalidOperationException($"{name}: {result.GetRawText()}");
            if (result.TryGetProperty("success", out var success) && !success.GetBoolean())
                throw new InvalidOperationException($"{name}: {result.GetRawText()}");
        }
        Assert(true, name);
    }

    private static void Assert(bool condition, string name)
    {
        if (!condition)
            throw new InvalidOperationException(name);
        _passed++;
        Console.WriteLine($"PASS: {name}");
    }

    private static void AssertEqual<T>(T expected, T actual, string name)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new InvalidOperationException($"{name}: expected={expected}, actual={actual}");
        Assert(true, name);
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path))
                Directory.Delete(path, true);
        }
        catch
        {
            // Best-effort cleanup for temporary regression data.
        }
    }
}

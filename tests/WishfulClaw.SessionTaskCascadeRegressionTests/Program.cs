// 会话任务级联回归：AOT 上下文、入口、同步级联套件与断言辅助。
// 拆分自原单文件 Program.cs（S-252，2026-10-28），方法体逐字平移。
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
using WishfulClaw.TestSupport;

namespace WishfulClaw.SessionTaskCascadeRegressionTests;

/// <summary>
/// Local AOT context for the tool result records the suites serialize directly —
/// the global-task executor results plus create_session's result (registered in
/// WishfulClawJsonContext at runtime; mirrored here so the tests can resolve them).
/// </summary>
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(GlobalTaskCreateToolResult))]
[JsonSerializable(typeof(GlobalTaskMutationToolResult))]
[JsonSerializable(typeof(GlobalDispatchCreateToolResult))]
[JsonSerializable(typeof(GlobalDispatchUpdateToolResult))]
[JsonSerializable(typeof(GlobalDispatchReplyToolResult))]
[JsonSerializable(typeof(CreateSessionResult))]
internal partial class RegressionJsonContext : JsonSerializerContext
{
}

/// <summary>
/// Regression: session-scoped agent tasks (tasks table) must be cascade-deleted
/// together with messages whenever a session/conversation/project is removed,
/// while ClearAll must keep plugin-bound sessions and their tasks intact.
/// </summary>
internal static partial class Program
{
    private static int _passed;

    public static async Task<int> Main()
    {
        try
        {
            WorkerJsonHelper.ConfigureAotResolver(JsonTypeInfoResolver.Combine(
                InfrastructureJsonContext.Default, RegressionJsonContext.Default));
            var testRoot = Path.Combine(TestOutputRoot.Resolve(), $"wishful-task-cascade-regression-{Guid.NewGuid():N}");
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

                RunSessionFollowUpSuite(dbPath, db);
                RunSessionDeleteSuite(dbPath, db);
                RunResetConversationSuite(dbPath, db);
                RunProjectDeleteSuite(dbPath, db);
                RunPluginSessionSuite(dbPath, db);
                RunPluginSessionRoutingSuite(dbPath, db);
                RunSessionPermissionModeSuite(dbPath, db);
        RunSessionContextCapSuite(dbPath, db);
                RunClearAllSuite(dbPath, db);
                RunGlobalTaskSuite(dbPath, db);
                RunGlobalToolProviderSuite();
                RunChannelToolProviderSuite();
                await RunGlobalTaskExecutorSuiteAsync(dbPath);
                await RunDispatchProtocolSuiteAsync(dbPath);
                RunDeleteBySessionSuite(dbPath, db);
                await RunCreateSessionInsertSuiteAsync(dbPath, db);
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
        CreateSession(dbPath, "s-gt", title: "Global Dispatch Target", projectId: "p-gt");
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

    // ─── Suite: Channel tool provider mode availability ───

    private static void RunChannelToolProviderSuite()
    {
        var registry = new ToolRegistry();
        new ChannelPluginToolProvider().RegisterTools(registry);

        var channelSendImage = registry.GetToolDefinitions()
            .Single(definition => definition.Name == "ChannelSendImage");
        Assert(registry.IsAvailableInMode(channelSendImage.Name, "channel"),
            "ChannelSendImage is available in channel mode");
        Assert(registry.IsAvailableInMode(channelSendImage.Name, "global"),
            "ChannelSendImage remains available in global mode");
        Assert(registry.IsAvailableInMode(channelSendImage.Name, "normal"),
            "ChannelSendImage remains available in normal mode");
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

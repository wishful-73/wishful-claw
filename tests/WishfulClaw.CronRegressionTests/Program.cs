using System.Diagnostics;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Agent.Tools.Providers;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Tools;
using WishfulClaw.Infrastructure;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.CronRegressionTests;

internal static class Program
{
    private const string PersistentJobId = "cron-persistent";
    private const string DisabledJobId = "cron-disabled";
    private const string SmokeJobId = "cron-smoke-at";
    private static int _passed;

    public static int Main(string[] args)
    {
        WorkerJsonHelper.ConfigureAotResolver(InfrastructureJsonContext.Default);
        try
        {
            if (args.Length == 2)
                return RunChildMode(args[0], args[1]);

            RunSchemaRegressionSuite();
            var testRoot = Path.Combine(Path.GetTempPath(), $"wishful-cron-regression-{Guid.NewGuid():N}");
            Directory.CreateDirectory(testRoot);
            try
            {
                var legacyDbPath = Path.Combine(testRoot, "legacy.db");
                var newDbPath = Path.Combine(testRoot, "new.db");
                SeedLegacyCronDatabase(legacyDbPath);
                RunChild("--exercise-legacy", legacyDbPath);
                RunChild("--verify-reopen", legacyDbPath);
                RunChild("--verify-new", newDbPath);
            }
            finally
            {
                TryDeleteDirectory(testRoot);
            }

            Console.WriteLine($"Cron regression parent checks passed: {_passed}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Cron regression test failed: {ex}");
            return 1;
        }
    }

    private static int RunChildMode(string mode, string dbPath)
    {
        try
        {
            switch (mode)
            {
                case "--exercise-legacy":
                    RunLegacyAndCrudSuite(dbPath);
                    break;
                case "--verify-reopen":
                    RunReopenSuite(dbPath);
                    break;
                case "--verify-new":
                    RunNewDatabaseSuite(dbPath);
                    break;
                case "--seed-smoke":
                    SeedSmokeTask(dbPath);
                    break;
                case "--verify-smoke":
                    VerifySmokeTask(dbPath);
                    break;
                default:
                    throw new InvalidOperationException($"Unknown child mode: {mode}");
            }

            Console.WriteLine($"Cron regression child checks passed ({mode}): {_passed}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Cron regression child failed ({mode}): {ex}");
            return 1;
        }
    }

    private static void RunSchemaRegressionSuite()
    {
        var registry = new ToolRegistry();
        new CronToolProvider().RegisterTools(registry);
        var definitions = registry.GetToolDefinitions().ToDictionary(item => item.Name, StringComparer.Ordinal);

        foreach (var name in new[] { "CronAdd", "CronCreate", "CronUpdate", "CronRemove", "CronDelete", "CronList" })
            Assert(definitions.ContainsKey(name), $"Native schema registers {name}");

        var create = definitions["CronCreate"].InputSchema;
        AssertEqual("object", create.GetProperty("type").GetString(), "CronCreate input is an object");
        AssertRequired(create, "name", "schedule", "prompt");
        var createProperties = create.GetProperty("properties");
        var schedule = createProperties.GetProperty("schedule");
        AssertEqual("object", schedule.GetProperty("type").GetString(), "schedule is an object");
        AssertRequired(schedule, "kind");
        var scheduleProperties = schedule.GetProperty("properties");
        AssertEqual("string", scheduleProperties.GetProperty("at").GetProperty("type").GetString(), "at accepts relative strings");
        AssertEqual("number", scheduleProperties.GetProperty("every").GetProperty("type").GetString(), "every accepts milliseconds");
        AssertEqual("string", scheduleProperties.GetProperty("expr").GetProperty("type").GetString(), "cron expression is a string");
        var kinds = scheduleProperties.GetProperty("kind").GetProperty("enum")
            .EnumerateArray().Select(item => item.GetString()).ToArray();
        Assert(kinds.SequenceEqual(new[] { "at", "every", "cron" }), "schedule kind enum covers at/every/cron");

        foreach (var field in new[]
                 {
                     "sessionId", "agentId", "model", "workingFolder", "deliveryMode", "deliveryTarget",
                     "pluginId", "pluginType", "pluginChatId", "deleteAfterRun", "maxIterations"
                 })
            Assert(createProperties.TryGetProperty(field, out _), $"CronCreate exposes {field}");
        AssertEqual("integer", createProperties.GetProperty("maxIterations").GetProperty("type").GetString(),
            "maxIterations uses integer schema");
        var deliveryModes = createProperties.GetProperty("deliveryMode").GetProperty("enum")
            .EnumerateArray().Select(item => item.GetString()).ToArray();
        Assert(deliveryModes.SequenceEqual(new[] { "desktop", "session", "plugin", "none" }),
            "deliveryMode enum covers all runtime modes");

        var update = definitions["CronUpdate"].InputSchema;
        AssertRequired(update, "jobId", "patch");
        var patch = update.GetProperty("properties").GetProperty("patch");
        AssertEqual("object", patch.GetProperty("type").GetString(), "CronUpdate patch is an object");
        Assert(patch.GetProperty("properties").TryGetProperty("enabled", out _), "CronUpdate patch exposes enabled");
        AssertRequired(definitions["CronRemove"].InputSchema, "jobId");
        AssertRequired(definitions["CronDelete"].InputSchema, "jobId");
    }

    private static void RunLegacyAndCrudSuite(string dbPath)
    {
        var initialization = DbClient.Initialize(dbPath);
        Assert(initialization.Success, $"legacy cron database migrates: {initialization.Error}");
        var db = DbClient.GetClient();
        var columns = db.Query("PRAGMA table_info(cron_tasks);", reader => reader.GetString("name"));
        foreach (var column in ExpectedCronColumns())
            Assert(columns.Contains(column, StringComparer.OrdinalIgnoreCase), $"legacy migration adds {column}");
        AssertEqual(1L, db.QueryScalar<long>("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='ix_cron_tasks_enabled_next'"),
            "legacy migration creates enabled index after columns");
        AssertEqual(1L, db.QueryScalar<long>("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='ix_cron_tasks_session'"),
            "legacy migration creates session index after columns");

        var migrated = ResultObject(DbCronTools.Get(Parameters(dbPath, writer => writer.WriteString("id", "legacy-cron"))));
        Assert(migrated.GetProperty("success").GetBoolean(), "legacy row remains queryable");
        AssertEqual("desktop", migrated.GetProperty("cron").GetProperty("delivery_mode").GetString(),
            "legacy row receives delivery default");
        AssertEqual(15, migrated.GetProperty("cron").GetProperty("max_iterations").GetInt32(),
            "legacy row receives iteration default");
        AssertMutationSuccess(DbCronTools.Delete(Parameters(dbPath, writer => writer.WriteString("id", "legacy-cron"))),
            "legacy row can be soft-deleted");

        var created = ResultObject(DbCronTools.Create(CreateParameters(dbPath, PersistentJobId, enabled: true)));
        Assert(created.GetProperty("success").GetBoolean(), "create persists a Cron task");
        var createdCron = created.GetProperty("cron");
        AssertEqual("plugin", createdCron.GetProperty("delivery_mode").GetString(), "create persists delivery mode");
        AssertEqual("feishu", createdCron.GetProperty("plugin_type").GetString(), "create persists plugin type");
        AssertEqual(21, createdCron.GetProperty("max_iterations").GetInt32(), "create persists max iterations");

        AssertMutationSuccess(DbCronTools.Create(CreateParameters(dbPath, DisabledJobId, enabled: false)),
            "create supports disabled tasks");
        var defaultList = ResultArray(DbCronTools.List(Parameters(dbPath)));
        AssertEqual(2, defaultList.Count, "list filters soft-deleted rows by default");
        var enabledList = ResultArray(DbCronTools.List(Parameters(dbPath, writer => writer.WriteBoolean("enabledOnly", true))));
        AssertEqual(1, enabledList.Count, "enabledOnly returns only enabled tasks");
        AssertEqual(PersistentJobId, enabledList[0].GetProperty("id").GetString(), "enabledOnly returns the enabled task");
        var deletedList = ResultArray(DbCronTools.List(Parameters(dbPath, writer => writer.WriteBoolean("includeDeleted", true))));
        AssertEqual(3, deletedList.Count, "includeDeleted returns soft-deleted history");

        var update = ResultObject(DbCronTools.Update(Parameters(dbPath, writer =>
        {
            writer.WriteString("id", PersistentJobId);
            writer.WriteStartObject("patch");
            writer.WriteString("name", "Updated Cron");
            writer.WriteString("model", "updated-model");
            writer.WriteStartObject("scheduleJson");
            writer.WriteString("kind", "cron");
            writer.WriteString("expr", "0 9 * * *");
            writer.WriteString("tz", "Asia/Shanghai");
            writer.WriteEndObject();
            writer.WriteNumber("maxIterations", 9);
            writer.WriteEndObject();
        })));
        Assert(update.GetProperty("success").GetBoolean(), "update applies a patch");
        var updatedCron = update.GetProperty("cron");
        AssertEqual("Updated Cron", updatedCron.GetProperty("name").GetString(), "update changes selected fields");
        AssertEqual("Run the persisted task", updatedCron.GetProperty("prompt").GetString(), "update preserves fields outside patch");
        AssertEqual("plugin-feishu", updatedCron.GetProperty("plugin_id").GetString(), "update preserves plugin configuration");
        AssertEqual(9, updatedCron.GetProperty("max_iterations").GetInt32(), "update persists integer fields");

        AssertMutationSuccess(DbCronTools.Toggle(Parameters(dbPath, writer =>
        {
            writer.WriteString("id", PersistentJobId);
            writer.WriteBoolean("enabled", false);
        })), "toggle disables a task");
        AssertEqual(0, ResultArray(DbCronTools.List(Parameters(dbPath, writer => writer.WriteBoolean("enabledOnly", true)))).Count,
            "enabledOnly reflects disable");
        AssertMutationSuccess(DbCronTools.Toggle(Parameters(dbPath, writer =>
        {
            writer.WriteString("id", PersistentJobId);
            writer.WriteBoolean("enabled", true);
        })), "toggle re-enables a task");

        AssertMutationSuccess(DbCronTools.MarkFired(Parameters(dbPath, writer =>
        {
            writer.WriteString("id", PersistentJobId);
            writer.WriteNumber("firedAt", 1001L);
        })), "mark-fired records the first trigger");
        var fired = ResultObject(DbCronTools.MarkFired(Parameters(dbPath, writer =>
        {
            writer.WriteString("id", PersistentJobId);
            writer.WriteNumber("firedAt", 1002L);
        })));
        Assert(fired.GetProperty("success").GetBoolean(), "mark-fired records repeated triggers");
        AssertEqual(2L, fired.GetProperty("cron").GetProperty("fire_count").GetInt64(), "mark-fired increments fire count");
        AssertEqual(1002L, fired.GetProperty("cron").GetProperty("last_fired_at").GetInt64(), "mark-fired stores latest timestamp");

        AssertMutationSuccess(DbCronTools.Toggle(Parameters(dbPath, writer =>
        {
            writer.WriteString("id", DisabledJobId);
            writer.WriteBoolean("enabled", true);
        })), "one-shot fixture can be enabled");
        var consumed = ResultObject(DbCronTools.MarkFired(Parameters(dbPath, writer =>
        {
            writer.WriteString("id", DisabledJobId);
            writer.WriteNumber("firedAt", 1003L);
            writer.WriteBoolean("disable", true);
        })));
        AssertEqual(1L, consumed.GetProperty("cron").GetProperty("fire_count").GetInt64(),
            "mark-fired atomically increments a consumed one-shot task");
        Assert(!consumed.GetProperty("cron").GetProperty("enabled").GetBoolean(),
            "mark-fired atomically disables a consumed one-shot task");

        var finished = ResultObject(DbCronTools.MarkRunFinished(Parameters(dbPath, writer =>
        {
            writer.WriteString("id", PersistentJobId);
            writer.WriteNumber("runAt", 2001L);
            writer.WriteString("status", "failed");
            writer.WriteString("summary", "Short failure summary");
            writer.WriteString("error", "notification unavailable");
        })));
        Assert(finished.GetProperty("success").GetBoolean(), "mark-run-finished updates task state");
        var finishedCron = finished.GetProperty("cron");
        AssertEqual(2001L, finishedCron.GetProperty("last_run_at").GetInt64(), "run completion stores timestamp");
        AssertEqual("failed", finishedCron.GetProperty("last_run_status").GetString(), "run completion stores status");
        AssertEqual("Short failure summary", finishedCron.GetProperty("last_run_summary").GetString(), "run completion stores summary");
        AssertEqual("notification unavailable", finishedCron.GetProperty("last_error").GetString(), "run completion stores error");

        AssertMutationSuccess(DbCronTools.Delete(Parameters(dbPath, writer => writer.WriteString("id", PersistentJobId))),
            "delete soft-deletes and disables a task");
        var defaultGet = ResultObject(DbCronTools.Get(Parameters(dbPath, writer => writer.WriteString("id", PersistentJobId))));
        Assert(!defaultGet.GetProperty("success").GetBoolean(), "get filters soft-deleted tasks by default");
        var deletedGet = ResultObject(DbCronTools.Get(Parameters(dbPath, writer =>
        {
            writer.WriteString("id", PersistentJobId);
            writer.WriteBoolean("includeDeleted", true);
        })));
        Assert(deletedGet.GetProperty("success").GetBoolean(), "get includeDeleted returns archived task");
        Assert(!deletedGet.GetProperty("cron").GetProperty("enabled").GetBoolean(), "soft delete disables task");
        Assert(deletedGet.GetProperty("cron").GetProperty("deleted_at").ValueKind == JsonValueKind.Number,
            "soft delete records deleted_at");
    }

    private static void RunReopenSuite(string dbPath)
    {
        var initialization = DbClient.Initialize(dbPath);
        Assert(initialization.Success, $"reopened cron database initializes: {initialization.Error}");
        var archived = ResultObject(DbCronTools.Get(Parameters(dbPath, writer =>
        {
            writer.WriteString("id", PersistentJobId);
            writer.WriteBoolean("includeDeleted", true);
        })));
        Assert(archived.GetProperty("success").GetBoolean(), "archived task survives process restart");
        AssertEqual(2L, archived.GetProperty("cron").GetProperty("fire_count").GetInt64(),
            "fire count survives process restart");
        AssertEqual("failed", archived.GetProperty("cron").GetProperty("last_run_status").GetString(),
            "last run state survives process restart");

        var active = ResultObject(DbCronTools.Get(Parameters(dbPath, writer => writer.WriteString("id", DisabledJobId))));
        Assert(active.GetProperty("success").GetBoolean(), "non-deleted task survives process restart");
        Assert(!active.GetProperty("cron").GetProperty("enabled").GetBoolean(), "disabled state survives process restart");
    }

    private static void RunNewDatabaseSuite(string dbPath)
    {
        var initialization = DbClient.Initialize(dbPath);
        Assert(initialization.Success, $"new database initializes: {initialization.Error}");
        var db = DbClient.GetClient();
        AssertEqual(1L, db.QueryScalar<long>("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='cron_tasks'"),
            "new database creates cron_tasks");
        var columns = db.Query("PRAGMA table_info(cron_tasks);", reader => reader.GetString("name"));
        AssertEqual(ExpectedCronColumns().Length, columns.Count, "new cron table contains the complete column set");
        AssertEqual(1L, db.QueryScalar<long>("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='ix_cron_tasks_enabled_next'"),
            "new database creates enabled index");
        AssertEqual(1L, db.QueryScalar<long>("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='ix_cron_tasks_session'"),
            "new database creates session index");
    }

    private static void SeedSmokeTask(string dbPath)
    {
        var initialization = DbClient.Initialize(dbPath);
        Assert(initialization.Success, $"smoke database initializes: {initialization.Error}");
        var fireAt = DateTimeOffset.UtcNow.AddSeconds(25).ToUnixTimeMilliseconds();
        var result = ResultObject(DbCronTools.Create(Parameters(dbPath, writer =>
        {
            writer.WriteString("id", SmokeJobId);
            writer.WriteString("name", "Isolated Cron Smoke");
            writer.WriteStartObject("scheduleJson");
            writer.WriteString("kind", "at");
            writer.WriteNumber("at", fireAt);
            writer.WriteEndObject();
            writer.WriteString("prompt", "Verify isolated Cron failure recovery");
            writer.WriteString("deliveryMode", "none");
            writer.WriteBoolean("deleteAfterRun", true);
            writer.WriteNumber("maxIterations", 1);
            writer.WriteBoolean("enabled", true);
        })));
        Assert(result.GetProperty("success").GetBoolean(), "smoke task is seeded");
        Console.WriteLine($"SMOKE_FIRE_AT={fireAt}");
    }

    private static void VerifySmokeTask(string dbPath)
    {
        var initialization = DbClient.Initialize(dbPath);
        Assert(initialization.Success, $"smoke database reopens: {initialization.Error}");
        var result = ResultObject(DbCronTools.Get(Parameters(dbPath, writer =>
        {
            writer.WriteString("id", SmokeJobId);
            writer.WriteBoolean("includeDeleted", true);
        })));
        Assert(result.GetProperty("success").GetBoolean(), "smoke task remains queryable as history");
        var cron = result.GetProperty("cron");
        AssertEqual(1, cron.GetProperty("fire_count").GetInt32(), "smoke task fires exactly once");
        AssertEqual("error", cron.GetProperty("last_run_status").GetString(), "smoke task records Agent failure");
        Assert(cron.GetProperty("last_error").GetString()?.Contains("No enabled provider/model", StringComparison.Ordinal) == true,
            "smoke task records isolated provider failure");
        Assert(cron.GetProperty("deleted_at").ValueKind == JsonValueKind.Number, "smoke task is archived after completion");
        Assert(!cron.GetProperty("enabled").GetBoolean(), "smoke task is disabled after archival");
    }

    private static JsonElement CreateParameters(string dbPath, string id, bool enabled)
        => Parameters(dbPath, writer =>
        {
            writer.WriteString("id", id);
            writer.WriteString("name", id == PersistentJobId ? "Persistent Cron" : "Disabled Cron");
            writer.WriteString("sessionId", "session-cron");
            writer.WriteStartObject("scheduleJson");
            writer.WriteString("kind", id == PersistentJobId ? "every" : "at");
            if (id == PersistentJobId)
                writer.WriteNumber("every", 60000);
            else
                writer.WriteNumber("at", 4102444800000L);
            writer.WriteEndObject();
            writer.WriteString("prompt", "Run the persisted task");
            writer.WriteString("agentId", "CronAgent");
            writer.WriteString("model", "test-model");
            writer.WriteString("workingFolder", Path.GetTempPath());
            writer.WriteString("deliveryMode", "plugin");
            writer.WriteString("deliveryTarget", "chat-target");
            writer.WriteString("pluginId", "plugin-feishu");
            writer.WriteString("pluginType", "feishu");
            writer.WriteString("pluginChatId", "chat-target");
            writer.WriteBoolean("deleteAfterRun", false);
            writer.WriteNumber("maxIterations", 21);
            writer.WriteBoolean("enabled", enabled);
        });

    private static JsonElement Parameters(string dbPath, Action<Utf8JsonWriter>? writeProperties = null)
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("dbPath", dbPath);
            writeProperties?.Invoke(writer);
            writer.WriteEndObject();
        });

    private static JsonElement ResultObject(WorkerResponse response)
    {
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        return document.RootElement.GetProperty("result").Clone();
    }

    private static List<JsonElement> ResultArray(WorkerResponse response)
    {
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        return document.RootElement.GetProperty("result").EnumerateArray().Select(item => item.Clone()).ToList();
    }

    private static void AssertMutationSuccess(WorkerResponse response, string name)
        => Assert(ResultObject(response).GetProperty("success").GetBoolean(), name);

    private static void AssertRequired(JsonElement schema, params string[] expected)
    {
        var required = schema.GetProperty("required").EnumerateArray()
            .Select(item => item.GetString()).ToHashSet(StringComparer.Ordinal);
        foreach (var field in expected)
            Assert(required.Contains(field), $"schema requires {field}");
    }

    private static string[] ExpectedCronColumns() =>
    [
        "id", "name", "session_id", "schedule_json", "prompt", "agent_id", "model", "working_folder",
        "delivery_mode", "delivery_target", "plugin_id", "plugin_type", "plugin_chat_id", "delete_after_run",
        "max_iterations", "enabled", "deleted_at", "last_fired_at", "last_run_at", "last_run_status",
        "last_run_summary", "last_error", "fire_count", "created_at", "updated_at"
    ];

    private static void SeedLegacyCronDatabase(string dbPath)
    {
        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "CREATE TABLE cron_tasks (id TEXT PRIMARY KEY NOT NULL); " +
                              "INSERT INTO cron_tasks (id) VALUES ('legacy-cron');";
        command.ExecuteNonQuery();
    }

    private static void RunChild(string mode, string dbPath)
    {
        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Current process path is unavailable");
        var startInfo = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        if (string.Equals(Path.GetFileNameWithoutExtension(executable), "dotnet", StringComparison.OrdinalIgnoreCase))
            startInfo.ArgumentList.Add(Environment.GetCommandLineArgs()[0]);
        startInfo.ArgumentList.Add(mode);
        startInfo.ArgumentList.Add(dbPath);

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException($"Failed to start child mode {mode}");
        var stdout = process.StandardOutput.ReadToEnd();
        var stderr = process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (!string.IsNullOrWhiteSpace(stdout)) Console.Write(stdout);
        if (!string.IsNullOrWhiteSpace(stderr)) Console.Error.Write(stderr);
        AssertEqual(0, process.ExitCode, $"child mode {mode} exits successfully");
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

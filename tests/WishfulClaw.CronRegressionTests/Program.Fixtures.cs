// Cron 回归：请求参数与结果夹具、legacy 库造数。
// 拆分自原单文件 Program.cs（S-252，2026-10-28），方法体逐字平移。
using System.Diagnostics;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Agent.Tools.Providers;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Tools;
using WishfulClaw.Infrastructure;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.TestSupport;

namespace WishfulClaw.CronRegressionTests;

internal static partial class Program
{
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
            writer.WriteString("workingFolder", TestOutputRoot.Resolve());
            writer.WriteString("deliveryMode", "plugin");
            writer.WriteString("deliveryTarget", "chat-target");
            writer.WriteString("pluginId", "plugin-feishu");
            writer.WriteString("pluginType", "feishu");
            writer.WriteString("pluginChatId", "chat-target");
            writer.WriteBoolean("deleteAfterRun", false);
            writer.WriteNumber("maxIterations", 21);
            writer.WriteBoolean("thinkingEnabled", id == PersistentJobId);
            if (id == PersistentJobId)
                writer.WriteString("reasoningEffort", "medium");
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

    private static bool IsMissingOrNull(JsonElement element, string propertyName)
        => !element.TryGetProperty(propertyName, out var value) || value.ValueKind == JsonValueKind.Null;

    private static void SeedLegacyCronDatabase(string dbPath)
    {
        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "CREATE TABLE cron_tasks (id TEXT PRIMARY KEY NOT NULL); " +
                              "INSERT INTO cron_tasks (id) VALUES ('legacy-cron');";
        command.ExecuteNonQuery();
    }
}

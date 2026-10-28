// 会话任务级联回归：造数与断言夹具。
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

internal static partial class Program
{
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

}

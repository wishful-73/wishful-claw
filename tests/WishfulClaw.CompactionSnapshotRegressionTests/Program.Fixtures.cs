// 压缩快照回归：造数夹具与静默请求上下文。
// 拆分自原单文件 Program.cs（S-252，2026-10-28），方法体逐字平移。
using System.Diagnostics;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Agent;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.TestSupport;

namespace WishfulClaw.CompactionSnapshotRegressionTests;

internal static partial class Program
{
    private static void AddMessage(string dbPath, string sessionId, string id, long createdAt, int sortOrder)
    {
        AssertMutationSuccess(DbMessageTools.Add(Params(dbPath, writer =>
        {
            writer.WriteString("id", id);
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("role", sortOrder % 2 == 0 ? "user" : "assistant");
            writer.WriteString("content", $"message {id}");
            writer.WriteNumber("createdAt", createdAt);
            writer.WriteNumber("sortOrder", sortOrder);
        })), $"message {id} is inserted");
    }

    private static void AddMetaMessage(string dbPath, string sessionId, string id, long createdAt, int sortOrder, string role, string content, string? meta)
    {
        AssertMutationSuccess(DbMessageTools.Add(Params(dbPath, writer =>
        {
            writer.WriteString("id", id);
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("role", role);
            writer.WriteString("content", content);
            if (meta is not null) writer.WriteString("meta", meta);
            writer.WriteNumber("createdAt", createdAt);
            writer.WriteNumber("sortOrder", sortOrder);
        })), $"message {id} is inserted");
    }

    private static void AddBatchMessages(string dbPath, string sessionId, string idPrefix, int startIndex, int count, long baseCreatedAt, int baseSortOrder)
    {
        AssertMutationSuccess(DbMessageTools.AddBatch(Params(dbPath, writer =>
        {
            writer.WriteStartArray("messages");
            for (var index = 0; index < count; index++)
            {
                writer.WriteStartObject();
                writer.WriteString("id", $"{idPrefix}-m{startIndex + index}");
                writer.WriteString("sessionId", sessionId);
                writer.WriteString("role", index % 2 == 0 ? "user" : "assistant");
                writer.WriteString("content", $"message {index}");
                writer.WriteNumber("createdAt", baseCreatedAt + index);
                writer.WriteNumber("sortOrder", baseSortOrder + index);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
        })), $"batch of {count} messages is inserted");
    }

    private static void UpsertSnapshot(string dbPath, string sessionId)
    {
        AssertMutationSuccess(DbCompactionSnapshotTools.Upsert(UpsertParams(dbPath, sessionId)),
            $"snapshot is upserted for {sessionId}");
    }

    private static JsonElement ReadSnapshot(string dbPath, string sessionId)
    {
        var result = ResultObject(DbCompactionSnapshotTools.Get(Params(dbPath, writer => writer.WriteString("sessionId", sessionId))));
        Assert(result.GetProperty("success").GetBoolean(), $"snapshot read succeeds for {sessionId}");
        Assert(result.TryGetProperty("snapshot", out var snapshot) && snapshot.ValueKind == JsonValueKind.Object,
            $"snapshot exists for {sessionId}");
        return result.GetProperty("snapshot");
    }

    private static void AssertHasSnapshot(string dbPath, string sessionId, string name)
    {
        var result = ResultObject(DbCompactionSnapshotTools.Get(Params(dbPath, writer => writer.WriteString("sessionId", sessionId))));
        Assert(result.GetProperty("success").GetBoolean(), name);
        Assert(result.TryGetProperty("snapshot", out var snapshot) && snapshot.ValueKind == JsonValueKind.Object, name);
    }

    private static void AssertNoSnapshot(string dbPath, string sessionId, string name)
    {
        var result = ResultObject(DbCompactionSnapshotTools.Get(Params(dbPath, writer => writer.WriteString("sessionId", sessionId))));
        Assert(result.GetProperty("success").GetBoolean(), name);
        Assert(!result.TryGetProperty("snapshot", out var snapshot) || snapshot.ValueKind == JsonValueKind.Null, name);
    }

    private static JsonElement UpsertParams(
        string dbPath,
        string sessionId,
        string trigger = "auto",
        int originalCount = 5,
        int newCount = 2,
        int messagesSummarized = 3,
        bool summarizerFailed = false,
        string? summaryMessage = null,
        string? summaryText = null)
        => Params(dbPath, writer =>
        {
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("trigger", trigger);
            writer.WriteString("wireConversation", "[{\"role\":\"user\",\"content\":\"compressed\"}]");
            writer.WriteString("compactArtifacts", "[{\"id\":\"compact-boundary\"}]");
            writer.WriteNumber("originalCount", originalCount);
            writer.WriteNumber("newCount", newCount);
            writer.WriteNumber("messagesSummarized", messagesSummarized);
            writer.WriteBoolean("summarizerFailed", summarizerFailed);
            if (summaryMessage is not null) writer.WriteString("summaryMessage", summaryMessage);
            if (summaryText is not null) writer.WriteString("summaryText", summaryText);
        });

    private static JsonElement Json(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private sealed class SilentRequestContext : IWorkerRequestContext
    {
        public static SilentRequestContext Instance { get; } = new();
        public CancellationToken CancellationToken => CancellationToken.None;
        public CancellationToken ConnectionCancellationToken => CancellationToken.None;
        public IWorkerRequestContext ForBackgroundOperation() => this;
        public ValueTask EmitEventAsync<T>(string eventName, T parameters, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo)
            => ValueTask.CompletedTask;
        public ValueTask EmitEventIgnoringCancellationAsync<T>(string eventName, T parameters, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo)
            => ValueTask.CompletedTask;
        public ValueTask EmitMessagePackEventAsync(string eventName, ReadOnlyMemory<byte> payload)
            => ValueTask.CompletedTask;
    }

    private static JsonElement Params(string dbPath, Action<Utf8JsonWriter>? writeProperties = null)
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
    {
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        var result = document.RootElement.GetProperty("result");
        if (!result.GetProperty("success").GetBoolean())
            throw new InvalidOperationException($"{name}: {result.GetRawText()}");
        Assert(true, name);
    }

    private static void AssertNullProperty(JsonElement element, string propertyName, string name)
    {
        Assert(!element.TryGetProperty(propertyName, out var value) || value.ValueKind == JsonValueKind.Null, name);
    }

    private static bool IsJsonObjectText(string? text)
    {
        if (string.IsNullOrEmpty(text)) return false;
        try
        {
            using var document = JsonDocument.Parse(text);
            return document.RootElement.ValueKind == JsonValueKind.Object;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static string[] ExpectedSnapshotColumns() =>
    [
        "snapshot_id", "session_id", "version", "trigger", "wire_conversation", "compact_artifacts",
        "summary_message", "summary_text", "through_created_at", "through_sort_order", "original_count",
        "new_count", "messages_summarized", "summarizer_failed", "created_at", "updated_at"
    ];

    /// <summary>
    /// Seeds a pre-migration database: snapshots keyed by <c>session_id</c>, i.e. one snapshot per
    /// session, before the <c>snapshot_id</c> rework.
    ///
    /// Not a relic. The migration in <c>DbClientCompactionSnapshotMigrations</c> still runs on every
    /// <c>DbClient.Initialize</c>, and it is the kind of code that fails silently by losing rows
    /// rather than by throwing — so the upgrade path stays covered on purpose.
    /// </summary>
    private static void SeedLegacyDatabase(string dbPath)
    {
        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL DEFAULT '', working_folder TEXT, " +
            "pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);" +
            "CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'chat', " +
            "created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, message_count INTEGER NOT NULL DEFAULT 0, " +
            "project_id TEXT, pinned INTEGER NOT NULL DEFAULT 0);" +
            "CREATE TABLE messages (id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, role TEXT NOT NULL, " +
            "content TEXT NOT NULL DEFAULT '', meta TEXT, created_at INTEGER NOT NULL);" +
            "CREATE TABLE session_compaction_snapshots (" +
            "session_id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL, \"trigger\" TEXT NOT NULL, " +
            "wire_conversation TEXT NOT NULL, compact_artifacts TEXT NOT NULL, summary_message TEXT, " +
            "summary_text TEXT, through_created_at INTEGER NOT NULL, through_sort_order INTEGER NOT NULL, " +
            "original_count INTEGER NOT NULL, new_count INTEGER NOT NULL, messages_summarized INTEGER NOT NULL, " +
            "summarizer_failed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);" +
            "INSERT INTO sessions (id, title, mode, created_at, updated_at, message_count) " +
            "VALUES ('legacy-session', 'Legacy Session', 'chat', 1000, 1000, 3);" +
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES " +
            "('legacy-orig-1', 'legacy-session', 'user', 'hello', 1001)," +
            "('legacy-orig-2', 'legacy-session', 'assistant', 'hi', 1002)," +
            "('legacy-orig-3', 'legacy-session', 'user', 'next', 1003);" +
            "INSERT INTO session_compaction_snapshots (session_id, version, \"trigger\", wire_conversation, " +
            "compact_artifacts, summary_message, summary_text, through_created_at, through_sort_order, " +
            "original_count, new_count, messages_summarized, summarizer_failed, created_at, updated_at) " +
            "VALUES ('legacy-session', 1, 'legacy', 'legacy-wire', 'legacy-artifacts', NULL, NULL, " +
            "1003, 2, 3, 3, 0, 0, 1004, 1004);";
        command.ExecuteNonQuery();
    }
}

using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using Microsoft.Data.Sqlite;
using WishfulClaw.Agent;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Tools;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.GoalRegressionTests;

internal static partial class Program
{
    private static void SeedLegacyDatabase(string dbPath)
    {
        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();
        Execute(connection, @"CREATE TABLE projects (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            working_folder TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )");
        Execute(connection, @"CREATE TABLE sessions (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            mode TEXT NOT NULL DEFAULT 'chat',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            message_count INTEGER NOT NULL DEFAULT 0,
            project_id TEXT,
            pinned INTEGER NOT NULL DEFAULT 0
        )");
        Execute(connection, @"CREATE TABLE goals (
            goal_id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL,
            objective TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active',
            token_budget INTEGER,
            tokens_used INTEGER NOT NULL DEFAULT 0,
            time_used_seconds INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )");
        Execute(connection, @"CREATE TABLE goal_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            goal_id TEXT,
            event_type TEXT NOT NULL,
            message TEXT,
            metadata_json TEXT,
            created_at INTEGER NOT NULL
        )");
        Execute(connection,
            "CREATE UNIQUE INDEX ux_goals_session_id ON goals(session_id, status)");

        Execute(connection,
            "INSERT INTO projects (id, name, created_at, updated_at) VALUES " +
            "('project-a', 'Project A', 1, 1), ('project-b', 'Project B', 1, 1)");
        Execute(connection,
            "INSERT INTO sessions (id, title, mode, created_at, updated_at, message_count, project_id, pinned) VALUES " +
            "('session-a', 'Session A', 'chat', 1, 1, 0, 'project-a', 0), " +
            "('session-b', 'Session B', 'chat', 1, 1, 0, 'project-b', 0)");
        Execute(connection,
            "INSERT INTO goals " +
            "(goal_id, session_id, objective, status, tokens_used, time_used_seconds, created_at, updated_at) VALUES " +
            "('goal-complete-a', 'session-a', 'complete history', 'complete', 10, 1, 10, 10), " +
            "('goal-active-a', 'session-a', 'older active', 'active', 20, 2, 20, 20), " +
            "('goal-pending-a', 'session-a', 'newer pending', 'pending', 0, 0, 30, 30), " +
            "('goal-complete-b', 'session-b', 'project b history', 'complete', 30, 3, 40, 40)");
        Execute(connection,
            "INSERT INTO goal_events (session_id, goal_id, event_type, message, created_at) VALUES " +
            "('session-a', 'goal-complete-a', 'completed', 'legacy complete', 10), " +
            "('session-a', 'goal-active-a', 'created', 'legacy active', 20), " +
            "('session-a', 'goal-pending-a', 'created', 'legacy pending', 30), " +
            "('session-b', 'goal-complete-b', 'completed', 'legacy project b', 40)");
    }

    private static JsonElement GoalParameters(
        string dbPath,
        string sessionId,
        string goalId,
        string objective,
        string status)
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("dbPath", dbPath);
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("goalId", goalId);
            writer.WriteString("objective", objective);
            writer.WriteString("status", status);
            writer.WriteEndObject();
        });

    private static JsonElement ListParameters(string dbPath, string projectId)
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("dbPath", dbPath);
            writer.WriteString("projectId", projectId);
            writer.WriteEndObject();
        });

    private static JsonElement EventParameters(string dbPath, string sessionId, string goalId)
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("dbPath", dbPath);
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("goalId", goalId);
            writer.WriteNumber("limit", 100);
            writer.WriteEndObject();
        });

    private static JsonElement GoalPageParameters(
        string dbPath,
        string sessionId,
        int limit,
        GoalPageResult? cursor = null)
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("dbPath", dbPath);
            writer.WriteString("sessionId", sessionId);
            writer.WriteNumber("limit", limit);
            if (cursor?.NextCurrentRank != null
                && cursor.NextUpdatedAt != null
                && cursor.NextGoalId != null)
            {
                writer.WriteNumber("cursorCurrentRank", cursor.NextCurrentRank.Value);
                writer.WriteNumber("cursorUpdatedAt", cursor.NextUpdatedAt.Value);
                writer.WriteString("cursorGoalId", cursor.NextGoalId);
            }
            writer.WriteEndObject();
        });

    private static JsonElement GoalEventPageParameters(
        string dbPath,
        string sessionId,
        string goalId,
        int limit,
        GoalEventPageResult? cursor = null)
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("dbPath", dbPath);
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("goalId", goalId);
            writer.WriteNumber("limit", limit);
            if (cursor?.NextCreatedAt != null && cursor.NextEventId != null)
            {
                writer.WriteNumber("cursorCreatedAt", cursor.NextCreatedAt.Value);
                writer.WriteNumber("cursorEventId", cursor.NextEventId.Value);
            }
            writer.WriteEndObject();
        });

    private static JsonElement ReopenParameters(
        string dbPath,
        string sessionId,
        string goalId,
        string? objective = null)
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("dbPath", dbPath);
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("goalId", goalId);
            if (!string.IsNullOrEmpty(objective))
                writer.WriteString("objective", objective);
            writer.WriteEndObject();
        });

    private static List<JsonElement> ReadResultArray(WorkerResponse response)
    {
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        return document.RootElement.GetProperty("result")
            .EnumerateArray()
            .Select(item => item.Clone())
            .ToList();
    }

    private static string? ScalarString(DbService db, string sql)
        => db.QueryScalar<string?>(sql);

    private static void Execute(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
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
        {
            throw new InvalidOperationException(
                $"{name}: expected={expected}, actual={actual}");
        }
        Assert(true, name);
    }

    private static void AssertThrows<TException>(Action action, string name)
        where TException : Exception
    {
        try
        {
            action();
        }
        catch (TException)
        {
            Assert(true, name);
            return;
        }
        throw new InvalidOperationException($"{name}: expected {typeof(TException).Name}");
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
        }
    }

    private sealed class SilentRequestContext : IWorkerRequestContext
    {
        public static SilentRequestContext Instance { get; } = new();
        public CancellationToken CancellationToken => CancellationToken.None;
        public CancellationToken ConnectionCancellationToken => CancellationToken.None;
        public IWorkerRequestContext ForBackgroundOperation() => this;
        public ValueTask EmitEventAsync<T>(string eventName, T parameters, JsonTypeInfo<T> typeInfo)
            => ValueTask.CompletedTask;
        public ValueTask EmitEventIgnoringCancellationAsync<T>(string eventName, T parameters, JsonTypeInfo<T> typeInfo)
            => ValueTask.CompletedTask;
        public ValueTask EmitMessagePackEventAsync(string eventName, ReadOnlyMemory<byte> payload)
            => ValueTask.CompletedTask;
    }

    private sealed class ProjectModeProbeTool : IToolExecutor
    {
        public string Name => "project_mode_probe";
        public string Description => "Project mode capability probe.";
        public JsonElement InputSchema => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("type", "object");
            writer.WriteEndObject();
        });
        public string[]? AvailableModes => ["global"];
        public Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)
            => Task.FromResult(new ToolResult("{\"ok\":true}"));
    }

    private sealed class CapabilityRequestContext(bool confirmed) : IWorkerRequestContext
    {
        public CancellationToken CancellationToken => CancellationToken.None;
        public CancellationToken ConnectionCancellationToken => CancellationToken.None;
        public IWorkerRequestContext ForBackgroundOperation() => this;

        public ValueTask EmitEventAsync<T>(
            string eventName,
            T parameters,
            JsonTypeInfo<T> typeInfo)
        {
            if (eventName != "agent/reverse-request"
                || parameters is not AgentRuntimeReverseRequestEnvelope request)
            {
                return ValueTask.CompletedTask;
            }

            AgentRuntimeReverseRequests.Complete(WorkerJsonHelper.BuildJsonElement(writer =>
            {
                writer.WriteStartObject();
                writer.WriteString("id", request.Id);
                writer.WriteStartObject("result");
                if (request.Method == "mcp:capability-list")
                {
                    writer.WriteStartArray("servers");
                    writer.WriteEndArray();
                    writer.WriteStartArray("skills");
                    writer.WriteEndArray();
                }
                else if (request.Method == "goal/confirm-request")
                {
                    writer.WriteBoolean("confirmed", confirmed);
                }
                writer.WriteEndObject();
                writer.WriteEndObject();
            }));
            return ValueTask.CompletedTask;
        }

        public ValueTask EmitEventIgnoringCancellationAsync<T>(
            string eventName,
            T parameters,
            JsonTypeInfo<T> typeInfo)
            => ValueTask.CompletedTask;

        public ValueTask EmitMessagePackEventAsync(
            string eventName,
            ReadOnlyMemory<byte> payload)
            => ValueTask.CompletedTask;
    }

    private sealed class ReverseRequestContext(
        bool confirmed,
        bool failBackgroundContext = false) : IWorkerRequestContext
    {
        public string? GoalId { get; private set; }
        public CancellationToken CancellationToken => CancellationToken.None;
        public CancellationToken ConnectionCancellationToken => CancellationToken.None;

        public IWorkerRequestContext ForBackgroundOperation()
            => failBackgroundContext
                ? throw new InvalidOperationException("Injected background context failure")
                : this;

        public ValueTask EmitEventAsync<T>(
            string eventName,
            T parameters,
            JsonTypeInfo<T> typeInfo)
        {
            if (eventName == "agent/reverse-request"
                && parameters is AgentRuntimeReverseRequestEnvelope request)
            {
                GoalId = request.Params.GetProperty("goalId").GetString();
                AgentRuntimeReverseRequests.Complete(WorkerJsonHelper.BuildJsonElement(writer =>
                {
                    writer.WriteStartObject();
                    writer.WriteString("id", request.Id);
                    writer.WriteStartObject("result");
                    writer.WriteBoolean("confirmed", confirmed);
                    if (confirmed)
                    {
                        writer.WriteStartObject("modelConfig");
                        writer.WriteString("providerId", "test-provider");
                        writer.WriteString("providerType", "openai");
                        writer.WriteString("model", "test-model");
                        writer.WriteEndObject();
                    }
                    writer.WriteEndObject();
                    writer.WriteEndObject();
                }));
            }
            return ValueTask.CompletedTask;
        }

        public ValueTask EmitEventIgnoringCancellationAsync<T>(
            string eventName,
            T parameters,
            JsonTypeInfo<T> typeInfo)
            => ValueTask.CompletedTask;

        public ValueTask EmitMessagePackEventAsync(
            string eventName,
            ReadOnlyMemory<byte> payload)
            => ValueTask.CompletedTask;
    }
}

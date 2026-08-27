using System.IO;
using System.Linq;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Workspace.Memory;
using WishfulClaw.Agent.Tools;
using WishfulClaw.Agent;
using Microsoft.Data.Sqlite;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Worker.Modules;

/// <summary>
/// Worker module for memory IPC endpoints.
/// </summary>
internal sealed class MemoryModule : IWorkerModule
{
    public string Name => "memory";

    public void Register(IWorkerModuleContext context)
    {
        context.Register("memory/stats", MemoryStats);
        context.Register("memory/read", MemoryRead);
        context.Register("memory/write", MemoryWrite);
        context.Register("memory/search", MemorySearch);
        context.Register("memory/append", MemoryAppend);
        context.Register("memory/update", MemoryUpdate);
    }

    // ── Handlers ──

    private static Task<WorkerResponse> MemoryStats(JsonElement parameters)
    {
        var scope = GetScope(parameters);
        return RunAsync(() =>
        {
            var path = MemoryPathResolver.GetMemoryFilePath(scope);
            var hotCount = 0;
            if (File.Exists(path))
            {
                var content = File.ReadAllText(path);
                // Count "## " headings at line start
                hotCount = content.Split('\n').Count(l => l.StartsWith("## "));
            }
            return Task.FromResult(WorkerResponse.Json(new MemoryStats
            {
                HotCount = hotCount,
                WarmCount = 0,
                ColdCount = 0,
                TopicsCount = 0,
                DailyCount = 0
            }, WishfulClawJsonContext.Default.MemoryStats));
        });
    }

    private static Task<WorkerResponse> MemoryRead(JsonElement parameters)
    {
        var scope = GetScope(parameters);
        return RunAsync(async () =>
        {
            var path = MemoryPathResolver.GetMemoryFilePath(scope);
            if (!File.Exists(path))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                await File.WriteAllTextAsync(path, "# Long-Term Memory\n");
            }
            var content = await File.ReadAllTextAsync(path);
            return WorkerResponse.Json(new MemoryReadResult(content), WishfulClawJsonContext.Default.MemoryReadResult);
        });
    }

    private static Task<WorkerResponse> MemoryWrite(JsonElement parameters)
    {
        var scope = GetScope(parameters);
        var content = GetString(parameters, "content") ?? "";
        return RunAsync(async () =>
        {
            var path = MemoryPathResolver.GetMemoryFilePath(scope);
            if (!File.Exists(path))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                await File.WriteAllTextAsync(path, "# Long-Term Memory\n");
            }
            await File.WriteAllTextAsync(path, content);
            // memory/write is external to any agent run, so there is no implicit
            // session. Callers pass sessionId when the overwrite should be
            // announced at the next turn; without one the note would land in a
            // queue that no session ever drains — skip the enqueue instead.
            var sessionId = GetString(parameters, "sessionId");
            if (!string.IsNullOrWhiteSpace(sessionId))
            {
                MemoryUpdateQueue.Enqueue(sessionId, "Hot memory file was overwritten via memory/write endpoint.");
            }
            return WorkerResponse.Json(new SimpleOkResult(true), WishfulClawJsonContext.Default.SimpleOkResult);
        });
    }

    private static Task<WorkerResponse> MemorySearch(JsonElement parameters)
    {
        var query = GetString(parameters, "query") ?? "";
        var scope = GetScope(parameters);
        var limit = GetInt(parameters, "limit", 10);
        var includeDeprecated = GetBool(parameters, "include_deprecated", false);
        var search = GetSearch();
        return RunAsync(async () =>
        {
            var hits = await search.SearchAsync(query, scope, limit, includeDeprecated);
            return WorkerResponse.Json(new MemorySearchResponse(hits.ToList()), WishfulClawJsonContext.Default.MemorySearchResponse);
        });
    }

    private static Task<WorkerResponse> MemoryAppend(JsonElement parameters)
    {
        var scope = GetScope(parameters);
        var content = GetString(parameters, "content") ?? "";
        var title = GetString(parameters, "title");
        var priorityStr = GetString(parameters, "priority") ?? "standard";
        return RunAsync(() =>
        {
            var db = DbClient.GetClient();
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var entry = new MemoryEntryEntity
            {
                Scope = scope,
                Title = title ?? content[..Math.Min(80, content.Length)],
                Content = content,
                Priority = priorityStr.ToLowerInvariant(),
                Status = "active",
                CreatedAt = now,
                UpdatedAt = now
            };
            var id = db.ExecuteReturnIdentity(
                "INSERT INTO memory_entries (scope, title, content, priority, status, created_at, updated_at) " +
                "VALUES (@scope, @title, @content, @priority, @status, @ca, @ua)",
                new SqliteParameter("@scope", entry.Scope),
                new SqliteParameter("@title", (object?)entry.Title ?? DBNull.Value),
                new SqliteParameter("@content", entry.Content),
                new SqliteParameter("@priority", entry.Priority),
                new SqliteParameter("@status", entry.Status),
                new SqliteParameter("@ca", entry.CreatedAt),
                new SqliteParameter("@ua", entry.UpdatedAt));
            return Task.FromResult(WorkerResponse.Json(new MemoryMutationResult(true, Id: id), WishfulClawJsonContext.Default.MemoryMutationResult));
        });
    }

    private static Task<WorkerResponse> MemoryUpdate(JsonElement parameters)
    {
        var id = GetLong(parameters, "id");
        var content = GetString(parameters, "content");
        var priority = GetString(parameters, "priority");
        var status = GetString(parameters, "status");
        return RunAsync(() =>
        {
            var db = DbClient.GetClient();
            var entry = db.QueryFirstOrDefault(
                "SELECT * FROM memory_entries WHERE id = @id",
                EntityMappers.MapMemoryEntry, new SqliteParameter("@id", id));
            if (entry is null)
                return Task.FromResult(WorkerResponse.Json(new SimpleOkResult(false, Error: "Entry not found"), WishfulClawJsonContext.Default.SimpleOkResult));

            if (content is not null) entry.Content = content;
            if (priority is not null) entry.Priority = priority.ToLowerInvariant();
            if (status is not null) entry.Status = status.ToLowerInvariant();
            entry.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            db.Execute(
                "UPDATE memory_entries SET title = @title, content = @content, priority = @priority, " +
                "status = @status, updated_at = @ua WHERE id = @id",
                new SqliteParameter("@title", (object?)entry.Title ?? DBNull.Value),
                new SqliteParameter("@content", entry.Content),
                new SqliteParameter("@priority", entry.Priority),
                new SqliteParameter("@status", entry.Status),
                new SqliteParameter("@ua", entry.UpdatedAt),
                new SqliteParameter("@id", id));
            return Task.FromResult(WorkerResponse.Json(new SimpleOkResult(true), WishfulClawJsonContext.Default.SimpleOkResult));
        });
    }

    // ── Helpers ──

private static IMemorySearch GetSearch() =>
        ToolModuleState.MemorySearch ?? throw new InvalidOperationException("Memory search service not initialized");

    private static string GetScope(JsonElement parameters)
    {
        var scope = GetString(parameters, "scope");
        if (!string.IsNullOrWhiteSpace(scope))
        {
            if (scope == "project")
            {
                var projectId = GetString(parameters, "projectId");
                var sshConnectionId = GetString(parameters, "sshConnectionId");
                var workingFolder = GetString(parameters, "workingFolder");
                if (!string.IsNullOrWhiteSpace(sshConnectionId))
                {
                    var scopeId = !string.IsNullOrWhiteSpace(projectId) ? projectId : sshConnectionId;
                    return $"project:ssh:{scopeId}";
                }
                if (!string.IsNullOrWhiteSpace(workingFolder))
                    return $"project:{workingFolder}";
                return "global";
            }
            if (scope == "global")
                return "global";
            return scope;
        }
        // Auto-resolve from parameters
        var sshConnId = GetString(parameters, "sshConnectionId");
        var projId = GetString(parameters, "projectId");
        var wf = GetString(parameters, "workingFolder");
        if (!string.IsNullOrWhiteSpace(sshConnId))
        {
            var scopeId = !string.IsNullOrWhiteSpace(projId) ? projId : sshConnId;
            return $"project:ssh:{scopeId}";
        }
        if (!string.IsNullOrWhiteSpace(wf))
            return $"project:{wf}";
        return "global";
    }

    private static string? GetString(JsonElement element, string name)
    {
        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(name, out var prop) &&
            prop.ValueKind == JsonValueKind.String)
        {
            return prop.GetString();
        }
        return null;
    }

    private static int GetInt(JsonElement element, string name, int defaultValue)
    {
        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(name, out var prop) &&
            prop.ValueKind == JsonValueKind.Number)
        {
            return prop.GetInt32();
        }
        return defaultValue;
    }

    private static long GetLong(JsonElement element, string name)
    {
        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(name, out var prop) &&
            prop.ValueKind == JsonValueKind.Number)
        {
            return prop.GetInt64();
        }
        return 0;
    }

    private static bool GetBool(JsonElement element, string name, bool defaultValue)
    {
        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(name, out var prop))
        {
            if (prop.ValueKind == JsonValueKind.True) return true;
            if (prop.ValueKind == JsonValueKind.False) return false;
        }
        return defaultValue;
    }

    private static async Task<WorkerResponse> RunAsync(Func<Task<WorkerResponse>> action)
    {
        try
        {
            return await action();
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(new SimpleOkResult(false, Error: ex.Message), WishfulClawJsonContext.Default.SimpleOkResult);
        }
    }
}

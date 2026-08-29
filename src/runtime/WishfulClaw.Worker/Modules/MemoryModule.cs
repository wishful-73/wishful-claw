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
        context.Register("memory/demotion-candidates", MemoryDemotionCandidates);
        context.Register("memory/batch-status", MemoryBatchStatus);
        context.Register("memory/entries-by-status", MemoryEntriesByStatus);
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
            var db = DbClient.GetClient();
            var scopeClause = $" AND scope = '{EscapeSql(scope)}'";
            var warmCount = CountStatus(db, $"SELECT COUNT(*) FROM memory_entries WHERE status = 'warm'{scopeClause}");
            var coldCount = CountStatus(db, $"SELECT COUNT(*) FROM memory_entries WHERE status IN ('cold', 'deprecated'){scopeClause}");
            return Task.FromResult(WorkerResponse.Json(new MemoryStats
            {
                HotCount = hotCount,
                WarmCount = warmCount,
                ColdCount = coldCount,
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

    // ── Tier organization endpoints (daily memory organization plan) ──

    /// <summary>
    /// Lists entries eligible for tier demotion based on priority × idle days.
    /// Thresholds come from the renderer settings; permanent entries are never demoted.
    /// Pass scope="all" (or omit with no scope hints) to scan every scope; explicit scopes are exact.
    /// </summary>
    private static Task<WorkerResponse> MemoryDemotionCandidates(JsonElement parameters)
    {
        var rawScope = GetString(parameters, "scope");
        var explicitAll = string.IsNullOrWhiteSpace(rawScope) || rawScope == "all";
        var scope = explicitAll ? null : GetScope(parameters);
        var warmEphemeral = GetInt(parameters, "warmDaysEphemeral", 7);
        var coldEphemeral = GetInt(parameters, "coldDaysEphemeral", 21);
        var warmStandard = GetInt(parameters, "warmDaysStandard", 30);
        var coldStandard = GetInt(parameters, "coldDaysStandard", 90);
        var warmLasting = GetInt(parameters, "warmDaysLasting", 90);
        var coldLasting = GetInt(parameters, "coldDaysLasting", 180);

        return RunAsync(() =>
        {
            var db = DbClient.GetClient();
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var scopeClause = scope is null
                ? ""
                : $" AND scope = '{EscapeSql(scope)}'";
            var candidates = new List<MemoryDemotionCandidate>();
            using (var reader = db.ExecuteReader(
                       "SELECT id, scope, title, priority, status, updated_at FROM memory_entries " +
                       $"WHERE priority <> 'permanent' AND status IN ('active', 'warm'){scopeClause}"))
            {
                while (reader.Read())
                {
                    var id = reader.GetInt64(reader.GetOrdinal("id"));
                    var entryScope = reader.GetString("scope");
                    var title = reader.IsDBNull(reader.GetOrdinal("title")) ? null : reader.GetString("title");
                    var priority = reader.GetString("priority");
                    var status = reader.GetString("status");
                    var updatedAt = reader.IsDBNull(reader.GetOrdinal("updated_at")) ? 0 : reader.GetInt64(reader.GetOrdinal("updated_at"));
                    var (warmDays, coldDays) = priority switch
                    {
                        "ephemeral" => (warmEphemeral, coldEphemeral),
                        "lasting" => (warmLasting, coldLasting),
                        _ => (warmStandard, coldStandard)
                    };
                    var idleDays = (now - updatedAt) / 86400.0;
                    if (status == "active" && idleDays >= warmDays)
                        candidates.Add(new(id, entryScope, title, priority, status, updatedAt, "warm"));
                    else if (status == "warm" && idleDays >= coldDays)
                        candidates.Add(new(id, entryScope, title, priority, status, updatedAt, "cold"));
                }
            }
            return Task.FromResult(WorkerResponse.Json(
                new MemoryDemotionCandidatesResponse(candidates),
                WishfulClawJsonContext.Default.MemoryDemotionCandidatesResponse));
        });
    }

    /// <summary>
    /// Batch status transition used by demotion, recovery and recall re-heat.
    /// touch=true additionally refreshes updated_at (used by re-heat); demotion
    /// keeps updated_at so idle time keeps accumulating.
    /// </summary>
    private static Task<WorkerResponse> MemoryBatchStatus(JsonElement parameters)
    {
        var ids = GetLongArray(parameters, "ids");
        var status = GetString(parameters, "status")?.ToLowerInvariant();
        var touch = GetBool(parameters, "touch", false);
        var rawScope = GetString(parameters, "scope");
        var explicitAll = string.IsNullOrWhiteSpace(rawScope) || rawScope == "all";
        var scope = explicitAll ? null : GetScope(parameters);
        if (ids.Count == 0)
            return Task.FromResult(WorkerResponse.Json(new MemoryBatchStatusResult(true, 0), WishfulClawJsonContext.Default.MemoryBatchStatusResult));
        if (status != "active" && status != "warm" && status != "cold")
            return Task.FromResult(WorkerResponse.Json(new MemoryBatchStatusResult(false, 0, Error: "Invalid status"), WishfulClawJsonContext.Default.MemoryBatchStatusResult));

        return RunAsync(() =>
        {
            var db = DbClient.GetClient();
            var idParams = ids.Select((value, index) => new SqliteParameter($"@id{index}", value)).ToArray();
            var inList = string.Join(",", ids.Select((_, index) => $"@id{index}"));
            var scopeClause = scope is null
                ? ""
                : $" AND scope = '{EscapeSql(scope)}'";
            var sql = touch
                ? $"UPDATE memory_entries SET status = @status, updated_at = @ua WHERE id IN ({inList}){scopeClause}"
                : $"UPDATE memory_entries SET status = @status WHERE id IN ({inList}){scopeClause}";
            var allParams = touch
                ? idParams.Append(new SqliteParameter("@status", status)).Append(new SqliteParameter("@ua", DateTimeOffset.UtcNow.ToUnixTimeSeconds())).ToArray()
                : idParams.Append(new SqliteParameter("@status", status)).ToArray();
            var affected = db.Execute(sql, allParams);
            return Task.FromResult(WorkerResponse.Json(new MemoryBatchStatusResult(true, affected), WishfulClawJsonContext.Default.MemoryBatchStatusResult));
        });
    }

    /// <summary>
    /// Lists entries by status for the tier browser / restore UI. Cold includes
    /// legacy 'deprecated' rows. scope="all" scans every scope; explicit scopes
    /// are exact, same semantics as demotion-candidates.
    /// </summary>
    private static Task<WorkerResponse> MemoryEntriesByStatus(JsonElement parameters)
    {
        var status = GetString(parameters, "status")?.ToLowerInvariant();
        if (status != "active" && status != "warm" && status != "cold")
            return Task.FromResult(WorkerResponse.Json(new MemoryEntriesByStatusResponse([]), WishfulClawJsonContext.Default.MemoryEntriesByStatusResponse));
        var rawScope = GetString(parameters, "scope");
        var explicitAll = string.IsNullOrWhiteSpace(rawScope) || rawScope == "all";
        var scope = explicitAll ? null : GetScope(parameters);
        var limit = GetInt(parameters, "limit", 200);

        return RunAsync(() =>
        {
            var db = DbClient.GetClient();
            var scopeClause = scope is null
                ? ""
                : $" AND scope = '{EscapeSql(scope)}'";
            var statusClause = status == "cold"
                ? "status IN ('cold', 'deprecated')"
                : "status = @status";
            var entries = new List<MemoryEntryRow>();
            using (var reader = db.ExecuteReader(
                       "SELECT id, scope, title, content, priority, status, updated_at FROM memory_entries " +
                       $"WHERE {statusClause}{scopeClause} ORDER BY updated_at DESC LIMIT @limit",
                       new SqliteParameter("@status", status),
                       new SqliteParameter("@limit", limit)))
            {
                while (reader.Read())
                {
                    var id = reader.GetInt64(reader.GetOrdinal("id"));
                    var entryScope = reader.GetString("scope");
                    var title = reader.IsDBNull(reader.GetOrdinal("title")) ? null : reader.GetString("title");
                    var content = reader.IsDBNull(reader.GetOrdinal("content")) ? "" : reader.GetString("content");
                    var priority = reader.GetString("priority");
                    var entryStatus = reader.GetString("status");
                    var updatedAt = reader.IsDBNull(reader.GetOrdinal("updated_at")) ? 0 : reader.GetInt64("updated_at");
                    entries.Add(new MemoryEntryRow(id, entryScope, title, content, priority, entryStatus, updatedAt));
                }
            }
            return Task.FromResult(WorkerResponse.Json(
                new MemoryEntriesByStatusResponse(entries),
                WishfulClawJsonContext.Default.MemoryEntriesByStatusResponse));
        });
    }

    // ── Helpers ──

    private static int CountStatus(DbService db, string sql)
    {
        using var reader = db.ExecuteReader(sql);
        return reader.Read() ? (int)reader.GetInt64(0) : 0;
    }

    private static string EscapeSql(string s) => s.Replace("'", "''", StringComparison.Ordinal);

    private static List<long> GetLongArray(JsonElement element, string name)
    {
        var result = new List<long>();
        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(name, out var prop) &&
            prop.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in prop.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.Number && item.TryGetInt64(out var value))
                    result.Add(value);
            }
        }
        return result;
    }

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

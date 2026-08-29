using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// DB endpoints for the global agent's high-level tasks (global_tasks table).
/// Global tasks are never deleted, only archived. Consumed by the Task Board
/// (renderer) and the global agent tool layer through db/global-tasks-* methods.
/// Contract: camelCase input params, snake_case GlobalTaskRow results.
/// </summary>
public static class DbGlobalTaskTools
{
    private const string GlobalTaskSelect =
        "SELECT id, title, description, status, priority, tags, due_at, archived, created_at, updated_at FROM global_tasks";

    public static WorkerResponse List(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var includeArchived = GetBool(parameters, "includeArchived");
            var status = GetString(parameters, "status");
            var keyword = GetString(parameters, "keyword");

            var sql = $"{GlobalTaskSelect} WHERE 1=1";
            var sqlParams = new List<SqliteParameter>();
            if (!includeArchived)
            {
                sql += " AND archived = 0";
            }
            if (!string.IsNullOrEmpty(status))
            {
                sql += " AND status = @status";
                sqlParams.Add(new SqliteParameter("@status", status));
            }
            if (!string.IsNullOrEmpty(keyword))
            {
                sql += " AND (title LIKE @kw OR description LIKE @kw)";
                sqlParams.Add(new SqliteParameter("@kw", $"%{keyword}%"));
            }
            sql += " ORDER BY archived ASC, updated_at DESC";

            var rows = db.Query(sql, r => GlobalTaskRow.FromEntity(EntityMappers.MapGlobalTask(r)), sqlParams.ToArray());
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListGlobalTaskRow);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGlobalTaskTools.List failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Get(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            if (string.IsNullOrEmpty(id))
                return WorkerResponse.Json(new GlobalTaskFindResult(false, null, "id is required"), InfrastructureJsonContext.Default.GlobalTaskFindResult);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var entity = db.QueryFirstOrDefault($"{GlobalTaskSelect} WHERE id = @id", EntityMappers.MapGlobalTask,
                new SqliteParameter("@id", id));
            var row = entity != null ? GlobalTaskRow.FromEntity(entity) : null;
            return WorkerResponse.Json(new GlobalTaskFindResult(true, row, null), InfrastructureJsonContext.Default.GlobalTaskFindResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGlobalTaskTools.Get failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Create(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            var title = GetString(parameters, "title");
            if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(title))
                return WorkerResponse.Json(new GlobalTaskMutationResult(false, 0, "id and title are required"), InfrastructureJsonContext.Default.GlobalTaskMutationResult);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var changed = db.Execute(
                "INSERT INTO global_tasks (id, title, description, status, priority, tags, due_at, archived, created_at, updated_at) VALUES " +
                "(@id, @title, @description, @status, @priority, @tags, @dueAt, 0, @createdAt, @updatedAt)",
                new SqliteParameter("@id", id),
                new SqliteParameter("@title", title),
                new SqliteParameter("@description", GetString(parameters, "description") ?? ""),
                new SqliteParameter("@status", GetString(parameters, "status") ?? GlobalTaskStatusValues.Pending),
                new SqliteParameter("@priority", GetString(parameters, "priority") ?? GlobalTaskPriorityValues.Normal),
                new SqliteParameter("@tags", RawArrayText(parameters, "tags")),
                new SqliteParameter("@dueAt", (object?)GetNullableLong(parameters, "dueAt") ?? DBNull.Value),
                new SqliteParameter("@createdAt", GetLong(parameters, "createdAt", now)),
                new SqliteParameter("@updatedAt", GetLong(parameters, "updatedAt", now)));

            return WorkerResponse.Json(new GlobalTaskMutationResult(true, changed, null), InfrastructureJsonContext.Default.GlobalTaskMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGlobalTaskTools.Create failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Update(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            if (string.IsNullOrEmpty(id))
                return WorkerResponse.Json(new GlobalTaskMutationResult(false, 0, "id is required"), InfrastructureJsonContext.Default.GlobalTaskMutationResult);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var entity = db.QueryFirstOrDefault($"{GlobalTaskSelect} WHERE id = @id", EntityMappers.MapGlobalTask,
                new SqliteParameter("@id", id));
            if (entity == null)
                return WorkerResponse.Json(new GlobalTaskMutationResult(false, 0, "Global task not found"), InfrastructureJsonContext.Default.GlobalTaskMutationResult);

            if (parameters.TryGetProperty("patch", out var patch) && patch.ValueKind == JsonValueKind.Object)
            {
                ApplyPatch(entity, patch);
            }

            var changed = db.Execute(
                "UPDATE global_tasks SET title = @title, description = @description, status = @status, priority = @priority, " +
                "tags = @tags, due_at = @dueAt, archived = @archived, updated_at = @ua WHERE id = @id",
                new SqliteParameter("@title", entity.Title),
                new SqliteParameter("@description", entity.Description),
                new SqliteParameter("@status", entity.Status),
                new SqliteParameter("@priority", entity.Priority),
                new SqliteParameter("@tags", entity.Tags),
                new SqliteParameter("@dueAt", (object?)entity.DueAt ?? DBNull.Value),
                new SqliteParameter("@archived", entity.Archived),
                new SqliteParameter("@ua", entity.UpdatedAt),
                new SqliteParameter("@id", id));

            return WorkerResponse.Json(new GlobalTaskMutationResult(true, changed, null), InfrastructureJsonContext.Default.GlobalTaskMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGlobalTaskTools.Update failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    /// <summary>Archive (soft-delete). Global tasks are never physically deleted.</summary>
    public static WorkerResponse Archive(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            if (string.IsNullOrEmpty(id))
                return WorkerResponse.Json(new GlobalTaskMutationResult(false, 0, "id is required"), InfrastructureJsonContext.Default.GlobalTaskMutationResult);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var changed = db.Execute(
                "UPDATE global_tasks SET archived = @archived, updated_at = @ua WHERE id = @id",
                new SqliteParameter("@archived", 1),
                new SqliteParameter("@ua", now),
                new SqliteParameter("@id", id));

            return WorkerResponse.Json(new GlobalTaskMutationResult(true, changed, null), InfrastructureJsonContext.Default.GlobalTaskMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGlobalTaskTools.Archive failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    // ─── Private helpers ───

    private static void ApplyPatch(GlobalTaskEntity entity, JsonElement patch)
    {
        if (patch.TryGetProperty("title", out var title) && title.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(title.GetString()))
            entity.Title = title.GetString()!;
        if (patch.TryGetProperty("description", out var description) && description.ValueKind == JsonValueKind.String)
            entity.Description = description.GetString()!;
        if (patch.TryGetProperty("status", out var status) && status.ValueKind == JsonValueKind.String)
            entity.Status = status.GetString()!;
        if (patch.TryGetProperty("priority", out var priority) && priority.ValueKind == JsonValueKind.String)
            entity.Priority = priority.GetString()!;
        if (patch.TryGetProperty("tags", out var tags) && tags.ValueKind == JsonValueKind.Array)
            entity.Tags = tags.GetRawText();
        if (patch.TryGetProperty("dueAt", out var dueAt))
            entity.DueAt = dueAt.ValueKind == JsonValueKind.Number ? dueAt.GetInt64() : null;
        if (patch.TryGetProperty("archived", out var archived))
            entity.Archived = archived.ValueKind is JsonValueKind.True or JsonValueKind.Number ? 1 : 0;
        if (patch.TryGetProperty("updatedAt", out var updatedAt) && updatedAt.ValueKind == JsonValueKind.Number)
            entity.UpdatedAt = updatedAt.GetInt64();
        else
            entity.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    private static string? GetString(JsonElement parameters, string name)
    {
        return parameters.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String
            ? el.GetString()
            : null;
    }

    private static bool GetBool(JsonElement parameters, string name)
    {
        return parameters.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.True;
    }

    private static long GetLong(JsonElement parameters, string name, long fallback)
    {
        return parameters.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number
            ? el.GetInt64()
            : fallback;
    }

    private static long? GetNullableLong(JsonElement parameters, string name)
    {
        return parameters.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number
            ? el.GetInt64()
            : null;
    }

    private static string RawArrayText(JsonElement parameters, string name)
    {
        return parameters.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Array
            ? el.GetRawText()
            : "[]";
    }
}

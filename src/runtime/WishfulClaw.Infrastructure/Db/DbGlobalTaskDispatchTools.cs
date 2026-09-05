using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// DB endpoints for global task dispatch records (global_task_dispatches table).
/// Dispatch records are permanent — never cascade-deleted with sessions, and
/// they never reference the session-scoped tasks table.
/// Contract: camelCase input params, snake_case GlobalTaskDispatchRow results.
/// </summary>
public static class DbGlobalTaskDispatchTools
{
    private const string DispatchSelect =
        "SELECT id, global_task_id, project_id, session_id, source_session_id, kind, instruction, status, latest_report, error, " +
        "created_at, updated_at, completed_at FROM global_task_dispatches";

    public static WorkerResponse List(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var sql = $"{DispatchSelect} WHERE 1=1";
            var sqlParams = new List<SqliteParameter>();
            var globalTaskId = GetString(parameters, "globalTaskId");
            var sessionId = GetString(parameters, "sessionId");
            var projectId = GetString(parameters, "projectId");
            var status = GetString(parameters, "status");
            if (!string.IsNullOrEmpty(globalTaskId))
            {
                sql += " AND global_task_id = @gtid";
                sqlParams.Add(new SqliteParameter("@gtid", globalTaskId));
            }
            if (!string.IsNullOrEmpty(sessionId))
            {
                sql += " AND session_id = @sid";
                sqlParams.Add(new SqliteParameter("@sid", sessionId));
            }
            if (!string.IsNullOrEmpty(projectId))
            {
                sql += " AND project_id = @pid";
                sqlParams.Add(new SqliteParameter("@pid", projectId));
            }
            if (!string.IsNullOrEmpty(status))
            {
                sql += " AND status = @status";
                sqlParams.Add(new SqliteParameter("@status", status));
            }
            sql += " ORDER BY updated_at DESC";

            var rows = db.Query(sql, r => GlobalTaskDispatchRow.FromEntity(EntityMappers.MapGlobalTaskDispatch(r)), sqlParams.ToArray());
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListGlobalTaskDispatchRow);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGlobalTaskDispatchTools.List failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Get(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            if (string.IsNullOrEmpty(id))
                return WorkerResponse.Json(new GlobalTaskDispatchFindResult(false, null, "id is required"), InfrastructureJsonContext.Default.GlobalTaskDispatchFindResult);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var entity = db.QueryFirstOrDefault($"{DispatchSelect} WHERE id = @id", EntityMappers.MapGlobalTaskDispatch,
                new SqliteParameter("@id", id));
            var row = entity != null ? GlobalTaskDispatchRow.FromEntity(entity) : null;
            return WorkerResponse.Json(new GlobalTaskDispatchFindResult(true, row, null), InfrastructureJsonContext.Default.GlobalTaskDispatchFindResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGlobalTaskDispatchTools.Get failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Create(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            var globalTaskId = GetString(parameters, "globalTaskId");
            var sessionId = GetString(parameters, "sessionId");
            if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(globalTaskId) || string.IsNullOrEmpty(sessionId))
                return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(false, 0, "id, globalTaskId and sessionId are required"), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var mutation = db.ExecuteInTransaction((conn, tx) =>
            {
                // Validate the parent task and target session on the same
                // transaction that inserts the dispatch row.
                var taskExists = db.QueryScalar<long>(conn, tx,
                    "SELECT COUNT(*) FROM global_tasks WHERE id = @id",
                    new SqliteParameter("@id", globalTaskId)) > 0;
                if (!taskExists)
                    return new GlobalTaskDispatchMutationResult(false, 0, "Global task not found");

                var sessionExists = db.QueryScalar<long>(conn, tx,
                    "SELECT COUNT(*) FROM sessions WHERE id = @id AND scope = 'project'",
                    new SqliteParameter("@id", sessionId)) > 0;
                if (!sessionExists)
                    return new GlobalTaskDispatchMutationResult(false, 0, "Target session must be a project session");

                var sessionProjectId = db.QueryFirstOrDefault(
                    conn, tx,
                    "SELECT project_id FROM sessions WHERE id = @id",
                    r => r.GetNullableString("project_id") ?? string.Empty,
                    new SqliteParameter("@id", sessionId));
                if (string.IsNullOrEmpty(sessionProjectId))
                    return new GlobalTaskDispatchMutationResult(false, 0, "Target project session has no projectId");

                var requestedProjectId = GetString(parameters, "projectId");
                if (!string.IsNullOrEmpty(requestedProjectId) && requestedProjectId != sessionProjectId)
                    return new GlobalTaskDispatchMutationResult(false, 0, "projectId does not match the target session's project");

                var kind = GetString(parameters, "kind") ?? GlobalTaskDispatchKindValues.Message;
                if (kind != GlobalTaskDispatchKindValues.Message && kind != GlobalTaskDispatchKindValues.WorkRequest)
                    return new GlobalTaskDispatchMutationResult(false, 0, "kind must be 'message' or 'work_request'");

                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var changed = db.Execute(conn, tx,
                    "INSERT INTO global_task_dispatches (id, global_task_id, project_id, session_id, source_session_id, kind, instruction, status, " +
                    "latest_report, error, created_at, updated_at, completed_at) VALUES " +
                    "(@id, @gtid, @pid, @sid, @srcid, @kind, @instruction, @status, NULL, NULL, @createdAt, @updatedAt, NULL)",
                    new SqliteParameter("@id", id),
                    new SqliteParameter("@gtid", globalTaskId),
                    new SqliteParameter("@pid", sessionProjectId),
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@srcid", (object?)GetString(parameters, "sourceSessionId") ?? DBNull.Value),
                    new SqliteParameter("@kind", kind),
                    new SqliteParameter("@instruction", GetString(parameters, "instruction") ?? ""),
                    new SqliteParameter("@status", GetString(parameters, "status") ?? GlobalTaskDispatchStatusValues.Pending),
                    new SqliteParameter("@createdAt", GetLong(parameters, "createdAt", now)),
                    new SqliteParameter("@updatedAt", GetLong(parameters, "updatedAt", now)));
                return new GlobalTaskDispatchMutationResult(changed > 0, changed, changed > 0 ? null : "Dispatch was not created");
            });

            return WorkerResponse.Json(mutation, InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGlobalTaskDispatchTools.Create failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Update(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            if (string.IsNullOrEmpty(id))
                return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(false, 0, "id is required"), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            if (!parameters.TryGetProperty("patch", out var patch) || patch.ValueKind != JsonValueKind.Object)
                return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(false, 0, "patch is required"), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);

            var assignments = new List<string>();
            var sqlParams = new List<SqliteParameter>();
            AddStringPatch(patch, "kind", "kind", assignments, sqlParams);
            AddStringPatch(patch, "instruction", "instruction", assignments, sqlParams);
            AddStringPatch(patch, "status", "status", assignments, sqlParams);
            AddNullableStringPatch(patch, "latestReport", "latest_report", assignments, sqlParams);
            AddNullableStringPatch(patch, "error", "error", assignments, sqlParams);
            AddNullableLongPatch(patch, "completedAt", "completed_at", assignments, sqlParams);
            if (assignments.Count == 0)
                return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(false, 0, "patch has no supported fields"), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);

            assignments.Add("updated_at = @updatedAt");
            sqlParams.Add(new SqliteParameter("@updatedAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
            sqlParams.Add(new SqliteParameter("@id", id));
            var changed = db.Execute(
                $"UPDATE global_task_dispatches SET {string.Join(", ", assignments)} WHERE id = @id",
                sqlParams.ToArray());
            if (changed == 0)
                return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(false, 0, "Dispatch not found"), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);

            return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(true, changed, null), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGlobalTaskDispatchTools.Update failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    /// <summary>Cancel a dispatch. Completed dispatches cannot be cancelled.</summary>
    public static WorkerResponse Cancel(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            if (string.IsNullOrEmpty(id))
                return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(false, 0, "id is required"), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var changed = db.Execute(
                "UPDATE global_task_dispatches SET status = @status, updated_at = @ua " +
                "WHERE id = @id AND status NOT IN (@completed, @cancelled)",
                new SqliteParameter("@status", GlobalTaskDispatchStatusValues.Cancelled),
                new SqliteParameter("@ua", now),
                new SqliteParameter("@id", id),
                new SqliteParameter("@completed", GlobalTaskDispatchStatusValues.Completed),
                new SqliteParameter("@cancelled", GlobalTaskDispatchStatusValues.Cancelled));
            if (changed == 0)
                return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(false, 0, "Dispatch not found or already completed/cancelled"), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);

            return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(true, changed, null), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGlobalTaskDispatchTools.Cancel failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    // ─── Private helpers ───

    private static void AddStringPatch(
        JsonElement patch,
        string inputName,
        string columnName,
        List<string> assignments,
        List<SqliteParameter> parameters)
    {
        if (!patch.TryGetProperty(inputName, out var value) || value.ValueKind != JsonValueKind.String)
            return;

        var parameterName = $"@patch_{columnName}";
        assignments.Add($"{columnName} = {parameterName}");
        parameters.Add(new SqliteParameter(parameterName, value.GetString() ?? string.Empty));
    }

    private static void AddNullableStringPatch(
        JsonElement patch,
        string inputName,
        string columnName,
        List<string> assignments,
        List<SqliteParameter> parameters)
    {
        if (!patch.TryGetProperty(inputName, out var value)
            || (value.ValueKind != JsonValueKind.String && value.ValueKind != JsonValueKind.Null))
            return;

        var parameterName = $"@patch_{columnName}";
        assignments.Add($"{columnName} = {parameterName}");
        parameters.Add(new SqliteParameter(parameterName,
            value.ValueKind == JsonValueKind.Null ? DBNull.Value : value.GetString() ?? string.Empty));
    }

    private static void AddNullableLongPatch(
        JsonElement patch,
        string inputName,
        string columnName,
        List<string> assignments,
        List<SqliteParameter> parameters)
    {
        if (!patch.TryGetProperty(inputName, out var value)
            || (value.ValueKind != JsonValueKind.Number && value.ValueKind != JsonValueKind.Null))
            return;

        var parameterName = $"@patch_{columnName}";
        assignments.Add($"{columnName} = {parameterName}");
        parameters.Add(new SqliteParameter(parameterName,
            value.ValueKind == JsonValueKind.Null ? DBNull.Value : value.GetInt64()));
    }

    private static string? GetString(JsonElement parameters, string name)
    {
        return parameters.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String
            ? el.GetString()
            : null;
    }

    private static long GetLong(JsonElement parameters, string name, long fallback)
    {
        return parameters.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number
            ? el.GetInt64()
            : fallback;
    }
}

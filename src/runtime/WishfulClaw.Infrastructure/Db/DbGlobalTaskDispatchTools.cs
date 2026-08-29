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

            // Constraint: the parent global task must exist.
            var taskExists = db.QueryScalar<long>("SELECT COUNT(*) FROM global_tasks WHERE id = @id",
                new SqliteParameter("@id", globalTaskId)) > 0;
            if (!taskExists)
                return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(false, 0, "Global task not found"), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);

            // Constraint: the target session must exist; project is derived
            // from the session↔project relationship and must agree with any
            // explicitly supplied projectId.
            var sessionExists = db.QueryScalar<long>("SELECT COUNT(*) FROM sessions WHERE id = @id",
                new SqliteParameter("@id", sessionId)) > 0;
            if (!sessionExists)
                return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(false, 0, "Target session not found"), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);
            var sessionProjectRaw = db.QueryFirstOrDefault(
                "SELECT project_id FROM sessions WHERE id = @id",
                r => r.GetNullableString("project_id") ?? string.Empty,
                new SqliteParameter("@id", sessionId));
            var sessionProjectId = string.IsNullOrEmpty(sessionProjectRaw) ? null : sessionProjectRaw;
            var requestedProjectId = GetString(parameters, "projectId");
            if (!string.IsNullOrEmpty(requestedProjectId) && requestedProjectId != sessionProjectId)
                return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(false, 0, "projectId does not match the target session's project"), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);

            var kind = GetString(parameters, "kind") ?? GlobalTaskDispatchKindValues.Message;
            if (kind != GlobalTaskDispatchKindValues.Message && kind != GlobalTaskDispatchKindValues.WorkRequest)
                return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(false, 0, "kind must be 'message' or 'work_request'"), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var changed = db.Execute(
                "INSERT INTO global_task_dispatches (id, global_task_id, project_id, session_id, source_session_id, kind, instruction, status, " +
                "latest_report, error, created_at, updated_at, completed_at) VALUES " +
                "(@id, @gtid, @pid, @sid, @srcid, @kind, @instruction, @status, NULL, NULL, @createdAt, @updatedAt, NULL)",
                new SqliteParameter("@id", id),
                new SqliteParameter("@gtid", globalTaskId),
                new SqliteParameter("@pid", (object?)sessionProjectId ?? DBNull.Value),
                new SqliteParameter("@sid", sessionId),
                new SqliteParameter("@srcid", (object?)GetString(parameters, "sourceSessionId") ?? DBNull.Value),
                new SqliteParameter("@kind", kind),
                new SqliteParameter("@instruction", GetString(parameters, "instruction") ?? ""),
                new SqliteParameter("@status", GetString(parameters, "status") ?? GlobalTaskDispatchStatusValues.Pending),
                new SqliteParameter("@createdAt", GetLong(parameters, "createdAt", now)),
                new SqliteParameter("@updatedAt", GetLong(parameters, "updatedAt", now)));

            return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(true, changed, null), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);
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

            var entity = db.QueryFirstOrDefault($"{DispatchSelect} WHERE id = @id", EntityMappers.MapGlobalTaskDispatch,
                new SqliteParameter("@id", id));
            if (entity == null)
                return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(false, 0, "Dispatch not found"), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);

            if (parameters.TryGetProperty("patch", out var patch) && patch.ValueKind == JsonValueKind.Object)
            {
                ApplyPatch(entity, patch);
            }

            var changed = db.Execute(
                "UPDATE global_task_dispatches SET kind = @kind, instruction = @instruction, status = @status, " +
                "latest_report = @report, error = @error, updated_at = @ua, completed_at = @ca WHERE id = @id",
                new SqliteParameter("@kind", entity.Kind),
                new SqliteParameter("@instruction", entity.Instruction),
                new SqliteParameter("@status", entity.Status),
                new SqliteParameter("@report", (object?)entity.LatestReport ?? DBNull.Value),
                new SqliteParameter("@error", (object?)entity.Error ?? DBNull.Value),
                new SqliteParameter("@ua", entity.UpdatedAt),
                new SqliteParameter("@ca", (object?)entity.CompletedAt ?? DBNull.Value),
                new SqliteParameter("@id", id));

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

    private static void ApplyPatch(GlobalTaskDispatchEntity entity, JsonElement patch)
    {
        if (patch.TryGetProperty("instruction", out var instruction) && instruction.ValueKind == JsonValueKind.String)
            entity.Instruction = instruction.GetString()!;
        if (patch.TryGetProperty("status", out var status) && status.ValueKind == JsonValueKind.String)
            entity.Status = status.GetString()!;
        if (patch.TryGetProperty("latestReport", out var latestReport))
            entity.LatestReport = latestReport.ValueKind == JsonValueKind.String ? latestReport.GetString() : null;
        if (patch.TryGetProperty("error", out var error))
            entity.Error = error.ValueKind == JsonValueKind.String ? error.GetString() : null;
        if (patch.TryGetProperty("completedAt", out var completedAt))
            entity.CompletedAt = completedAt.ValueKind == JsonValueKind.Number ? completedAt.GetInt64() : null;
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

    private static long GetLong(JsonElement parameters, string name, long fallback)
    {
        return parameters.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number
            ? el.GetInt64()
            : fallback;
    }
}

using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// S-279（v3-iter-5）：普通消息派活记录（<c>global_message_dispatches</c>）的 DB 端点。
///
/// 与 <see cref="DbGlobalTaskDispatchTools"/> 平行，但**不复制它的状态机** ——
/// 状态流转一律走 <see cref="DispatchStatusMachine"/>，两张表共用一份。
///
/// 与任务派活的差别只有一处：这里没有 <c>global_task_id</c>，所以 <see cref="Create"/>
/// 不校验全局任务存在，只校验目标 session 是项目会话。其余字段、DTO、状态值域完全相同。
///
/// 派活记录永久保留 —— 不随 session 级联删除，也不引用会话级 tasks 表。
/// Contract: camelCase input params, snake_case <see cref="GlobalTaskDispatchRow"/> results.
/// </summary>
public static class DbGlobalMessageDispatchTools
{
    private const string MessageDispatchSelect =
        "SELECT id, project_id, session_id, source_session_id, instruction, status, latest_report, error, " +
        "created_at, updated_at, completed_at FROM global_message_dispatches";

    public static WorkerResponse List(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var sql = $"{MessageDispatchSelect} WHERE 1=1";
            var sqlParams = new List<SqliteParameter>();
            var sessionId = GetString(parameters, "sessionId");
            var sourceSessionId = GetString(parameters, "sourceSessionId");
            var projectId = GetString(parameters, "projectId");
            var status = GetString(parameters, "status");
            if (!string.IsNullOrEmpty(sessionId))
            {
                sql += " AND session_id = @sid";
                sqlParams.Add(new SqliteParameter("@sid", sessionId));
            }
            if (!string.IsNullOrEmpty(sourceSessionId))
            {
                sql += " AND source_session_id = @srcid";
                sqlParams.Add(new SqliteParameter("@srcid", sourceSessionId));
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

            var rows = db.Query(sql, r => GlobalTaskDispatchRow.FromEntity(EntityMappers.MapGlobalMessageDispatch(r)), sqlParams.ToArray());
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListGlobalTaskDispatchRow);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGlobalMessageDispatchTools.List failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
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
            var entity = db.QueryFirstOrDefault($"{MessageDispatchSelect} WHERE id = @id", EntityMappers.MapGlobalMessageDispatch,
                new SqliteParameter("@id", id));
            var row = entity != null ? GlobalTaskDispatchRow.FromEntity(entity) : null;
            return WorkerResponse.Json(new GlobalTaskDispatchFindResult(true, row, null), InfrastructureJsonContext.Default.GlobalTaskDispatchFindResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGlobalMessageDispatchTools.Get failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Create(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            var sessionId = GetString(parameters, "sessionId");
            if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(sessionId))
                return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(false, 0, "id and sessionId are required"), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var mutation = db.ExecuteInTransaction((conn, tx) =>
            {
                // 与任务派活同一口径：目标必须是项目会话（project_id 非空），
                // 判定方式见 DbGlobalTaskDispatchTools.Create 的注释（S-189）。
                var targetSessionExists = db.QueryScalar<long>(conn, tx,
                    "SELECT COUNT(*) FROM sessions WHERE id = @id",
                    new SqliteParameter("@id", sessionId)) > 0;
                if (!targetSessionExists)
                    return new GlobalTaskDispatchMutationResult(false, 0, "Target session not found");

                var sessionProjectId = db.QueryFirstOrDefault(
                    conn, tx,
                    "SELECT project_id FROM sessions WHERE id = @id",
                    r => r.GetNullableString("project_id") ?? string.Empty,
                    new SqliteParameter("@id", sessionId));
                if (string.IsNullOrEmpty(sessionProjectId))
                    return new GlobalTaskDispatchMutationResult(false, 0, "Target session must be a project session");

                var requestedProjectId = GetString(parameters, "projectId");
                if (!string.IsNullOrEmpty(requestedProjectId) && requestedProjectId != sessionProjectId)
                    return new GlobalTaskDispatchMutationResult(false, 0, "projectId does not match the target session's project");

                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var changed = db.Execute(conn, tx,
                    "INSERT INTO global_message_dispatches (id, project_id, session_id, source_session_id, instruction, status, " +
                    "latest_report, error, created_at, updated_at, completed_at) VALUES " +
                    "(@id, @pid, @sid, @srcid, @instruction, @status, NULL, NULL, @createdAt, @updatedAt, NULL)",
                    new SqliteParameter("@id", id),
                    new SqliteParameter("@pid", sessionProjectId),
                    new SqliteParameter("@sid", sessionId),
                    new SqliteParameter("@srcid", (object?)GetString(parameters, "sourceSessionId") ?? DBNull.Value),
                    new SqliteParameter("@instruction", GetString(parameters, "instruction") ?? ""),
                    new SqliteParameter("@status", GetString(parameters, "status") ?? GlobalTaskDispatchStatusValues.Pending),
                    new SqliteParameter("@createdAt", GetLong(parameters, "createdAt", now)),
                    new SqliteParameter("@updatedAt", GetLong(parameters, "updatedAt", now)));
                return new GlobalTaskDispatchMutationResult(changed > 0, changed, changed > 0 ? null : "Dispatch was not created");
            });

            if (mutation.Success)
            {
                DbAgentTimelineTools.Log(db, sessionId, null, "task_dispatched",
                    GetString(parameters, "instruction"),
                    DbAgentTimelineTools.Metadata(
                        ("dispatch_id", id),
                        ("kind", GlobalTaskDispatchKindValues.Message)));
            }

            return WorkerResponse.Json(mutation, InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGlobalMessageDispatchTools.Create failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
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
            // 没有 kind 列（整张表就是 message），所以不像任务派活那样支持 patch kind。
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
                $"UPDATE global_message_dispatches SET {string.Join(", ", assignments)} WHERE id = @id",
                sqlParams.ToArray());
            if (changed == 0)
                return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(false, 0, "Dispatch not found"), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);

            return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(true, changed, null), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGlobalMessageDispatchTools.Update failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    /// <summary>取消一条普通消息派活。终态（completed / failed / cancelled）不可取消。</summary>
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
                "UPDATE global_message_dispatches SET status = @status, updated_at = @ua " +
                "WHERE id = @id AND status NOT IN (@completed, @failed, @cancelled)",
                new SqliteParameter("@status", GlobalTaskDispatchStatusValues.Cancelled),
                new SqliteParameter("@ua", now),
                new SqliteParameter("@id", id),
                new SqliteParameter("@completed", GlobalTaskDispatchStatusValues.Completed),
                new SqliteParameter("@failed", GlobalTaskDispatchStatusValues.Failed),
                new SqliteParameter("@cancelled", GlobalTaskDispatchStatusValues.Cancelled));
            if (changed == 0)
                return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(false, 0, "Dispatch not found or already terminal"), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);

            return WorkerResponse.Json(new GlobalTaskDispatchMutationResult(true, changed, null), InfrastructureJsonContext.Default.GlobalTaskDispatchMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbGlobalMessageDispatchTools.Cancel failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    // ─── Private helpers（与 DbGlobalTaskDispatchTools 同构；只差表名与列集） ───

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

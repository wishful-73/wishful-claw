using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// AOT-safe CRUD and run-state endpoints for persisted Cron tasks.
/// </summary>
public static class DbCronTools
{
    public static WorkerResponse List(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var includeDeleted = GetBool(parameters, "includeDeleted", false);
            var enabledOnly = GetBool(parameters, "enabledOnly", false);
            var conditions = new List<string>();
            if (!includeDeleted)
                conditions.Add("deleted_at IS NULL");
            if (enabledOnly)
                conditions.Add("enabled = 1");

            var sql = "SELECT * FROM cron_tasks";
            if (conditions.Count > 0)
                sql += " WHERE " + string.Join(" AND ", conditions);
            sql += " ORDER BY updated_at DESC";

            var rows = db.Query(sql, EntityMappers.MapCron)
                .Select(CronRow.FromEntity)
                .ToList();
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListCronRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbCronTools.List failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse Get(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var id = RequireString(parameters, "id");
            var includeDeleted = GetBool(parameters, "includeDeleted", false);
            var entity = db.QueryFirstOrDefault(
                includeDeleted
                    ? "SELECT * FROM cron_tasks WHERE id = @id LIMIT 1"
                    : "SELECT * FROM cron_tasks WHERE id = @id AND deleted_at IS NULL LIMIT 1",
                EntityMappers.MapCron,
                new SqliteParameter("@id", id));
            if (entity is null)
                return WorkerResponse.Json(new CronFindResult(false, null, "Cron task not found"),
                    InfrastructureJsonContext.Default.CronFindResult);

            return WorkerResponse.Json(new CronFindResult(true, CronRow.FromEntity(entity), null),
                InfrastructureJsonContext.Default.CronFindResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbCronTools.Get failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse Create(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var entity = ParseCreate(parameters);
            db.Execute(
                "INSERT INTO cron_tasks " +
                "(id, name, session_id, scope, project_id, schedule_json, prompt, agent_id, model, thinking_enabled, reasoning_effort, working_folder, " +
                "delivery_mode, output_mode, reuse_session_id, run_mode, delivery_target, plugin_id, plugin_type, plugin_chat_id, delete_after_run, " +
                "max_iterations, enabled, deleted_at, last_fired_at, last_run_at, last_run_status, " +
                "last_run_summary, last_error, fire_count, created_at, updated_at) " +
                "VALUES (@id, @name, @sid, @scope, @projectId, @schedule, @prompt, @agent, @model, @thinkingEnabled, @reasoningEffort, @folder, @deliveryMode, " +
                "@outputMode, @reuseSessionId, @runMode, @deliveryTarget, @pluginId, @pluginType, @pluginChatId, @deleteAfterRun, @maxIterations, " +
                "@enabled, NULL, NULL, NULL, NULL, NULL, NULL, 0, @createdAt, @updatedAt)",
                Parameters(entity).ToArray());

            return WorkerResponse.Json(new CronMutationResult(true, 1, CronRow.FromEntity(entity), null),
                InfrastructureJsonContext.Default.CronMutationResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbCronTools.Create failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse Update(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var id = RequireString(parameters, "id");
            var entity = db.QueryFirstOrDefault(
                "SELECT * FROM cron_tasks WHERE id = @id AND deleted_at IS NULL LIMIT 1",
                EntityMappers.MapCron,
                new SqliteParameter("@id", id));
            if (entity is null)
                return WorkerResponse.Json(new CronMutationResult(false, 0, null, "Cron task not found"),
                    InfrastructureJsonContext.Default.CronMutationResult);

            if (parameters.TryGetProperty("patch", out var patch) && patch.ValueKind == JsonValueKind.Object)
                ApplyPatch(entity, patch);
            else
                ApplyPatch(entity, parameters);

            entity.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var changed = db.Execute(
                "UPDATE cron_tasks SET name = @name, session_id = @sid, scope = @scope, project_id = @projectId, " +
                "schedule_json = @schedule, prompt = @prompt, agent_id = @agent, model = @model, " +
                "thinking_enabled = @thinkingEnabled, reasoning_effort = @reasoningEffort, working_folder = @folder, " +
                "delivery_mode = @deliveryMode, output_mode = @outputMode, reuse_session_id = @reuseSessionId, run_mode = @runMode, " +
                "delivery_target = @deliveryTarget, plugin_id = @pluginId, plugin_type = @pluginType, " +
                "plugin_chat_id = @pluginChatId, delete_after_run = @deleteAfterRun, max_iterations = @maxIterations, " +
                "enabled = @enabled, updated_at = @updatedAt WHERE id = @id",
                Parameters(entity).ToArray());

            return WorkerResponse.Json(new CronMutationResult(changed == 1, changed, CronRow.FromEntity(entity),
                    changed == 1 ? null : "Cron task was not updated"),
                InfrastructureJsonContext.Default.CronMutationResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbCronTools.Update failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse Delete(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var id = RequireString(parameters, "id");
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var changed = db.Execute(
                "UPDATE cron_tasks SET enabled = 0, deleted_at = @deletedAt, updated_at = @updatedAt " +
                "WHERE id = @id AND deleted_at IS NULL",
                new SqliteParameter("@deletedAt", now),
                new SqliteParameter("@updatedAt", now),
                new SqliteParameter("@id", id));
            return WorkerResponse.Json(new CronMutationResult(changed == 1, changed, null,
                    changed == 1 ? null : "Cron task not found or already deleted"),
                InfrastructureJsonContext.Default.CronMutationResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbCronTools.Delete failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse Toggle(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var id = RequireString(parameters, "id");
            if (!parameters.TryGetProperty("enabled", out var enabledElement) ||
                (enabledElement.ValueKind != JsonValueKind.True && enabledElement.ValueKind != JsonValueKind.False))
                throw new InvalidOperationException("enabled is required");

            var enabled = enabledElement.GetBoolean();
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var changed = db.Execute(
                "UPDATE cron_tasks SET enabled = @enabled, updated_at = @updatedAt " +
                "WHERE id = @id AND deleted_at IS NULL",
                new SqliteParameter("@enabled", enabled ? 1 : 0),
                new SqliteParameter("@updatedAt", now),
                new SqliteParameter("@id", id));
            var entity = changed == 1
                ? db.QueryFirstOrDefault("SELECT * FROM cron_tasks WHERE id = @id LIMIT 1", EntityMappers.MapCron,
                    new SqliteParameter("@id", id))
                : null;
            return WorkerResponse.Json(new CronMutationResult(changed == 1, changed,
                    entity is null ? null : CronRow.FromEntity(entity),
                    changed == 1 ? null : "Cron task not found or already deleted"),
                InfrastructureJsonContext.Default.CronMutationResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbCronTools.Toggle failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse MarkFired(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var id = RequireString(parameters, "id");
            var firedAt = GetLong(parameters, "firedAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            var disable = GetBool(parameters, "disable", false);
            var changed = db.Execute(
                "UPDATE cron_tasks SET last_fired_at = @firedAt, fire_count = fire_count + 1, " +
                "enabled = CASE WHEN @disable = 1 THEN 0 ELSE enabled END, updated_at = @updatedAt " +
                "WHERE id = @id AND deleted_at IS NULL",
                new SqliteParameter("@firedAt", firedAt),
                new SqliteParameter("@disable", disable ? 1 : 0),
                new SqliteParameter("@updatedAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()),
                new SqliteParameter("@id", id));
            return ReadMutation(db, id, changed, "Cron task not found or deleted");
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbCronTools.MarkFired failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse MarkRunFinished(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var id = RequireString(parameters, "id");
            var status = RequireString(parameters, "status");
            var runAt = GetLong(parameters, "runAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            var summary = GetNullableString(parameters, "summary") ?? GetNullableString(parameters, "runSummary");
            var error = GetNullableString(parameters, "error");
            var changed = db.Execute(
                "UPDATE cron_tasks SET last_run_at = @runAt, last_run_status = @status, " +
                "last_run_summary = @summary, last_error = @error, updated_at = @updatedAt " +
                "WHERE id = @id AND deleted_at IS NULL",
                new SqliteParameter("@runAt", runAt),
                new SqliteParameter("@status", status),
                new SqliteParameter("@summary", (object?)summary ?? DBNull.Value),
                new SqliteParameter("@error", (object?)error ?? DBNull.Value),
                new SqliteParameter("@updatedAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()),
                new SqliteParameter("@id", id));
            return ReadMutation(db, id, changed, "Cron task not found or deleted");
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbCronTools.MarkRunFinished failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    private static WorkerResponse ReadMutation(DbService db, string id, int changed, string error)
    {
        var entity = changed == 1
            ? db.QueryFirstOrDefault("SELECT * FROM cron_tasks WHERE id = @id LIMIT 1", EntityMappers.MapCron,
                new SqliteParameter("@id", id))
            : null;
        return WorkerResponse.Json(new CronMutationResult(changed == 1, changed,
                entity is null ? null : CronRow.FromEntity(entity), changed == 1 ? null : error),
            InfrastructureJsonContext.Default.CronMutationResult);
    }

    private static CronEntity ParseCreate(JsonElement parameters)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var scheduleJson = GetRawJson(parameters, "scheduleJson") ?? throw new InvalidOperationException("scheduleJson is required");
        var prompt = RequireString(parameters, "prompt");
        return new CronEntity
        {
            Id = GetNullableString(parameters, "id") ?? Guid.NewGuid().ToString("N"),
            Name = GetNullableString(parameters, "name") ?? string.Empty,
            SessionId = GetNullableString(parameters, "sessionId"),
            Scope = GetNullableString(parameters, "scope") ?? "global",
            ProjectId = GetNullableString(parameters, "projectId"),
            ScheduleJson = scheduleJson,
            Prompt = prompt,
            AgentId = GetNullableString(parameters, "agentId"),
            Model = GetNullableString(parameters, "model"),
            ThinkingEnabled = GetNullableBool(parameters, "thinkingEnabled"),
            ReasoningEffort = GetNullableString(parameters, "reasoningEffort"),
            WorkingFolder = GetNullableString(parameters, "workingFolder"),
            DeliveryMode = GetNullableString(parameters, "deliveryMode") ?? "desktop",
            OutputMode = GetNullableString(parameters, "outputMode") ?? "new_session",
            ReuseSessionId = GetNullableString(parameters, "reuseSessionId"),
            RunMode = GetNullableString(parameters, "runMode") ?? "background",
            DeliveryTarget = GetNullableString(parameters, "deliveryTarget"),
            PluginId = GetNullableString(parameters, "pluginId"),
            PluginType = GetNullableString(parameters, "pluginType"),
            PluginChatId = GetNullableString(parameters, "pluginChatId"),
            DeleteAfterRun = GetBool(parameters, "deleteAfterRun", false),
            MaxIterations = GetInt(parameters, "maxIterations", 15),
            Enabled = GetBool(parameters, "enabled", true),
            CreatedAt = now,
            UpdatedAt = now
        };
    }

    private static void ApplyPatch(CronEntity entity, JsonElement patch)
    {
        if (patch.TryGetProperty("name", out var name)) entity.Name = RequireValueString(name, "name");
        if (patch.TryGetProperty("sessionId", out var sessionId)) entity.SessionId = NullableValueString(sessionId);
        if (patch.TryGetProperty("scope", out var scope)) entity.Scope = RequireValueString(scope, "scope");
        if (patch.TryGetProperty("projectId", out var projectId)) entity.ProjectId = NullableValueString(projectId);
        if (patch.TryGetProperty("scheduleJson", out var schedule)) entity.ScheduleJson = RequireRawJson(schedule, "scheduleJson");
        if (patch.TryGetProperty("prompt", out var prompt)) entity.Prompt = RequireValueString(prompt, "prompt");
        if (patch.TryGetProperty("agentId", out var agentId)) entity.AgentId = NullableValueString(agentId);
        if (patch.TryGetProperty("model", out var model)) entity.Model = NullableValueString(model);
        if (patch.TryGetProperty("thinkingEnabled", out var thinkingEnabled)) entity.ThinkingEnabled = NullableValueBool(thinkingEnabled, "thinkingEnabled");
        if (patch.TryGetProperty("reasoningEffort", out var reasoningEffort)) entity.ReasoningEffort = NullableValueString(reasoningEffort);
        if (patch.TryGetProperty("workingFolder", out var folder)) entity.WorkingFolder = NullableValueString(folder);
        if (patch.TryGetProperty("deliveryMode", out var mode)) entity.DeliveryMode = RequireValueString(mode, "deliveryMode");
        if (patch.TryGetProperty("outputMode", out var outputMode)) entity.OutputMode = RequireValueString(outputMode, "outputMode");
        if (patch.TryGetProperty("reuseSessionId", out var reuseSessionId)) entity.ReuseSessionId = NullableValueString(reuseSessionId);
        if (patch.TryGetProperty("runMode", out var runMode)) entity.RunMode = RequireValueString(runMode, "runMode");
        if (patch.TryGetProperty("deliveryTarget", out var target)) entity.DeliveryTarget = NullableValueString(target);
        if (patch.TryGetProperty("pluginId", out var pluginId)) entity.PluginId = NullableValueString(pluginId);
        if (patch.TryGetProperty("pluginType", out var pluginType)) entity.PluginType = NullableValueString(pluginType);
        if (patch.TryGetProperty("pluginChatId", out var chatId)) entity.PluginChatId = NullableValueString(chatId);
        if (patch.TryGetProperty("deleteAfterRun", out var deleteAfterRun)) entity.DeleteAfterRun = RequireBool(deleteAfterRun, "deleteAfterRun");
        if (patch.TryGetProperty("maxIterations", out var maxIterations)) entity.MaxIterations = RequireInt(maxIterations, "maxIterations");
        if (patch.TryGetProperty("enabled", out var enabled)) entity.Enabled = RequireBool(enabled, "enabled");
    }

    private static IEnumerable<SqliteParameter> Parameters(CronEntity entity)
    {
        return new[]
        {
            new SqliteParameter("@id", entity.Id),
            new SqliteParameter("@name", entity.Name),
            new SqliteParameter("@sid", (object?)entity.SessionId ?? DBNull.Value),
            new SqliteParameter("@scope", entity.Scope),
            new SqliteParameter("@projectId", (object?)entity.ProjectId ?? DBNull.Value),
            new SqliteParameter("@schedule", entity.ScheduleJson),
            new SqliteParameter("@prompt", entity.Prompt),
            new SqliteParameter("@agent", (object?)entity.AgentId ?? DBNull.Value),
            new SqliteParameter("@model", (object?)entity.Model ?? DBNull.Value),
            new SqliteParameter("@thinkingEnabled", entity.ThinkingEnabled is bool thinkingEnabled
                ? (object)(thinkingEnabled ? 1 : 0)
                : DBNull.Value),
            new SqliteParameter("@reasoningEffort", (object?)entity.ReasoningEffort ?? DBNull.Value),
            new SqliteParameter("@folder", (object?)entity.WorkingFolder ?? DBNull.Value),
            new SqliteParameter("@deliveryMode", entity.DeliveryMode),
            new SqliteParameter("@outputMode", entity.OutputMode),
            new SqliteParameter("@reuseSessionId", (object?)entity.ReuseSessionId ?? DBNull.Value),
            new SqliteParameter("@runMode", entity.RunMode),
            new SqliteParameter("@deliveryTarget", (object?)entity.DeliveryTarget ?? DBNull.Value),
            new SqliteParameter("@pluginId", (object?)entity.PluginId ?? DBNull.Value),
            new SqliteParameter("@pluginType", (object?)entity.PluginType ?? DBNull.Value),
            new SqliteParameter("@pluginChatId", (object?)entity.PluginChatId ?? DBNull.Value),
            new SqliteParameter("@deleteAfterRun", entity.DeleteAfterRun ? 1 : 0),
            new SqliteParameter("@maxIterations", entity.MaxIterations),
            new SqliteParameter("@enabled", entity.Enabled ? 1 : 0),
            new SqliteParameter("@createdAt", entity.CreatedAt),
            new SqliteParameter("@updatedAt", entity.UpdatedAt)
        };
    }

    private static string RequireString(JsonElement parameters, string name)
        => GetNullableString(parameters, name) ?? throw new InvalidOperationException($"{name} is required");

    private static string RequireValueString(JsonElement value, string name)
        => value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString())
            ? value.GetString()!
            : throw new InvalidOperationException($"{name} must be a non-empty string");

    private static string? GetNullableString(JsonElement parameters, string name)
        => parameters.TryGetProperty(name, out var value) ? NullableValueString(value) : null;

    private static string? NullableValueString(JsonElement value)
        => value.ValueKind == JsonValueKind.Null ? null : value.ValueKind == JsonValueKind.String ? value.GetString() : throw new InvalidOperationException("Expected string value");

    private static string? GetRawJson(JsonElement parameters, string name)
        => parameters.TryGetProperty(name, out var value) ? RequireRawJson(value, name) : null;

    private static string RequireRawJson(JsonElement value, string name)
        => value.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null
            ? throw new InvalidOperationException($"{name} is required")
            : value.GetRawText();

    private static bool GetBool(JsonElement parameters, string name, bool fallback)
        => parameters.TryGetProperty(name, out var value) ? RequireBool(value, name) : fallback;

    private static bool? GetNullableBool(JsonElement parameters, string name)
        => parameters.TryGetProperty(name, out var value) ? NullableValueBool(value, name) : null;

    private static bool? NullableValueBool(JsonElement value, string name)
        => value.ValueKind == JsonValueKind.Null ? null : RequireBool(value, name);

    private static bool RequireBool(JsonElement value, string name)
        => value.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? value.GetBoolean()
            : throw new InvalidOperationException($"{name} must be boolean");

    private static int GetInt(JsonElement parameters, string name, int fallback)
        => parameters.TryGetProperty(name, out var value) ? RequireInt(value, name) : fallback;

    private static int RequireInt(JsonElement value, string name)
        => value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var result)
            ? result
            : throw new InvalidOperationException($"{name} must be an integer");

    private static long GetLong(JsonElement parameters, string name, long fallback)
        => parameters.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var result)
            ? result
            : fallback;
}

public sealed record CronFindResult(bool Success, CronRow? Cron, string? Error);
public sealed record CronMutationResult(bool Success, int Changed, CronRow? Cron, string? Error);

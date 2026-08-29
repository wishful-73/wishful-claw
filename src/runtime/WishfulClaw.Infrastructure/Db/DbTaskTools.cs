/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// DB endpoints for session-scoped agent tasks (tasks table), consumed by the
/// renderer task-store through the db:tasks:* IPC channels.
/// Contract: camelCase input params, snake_case TaskRow results.
/// </summary>
public static class DbTaskTools
{
    private const string TaskSelect = "SELECT * FROM tasks";

    public static WorkerResponse ListBySession(JsonElement parameters)
    {
        try
        {
            var sessionId = GetString(parameters, "sessionId");
            if (string.IsNullOrEmpty(sessionId))
                return WorkerResponse.Json(new TaskListResult(false, new List<TaskRow>(), "sessionId is required"), InfrastructureJsonContext.Default.TaskListResult);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var rows = db.Query(
                $"{TaskSelect} WHERE session_id = @sid ORDER BY sort_order ASC, created_at ASC",
                r => TaskRow.FromEntity(EntityMappers.MapTask(r)),
                new SqliteParameter("@sid", sessionId));
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListTaskRow);
        }
        catch (Exception ex) { WorkerLog.Error($"DbTaskTools.ListBySession failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Get(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            if (string.IsNullOrEmpty(id))
                return WorkerResponse.Json(new TaskFindResult(false, null, "id is required"), InfrastructureJsonContext.Default.TaskFindResult);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var entity = db.QueryFirstOrDefault($"{TaskSelect} WHERE id = @id", EntityMappers.MapTask,
                new SqliteParameter("@id", id));
            var row = entity != null ? TaskRow.FromEntity(entity) : null;
            return WorkerResponse.Json(new TaskFindResult(true, row, null), InfrastructureJsonContext.Default.TaskFindResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbTaskTools.Get failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Create(JsonElement parameters)
    {
        try
        {
            var sessionId = GetString(parameters, "sessionId");
            var id = GetString(parameters, "id");
            var subject = GetString(parameters, "subject");
            if (string.IsNullOrEmpty(sessionId) || string.IsNullOrEmpty(id) || string.IsNullOrEmpty(subject))
                return WorkerResponse.Json(new TaskMutationResult(false, 0, "id, sessionId and subject are required"), InfrastructureJsonContext.Default.TaskMutationResult);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var changed = db.Execute(
                "INSERT INTO tasks (id, session_id, plan_id, subject, description, active_form, status, owner, " +
                "blocks, blocked_by, metadata, sort_order, created_at, updated_at) VALUES " +
                "(@id, @sid, @pid, @subject, @description, @activeForm, @status, @owner, " +
                "@blocks, @blockedBy, @metadata, @sortOrder, @createdAt, @updatedAt)",
                new SqliteParameter("@id", id),
                new SqliteParameter("@sid", sessionId),
                new SqliteParameter("@pid", (object?)GetString(parameters, "planId") ?? DBNull.Value),
                new SqliteParameter("@subject", subject),
                new SqliteParameter("@description", GetString(parameters, "description") ?? ""),
                new SqliteParameter("@activeForm", (object?)GetString(parameters, "activeForm") ?? DBNull.Value),
                new SqliteParameter("@status", GetString(parameters, "status") ?? "pending"),
                new SqliteParameter("@owner", (object?)GetString(parameters, "owner") ?? DBNull.Value),
                new SqliteParameter("@blocks", RawArrayText(parameters, "blocks")),
                new SqliteParameter("@blockedBy", RawArrayText(parameters, "blockedBy")),
                new SqliteParameter("@metadata", (object?)RawObjectText(parameters, "metadata") ?? DBNull.Value),
                new SqliteParameter("@sortOrder", GetInt(parameters, "sortOrder")),
                new SqliteParameter("@createdAt", GetLong(parameters, "createdAt", now)),
                new SqliteParameter("@updatedAt", GetLong(parameters, "updatedAt", now)));

            return WorkerResponse.Json(new TaskMutationResult(true, changed, null), InfrastructureJsonContext.Default.TaskMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbTaskTools.Create failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Update(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            if (string.IsNullOrEmpty(id))
                return WorkerResponse.Json(new TaskMutationResult(false, 0, "id is required"), InfrastructureJsonContext.Default.TaskMutationResult);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var entity = db.QueryFirstOrDefault($"{TaskSelect} WHERE id = @id", EntityMappers.MapTask,
                new SqliteParameter("@id", id));
            if (entity == null)
                return WorkerResponse.Json(new TaskMutationResult(false, 0, "Task not found"), InfrastructureJsonContext.Default.TaskMutationResult);

            if (parameters.TryGetProperty("patch", out var patch) && patch.ValueKind == JsonValueKind.Object)
            {
                ApplyPatch(entity, patch);
            }

            var changed = db.Execute(
                "UPDATE tasks SET subject = @subject, description = @description, active_form = @activeForm, " +
                "status = @status, owner = @owner, blocks = @blocks, blocked_by = @blockedBy, " +
                "metadata = @metadata, updated_at = @ua WHERE id = @id",
                new SqliteParameter("@subject", entity.Subject),
                new SqliteParameter("@description", entity.Description),
                new SqliteParameter("@activeForm", (object?)entity.ActiveForm ?? DBNull.Value),
                new SqliteParameter("@status", entity.Status),
                new SqliteParameter("@owner", (object?)entity.Owner ?? DBNull.Value),
                new SqliteParameter("@blocks", entity.Blocks),
                new SqliteParameter("@blockedBy", entity.BlockedBy),
                new SqliteParameter("@metadata", (object?)entity.Metadata ?? DBNull.Value),
                new SqliteParameter("@ua", entity.UpdatedAt),
                new SqliteParameter("@id", id));

            return WorkerResponse.Json(new TaskMutationResult(true, changed, null), InfrastructureJsonContext.Default.TaskMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbTaskTools.Update failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Delete(JsonElement parameters)
    {
        try
        {
            var id = GetString(parameters, "id");
            if (string.IsNullOrEmpty(id))
                return WorkerResponse.Json(new TaskMutationResult(false, 0, "id is required"), InfrastructureJsonContext.Default.TaskMutationResult);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var changed = db.Execute("DELETE FROM tasks WHERE id = @id", new SqliteParameter("@id", id));
            return WorkerResponse.Json(new TaskMutationResult(true, changed, null), InfrastructureJsonContext.Default.TaskMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbTaskTools.Delete failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse DeleteBySession(JsonElement parameters)
    {
        try
        {
            var sessionId = GetString(parameters, "sessionId");
            if (string.IsNullOrEmpty(sessionId))
                return WorkerResponse.Json(new TaskMutationResult(false, 0, "sessionId is required"), InfrastructureJsonContext.Default.TaskMutationResult);

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var changed = db.Execute("DELETE FROM tasks WHERE session_id = @sid", new SqliteParameter("@sid", sessionId));
            return WorkerResponse.Json(new TaskMutationResult(true, changed, null), InfrastructureJsonContext.Default.TaskMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbTaskTools.DeleteBySession failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    // ─── Private helpers ───

    private static void ApplyPatch(TaskEntity entity, JsonElement patch)
    {
        if (patch.TryGetProperty("subject", out var subject) && subject.ValueKind == JsonValueKind.String)
            entity.Subject = subject.GetString()!;
        if (patch.TryGetProperty("description", out var description) && description.ValueKind == JsonValueKind.String)
            entity.Description = description.GetString()!;
        if (patch.TryGetProperty("activeForm", out var activeForm))
            entity.ActiveForm = activeForm.ValueKind == JsonValueKind.String ? activeForm.GetString() : null;
        if (patch.TryGetProperty("status", out var status) && status.ValueKind == JsonValueKind.String)
            entity.Status = status.GetString()!;
        if (patch.TryGetProperty("owner", out var owner))
            entity.Owner = owner.ValueKind == JsonValueKind.String ? owner.GetString() : null;
        if (patch.TryGetProperty("blocks", out var blocks) && blocks.ValueKind == JsonValueKind.Array)
            entity.Blocks = blocks.GetRawText();
        if (patch.TryGetProperty("blockedBy", out var blockedBy) && blockedBy.ValueKind == JsonValueKind.Array)
            entity.BlockedBy = blockedBy.GetRawText();
        if (patch.TryGetProperty("metadata", out var metadata))
            entity.Metadata = metadata.ValueKind == JsonValueKind.Object ? metadata.GetRawText() : null;
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

    private static int GetInt(JsonElement parameters, string name)
    {
        return parameters.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number
            ? el.GetInt32()
            : 0;
    }

    private static long GetLong(JsonElement parameters, string name, long fallback)
    {
        return parameters.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number
            ? el.GetInt64()
            : fallback;
    }

    private static string RawArrayText(JsonElement parameters, string name)
    {
        return parameters.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Array
            ? el.GetRawText()
            : "[]";
    }

    private static string? RawObjectText(JsonElement parameters, string name)
    {
        return parameters.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Object
            ? el.GetRawText()
            : null;
    }
}

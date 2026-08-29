/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using Microsoft.Data.Sqlite;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// SQL operations for the session task tools (tasks table).
/// </summary>
public static partial class AgentRuntimeTaskExecutor
{
    private const string TaskSelectSql =
        "SELECT id, session_id, plan_id, subject, description, active_form, status, owner, " +
        "blocks, blocked_by, metadata, sort_order, created_at, updated_at FROM tasks";

    /// <summary>
    /// Mutable working row used during dependency/metadata updates.
    /// Blocks/BlockedBy are parsed id arrays; MetadataJson stays as raw JSON text.
    /// </summary>
    private sealed class TaskWorkingRow
    {
        public string Id { get; set; } = string.Empty;
        public string SessionId { get; set; } = string.Empty;
        public string? PlanId { get; set; }
        public string Subject { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string? ActiveForm { get; set; }
        public string Status { get; set; } = "pending";
        public string? Owner { get; set; }
        public string[] Blocks { get; set; } = [];
        public string[] BlockedBy { get; set; } = [];
        public string? MetadataJson { get; set; }
        public int SortOrder { get; set; }
        public long CreatedAt { get; set; }
        public long UpdatedAt { get; set; }
    }

    private static TaskWorkingRow ToWorkingRow(TaskEntity e) => new()
    {
        Id = e.Id,
        SessionId = e.SessionId,
        PlanId = e.PlanId,
        Subject = e.Subject,
        Description = e.Description,
        ActiveForm = e.ActiveForm,
        Status = NormalizeStatus(e.Status),
        Owner = e.Owner,
        Blocks = ParseStringArray(e.Blocks),
        BlockedBy = ParseStringArray(e.BlockedBy),
        MetadataJson = e.Metadata,
        SortOrder = e.SortOrder,
        CreatedAt = e.CreatedAt,
        UpdatedAt = e.UpdatedAt
    };

    private static void InsertTask(DbService db, SqliteConnection conn, SqliteTransaction tx, TaskWorkingRow task)
    {
        db.Execute(conn, tx,
            "INSERT INTO tasks (id, session_id, plan_id, subject, description, active_form, status, owner, " +
            "blocks, blocked_by, metadata, sort_order, created_at, updated_at) VALUES " +
            "(@id, @sessionId, @planId, @subject, @description, @activeForm, @status, @owner, " +
            "@blocks, @blockedBy, @metadata, @sortOrder, @createdAt, @updatedAt)",
            DbService.Param("@id", task.Id),
            DbService.Param("@sessionId", task.SessionId),
            DbService.Param("@planId", task.PlanId),
            DbService.Param("@subject", task.Subject),
            DbService.Param("@description", task.Description),
            DbService.Param("@activeForm", task.ActiveForm),
            DbService.Param("@status", task.Status),
            DbService.Param("@owner", task.Owner),
            DbService.Param("@blocks", SerializeStringArray(task.Blocks)),
            DbService.Param("@blockedBy", SerializeStringArray(task.BlockedBy)),
            DbService.Param("@metadata", task.MetadataJson),
            DbService.Param("@sortOrder", task.SortOrder),
            DbService.Param("@createdAt", task.CreatedAt),
            DbService.Param("@updatedAt", task.UpdatedAt));
    }

    private static void UpdateTaskRow(DbService db, SqliteConnection conn, SqliteTransaction tx, TaskWorkingRow task)
    {
        db.Execute(conn, tx,
            "UPDATE tasks SET subject = @subject, description = @description, active_form = @activeForm, " +
            "status = @status, owner = @owner, blocks = @blocks, blocked_by = @blockedBy, " +
            "metadata = @metadata, updated_at = @updatedAt WHERE id = @id",
            DbService.Param("@subject", task.Subject),
            DbService.Param("@description", task.Description),
            DbService.Param("@activeForm", task.ActiveForm),
            DbService.Param("@status", task.Status),
            DbService.Param("@owner", task.Owner),
            DbService.Param("@blocks", SerializeStringArray(task.Blocks)),
            DbService.Param("@blockedBy", SerializeStringArray(task.BlockedBy)),
            DbService.Param("@metadata", task.MetadataJson),
            DbService.Param("@updatedAt", task.UpdatedAt),
            DbService.Param("@id", task.Id));
    }

    private static void DeleteTaskAndReferences(
        DbService db, SqliteConnection conn, SqliteTransaction tx, string taskId, string sessionId)
    {
        var sessionTasks = LoadTasksBySession(db, conn, tx, sessionId);
        db.Execute(conn, tx, "DELETE FROM tasks WHERE id = @id", DbService.Param("@id", taskId));

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var task in sessionTasks)
        {
            if (task.Id == taskId)
            {
                continue;
            }

            var nextBlocks = RemoveTaskId(task.Blocks, taskId);
            var nextBlockedBy = RemoveTaskId(task.BlockedBy, taskId);
            if (nextBlocks.Length == task.Blocks.Length && nextBlockedBy.Length == task.BlockedBy.Length)
            {
                continue;
            }

            task.Blocks = nextBlocks;
            task.BlockedBy = nextBlockedBy;
            task.UpdatedAt = now;
            UpdateTaskRow(db, conn, tx, task);
        }
    }

    private static int CountSessionTasks(DbService db, SqliteConnection conn, SqliteTransaction tx, string sessionId)
    {
        return db.QueryScalar<int>(conn, tx,
            "SELECT COUNT(*) FROM tasks WHERE session_id = @sessionId",
            DbService.Param("@sessionId", sessionId));
    }

    private static List<TaskWorkingRow> LoadTasksBySession(DbService db, string sessionId)
    {
        return db.Query(
            $"{TaskSelectSql} WHERE session_id = @sessionId ORDER BY sort_order ASC",
            r => ToWorkingRow(EntityMappers.MapTask(r)),
            DbService.Param("@sessionId", sessionId));
    }

    private static List<TaskWorkingRow> LoadTasksBySession(
        DbService db, SqliteConnection conn, SqliteTransaction tx, string sessionId)
    {
        return db.Query(conn, tx,
            $"{TaskSelectSql} WHERE session_id = @sessionId ORDER BY sort_order ASC",
            r => ToWorkingRow(EntityMappers.MapTask(r)),
            DbService.Param("@sessionId", sessionId));
    }

    private static TaskWorkingRow? LoadTask(DbService db, string taskId, string? sessionId)
    {
        var entity = string.IsNullOrEmpty(sessionId)
            ? db.QueryFirstOrDefault($"{TaskSelectSql} WHERE id = @id LIMIT 1", EntityMappers.MapTask,
                DbService.Param("@id", taskId))
            : db.QueryFirstOrDefault($"{TaskSelectSql} WHERE id = @id AND session_id = @sessionId LIMIT 1", EntityMappers.MapTask,
                DbService.Param("@id", taskId), DbService.Param("@sessionId", sessionId));
        return entity is null ? null : ToWorkingRow(entity);
    }

    private static TaskWorkingRow? LoadTask(
        DbService db, SqliteConnection conn, SqliteTransaction tx, string taskId, string? sessionId)
    {
        var entity = string.IsNullOrEmpty(sessionId)
            ? db.QueryFirstOrDefault(conn, tx, $"{TaskSelectSql} WHERE id = @id LIMIT 1", EntityMappers.MapTask,
                DbService.Param("@id", taskId))
            : db.QueryFirstOrDefault(conn, tx, $"{TaskSelectSql} WHERE id = @id AND session_id = @sessionId LIMIT 1", EntityMappers.MapTask,
                DbService.Param("@id", taskId), DbService.Param("@sessionId", sessionId));
        return entity is null ? null : ToWorkingRow(entity);
    }
}

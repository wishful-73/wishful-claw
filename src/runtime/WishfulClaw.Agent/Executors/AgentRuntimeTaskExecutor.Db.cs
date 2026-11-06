/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent.Executors;

/// <summary>
/// Todo operations for the session task tools. SQL lives in <see cref="DbTaskStore"/>; what stays
/// here is the parsed working shape (<see cref="TaskWorkingRow"/>) and the dependency-graph
/// bookkeeping around it.
/// </summary>
public static partial class AgentRuntimeTaskExecutor
{
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

    private static TaskEntity ToEntity(TaskWorkingRow task) => new()
    {
        Id = task.Id,
        SessionId = task.SessionId,
        PlanId = task.PlanId,
        Subject = task.Subject,
        Description = task.Description,
        ActiveForm = task.ActiveForm,
        Status = task.Status,
        Owner = task.Owner,
        Blocks = SerializeStringArray(task.Blocks),
        BlockedBy = SerializeStringArray(task.BlockedBy),
        Metadata = task.MetadataJson,
        SortOrder = task.SortOrder,
        CreatedAt = task.CreatedAt,
        UpdatedAt = task.UpdatedAt
    };

    private static void InsertTask(DbService db, SqliteConnection conn, SqliteTransaction tx, TaskWorkingRow task) =>
        DbTaskStore.Insert(db, conn, tx, ToEntity(task));

    private static void UpdateTaskRow(DbService db, SqliteConnection conn, SqliteTransaction tx, TaskWorkingRow task) =>
        DbTaskStore.UpdateRow(db, conn, tx, ToEntity(task));

    private static void DeleteTaskAndReferences(
        DbService db, SqliteConnection conn, SqliteTransaction tx, string taskId, string sessionId)
    {
        var sessionTasks = LoadTasksBySession(db, conn, tx, sessionId);
        DbTaskStore.DeleteById(db, conn, tx, taskId);

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

    private static int CountSessionTasks(DbService db, SqliteConnection conn, SqliteTransaction tx, string sessionId) =>
        DbTaskStore.CountBySession(db, conn, tx, sessionId);

    private static List<TaskWorkingRow> LoadTasksBySession(DbService db, string sessionId) =>
        DbTaskStore.ListBySession(db, sessionId).ConvertAll(ToWorkingRow);

    private static List<TaskWorkingRow> LoadTasksBySession(
        DbService db, SqliteConnection conn, SqliteTransaction tx, string sessionId) =>
        DbTaskStore.ListBySession(db, conn, tx, sessionId).ConvertAll(ToWorkingRow);

    /// <summary>
    /// 读取会话 todo 的只读快照，供 AgentLoop 每轮把现状注入上下文（iter-30 S-44）。
    ///
    /// 与上面几个 Load* 的区别：只读、不走事务、按 sort_order 排序、返回公开 DTO。
    /// 注入是「尽力而为」的旁路 —— 任何异常都吞掉返回 null，绝不能因为读 todo 失败而拖垮 agent run。
    /// </summary>
    internal static IReadOnlyList<TaskRow>? LoadSessionTodoSnapshot(JsonElement parameters, string? sessionId)
    {
        if (string.IsNullOrWhiteSpace(sessionId))
        {
            return null;
        }

        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var rows = DbTaskStore.ListBySession(db, sessionId).ConvertAll(TaskRow.FromEntity);
            return rows.Count == 0 ? null : rows;
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"session todo snapshot failed sessionId={sessionId} error={ex.GetType().Name}: {ex.Message}");
            return null;
        }
    }

    private static TaskWorkingRow? LoadTask(DbService db, string taskId, string? sessionId)
    {
        var entity = DbTaskStore.GetById(db, taskId, sessionId);
        return entity is null ? null : ToWorkingRow(entity);
    }

    private static TaskWorkingRow? LoadTask(
        DbService db, SqliteConnection conn, SqliteTransaction tx, string taskId, string? sessionId)
    {
        var entity = DbTaskStore.GetById(db, conn, tx, taskId, sessionId);
        return entity is null ? null : ToWorkingRow(entity);
    }
}

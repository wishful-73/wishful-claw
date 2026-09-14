/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Todo task tool executor — TodoTaskCreate/Get/Update/List (SQLite-backed, OpenCowork semantics).
/// Session-scoped agent Todo: five statuses, dependency links, metadata merge, "deleted" = physical delete.
/// Split files: AgentRuntimeTaskExecutor.Db.cs (SQL), AgentRuntimeTaskExecutor.Codec.cs (JSON encoding/parsing).
/// </summary>
public static partial class AgentRuntimeTaskExecutor
{
    private static readonly HashSet<string> TaskToolNames = new(StringComparer.Ordinal)
    {
        "TodoTaskCreate", "TodoTaskGet", "TodoTaskUpdate", "TodoTaskList",
        // Legacy names kept for routing old persisted transcripts.
        "TaskCreate", "TaskGet", "TaskUpdate", "TaskList"
    };

    public static bool IsTaskTool(string toolName)
    {
        return TaskToolNames.Contains(toolName);
    }

    public static string Execute(AgentRuntimeNativeToolCall call, JsonElement parameters)
    {
        try
        {
            return call.Name switch
            {
                "TodoTaskCreate" or "TaskCreate" => ExecuteCreate(call.Input, parameters),
                "TodoTaskGet" or "TaskGet" => ExecuteGet(call.Input, parameters),
                "TodoTaskUpdate" or "TaskUpdate" => ExecuteUpdate(call.Input, parameters),
                "TodoTaskList" or "TaskList" => ExecuteList(parameters),
                _ => EncodeError($"Native task tool not registered: {call.Name}")
            };
        }
        catch (Exception ex)
        {
            return EncodeError($"Task tool execution failed: {ex.Message}");
        }
    }

    private static string ExecuteCreate(JsonElement input, JsonElement parameters)
    {
        var sessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim();
        if (string.IsNullOrEmpty(sessionId))
        {
            return EncodeError("No active session context for TodoTaskCreate.");
        }

        var subject = ResolveTaskTitle(input);
        if (subject.Length == 0)
        {
            return EncodeError("TodoTaskCreate requires a non-empty title.");
        }

        DbClient.EnsureInitialized(parameters);
        var db = DbClient.GetClient(parameters);

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var task = new TaskWorkingRow
        {
            Id = CreateTaskId(),
            SessionId = sessionId,
            Subject = subject,
            ActiveForm = JsonHelpers.GetString(input, "activeForm"),
            Status = "pending",
            MetadataJson = GetObjectRawJson(input, "metadata"),
            CreatedAt = now,
            UpdatedAt = now
        };

        db.ExecuteInTransaction((conn, tx) =>
        {
            task.SortOrder = CountSessionTasks(db, conn, tx, sessionId);
            InsertTask(db, conn, tx, task);
        });

        var tasks = LoadTasksBySession(db, sessionId);
        DbAgentTimelineTools.Log(db, sessionId, null, "todo_created",
            subject, $"{{\"task_id\":\"{task.Id}\"}}");
        return EncodeTaskCreateResult(task, tasks);
    }

    private static string ExecuteGet(JsonElement input, JsonElement parameters)
    {
        var sessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim();
        if (string.IsNullOrEmpty(sessionId))
        {
            return EncodeError("No active session context for TodoTaskGet.");
        }

        var taskId = GetTaskId(input);
        if (taskId.Length == 0)
        {
            return EncodeError("TodoTaskGet requires taskId.");
        }

        DbClient.EnsureInitialized(parameters);
        var db = DbClient.GetClient(parameters);

        var task = LoadTask(db, taskId, sessionId);
        return task is null
            ? EncodeError($"Task \"{taskId}\" not found")
            : EncodeTaskGetResult(task);
    }

    private static string ExecuteUpdate(JsonElement input, JsonElement parameters)
    {
        var sessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim();
        if (string.IsNullOrEmpty(sessionId))
        {
            return EncodeError("No active session context for TodoTaskUpdate.");
        }

        var taskId = GetTaskId(input);
        if (taskId.Length == 0)
        {
            return EncodeError("TodoTaskUpdate requires taskId.");
        }

        DbClient.EnsureInitialized(parameters);
        var db = DbClient.GetClient(parameters);

        // Timeline instrumentation (S-25.4): captured inside the transaction,
        // written after it commits so the event never survives a rollback.
        string? timelineType = null;
        string? timelineMessage = null;
        string? timelineMeta = null;

        var result = db.ExecuteInTransaction((conn, tx) =>
        {
            var task = LoadTask(db, conn, tx, taskId, sessionId);
            if (task is null)
            {
                return EncodeError($"Task \"{taskId}\" not found");
            }

            var newStatus = JsonHelpers.GetString(input, "status");
            if (newStatus == "deleted")
            {
                timelineType = "todo_deleted";
                timelineMessage = task.Subject;
                timelineMeta = $"{{\"task_id\":\"{taskId}\"}}";
                DeleteTaskAndReferences(db, conn, tx, taskId, task.SessionId);
                return EncodeJsonObject(writer =>
                {
                    writer.WriteBoolean("success", true);
                    writer.WriteString("task_id", taskId);
                    writer.WriteBoolean("deleted", true);
                });
            }

            var changedFields = new List<string>();
            if (newStatus is "pending" or "in_progress" or "blocked" or "in_review" or "completed")
            {
                if (task.Status != newStatus)
                {
                    timelineType = "todo_status_changed";
                    timelineMessage = task.Subject;
                    timelineMeta = $"{{\"task_id\":\"{taskId}\",\"from\":\"{task.Status}\",\"to\":\"{newStatus}\"}}";
                }
                task.Status = newStatus;
                changedFields.Add("status");
            }

            if (HasAnyProperty(input, "title", "subject", "description"))
            {
                var nextTitle = ResolveTaskTitle(input, task.Subject);
                if (nextTitle.Length > 0 && nextTitle != task.Subject)
                {
                    task.Subject = nextTitle;
                    changedFields.Add("subject");
                }
            }

            if (input.TryGetProperty("activeForm", out var activeForm))
            {
                task.ActiveForm = activeForm.ValueKind == JsonValueKind.Null ? null : activeForm.ToString();
                changedFields.Add("activeForm");
            }

            if (input.TryGetProperty("owner", out var owner))
            {
                task.Owner = owner.ValueKind == JsonValueKind.Null ? null : owner.ToString();
                changedFields.Add("owner");
            }

            var addBlocks = GetStringArray(input, "addBlocks");
            if (addBlocks.Length > 0)
            {
                task.Blocks = Union(task.Blocks, addBlocks);
                changedFields.Add("blocks");
                foreach (var blockedId in addBlocks)
                {
                    if (LoadTask(db, conn, tx, blockedId, task.SessionId) is { } blocked)
                    {
                        blocked.BlockedBy = Union(blocked.BlockedBy, [taskId]);
                        blocked.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                        UpdateTaskRow(db, conn, tx, blocked);
                    }
                }
            }

            var addBlockedBy = GetStringArray(input, "addBlockedBy");
            if (addBlockedBy.Length > 0)
            {
                task.BlockedBy = Union(task.BlockedBy, addBlockedBy);
                changedFields.Add("blockedBy");
                foreach (var dependencyId in addBlockedBy)
                {
                    if (LoadTask(db, conn, tx, dependencyId, task.SessionId) is { } dependency)
                    {
                        dependency.Blocks = Union(dependency.Blocks, [taskId]);
                        dependency.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                        UpdateTaskRow(db, conn, tx, dependency);
                    }
                }
            }

            if (input.TryGetProperty("metadata", out var metadata) && metadata.ValueKind == JsonValueKind.Object)
            {
                task.MetadataJson = MergeMetadataJson(task.MetadataJson, metadata);
                changedFields.Add("metadata");
            }

            task.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            UpdateTaskRow(db, conn, tx, task);
            return EncodeTaskUpdateResult(task, LoadTasksBySession(db, conn, tx, task.SessionId), changedFields);
        });

        if (timelineType is not null)
        {
            DbAgentTimelineTools.Log(db, sessionId, null, timelineType, timelineMessage, timelineMeta);
        }

        return result;
    }

    private static string ExecuteList(JsonElement parameters)
    {
        var sessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim();
        if (string.IsNullOrEmpty(sessionId))
        {
            return EncodeJsonObject(writer =>
            {
                writer.WriteString("mode", "standalone");
                writer.WriteNumber("total", 0);
                writer.WriteStartArray("tasks");
                writer.WriteEndArray();
            });
        }

        DbClient.EnsureInitialized(parameters);
        var db = DbClient.GetClient(parameters);
        return EncodeTaskListResult(LoadTasksBySession(db, sessionId));
    }
}

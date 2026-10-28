/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License");
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json.Serialization.Metadata;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Mutating session endpoints: create, update, delete, clear-all, reset conversation, reset usage stats.
/// Split out per AGENTS.md 大文件拆分 (2026-10-28); bodies moved verbatim.
/// </summary>
public static partial class DbSessionTools
{
    public static WorkerResponse Create(JsonElement parameters)
    {
        try
        {
            var input = ReadSessionInput(parameters);
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            ApplyProjectDefaults(db, input);

            db.Execute(
                "INSERT INTO sessions (id, title, icon, mode, scope, collaboration_mode, permission_mode, " +
                "context_cap_tokens, context_cap_model_id, compression_threshold, " +
                "created_at, updated_at, message_count, project_id, working_folder, ssh_connection_id, plan_id, " +
                "pinned, plugin_id, external_chat_id, provider_id, model_id, model_selection_mode, persona_id) " +
                "VALUES (@id, @title, @icon, @mode, @scope, @collab, @permission, @cap, @capModel, @threshold, @ca, @ua, 0, @pid, @wf, " +
                "@ssh, @plan, @pinned, @plugin, @ext, @prov, @model, @msm, @persona)",
                new SqliteParameter("@id", input.Id),
                new SqliteParameter("@title", input.Title),
                new SqliteParameter("@icon", (object?)input.Icon ?? DBNull.Value),
                new SqliteParameter("@mode", input.Mode),
                new SqliteParameter("@scope", (object?)input.Scope ?? DBNull.Value),
                new SqliteParameter("@collab", (object?)input.CollaborationMode ?? DBNull.Value),
                new SqliteParameter("@permission", (object?)input.PermissionMode ?? DBNull.Value),
                new SqliteParameter("@cap", input.ContextCapTokens),
                new SqliteParameter("@capModel", (object?)input.ContextCapModelId ?? DBNull.Value),
                new SqliteParameter("@threshold", input.CompressionThreshold),
                new SqliteParameter("@ca", input.CreatedAt),
                new SqliteParameter("@ua", input.UpdatedAt),
                new SqliteParameter("@pid", (object?)input.ProjectId ?? DBNull.Value),
                new SqliteParameter("@wf", (object?)input.WorkingFolder ?? DBNull.Value),
                new SqliteParameter("@ssh", (object?)input.SshConnectionId ?? DBNull.Value),
                new SqliteParameter("@plan", (object?)input.PlanId ?? DBNull.Value),
                new SqliteParameter("@pinned", input.Pinned),
                new SqliteParameter("@plugin", (object?)input.PluginId ?? DBNull.Value),
                new SqliteParameter("@ext", (object?)input.ExternalChatId ?? DBNull.Value),
                new SqliteParameter("@prov", (object?)input.ProviderId ?? DBNull.Value),
                new SqliteParameter("@model", (object?)input.ModelId ?? DBNull.Value),
                new SqliteParameter("@msm", input.ModelSelectionMode),
                new SqliteParameter("@persona", (object?)input.PersonaId ?? DBNull.Value));
            return Mutation(1);
        }
        catch (Exception ex)
        {
            return MutationError(ex.Message);
        }
    }

    public static WorkerResponse Update(JsonElement parameters)
    {
        try
        {
            var id = RequireString(parameters, "id");
            if (!parameters.TryGetProperty("patch", out var patch) || patch.ValueKind != JsonValueKind.Object)
            {
                return Mutation(0);
            }

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var current = db.QueryFirstOrDefault(
                "SELECT * FROM sessions WHERE id = @id",
                EntityMappers.MapSession,
                new SqliteParameter("@id", id));
            if (current is null)
            {
                return Mutation(0);
            }

            ApplySessionPatch(patch, current);
            var changed = db.Execute(
                "UPDATE sessions SET title = @title, icon = @icon, mode = @mode, scope = @scope, " +
                "collaboration_mode = @collab, permission_mode = @permission, " +
                "context_cap_tokens = @cap, context_cap_model_id = @capModel, compression_threshold = @threshold, " +
                "updated_at = @ua, " +
                "project_id = @pid, working_folder = @wf, ssh_connection_id = @ssh, plan_id = @plan, " +
                "plugin_id = @plugin, provider_id = @prov, model_id = @model, " +
                "model_selection_mode = @msm, persona_id = @persona, pinned = @pinned WHERE id = @id",
                new SqliteParameter("@title", current.Title),
                new SqliteParameter("@icon", (object?)current.Icon ?? DBNull.Value),
                new SqliteParameter("@mode", current.Mode),
                new SqliteParameter("@scope", (object?)current.Scope ?? DBNull.Value),
                new SqliteParameter("@collab", (object?)current.CollaborationMode ?? DBNull.Value),
                new SqliteParameter("@permission", (object?)current.PermissionMode ?? DBNull.Value),
                new SqliteParameter("@cap", current.ContextCapTokens),
                new SqliteParameter("@capModel", (object?)current.ContextCapModelId ?? DBNull.Value),
                new SqliteParameter("@threshold", current.CompressionThreshold),
                new SqliteParameter("@ua", current.UpdatedAt),
                new SqliteParameter("@pid", (object?)current.ProjectId ?? DBNull.Value),
                new SqliteParameter("@wf", (object?)current.WorkingFolder ?? DBNull.Value),
                new SqliteParameter("@ssh", (object?)current.SshConnectionId ?? DBNull.Value),
                new SqliteParameter("@plan", (object?)current.PlanId ?? DBNull.Value),
                new SqliteParameter("@plugin", (object?)current.PluginId ?? DBNull.Value),
                new SqliteParameter("@prov", (object?)current.ProviderId ?? DBNull.Value),
                new SqliteParameter("@model", (object?)current.ModelId ?? DBNull.Value),
                new SqliteParameter("@msm", current.ModelSelectionMode),
                new SqliteParameter("@persona", (object?)current.PersonaId ?? DBNull.Value),
                new SqliteParameter("@pinned", current.Pinned),
                new SqliteParameter("@id", id));
            return Mutation(changed);
        }
        catch (Exception ex)
        {
            return MutationError(ex.Message);
        }
    }

    public static WorkerResponse Delete(JsonElement parameters)
    {
        try
        {
            var id = RequireString(parameters, "id");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            db.ExecuteInTransaction((conn, tx) =>
            {
                db.Execute(conn, tx, "DELETE FROM messages WHERE session_id = @id", new SqliteParameter("@id", id));
                db.Execute(conn, tx, "DELETE FROM tasks WHERE session_id = @id", new SqliteParameter("@id", id));
                DbCompactionSnapshotStore.DetachForSession(db, conn, tx, id);
            });
            var changed = db.Execute("DELETE FROM sessions WHERE id = @id", new SqliteParameter("@id", id));
            return Mutation(changed);
        }
        catch (Exception ex)
        {
            return MutationError(ex.Message);
        }
    }

    public static WorkerResponse ClearAll(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var sessionIds = db.Query(
                "SELECT id FROM sessions WHERE plugin_id IS NULL",
                r => r.GetString("id"));

            if (sessionIds.Count > 0)
            {
                db.ExecuteInTransaction((conn, tx) =>
                {
                    var placeholders = string.Join(",", sessionIds.Select((_, i) => $"@s{i}"));
                    var msgParams = sessionIds.Select((sid, i) => new SqliteParameter($"@s{i}", sid)).ToArray();
                    db.Execute(conn, tx, $"DELETE FROM messages WHERE session_id IN ({placeholders})", msgParams);
                    db.Execute(conn, tx, $"DELETE FROM tasks WHERE session_id IN ({placeholders})",
                        sessionIds.Select((sid, i) => new SqliteParameter($"@s{i}", sid)).ToArray());
                    DbCompactionSnapshotStore.DetachForSessions(db, conn, tx, sessionIds);
                });
            }

            var deletedSessions = db.Execute("DELETE FROM sessions WHERE plugin_id IS NULL");

            return WorkerResponse.Json(
                new SessionClearAllResult(true, sessionIds, sessionIds.Count, deletedSessions, null), InfrastructureJsonContext.Default.SessionClearAllResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(
                new SessionClearAllResult(false, new List<string>(), 0, 0, ex.Message), InfrastructureJsonContext.Default.SessionClearAllResult);
        }
    }

    // ─── Private helpers ───

    public static WorkerResponse ResetConversation(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            var updatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var deleted = db.ExecuteInTransaction((conn, tx) =>
            {
                var removed = db.Execute(conn, tx,
                    "DELETE FROM messages WHERE session_id = @id",
                    new SqliteParameter("@id", sessionId));
                // Resetting the conversation also drops the session's agent Todo
                // list — a fresh conversation must not inherit stale Todos.
                db.Execute(conn, tx,
                    "DELETE FROM tasks WHERE session_id = @id",
                    new SqliteParameter("@id", sessionId));
                DbCompactionSnapshotStore.DetachForSession(db, conn, tx, sessionId);
                return removed;
            });

            db.Execute(
                "UPDATE sessions SET title = @title, updated_at = @ua, message_count = 0 WHERE id = @id",
                new SqliteParameter("@title", "New Conversation"),
                new SqliteParameter("@ua", updatedAt),
                new SqliteParameter("@id", sessionId));

            return WorkerResponse.Json(new SessionResetResult(true, deleted, updatedAt, null), InfrastructureJsonContext.Default.SessionResetResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(new SessionResetResult(false, 0, 0, ex.Message), InfrastructureJsonContext.Default.SessionResetResult);
        }
    }

    /// <summary>
    /// S-193：把会话的用量统计清零 —— 只写一个起点时间戳，不删消息、不动 messages.usage。
    /// 聚合端点 db/messages-usage-stats 只统计 created_at 晚于该值的消息，因此重置对重启同样生效。
    /// </summary>
    public static WorkerResponse ResetUsageStats(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            var resetAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var changed = db.Execute(
                "UPDATE sessions SET usage_stats_reset_at = @at WHERE id = @id",
                new SqliteParameter("@at", resetAt),
                new SqliteParameter("@id", sessionId));

            return WorkerResponse.Json(
                new SessionUsageResetResult(true, changed > 0, resetAt, null),
                InfrastructureJsonContext.Default.SessionUsageResetResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(
                new SessionUsageResetResult(false, false, 0, ex.Message),
                InfrastructureJsonContext.Default.SessionUsageResetResult);
        }
    }
}

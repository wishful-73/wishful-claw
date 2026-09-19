/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json.Serialization.Metadata;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Infrastructure.Db;

public static class DbSessionTools
{
    public static WorkerResponse List(JsonElement parameters)
    {
        try
        {
            var limit = Math.Clamp(JsonHelpers.GetInt(parameters, "limit", 2000), 1, 10_000);
            var offset = Math.Max(0, JsonHelpers.GetInt(parameters, "offset", 0));
            var hasProjectFilter = parameters.TryGetProperty("projectId", out var projectIdValue);
            var projectId = hasProjectFilter && projectIdValue.ValueKind != JsonValueKind.Null
                ? JsonHelpers.GetString(parameters, "projectId")
                : null;

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            string sql;
            SqliteParameter[] sqlParams;

            if (hasProjectFilter)
            {
                if (projectId is null)
                {
                    sql = "SELECT * FROM sessions WHERE project_id IS NULL ORDER BY updated_at DESC LIMIT @limit OFFSET @offset";
                }
                else
                {
                    sql = "SELECT * FROM sessions WHERE project_id = @pid ORDER BY updated_at DESC LIMIT @limit OFFSET @offset";
                }
                sqlParams = projectId is null
                    ? [new("@limit", limit), new("@offset", offset)]
                    : [new("@pid", projectId), new("@limit", limit), new("@offset", offset)];
            }
            else
            {
                sql = "SELECT * FROM sessions ORDER BY updated_at DESC LIMIT @limit OFFSET @offset";
                sqlParams = [new("@limit", limit), new("@offset", offset)];
            }

            var entities = db.Query(sql, EntityMappers.MapSession, sqlParams);
            var rows = entities.Select(SessionRow.FromEntity).ToList();
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListSessionRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbSessionTools.List failed: {ex.GetType().Name}: {ex.Message} | StackTrace: {ex.StackTrace}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse Get(JsonElement parameters)
    {
        try
        {
            var id = RequireString(parameters, "id");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var entity = db.QueryFirstOrDefault(
                "SELECT * FROM sessions WHERE id = @id",
                EntityMappers.MapSession,
                new SqliteParameter("@id", id));
            return WorkerResponse.Json(new SessionFindResult(true, entity is null ? null : SessionRow.FromEntity(entity), null), InfrastructureJsonContext.Default.SessionFindResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(new SessionFindResult(false, null, ex.Message), InfrastructureJsonContext.Default.SessionFindResult);
        }
    }

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

    public static WorkerResponse Status(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var session = db.QueryFirstOrDefault(
                "SELECT * FROM sessions WHERE id = @id",
                EntityMappers.MapSession,
                new SqliteParameter("@id", sessionId));
            if (session is null)
            {
                return WorkerResponse.Json(new SessionStatusResult(true, false, null, null, null, 0, null), InfrastructureJsonContext.Default.SessionStatusResult);
            }

            var messageCount = db.QueryScalar<int>(
                "SELECT COUNT(*) FROM messages WHERE session_id = @id",
                new SqliteParameter("@id", sessionId));

            return WorkerResponse.Json(new SessionStatusResult(
                true, true, session.Title, session.CreatedAt, session.UpdatedAt, messageCount, null), InfrastructureJsonContext.Default.SessionStatusResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(new SessionStatusResult(false, false, null, null, null, 0, ex.Message), InfrastructureJsonContext.Default.SessionStatusResult);
        }
    }

    private static SessionEntity ReadSessionInput(JsonElement parameters)
    {
        var providerId = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "providerId"));
        var modelId = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "modelId"));
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        // 上限只在设它的那个模型上生效，所以 tokens 与 model id 必须成对写入；
        // tokens <= 0 表示「不限制」，此时 model id 不写。
        var contextCapTokens = JsonHelpers.GetInt(parameters, "contextCapTokens", 0);
        var input = new SessionEntity
        {
            Id = RequireString(parameters, "id"),
            Title = RequireString(parameters, "title"),
            Icon = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "icon")),
            Mode = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "mode")) ?? "chat",
            Scope = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "scope")),
            CollaborationMode = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "collaborationMode")),
            PermissionMode = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "permissionMode")),
            // tokens <= 0 = 不限制，不写 model id（留着会让人以为上限还在）。
            ContextCapTokens = contextCapTokens > 0 ? contextCapTokens : 0,
            ContextCapModelId = contextCapTokens > 0
                ? DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "contextCapModelId"))
                : null,
            // 压缩阈值（iter-32 S-85）：0 = 跟随全局；只记 0.3~0.9 的合法值。
            CompressionThreshold = NormalizeCompressionThreshold(
                JsonHelpers.GetDoubleNullable(parameters, "compressionThreshold") ?? 0),
            CreatedAt = JsonHelpers.GetLong(parameters, "createdAt", now),
            UpdatedAt = JsonHelpers.GetLong(parameters, "updatedAt", now),
            MessageCount = 0,
            ProjectId = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "projectId")),
            WorkingFolder = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "workingFolder")),
            SshConnectionId = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "sshConnectionId")),
            PlanId = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "planId")),
            Pinned = JsonHelpers.GetBool(parameters, "pinned", false) ? 1 : 0,
            PluginId = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "pluginId")),
            ProviderId = providerId,
            ModelId = modelId,
            ModelSelectionMode = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "modelSelectionMode")) ??
                (providerId is not null && modelId is not null ? "manual" : "inherit"),
            PersonaId = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "personaId"))
        };
        NormalizeSessionContext(input);
        return input;
    }

    private static void ApplyProjectDefaults(DbService db, SessionEntity input)
    {
        if (input.ProjectId is null ||
            (input.WorkingFolder is not null && input.SshConnectionId is not null))
        {
            return;
        }

        var project = db.QueryFirstOrDefault(
            "SELECT * FROM projects WHERE id = @id",
            EntityMappers.MapProject,
            new SqliteParameter("@id", input.ProjectId));
        if (project is null) return;

        input.WorkingFolder ??= project.WorkingFolder;
        input.SshConnectionId ??= project.SshConnectionId;
    }

    private static void ApplySessionPatch(JsonElement patch, SessionEntity row)
    {
        TryPatchString(patch, "title", v => row.Title = v);
        TryPatchString(patch, "icon", v => row.Icon = v);
        TryPatchString(patch, "mode", v => row.Mode = v);
        TryPatchNullableString(patch, "scope", v => row.Scope = v);
        TryPatchNullableString(patch, "collaborationMode", v => row.CollaborationMode = v);
        TryPatchNullableString(patch, "permissionMode", v => row.PermissionMode = v);

        if (JsonHelpers.GetLongNullable(patch, "updatedAt") is { } updatedAt)
        {
            row.UpdatedAt = updatedAt;
        }
        else
        {
            row.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        TryPatchNullableString(patch, "projectId", v => row.ProjectId = v);
        TryPatchNullableString(patch, "workingFolder", v => row.WorkingFolder = v);
        TryPatchNullableString(patch, "sshConnectionId", v => row.SshConnectionId = v);
        TryPatchNullableString(patch, "planId", v => row.PlanId = v);
        TryPatchNullableString(patch, "pluginId", v => row.PluginId = v);
        TryPatchNullableString(patch, "providerId", v => row.ProviderId = v);
        TryPatchNullableString(patch, "modelId", v => row.ModelId = v);
        TryPatchNullableString(patch, "modelSelectionMode", v => row.ModelSelectionMode = v ?? "inherit");
        TryPatchNullableString(patch, "personaId", v => row.PersonaId = v);

        if (patch.TryGetProperty("pinned", out var pinnedEl))
        {
            row.Pinned = pinnedEl.ValueKind switch
            {
                JsonValueKind.True => 1,
                JsonValueKind.False => 0,
                JsonValueKind.Number when pinnedEl.TryGetInt32(out var v) => v == 0 ? 0 : 1,
                _ => row.Pinned
            };
        }

        if (patch.TryGetProperty("contextCapTokens", out var capEl))
        {
            var capTokens = capEl.ValueKind switch
            {
                JsonValueKind.Number when capEl.TryGetInt32(out var v) && v > 0 => v,
                _ => 0
            };
            row.ContextCapTokens = capTokens;
            if (capTokens > 0)
            {
                if (patch.TryGetProperty("contextCapModelId", out var capModelEl) &&
                    capModelEl.ValueKind == JsonValueKind.String)
                {
                    row.ContextCapModelId = DbProjectTools.NormalizeOptional(capModelEl.GetString());
                }
            }
            else
            {
                row.ContextCapModelId = null;
            }
        }

        if (patch.TryGetProperty("compressionThreshold", out var thresholdEl))
        {
            // 非数字 / 越界一律回落 0 = 跟随全局，不保留脏值。
            row.CompressionThreshold = thresholdEl.ValueKind == JsonValueKind.Number &&
                                       thresholdEl.TryGetDouble(out var threshold)
                ? NormalizeCompressionThreshold(threshold)
                : 0;
        }

        NormalizeSessionContext(row);
    }

    /// <summary>
    /// 会话级压缩阈值（iter-32 S-85）的合法区间，与全局设置的钳制口径一致。
    /// 落在区间外或非有限值一律当「没设」，返回 0 = 跟随全局。
    /// </summary>
    internal const double MinSessionCompressionThreshold = 0.3;
    internal const double MaxSessionCompressionThreshold = 0.9;

    private static double NormalizeCompressionThreshold(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value))
        {
            return 0;
        }

        return value >= MinSessionCompressionThreshold && value <= MaxSessionCompressionThreshold
            ? value
            : 0;
    }

    private static void NormalizeSessionContext(SessionEntity session)
    {
        session.Scope = session.Scope is "global" or "project"
            ? session.Scope
            : session.ProjectId is null ? "global" : "project";

        if (session.Scope == "global")
        {
            session.CollaborationMode = "chat";
            // Permission mode is independent of collaboration mode (iter-31 S-59): a
            // global/chat session may store fullAccess too. Only unknown or missing
            // values fall back to "default"; the renderer forces "default" for channel
            // sessions at send time, so this cannot be used to un-gate a channel.
            session.PermissionMode = NormalizePermissionMode(session.PermissionMode);
            session.ProjectId = null;
            session.WorkingFolder = null;
            session.SshConnectionId = null;
            return;
        }

        if (session.ProjectId is null)
        {
            throw new InvalidOperationException("Project sessions require projectId.");
        }

        session.CollaborationMode = session.CollaborationMode is "chat" or "cowork"
            ? session.CollaborationMode
            : "cowork";
        session.PermissionMode = NormalizePermissionMode(session.PermissionMode);
    }

    /// <summary>
    /// 权限档与协作模式解绑后，存储层只做合法性校验：default / fullAccess 原样保留，
    /// 其余（含 NULL）一律回落 default。缺省值仍由渲染端按协作模式给出。
    /// </summary>
    private static string NormalizePermissionMode(string? permissionMode)
    {
        return permissionMode is "default" or "fullAccess" ? permissionMode : "default";
    }

    private static void TryPatchString(JsonElement patch, string name, Action<string> setter)
    {
        if (patch.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String)
        {
            var v = el.GetString();
            if (!string.IsNullOrEmpty(v)) setter(v);
        }
    }

    private static void TryPatchNullableString(JsonElement patch, string name, Action<string?> setter)
    {
        if (patch.TryGetProperty(name, out var el))
        {
            setter(el.ValueKind == JsonValueKind.String
                ? DbProjectTools.NormalizeOptional(el.GetString())
                : null);
        }
    }

    private static string RequireString(JsonElement parameters, string name)
    {
        return JsonHelpers.GetString(parameters, name) is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException($"Missing required field: {name}");
    }

    private static WorkerResponse Mutation(int changed)
    {
        return WorkerResponse.Json(new SessionMutationResult(true, changed, null), InfrastructureJsonContext.Default.SessionMutationResult);
    }

    private static WorkerResponse MutationError(string error)
    {
        return WorkerResponse.Json(new SessionMutationResult(false, 0, error), InfrastructureJsonContext.Default.SessionMutationResult);
    }
}

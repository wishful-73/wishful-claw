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

public static class DbPluginSessionTools
{
    internal const string PlaceholderNewConversation = "New Conversation";
    internal const string PlaceholderNewChat = "New Chat";

    public static WorkerResponse ListNormalProjects(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var entities = db.Query(
                "SELECT * FROM projects WHERE plugin_id IS NULL OR plugin_id = '' ORDER BY pinned DESC, updated_at DESC",
                EntityMappers.MapProject);
            var rows = entities.Select(e => new PluginProjectRow
            { Id = e.Id, Name = e.Name, WorkingFolder = e.WorkingFolder, SshConnectionId = e.SshConnectionId,
              PluginId = e.PluginId, Pinned = e.Pinned, CreatedAt = e.CreatedAt, UpdatedAt = e.UpdatedAt }).ToList();
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListPluginProjectRow);
        }
        catch (Exception ex) { return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse SyncPluginSessionModels(JsonElement parameters)
    {
        try
        {
            var pluginId = RequireString(parameters, "pluginId");
            var providerId = NormalizeOptional(JsonHelpers.GetString(parameters, "providerId"));
            var modelId = providerId is null ? null : NormalizeOptional(JsonHelpers.GetString(parameters, "modelId"));
            var modelSelectionMode = providerId is not null && modelId is not null ? "manual" : "inherit";
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var changed = db.Execute(
                "UPDATE sessions SET provider_id = @prov, model_id = @model, model_selection_mode = @msm WHERE plugin_id = @pid",
                new SqliteParameter("@prov", (object?)providerId ?? DBNull.Value),
                new SqliteParameter("@model", (object?)modelId ?? DBNull.Value),
                new SqliteParameter("@msm", modelSelectionMode),
                new SqliteParameter("@pid", pluginId));
            return Mutation(changed, 0);
        }
        catch (Exception ex) { return MutationError(ex.Message); }
    }

    public static WorkerResponse SyncPluginSessionProject(JsonElement parameters)
    {
        try
        {
            var pluginId = RequireString(parameters, "pluginId");
            var projectId = NormalizeOptional(JsonHelpers.GetString(parameters, "projectId"));
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            string? workingFolder = null, sshConnectionId = null;
            if (projectId is not null)
            {
                var project = db.QueryFirstOrDefault("SELECT * FROM projects WHERE id = @id", EntityMappers.MapProject,
                    new SqliteParameter("@id", projectId));
                if (project is not null) { workingFolder = EmptyToNull(project.WorkingFolder); sshConnectionId = project.SshConnectionId; }
            }
            var changed = db.Execute(
                "UPDATE sessions SET project_id = @pid, working_folder = @wf, ssh_connection_id = @ssh WHERE plugin_id = @plugin",
                new SqliteParameter("@pid", (object?)projectId ?? DBNull.Value),
                new SqliteParameter("@wf", (object?)workingFolder ?? DBNull.Value),
                new SqliteParameter("@ssh", (object?)sshConnectionId ?? DBNull.Value),
                new SqliteParameter("@plugin", pluginId));
            return Mutation(changed, 0);
        }
        catch (Exception ex) { return MutationError(ex.Message); }
    }

    public static WorkerResponse RemovePluginData(JsonElement parameters)
    {
        try
        {
            var pluginId = RequireString(parameters, "pluginId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var sessionIds = db.Query("SELECT id FROM sessions WHERE plugin_id = @pid", r => r.GetString("id"),
                new SqliteParameter("@pid", pluginId));
            var deletedMessages = 0;
            if (sessionIds.Count > 0)
            {
                deletedMessages = db.ExecuteInTransaction((conn, tx) =>
                {
                    var ph = string.Join(",", sessionIds.Select((_, i) => $"@s{i}"));
                    var removed = db.Execute(conn, tx, $"DELETE FROM messages WHERE session_id IN ({ph})",
                        sessionIds.Select((sid, i) => new SqliteParameter($"@s{i}", sid)).ToArray());
                    DbCompactionSnapshotStore.DeleteForSessions(db, conn, tx, sessionIds);
                    return removed;
                });
            }
            var deletedSessions = db.Execute("DELETE FROM sessions WHERE plugin_id = @pid", new SqliteParameter("@pid", pluginId));
            var deletedProjects = db.Execute("DELETE FROM projects WHERE plugin_id = @pid", new SqliteParameter("@pid", pluginId));
            return Mutation(deletedSessions + deletedProjects, deletedMessages);
        }
        catch (Exception ex) { return MutationError(ex.Message); }
    }

    public static WorkerResponse ListPluginSessions(JsonElement parameters)
    {
        try
        {
            var pluginId = RequireString(parameters, "pluginId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var entities = db.Query("SELECT * FROM sessions WHERE plugin_id = @pid ORDER BY updated_at DESC",
                EntityMappers.MapSession, new SqliteParameter("@pid", pluginId));
            var rows = entities.Select(SessionToPluginRow).ToList();
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListPluginSessionRow);
        }
        catch (Exception ex) { return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse CreatePluginSession(JsonElement parameters)
    {
        try
        {
            var pluginId = RequireString(parameters, "pluginId");
            var sessionId = NormalizeOptional(JsonHelpers.GetString(parameters, "id")) ?? CreateSessionId();
            var title = RequireString(parameters, "title");
            var mode = NormalizeOptional(JsonHelpers.GetString(parameters, "mode")) ?? "cowork";
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var createdAt = JsonHelpers.GetLong(parameters, "createdAt", now);
            var updatedAt = JsonHelpers.GetLong(parameters, "updatedAt", createdAt);
            var externalChatId = NormalizeOptional(JsonHelpers.GetString(parameters, "externalChatId"));
            var projectId = NormalizeOptional(JsonHelpers.GetString(parameters, "projectId"));
            var providerId = NormalizeOptional(JsonHelpers.GetString(parameters, "providerId"));
            var modelId = providerId is null ? null : NormalizeOptional(JsonHelpers.GetString(parameters, "modelId"));
            var modelSelectionMode = providerId is not null && modelId is not null ? "manual" : "inherit";

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            string? workingFolder = null, sshConnectionId = null;
            if (projectId is not null)
            {
                var project = db.QueryFirstOrDefault("SELECT * FROM projects WHERE id = @id", EntityMappers.MapProject,
                    new SqliteParameter("@id", projectId));
                if (project is not null) { workingFolder = EmptyToNull(project.WorkingFolder); sshConnectionId = project.SshConnectionId; }
            }

            db.Execute(
                "INSERT INTO sessions (id, title, mode, created_at, updated_at, message_count, project_id, " +
                "working_folder, ssh_connection_id, pinned, plugin_id, external_chat_id, provider_id, model_id, model_selection_mode) " +
                "VALUES (@id, @title, @mode, @ca, @ua, 0, @pid, @wf, @ssh, 0, @plugin, @ext, @prov, @model, @msm)",
                new SqliteParameter("@id", sessionId), new SqliteParameter("@title", title),
                new SqliteParameter("@mode", mode), new SqliteParameter("@ca", createdAt),
                new SqliteParameter("@ua", updatedAt), new SqliteParameter("@pid", (object?)projectId ?? DBNull.Value),
                new SqliteParameter("@wf", (object?)workingFolder ?? DBNull.Value),
                new SqliteParameter("@ssh", (object?)sshConnectionId ?? DBNull.Value),
                new SqliteParameter("@plugin", pluginId), new SqliteParameter("@ext", (object?)externalChatId ?? DBNull.Value),
                new SqliteParameter("@prov", (object?)providerId ?? DBNull.Value),
                new SqliteParameter("@model", (object?)modelId ?? DBNull.Value),
                new SqliteParameter("@msm", modelSelectionMode));
            return Mutation(1, 0);
        }
        catch (Exception ex) { return MutationError(ex.Message); }
    }

    public static WorkerResponse FindPluginSessionByChat(JsonElement parameters)
    {
        try
        {
            var externalChatId = RequireString(parameters, "externalChatId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var entity = db.QueryFirstOrDefault(
                "SELECT * FROM sessions WHERE external_chat_id = @key", EntityMappers.MapSession,
                new SqliteParameter("@key", externalChatId));
            var row = entity is null ? null : SessionToPluginRow(entity);
            return WorkerResponse.Json(new PluginSessionFindResult(true, row, null), InfrastructureJsonContext.Default.PluginSessionFindResult);
        }
        catch (Exception ex) { return WorkerResponse.Json(new PluginSessionFindResult(false, null, ex.Message), InfrastructureJsonContext.Default.PluginSessionFindResult); }
    }

    public static WorkerResponse ListAllPluginSessions(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var entities = db.Query(
                "SELECT * FROM sessions WHERE plugin_id IS NOT NULL AND plugin_id != '' ORDER BY updated_at DESC",
                EntityMappers.MapSession);
            var rows = entities.Select(SessionToPluginRow).ToList();
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListPluginSessionRow);
        }
        catch (Exception ex) { return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse ListPluginSessionMessages(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            var limit = Math.Clamp(JsonHelpers.GetInt(parameters, "limit", 50), 1, 500);
            var offset = Math.Max(0, JsonHelpers.GetInt(parameters, "offset", 0));
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var entities = db.Query(
                "SELECT * FROM messages WHERE session_id = @sid ORDER BY sort_order ASC LIMIT @limit OFFSET @offset",
                EntityMappers.MapMessage,
                new SqliteParameter("@sid", sessionId), new SqliteParameter("@limit", limit), new SqliteParameter("@offset", offset));
            var rows = entities.Select(m => new PluginSessionMessageRow
            { Id = m.Id, Role = m.Role, Content = m.Content, CreatedAt = m.CreatedAt }).ToList();
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListPluginSessionMessageRow);
        }
        catch (Exception ex) { return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse ClearPluginSession(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var deleted = db.ExecuteInTransaction((conn, tx) =>
            {
                var removed = db.Execute(conn, tx, "DELETE FROM messages WHERE session_id = @sid", new SqliteParameter("@sid", sessionId));
                DbCompactionSnapshotStore.DeleteForSession(db, conn, tx, sessionId);
                return removed;
            });
            db.Execute("UPDATE sessions SET message_count = 0 WHERE id = @id", new SqliteParameter("@id", sessionId));
            return Mutation(0, deleted);
        }
        catch (Exception ex) { return MutationError(ex.Message); }
    }

    public static WorkerResponse DeletePluginSession(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var (deletedSessions, deletedMessages) = db.ExecuteInTransaction((conn, tx) =>
            {
                var removedMessages = db.Execute(conn, tx, "DELETE FROM messages WHERE session_id = @sid", new SqliteParameter("@sid", sessionId));
                DbCompactionSnapshotStore.DeleteForSession(db, conn, tx, sessionId);
                var removedSessions = db.Execute(conn, tx, "DELETE FROM sessions WHERE id = @id", new SqliteParameter("@id", sessionId));
                return (removedSessions, removedMessages);
            });
            return Mutation(deletedSessions, deletedMessages);
        }
        catch (Exception ex) { return MutationError(ex.Message); }
    }

    public static WorkerResponse RenamePluginSession(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            var title = RequireString(parameters, "title");
            var updatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var changed = db.Execute(
                "UPDATE sessions SET title = @title, updated_at = @ua WHERE id = @id",
                new SqliteParameter("@title", title), new SqliteParameter("@ua", updatedAt),
                new SqliteParameter("@id", sessionId));
            return Mutation(changed, 0);
        }
        catch (Exception ex) { return MutationError(ex.Message); }
    }

    // NOTE: RoutePluginSession and auto-reply helpers are in DbPluginSessionRouting.cs

    // ── Private helpers ──

    public static PluginSessionRow SessionToPluginRow(SessionEntity e) => new()
    {
        Id = e.Id, Title = e.Title, Icon = e.Icon, Mode = e.Mode,
        CreatedAt = e.CreatedAt, UpdatedAt = e.UpdatedAt, ProjectId = e.ProjectId,
        WorkingFolder = e.WorkingFolder, SshConnectionId = e.SshConnectionId,
        PlanId = e.PlanId, Pinned = e.Pinned, PluginId = e.PluginId,
        PluginType = e.PluginType, ChannelRouteKey = e.ChannelRouteKey,
        ExternalChatId = e.ExternalChatId, ExternalChatType = e.ExternalChatType,
        ProviderId = e.ProviderId, ModelId = e.ModelId,
        ModelSelectionMode = e.ModelSelectionMode, MessageCount = e.MessageCount
    };

    public static WorkerResponse Mutation(int changed, int deleted)
        => WorkerResponse.Json(new PluginSessionMutationResult(true, changed, deleted, null), InfrastructureJsonContext.Default.PluginSessionMutationResult);

    public static WorkerResponse MutationError(string error)
        => WorkerResponse.Json(new PluginSessionMutationResult(false, 0, 0, error), InfrastructureJsonContext.Default.PluginSessionMutationResult);

    public static string RequireString(JsonElement parameters, string name)
        => JsonHelpers.GetString(parameters, name) is { Length: > 0 } value
            ? value : throw new InvalidOperationException($"Missing required plugin session field: {name}");

    public static string BuildPluginMessageSessionKey(string pluginId, string chatId)
        => $"plugin:{pluginId}:chat:{EncodeSessionKeyPart(chatId)}";

    public static string CreateSessionId() => $"wc_{Guid.NewGuid():N}";

    public static string EncodeSessionKeyPart(string value)
        => Uri.EscapeDataString(value)
            .Replace("%21", "!", StringComparison.OrdinalIgnoreCase)
            .Replace("%27", "'", StringComparison.OrdinalIgnoreCase)
            .Replace("%28", "(", StringComparison.OrdinalIgnoreCase)
            .Replace("%29", ")", StringComparison.OrdinalIgnoreCase)
            .Replace("%2A", "*", StringComparison.OrdinalIgnoreCase);

    public static bool ShouldReplaceSessionTitle(string? currentTitle, string? nextTitle)
    {
        var current = NormalizeOptional(currentTitle);
        var next = NormalizeOptional(nextTitle);
        if (next is null || string.Equals(current, next, StringComparison.Ordinal)) return false;
        return current is null ||
            current == PlaceholderNewConversation || current == PlaceholderNewChat ||
            current.StartsWith("wc_", StringComparison.OrdinalIgnoreCase) ||
            current.StartsWith("oc_", StringComparison.OrdinalIgnoreCase) ||
            current.StartsWith("Plugin ", StringComparison.OrdinalIgnoreCase);
    }

    public static string? FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values) { if (NormalizeOptional(value) is { } normalized) return normalized; }
        return null;
    }

    public static string? NormalizeOptional(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    public static string? EmptyToNull(string? value)
        => string.IsNullOrEmpty(value) ? null : value;
}

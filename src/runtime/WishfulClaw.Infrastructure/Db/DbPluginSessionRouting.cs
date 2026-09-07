using System.Text.Json.Serialization.Metadata;
﻿using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Infrastructure.Db;

public static class DbPluginSessionRouting
{
    private static readonly object RouteSync = new();

    public static WorkerResponse RoutePluginSession(JsonElement parameters)
    {
        lock (RouteSync)
        {
            return RoutePluginSessionLocked(parameters);
        }
    }

    private static WorkerResponse RoutePluginSessionLocked(JsonElement parameters)
    {
        try
        {
            var pluginId = DbPluginSessionTools.RequireString(parameters, "pluginId");
            var chatId = DbPluginSessionTools.RequireString(parameters, "chatId");
            var initialTitle = DbPluginSessionTools.NormalizeOptional(JsonHelpers.GetString(parameters, "initialTitle"));
            var chatName = DbPluginSessionTools.NormalizeOptional(JsonHelpers.GetString(parameters, "chatName"));
            var senderName = DbPluginSessionTools.NormalizeOptional(JsonHelpers.GetString(parameters, "senderName"));
            var requestedProjectId = DbPluginSessionTools.NormalizeOptional(JsonHelpers.GetString(parameters, "projectId"));
            var providerId = DbPluginSessionTools.NormalizeOptional(JsonHelpers.GetString(parameters, "providerId"));
            var modelId = DbPluginSessionTools.NormalizeOptional(JsonHelpers.GetString(parameters, "modelId"));
            var pluginType = DbPluginSessionTools.NormalizeOptional(JsonHelpers.GetString(parameters, "pluginType"));
            var chatType = DbPluginSessionTools.NormalizeOptional(JsonHelpers.GetString(parameters, "chatType"));
            var compositeKey = DbPluginSessionTools.BuildPluginMessageSessionKey(pluginId, chatId);
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            ProjectEntity? project = null;
            if (requestedProjectId is not null)
            {
                project = db.QueryFirstOrDefault("SELECT * FROM projects WHERE id = @id", EntityMappers.MapProject,
                    new SqliteParameter("@id", requestedProjectId));
            }

            var session = db.QueryFirstOrDefault(
                "SELECT * FROM sessions WHERE channel_route_key = @key " +
                "OR (plugin_id = @pluginId AND external_chat_id = @chatId) " +
                "OR (channel_route_key IS NULL AND external_chat_id = @key) " +
                "ORDER BY CASE WHEN channel_route_key = @key THEN 0 ELSE 1 END, updated_at DESC LIMIT 1",
                EntityMappers.MapSession,
                new SqliteParameter("@key", compositeKey),
                new SqliteParameter("@pluginId", pluginId),
                new SqliteParameter("@chatId", chatId));

            var modelSelectionMode = providerId is not null && modelId is not null ? "manual" : "inherit";
            string sessionId, sessionTitle;
            string? sessionProjectId;

            if (session is null)
            {
                sessionId = DbPluginSessionTools.CreateSessionId();
                sessionTitle = initialTitle ?? DbPluginSessionTools.FirstNonEmpty(chatName, senderName, chatId) ?? chatId;
                sessionProjectId = project?.Id;

                var scope = project is null ? "global" : "project";
                var collaborationMode = project is null ? "chat" : "cowork";
                var permissionMode = "default";
                var mode = collaborationMode;
                var workingFolder = DbPluginSessionTools.EmptyToNull(project?.WorkingFolder);
                var sshConnectionId = project?.SshConnectionId;

                db.Execute(
                    "INSERT INTO sessions (id, title, mode, scope, collaboration_mode, permission_mode, " +
                    "created_at, updated_at, message_count, project_id, working_folder, ssh_connection_id, " +
                    "pinned, plugin_id, plugin_type, channel_route_key, external_chat_id, external_chat_type, " +
                    "provider_id, model_id, model_selection_mode) " +
                    "VALUES (@id, @title, @mode, @scope, @collaborationMode, @permissionMode, " +
                    "@createdAt, @updatedAt, 0, @projectId, @workingFolder, @sshConnectionId, " +
                    "0, @pluginId, @pluginType, @channelRouteKey, @externalChatId, @externalChatType, " +
                    "@providerId, @modelId, @modelSelectionMode)",
                    new SqliteParameter("@id", sessionId),
                    new SqliteParameter("@title", sessionTitle),
                    new SqliteParameter("@mode", mode),
                    new SqliteParameter("@scope", scope),
                    new SqliteParameter("@collaborationMode", collaborationMode),
                    new SqliteParameter("@permissionMode", permissionMode),
                    new SqliteParameter("@createdAt", now),
                    new SqliteParameter("@updatedAt", now),
                    new SqliteParameter("@projectId", (object?)project?.Id ?? DBNull.Value),
                    new SqliteParameter("@workingFolder", (object?)workingFolder ?? DBNull.Value),
                    new SqliteParameter("@sshConnectionId", (object?)sshConnectionId ?? DBNull.Value),
                    new SqliteParameter("@pluginId", pluginId),
                    new SqliteParameter("@pluginType", (object?)pluginType ?? DBNull.Value),
                    new SqliteParameter("@channelRouteKey", compositeKey),
                    new SqliteParameter("@externalChatId", chatId),
                    new SqliteParameter("@externalChatType", (object?)chatType ?? DBNull.Value),
                    new SqliteParameter("@providerId", (object?)providerId ?? DBNull.Value),
                    new SqliteParameter("@modelId", (object?)modelId ?? DBNull.Value),
                    new SqliteParameter("@modelSelectionMode", modelSelectionMode));
            }
            else
            {
                sessionId = session.Id;
                sessionTitle = session.Title;
                sessionProjectId = session.ProjectId;

                if (project is not null)
                {
                    db.Execute(
                        "UPDATE sessions SET updated_at = @ua, project_id = @pid, working_folder = @wf, " +
                        "ssh_connection_id = @ssh WHERE id = @id",
                        new SqliteParameter("@ua", now),
                        new SqliteParameter("@pid", project.Id),
                        new SqliteParameter("@wf", (object?)DbPluginSessionTools.EmptyToNull(project.WorkingFolder) ?? DBNull.Value),
                        new SqliteParameter("@ssh", (object?)project.SshConnectionId ?? DBNull.Value),
                        new SqliteParameter("@id", sessionId));
                    sessionProjectId = project.Id;
                }
                else
                {
                    db.Execute("UPDATE sessions SET updated_at = @ua WHERE id = @id",
                        new SqliteParameter("@ua", now), new SqliteParameter("@id", sessionId));
                }

                db.Execute(
                    "UPDATE sessions SET channel_route_key = @routeKey, external_chat_id = @chatId, " +
                    "external_chat_type = @chatType, plugin_type = COALESCE(@pluginType, plugin_type) " +
                    "WHERE id = @id",
                    new SqliteParameter("@routeKey", compositeKey),
                    new SqliteParameter("@chatId", chatId),
                    new SqliteParameter("@chatType", (object?)chatType ?? DBNull.Value),
                    new SqliteParameter("@pluginType", (object?)pluginType ?? DBNull.Value),
                    new SqliteParameter("@id", sessionId));

                if (providerId is not null || modelId is not null)
                {
                    db.Execute(
                        "UPDATE sessions SET provider_id = @prov, model_id = @model, model_selection_mode = @msm WHERE id = @id",
                        new SqliteParameter("@prov", (object?)providerId ?? DBNull.Value),
                        new SqliteParameter("@model", (object?)modelId ?? DBNull.Value),
                        new SqliteParameter("@msm", modelSelectionMode),
                        new SqliteParameter("@id", sessionId));
                }

            }

            return WorkerResponse.Json(new PluginRouteSessionResult(
                true, sessionId, sessionTitle, sessionProjectId,
                DbPluginSessionTools.EmptyToNull(project?.WorkingFolder), project?.SshConnectionId, null), InfrastructureJsonContext.Default.PluginRouteSessionResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(new PluginRouteSessionResult(false, null, null, null, null, null, ex.Message), InfrastructureJsonContext.Default.PluginRouteSessionResult);
        }
    }

    public static PluginSessionFindResult FindPluginSessionRecordByChat(string externalChatId)
    {
        try
        {
            DbClient.EnsureInitialized();
            var db = DbClient.GetClient();
            var entity = db.QueryFirstOrDefault(
                "SELECT * FROM sessions WHERE external_chat_id = @key", EntityMappers.MapSession,
                new SqliteParameter("@key", externalChatId));
            var row = entity is null ? null : DbPluginSessionTools.SessionToPluginRow(entity);
            return new PluginSessionFindResult(true, row, null);
        }
        catch (Exception ex)
        {
            return new PluginSessionFindResult(false, null, ex.Message);
        }
    }

    public static List<PluginSessionMessageRow> ListPluginSessionMessageRecords(string sessionId, int limit, int offset = 0)
    {
        DbClient.EnsureInitialized();
        var db = DbClient.GetClient();
        var entities = db.Query(
            "SELECT * FROM messages WHERE session_id = @sid ORDER BY sort_order ASC LIMIT @limit OFFSET @offset",
            EntityMappers.MapMessage,
            new SqliteParameter("@sid", sessionId),
            new SqliteParameter("@limit", Math.Clamp(limit, 1, 500)),
            new SqliteParameter("@offset", Math.Max(0, offset)));

        return entities.Select(m => new PluginSessionMessageRow
        { Id = m.Id, Role = m.Role, Content = m.Content, CreatedAt = m.CreatedAt }).ToList();
    }
}

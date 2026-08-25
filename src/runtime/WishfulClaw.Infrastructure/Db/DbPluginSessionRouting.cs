using System.Text.Json.Serialization.Metadata;
﻿using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Infrastructure.Db;

public static class DbPluginSessionRouting
{
    public static WorkerResponse RoutePluginSession(JsonElement parameters)
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
                "SELECT * FROM sessions WHERE external_chat_id = @key", EntityMappers.MapSession,
                new SqliteParameter("@key", compositeKey));

            var modelSelectionMode = providerId is not null && modelId is not null ? "manual" : "inherit";
            string sessionId, sessionTitle;
            string? sessionProjectId;

            if (session is null)
            {
                sessionId = DbPluginSessionTools.CreateSessionId();
                sessionTitle = initialTitle ?? DbPluginSessionTools.FirstNonEmpty(chatName, senderName, chatId) ?? chatId;
                sessionProjectId = project?.Id;

                var entity = new SessionEntity
                {
                    Id = sessionId, Title = sessionTitle, Mode = "cowork", CreatedAt = now, UpdatedAt = now,
                    ProjectId = project?.Id, WorkingFolder = DbPluginSessionTools.EmptyToNull(project?.WorkingFolder),
                    SshConnectionId = project?.SshConnectionId, Pinned = 0, PluginId = pluginId,
                    ExternalChatId = compositeKey, ProviderId = providerId, ModelId = modelId,
                    ModelSelectionMode = modelSelectionMode
                };
                WorkerJsonHelper.BuildJsonElement(w =>
                {
                    w.WriteStartObject();
                    w.WriteString("id", entity.Id);
                    w.WriteString("title", entity.Title);
                    w.WriteString("mode", entity.Mode);
                    w.WriteNumber("createdAt", entity.CreatedAt);
                    w.WriteNumber("updatedAt", entity.UpdatedAt);
                    w.WriteString("projectId", entity.ProjectId);
                    w.WriteString("workingFolder", entity.WorkingFolder);
                    w.WriteString("sshConnectionId", entity.SshConnectionId);
                    w.WriteBoolean("pinned", false);
                    w.WriteString("pluginId", entity.PluginId);
                    w.WriteString("externalChatId", entity.ExternalChatId);
                    w.WriteString("providerId", entity.ProviderId);
                    w.WriteString("modelId", entity.ModelId);
                    w.WriteString("modelSelectionMode", entity.ModelSelectionMode);
                    w.WriteEndObject();
                });
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

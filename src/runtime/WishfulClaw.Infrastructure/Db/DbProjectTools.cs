/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json.Serialization.Metadata;
﻿using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Infrastructure.Db;

public static class DbProjectTools
{
    public static WorkerResponse List(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var entities = db.Query(
                "SELECT * FROM projects ORDER BY pinned DESC, updated_at DESC",
                EntityMappers.MapProject);

            var rows = entities.Select(e =>
            {
                var count = db.QueryScalar<int>(
                    "SELECT COUNT(*) FROM sessions WHERE project_id = @id",
                    new SqliteParameter("@id", e.Id));
                return ProjectRow.FromEntity(e, count);
            }).ToList();

            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListProjectRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbProjectTools.List failed: {ex.GetType().Name}: {ex.Message} | StackTrace: {ex.StackTrace}");
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
                "SELECT * FROM projects WHERE id = @id",
                EntityMappers.MapProject,
                new SqliteParameter("@id", id));
            return WorkerResponse.Json(new ProjectFindResult(true, entity is null ? null : ProjectRow.FromEntity(entity), null), InfrastructureJsonContext.Default.ProjectFindResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(new ProjectFindResult(false, null, ex.Message), InfrastructureJsonContext.Default.ProjectFindResult);
        }
    }

    public static WorkerResponse Create(JsonElement parameters)
    {
        try
        {
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var id = NormalizeOptional(JsonHelpers.GetString(parameters, "id")) ?? CreateId();
            var name = SanitizeProjectName(RequireString(parameters, "name"));
            var sshConnectionId = NormalizeOptional(JsonHelpers.GetString(parameters, "sshConnectionId"));
            var workingFolder = NormalizeOptional(JsonHelpers.GetString(parameters, "workingFolder"));
            var pluginId = NormalizeOptional(JsonHelpers.GetString(parameters, "pluginId"));
            var pinned = JsonHelpers.GetBool(parameters, "pinned", false) ? 1 : 0;
            var createdAt = JsonHelpers.GetLong(parameters, "createdAt", now);
            var updatedAt = JsonHelpers.GetLong(parameters, "updatedAt", now);

            if (workingFolder is not null && sshConnectionId is null)
            {
                Directory.CreateDirectory(workingFolder);
            }

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            db.Execute(
                "INSERT INTO projects (id, name, working_folder, ssh_connection_id, plugin_id, pinned, created_at, updated_at) " +
                "VALUES (@id, @name, @wf, @ssh, @plugin, @pinned, @ca, @ua)",
                new SqliteParameter("@id", id),
                new SqliteParameter("@name", name),
                new SqliteParameter("@wf", (object?)workingFolder ?? DBNull.Value),
                new SqliteParameter("@ssh", (object?)sshConnectionId ?? DBNull.Value),
                new SqliteParameter("@plugin", (object?)pluginId ?? DBNull.Value),
                new SqliteParameter("@pinned", pinned),
                new SqliteParameter("@ca", createdAt),
                new SqliteParameter("@ua", updatedAt));

            var entity = new ProjectEntity
            {
                Id = id, Name = name, WorkingFolder = workingFolder,
                SshConnectionId = sshConnectionId, PluginId = pluginId,
                Pinned = pinned, CreatedAt = createdAt, UpdatedAt = updatedAt
            };

            return WorkerResponse.Json(ProjectRow.FromEntity(entity), InfrastructureJsonContext.Default.ProjectRow);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse Update(JsonElement parameters)
    {
        try
        {
            var id = RequireString(parameters, "id");
            if (!parameters.TryGetProperty("patch", out var patch) || patch.ValueKind != JsonValueKind.Object)
            {
                return WorkerResponse.Json(new ProjectFindResult(true, null, null), InfrastructureJsonContext.Default.ProjectFindResult);
            }

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var current = db.QueryFirstOrDefault(
                "SELECT * FROM projects WHERE id = @id",
                EntityMappers.MapProject,
                new SqliteParameter("@id", id));
            if (current is null)
            {
                return WorkerResponse.Json(new ProjectFindResult(true, null, null), InfrastructureJsonContext.Default.ProjectFindResult);
            }

            ApplyProjectPatch(patch, current);
            db.Execute(
                "UPDATE projects SET name = @name, working_folder = @wf, ssh_connection_id = @ssh, " +
                "plugin_id = @plugin, pinned = @pinned, updated_at = @ua WHERE id = @id",
                new SqliteParameter("@name", current.Name),
                new SqliteParameter("@wf", (object?)current.WorkingFolder ?? DBNull.Value),
                new SqliteParameter("@ssh", (object?)current.SshConnectionId ?? DBNull.Value),
                new SqliteParameter("@plugin", (object?)current.PluginId ?? DBNull.Value),
                new SqliteParameter("@pinned", current.Pinned),
                new SqliteParameter("@ua", current.UpdatedAt),
                new SqliteParameter("@id", id));

            return WorkerResponse.Json(new ProjectFindResult(true, ProjectRow.FromEntity(current), null), InfrastructureJsonContext.Default.ProjectFindResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(new ProjectFindResult(false, null, ex.Message), InfrastructureJsonContext.Default.ProjectFindResult);
        }
    }

    public static WorkerResponse Delete(JsonElement parameters)
    {
        try
        {
            var id = RequireString(parameters, "id");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var project = db.QueryFirstOrDefault(
                "SELECT * FROM projects WHERE id = @id",
                EntityMappers.MapProject,
                new SqliteParameter("@id", id));
            if (project is null)
            {
                return WorkerResponse.Json(new ProjectDeleteResult(true, false, null, new List<string>(), null), InfrastructureJsonContext.Default.ProjectDeleteResult);
            }

            var sessionIds = db.Query(
                "SELECT id FROM sessions WHERE project_id = @id",
                r => r.GetString("id"),
                new SqliteParameter("@id", id));

            if (sessionIds.Count > 0)
            {
                // Delete messages and compaction snapshots for all sessions in this project
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

            db.Execute("DELETE FROM sessions WHERE project_id = @id",
                new SqliteParameter("@id", id));
            db.Execute("DELETE FROM projects WHERE id = @id",
                new SqliteParameter("@id", id));

            return WorkerResponse.Json(new ProjectDeleteResult(true, true, id, sessionIds, null), InfrastructureJsonContext.Default.ProjectDeleteResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(new ProjectDeleteResult(false, false, null, new List<string>(), ex.Message), InfrastructureJsonContext.Default.ProjectDeleteResult);
        }
    }

    public static WorkerResponse EnsureDefault(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var existing = db.QueryFirstOrDefault(
                "SELECT * FROM projects WHERE plugin_id IS NULL ORDER BY pinned DESC, updated_at DESC LIMIT 1",
                EntityMappers.MapProject);

            if (existing is not null)
            {
                return WorkerResponse.Json(ProjectRow.FromEntity(existing), InfrastructureJsonContext.Default.ProjectRow);
            }

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var id = CreateId();
            db.Execute(
                "INSERT INTO projects (id, name, created_at, updated_at) VALUES (@id, @name, @ca, @ua)",
                new SqliteParameter("@id", id),
                new SqliteParameter("@name", "Default Project"),
                new SqliteParameter("@ca", now),
                new SqliteParameter("@ua", now));

            var entity = new ProjectEntity
            {
                Id = id, Name = "Default Project", CreatedAt = now, UpdatedAt = now
            };
            return WorkerResponse.Json(ProjectRow.FromEntity(entity), InfrastructureJsonContext.Default.ProjectRow);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Error(ex.Message);
        }
    }

    // ─── Private helpers ───

    private static void ApplyProjectPatch(JsonElement patch, ProjectEntity row)
    {
        if (patch.TryGetProperty("name", out var nameEl) && nameEl.ValueKind == JsonValueKind.String)
        {
            row.Name = SanitizeProjectName(nameEl.GetString() ?? string.Empty);
        }

        if (patch.TryGetProperty("sshConnectionId", out var sshEl))
        {
            row.SshConnectionId = sshEl.ValueKind == JsonValueKind.String
                ? NormalizeOptional(sshEl.GetString())
                : null;
        }

        if (patch.TryGetProperty("workingFolder", out var folderEl))
        {
            row.WorkingFolder = folderEl.ValueKind == JsonValueKind.String
                ? NormalizeOptional(folderEl.GetString())
                : null;
            if (row.WorkingFolder is not null && row.SshConnectionId is null)
            {
                Directory.CreateDirectory(row.WorkingFolder);
            }
        }

        if (patch.TryGetProperty("pluginId", out var pluginEl))
        {
            row.PluginId = pluginEl.ValueKind == JsonValueKind.String
                ? NormalizeOptional(pluginEl.GetString())
                : null;
        }

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

        if (JsonHelpers.GetLongNullable(patch, "updatedAt") is { } updatedAt)
        {
            row.UpdatedAt = updatedAt;
        }
        else
        {
            row.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }
    }

    private static string SanitizeProjectName(string rawName)
    {
        var replaced = new string(rawName
            .Select(c => c is '<' or '>' or ':' or '"' or '/' or '\\' or '|' or '?' or '*'
                ? ' '
                : c)
            .ToArray());
        var cleaned = string.Join(' ', replaced.Split(
            ' ',
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        return cleaned.Length == 0 ? "New Project" : cleaned;
    }

    private static string CreateId()
    {
        return $"wc_{Guid.NewGuid():N}";
    }

    public static string RequireString(JsonElement parameters, string name)
    {
        return JsonHelpers.GetString(parameters, name) is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException($"Missing required field: {name}");
    }

    public static string? NormalizeOptional(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }
}

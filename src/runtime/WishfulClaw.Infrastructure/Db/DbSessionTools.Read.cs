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
/// Read-only session endpoints: list, get, status.
/// Split out per AGENTS.md 大文件拆分 (2026-10-28); bodies moved verbatim.
/// </summary>
public static partial class DbSessionTools
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
}

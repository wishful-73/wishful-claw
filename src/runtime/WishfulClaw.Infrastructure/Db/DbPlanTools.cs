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

namespace WishfulClaw.Infrastructure.Db;

public static class DbPlanTools
{
    public static WorkerResponse List(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var entities = db.Query("SELECT * FROM plans ORDER BY updated_at DESC", EntityMappers.MapPlan);
            var rows = entities.Select(PlanRow.FromEntity).ToList();
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListPlanRow);
        }
        catch (Exception ex) { WorkerLog.Error($"DbPlanTools.List failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Get(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var id = parameters.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
            if (string.IsNullOrEmpty(id))
                return WorkerResponse.Json(new PlanFindResult(false, null, "id is required"), InfrastructureJsonContext.Default.PlanFindResult);

            var entity = DbPlanStore.GetById(db, id);
            var row = entity != null ? PlanRow.FromEntity(entity) : null;
            return WorkerResponse.Json(new PlanFindResult(true, row, null), InfrastructureJsonContext.Default.PlanFindResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbPlanTools.Get failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse GetBySession(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var sessionId = parameters.TryGetProperty("sessionId", out var sidEl) ? sidEl.GetString() : null;
            if (string.IsNullOrEmpty(sessionId))
                return WorkerResponse.Json(new PlanFindResult(false, null, "sessionId is required"), InfrastructureJsonContext.Default.PlanFindResult);

            var entity = DbPlanStore.GetLatestBySession(db, sessionId);
            var row = entity != null ? PlanRow.FromEntity(entity) : null;
            return WorkerResponse.Json(new PlanFindResult(true, row, null), InfrastructureJsonContext.Default.PlanFindResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbPlanTools.GetBySession failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Create(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var entity = ParseCreateParameters(parameters);

            // 9 列 + NULL 处理全在 DbPlanStore.Insert（S-336 薄化）；这里只摊参数。
            DbPlanStore.Insert(db, entity);

            return WorkerResponse.Json(new PlanMutationResult(true, 1, null), InfrastructureJsonContext.Default.PlanMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbPlanTools.Create failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Update(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var id = parameters.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
            if (string.IsNullOrEmpty(id))
                return WorkerResponse.Json(new PlanMutationResult(false, 0, "id is required"), InfrastructureJsonContext.Default.PlanMutationResult);

            var entity = db.QueryFirstOrDefault("SELECT * FROM plans WHERE id = @id", EntityMappers.MapPlan,
                new SqliteParameter("@id", id));
            if (entity == null)
                return WorkerResponse.Json(new PlanMutationResult(false, 0, "Plan not found"), InfrastructureJsonContext.Default.PlanMutationResult);

            if (parameters.TryGetProperty("patch", out var patch) && patch.ValueKind == JsonValueKind.Object)
            {
                if (patch.TryGetProperty("title", out var t) && t.ValueKind == JsonValueKind.String)
                    entity.Title = t.GetString()!;
                if (patch.TryGetProperty("status", out var s) && s.ValueKind == JsonValueKind.String)
                    entity.Status = s.GetString()!;
                if (patch.TryGetProperty("filePath", out var fp))
                    entity.FilePath = fp.ValueKind == JsonValueKind.String ? fp.GetString() : null;
                if (patch.TryGetProperty("content", out var c))
                    entity.Content = c.ValueKind == JsonValueKind.String ? c.GetString() : null;
                if (patch.TryGetProperty("specJson", out var sj))
                    entity.SpecJson = sj.ValueKind == JsonValueKind.Null ? null : sj.GetRawText();
            }

            entity.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var changed = db.Execute(
                "UPDATE plans SET title = @title, status = @status, file_path = @fp, content = @content, " +
                "spec_json = @spec, updated_at = @ua WHERE id = @id",
                new SqliteParameter("@title", entity.Title),
                new SqliteParameter("@status", entity.Status),
                new SqliteParameter("@fp", (object?)entity.FilePath ?? DBNull.Value),
                new SqliteParameter("@content", (object?)entity.Content ?? DBNull.Value),
                new SqliteParameter("@spec", (object?)entity.SpecJson ?? DBNull.Value),
                new SqliteParameter("@ua", entity.UpdatedAt),
                new SqliteParameter("@id", id));

            return WorkerResponse.Json(new PlanMutationResult(true, changed, null), InfrastructureJsonContext.Default.PlanMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbPlanTools.Update failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Delete(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var id = parameters.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
            if (string.IsNullOrEmpty(id))
                return WorkerResponse.Json(new PlanMutationResult(false, 0, "id is required"), InfrastructureJsonContext.Default.PlanMutationResult);

            var changed = DbPlanStore.DeleteById(db, id);
            return WorkerResponse.Json(new PlanMutationResult(true, changed, null), InfrastructureJsonContext.Default.PlanMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbPlanTools.Delete failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    private static PlanEntity ParseCreateParameters(JsonElement parameters)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        return new PlanEntity
        {
            Id = parameters.TryGetProperty("id", out var idEl) ? idEl.GetString()! : Guid.NewGuid().ToString("N"),
            SessionId = parameters.TryGetProperty("sessionId", out var sidEl) ? sidEl.GetString()! : "",
            Title = parameters.TryGetProperty("title", out var titleEl) ? titleEl.GetString()! : "",
            Status = parameters.TryGetProperty("status", out var statusEl) ? statusEl.GetString()! : "drafting",
            FilePath = parameters.TryGetProperty("filePath", out var fpEl) && fpEl.ValueKind == JsonValueKind.String ? fpEl.GetString() : null,
            Content = parameters.TryGetProperty("content", out var cEl) && cEl.ValueKind == JsonValueKind.String ? cEl.GetString() : null,
            SpecJson = parameters.TryGetProperty("specJson", out var sjEl) && sjEl.ValueKind != JsonValueKind.Null ? sjEl.GetRawText() : null,
            CreatedAt = now,
            UpdatedAt = now
        };
    }
}

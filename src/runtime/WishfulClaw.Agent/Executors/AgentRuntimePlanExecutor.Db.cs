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

public static partial class AgentRuntimePlanExecutor
{
    private static PlanEntity? LoadPlanBySession(JsonElement parameters, string sessionId)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            return db.QueryFirstOrDefault(
                "SELECT * FROM plans WHERE session_id = @sid ORDER BY updated_at DESC LIMIT 1",
                EntityMappers.MapPlan, new SqliteParameter("@sid", sessionId));
        }
        catch (Exception ex) { WorkerLog.Warn($"LoadPlanBySession failed: {ex.Message}"); return null; }
    }

    private static PlanEntity? LoadPlanById(JsonElement parameters, string planId)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            return db.QueryFirstOrDefault("SELECT * FROM plans WHERE id = @id",
                EntityMappers.MapPlan, new SqliteParameter("@id", planId));
        }
        catch (Exception ex) { WorkerLog.Warn($"LoadPlanById failed: {ex.Message}"); return null; }
    }

    private static void InsertPlan(JsonElement parameters, PlanEntity plan)
    {
        DbClient.EnsureInitialized(parameters);
        var db = DbClient.GetClient(parameters);
        db.Execute(
            "INSERT INTO plans (id, session_id, title, status, file_path, content, spec_json, created_at, updated_at) " +
            "VALUES (@id, @sid, @title, @status, @fp, @content, @spec, @ca, @ua)",
            new SqliteParameter("@id", plan.Id),
            new SqliteParameter("@sid", plan.SessionId),
            new SqliteParameter("@title", plan.Title),
            new SqliteParameter("@status", plan.Status),
            new SqliteParameter("@fp", (object?)plan.FilePath ?? DBNull.Value),
            new SqliteParameter("@content", (object?)plan.Content ?? DBNull.Value),
            new SqliteParameter("@spec", (object?)plan.SpecJson ?? DBNull.Value),
            new SqliteParameter("@ca", plan.CreatedAt),
            new SqliteParameter("@ua", plan.UpdatedAt));
    }

    private static void UpdatePlanForReview(JsonElement parameters, string planId, string title, long updatedAt)
        => UpdatePlanStatus(parameters, planId, title, "awaiting_review", updatedAt);

    private static void UpdatePlanStatus(JsonElement parameters, string planId, string title, string status, long updatedAt)
    {
        DbClient.EnsureInitialized(parameters);
        var db = DbClient.GetClient(parameters);
        db.Execute(
            "UPDATE plans SET title = @title, status = @status, updated_at = @ua WHERE id = @id",
            new SqliteParameter("@title", title),
            new SqliteParameter("@status", status),
            new SqliteParameter("@ua", updatedAt),
            new SqliteParameter("@id", planId));
    }

    private static void DeletePlan(JsonElement parameters, string planId)
    {
        DbClient.EnsureInitialized(parameters);
        var db = DbClient.GetClient(parameters);
        db.Execute("DELETE FROM plans WHERE id = @id", new SqliteParameter("@id", planId));
    }
}

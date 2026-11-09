/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json;
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
            return DbPlanStore.GetLatestBySession(db, sessionId);
        }
        catch (Exception ex) { WorkerLog.Warn($"LoadPlanBySession failed: {ex.Message}"); return null; }
    }

    private static PlanEntity? LoadPlanById(JsonElement parameters, string planId)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            return DbPlanStore.GetById(db, planId);
        }
        catch (Exception ex) { WorkerLog.Warn($"LoadPlanById failed: {ex.Message}"); return null; }
    }

    private static void InsertPlan(JsonElement parameters, PlanEntity plan)
    {
        DbClient.EnsureInitialized(parameters);
        DbPlanStore.Insert(DbClient.GetClient(parameters), plan);
    }

    private static void UpdatePlanForReview(JsonElement parameters, string planId, string title, long updatedAt)
        => UpdatePlanStatus(parameters, planId, title, "awaiting_review", updatedAt);

    private static void UpdatePlanStatus(JsonElement parameters, string planId, string title, string status, long updatedAt)
    {
        DbClient.EnsureInitialized(parameters);
        DbPlanStore.UpdateStatus(DbClient.GetClient(parameters), planId, title, status, updatedAt);
    }

    private static void DeletePlan(JsonElement parameters, string planId)
    {
        DbClient.EnsureInitialized(parameters);
        DbPlanStore.DeleteById(DbClient.GetClient(parameters), planId);
    }
}

/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json.Serialization.Metadata;
﻿using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Infrastructure.Db;

public sealed class DbModule : IWorkerModule
{
    public string Name => "db";

    public void Register(IWorkerModuleContext context)
    {
        // ── Initialize ──
        context.Register("db/initialize", DbInitialize);

        // ── Projects ──
        context.Register("db/projects-list", DbProjectTools.List);
        context.Register("db/projects-get", DbProjectTools.Get);
        context.Register("db/projects-create", DbProjectTools.Create);
        context.Register("db/projects-update", DbProjectTools.Update);
        context.Register("db/projects-delete", DbProjectTools.Delete);
        context.Register("db/projects-ensure-default", DbProjectTools.EnsureDefault);

        // ── Sessions ──
        context.Register("db/sessions-list", DbSessionTools.List);
        context.Register("db/sessions-get", DbSessionTools.Get);
        context.Register("db/sessions-create", DbSessionTools.Create);
        context.Register("db/sessions-update", DbSessionTools.Update);
        context.Register("db/sessions-delete", DbSessionTools.Delete);
        context.Register("db/sessions-clear-all", DbSessionTools.ClearAll);
        context.Register("db/session-reset-conversation", DbSessionTools.ResetConversation);
        context.Register("db/session-status", DbSessionTools.Status);

        // ── Messages ──
        context.Register("db/messages-list", DbMessageTools.List);
        context.Register("db/messages-list-page", DbMessageTools.ListPage);
        context.Register("db/messages-list-locator", DbMessageTools.ListLocator);
        context.Register("db/messages-list-by-turns", DbMessageTools.ListByTurns);
        context.Register("db/messages-list-after-cursor", DbMessageTools.ListAfterCursor);
        context.Register("db/messages-add", DbMessageTools.Add);
        context.Register("db/messages-add-batch", DbMessageTools.AddBatch);
        context.Register("db/messages-upsert", DbMessageTools.Upsert);
        context.Register("db/messages-update", DbMessageTools.Update);
        context.Register("db/messages-clear", DbMessageTools.Clear);
        context.Register("db/messages-delete", DbMessageTools.Delete);
        context.Register("db/messages-count", DbMessageTools.Count);
        context.Register("db/messages-delete-last", DbMessageTools.DeleteLast);
        context.Register("db/messages-truncate-from", DbMessageTools.TruncateFrom);
        context.Register("db/messages-compact-session", DbMessageCompactTools.CompactSession);
        context.Register("db/messages-usage-stats", DbMessageCompactTools.UsageStats);
        context.Register("db/messages-search-content", DbMessageTools.SearchContent);

        // ── Compaction Snapshots ──
        context.Register("db/compaction-snapshots-get", DbCompactionSnapshotTools.Get);
        context.Register("db/session-context-manifest", DbCompactionSnapshotTools.GetContextManifest);
        context.Register("db/compaction-snapshots-upsert", DbCompactionSnapshotTools.Upsert);
        context.Register("db/compaction-snapshots-delete", DbCompactionSnapshotTools.Delete);

        // ── Sub-Agent Runs ──
        context.Register("db/sub-agent-read-by-tool-use-id", DbSubAgentTools.ReadByToolUseId);
        context.Register("db/sub-agent-read-session", DbSubAgentTools.ReadSession);
        context.Register("db/sub-agent-index", DbSubAgentTools.Index);
        context.Register("db/sub-agent-apply", DbSubAgentTools.Apply);
        context.Register("db/sub-agent-replace", DbSubAgentTools.Replace);

        // ── SSH Connections ──
        context.Register("db/ssh-connections-list", DbSshTools.List);
        context.Register("db/ssh-connections-get", DbSshTools.Get);
        context.Register("db/ssh-connections-create", DbSshTools.Create);
        context.Register("db/ssh-connections-update", DbSshTools.Update);
        context.Register("db/ssh-connections-delete", DbSshTools.Delete);

        // ── Plans ──
        context.Register("db/plans-list", DbPlanTools.List);
        context.Register("db/plans-get", DbPlanTools.Get);
        context.Register("db/plans-get-by-session", DbPlanTools.GetBySession);
        context.Register("db/plans-create", DbPlanTools.Create);
        context.Register("db/plans-update", DbPlanTools.Update);
        context.Register("db/plans-delete", DbPlanTools.Delete);

        // ── Tasks (session-scoped agent Todo, OpenCowork semantics) ──
        context.Register("db/tasks-list-by-session", DbTaskTools.ListBySession);
        context.Register("db/tasks-get", DbTaskTools.Get);
        context.Register("db/tasks-create", DbTaskTools.Create);
        context.Register("db/tasks-update", DbTaskTools.Update);
        context.Register("db/tasks-delete", DbTaskTools.Delete);
        context.Register("db/tasks-delete-by-session", DbTaskTools.DeleteBySession);

        // ── Global Tasks (global agent work items, archive-not-delete) ──
        context.Register("db/global-tasks-list", DbGlobalTaskTools.List);
        context.Register("db/global-tasks-get", DbGlobalTaskTools.Get);
        context.Register("db/global-tasks-create", DbGlobalTaskTools.Create);
        context.Register("db/global-tasks-update", DbGlobalTaskTools.Update);
        context.Register("db/global-tasks-archive", DbGlobalTaskTools.Archive);

        // ── Global Task Dispatches (permanent dispatch records) ──
        context.Register("db/global-task-dispatches-list", DbGlobalTaskDispatchTools.List);
        context.Register("db/global-task-dispatches-get", DbGlobalTaskDispatchTools.Get);
        context.Register("db/global-task-dispatches-create", DbGlobalTaskDispatchTools.Create);
        context.Register("db/global-task-dispatches-update", DbGlobalTaskDispatchTools.Update);
        context.Register("db/global-task-dispatches-cancel", DbGlobalTaskDispatchTools.Cancel);

        // ── Goals ──
        context.Register("db/goals-list", DbGoalTools.List);
        context.Register("db/goals-list-page", DbGoalTools.ListPage);
        context.Register("db/goals-get", DbGoalTools.Get);
        context.Register("db/goals-create", DbGoalTools.Create);
        context.Register("db/goals-set", DbGoalTools.Set);
        context.Register("db/goals-update", DbGoalTools.Update);
        context.Register("db/goals-account", DbGoalTools.AccountUsage);
        context.Register("db/goals-reopen", DbGoalTools.Reopen);
        context.Register("db/goals-list-active", DbGoalTools.ListActive);

        // ── Goal Events ──
        context.Register("db/goal-events-list", DbGoalTools.ListEvents);
        context.Register("db/goal-events-list-page", DbGoalTools.ListEventsPage);
        context.Register("db/goal-events-add", DbGoalTools.AddEvent);

        // ── Goal Plan Tasks (per-round execution records) ──
        context.Register("db/goal-plan-tasks-list", DbGoalPlanTaskRoundTools.ListPlanTasks);
        context.Register("db/goal-plan-tasks-get", DbGoalPlanTaskRoundTools.GetPlanTask);
        context.Register("db/goal-plan-tasks-list-by-plan", DbGoalPlanTaskRoundTools.ListPlanTasksByPlan);

        // ── Goal Plans (plan definitions) ──
        context.Register("db/goal-plans-list", DbGoalPlanTools.ListPlans);
        context.Register("db/goal-plans-get", DbGoalPlanTools.GetPlan);
        context.Register("db/goal-plans-update-status", DbGoalPlanTools.UpdatePlanStatus);
        context.Register("db/goal-plans-update-retry", DbGoalPlanTools.UpdatePlanRetry);
        context.Register("db/goal-plans-update-snapshot", DbGoalPlanTools.UpdatePlanSnapshot);

        // ── Goal Tasks (task definitions) ──
        context.Register("db/goal-tasks-list", DbGoalTaskTools.ListTasks);
        context.Register("db/goal-tasks-get", DbGoalTaskTools.GetTask);
        context.Register("db/goal-tasks-update-status", DbGoalTaskTools.UpdateTaskStatus);

        // ── Goal Execution Runs (execution attempts) ──
        context.Register("db/goal-execution-runs-insert", DbGoalExecutionRunTools.InsertRun);
        context.Register("db/goal-execution-runs-finish", DbGoalExecutionRunTools.FinishRun);
        context.Register("db/goal-execution-runs-get", DbGoalExecutionRunTools.GetRun);
        context.Register("db/goal-execution-runs-list", DbGoalExecutionRunTools.ListRuns);
        context.Register("db/goal-ledger-get", DbGoalTools.GetLedger);

        // ── Cron ──
        context.Register("db/crons-list", DbCronTools.List);
        context.Register("db/crons-get", DbCronTools.Get);
        context.Register("db/crons-create", DbCronTools.Create);
        context.Register("db/crons-update", DbCronTools.Update);
        context.Register("db/crons-delete", DbCronTools.Delete);
        context.Register("db/crons-toggle", DbCronTools.Toggle);
        context.Register("db/crons-mark-fired", DbCronTools.MarkFired);
        context.Register("db/crons-mark-run-finished", DbCronTools.MarkRunFinished);
        context.Register("db/cron-runs-start", DbCronRunTools.Start);
        context.Register("db/cron-runs-finish", DbCronRunTools.Finish);
        context.Register("db/cron-runs-get", DbCronRunTools.Get);
        context.Register("db/cron-runs-list", DbCronRunTools.List);

        // ── Plugin Sessions ──
        context.Register("db/plugin-normal-projects", DbPluginSessionTools.ListNormalProjects);
        context.Register("db/plugin-sync-session-models", DbPluginSessionTools.SyncPluginSessionModels);
        context.Register("db/plugin-sync-session-project", DbPluginSessionTools.SyncPluginSessionProject);
        context.Register("db/plugin-remove-data", DbPluginSessionTools.RemovePluginData);
        context.Register("db/plugin-sessions-list", DbPluginSessionTools.ListPluginSessions);
        context.Register("db/plugin-sessions-create", DbPluginSessionTools.CreatePluginSession);
        context.Register("db/plugin-sessions-find-by-chat", DbPluginSessionTools.FindPluginSessionByChat);
        context.Register("db/plugin-sessions-list-all", DbPluginSessionTools.ListAllPluginSessions);
        context.Register("db/plugin-session-messages-list", DbPluginSessionTools.ListPluginSessionMessages);
        context.Register("db/plugin-session-messages-clear", DbPluginSessionTools.ClearPluginSession);
        context.Register("db/plugin-session-delete", DbPluginSessionTools.DeletePluginSession);
        context.Register("db/plugin-session-rename", DbPluginSessionTools.RenamePluginSession);
        context.Register("db/plugin-route-session", DbPluginSessionRouting.RoutePluginSession);
    }

    private static WorkerResponse DbInitialize(JsonElement parameters)
    {
        var dbPath = DbClient.ResolveDbPath(parameters);
        var result = DbClient.Initialize(dbPath);
        return WorkerResponse.Json(result, InfrastructureJsonContext.Default.DbInitializeResult);
    }
}

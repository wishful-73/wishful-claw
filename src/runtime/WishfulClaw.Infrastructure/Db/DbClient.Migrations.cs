using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Schema migrations run on every startup: column adds and legacy goal data normalization.
/// Split out of DbClient.Initialize per AGENTS.md 大文件拆分 (2026-10-28);
/// migration bodies are moved verbatim.
/// </summary>
public static partial class DbClient
{
    /// <summary>
    /// Run all startup migrations. Requires <see cref="_db"/> to be set by the caller.
    /// </summary>
    private static void RunMigrations()
    {
        // ── Migrations: add columns to existing tables ──
        WorkerLog.Info("DbClient: running EnsureColumn migrations");
        EnsureColumn("sessions", "persona_id", "TEXT");
        EnsureColumn("sessions", "plan_id", "TEXT");
        EnsureColumn("sessions", "plugin_type", "TEXT");
        EnsureColumn("sessions", "channel_route_key", "TEXT");
        EnsureColumn("sessions", "external_chat_id", "TEXT");
        EnsureColumn("sessions", "external_chat_type", "TEXT");
        EnsureColumn("sessions", "provider_id", "TEXT");
        EnsureColumn("sessions", "model_id", "TEXT");
        EnsureColumn("sessions", "model_selection_mode", "TEXT");
        EnsureColumn("sessions", "plugin_id", "TEXT");
        EnsureColumn("sessions", "ssh_connection_id", "TEXT");
        EnsureColumn("sessions", "working_folder", "TEXT");
        EnsureColumn("sessions", "icon", "TEXT");
        EnsureColumn("sessions", "scope", "TEXT");
        EnsureColumn("sessions", "collaboration_mode", "TEXT");
        EnsureColumn("sessions", "permission_mode", "TEXT");
        // 会话级「请求上下文上限」（iter-32 S-73/S-84）：token 数，0 = 不限制；
        // model id 记它是设在哪个模型上的，换模型即作废。
        EnsureColumn("sessions", "context_cap_tokens", "INTEGER");
        EnsureColumn("sessions", "context_cap_model_id", "TEXT");
        // 会话级「压缩阈值」（iter-32 S-85）：0 或 NULL = 跟随全局设置，否则是 0.3~0.9 的比例。
        EnsureColumn("sessions", "compression_threshold", "REAL");
        // 会话级「用量统计起点」（S-193）：0 = 从未重置，否则是重置那一刻的 Unix 毫秒。
        // 聚合端点 db/messages-usage-stats 只统计 created_at > 该值的消息 —— 重置因此
        // 既是持久的（重启不复活），又不必删除 messages.usage（逐条消息的 token 摘要照常可见）。
        EnsureColumn("sessions", "usage_stats_reset_at", "INTEGER NOT NULL DEFAULT 0");
        EnsureCompactionSnapshotSchema();
        _db!.Execute(
            "UPDATE sessions SET scope = CASE WHEN project_id IS NULL THEN 'global' ELSE 'project' END " +
            "WHERE scope IS NULL OR scope NOT IN ('global', 'project');");
        _db!.Execute(
            "UPDATE sessions SET collaboration_mode = CASE WHEN scope = 'global' THEN 'chat' ELSE 'cowork' END " +
            "WHERE collaboration_mode IS NULL OR collaboration_mode NOT IN ('chat', 'cowork');");
        // 权限档与协作模式解绑（iter-31 S-59）：以前 global 会话被无条件抹成 'default'，
        // 于是全局对话每次跑 shell 都要弹审批。现在只剩「从未有过取值」这一种兜底，
        // 落到渲染端共享的缺省值 fullAccess。渠道会话没有 UI 入口（聊天窗对 pluginId
        // 会话不显示权限控件），它的 'default' 一律是系统塞的，同样升级——对面没人值守。
        // 注意：非渠道会话里用户显式选过的 'default' 不在此列，那是他的选择，动不得。
        _db!.Execute(
            "UPDATE sessions SET permission_mode = 'fullAccess' " +
            "WHERE permission_mode IS NULL " +
            "OR permission_mode NOT IN ('default', 'fullAccess') " +
            // 渠道会话的判据不能只看 plugin_id：早期格式的会话只有 external_chat_id
            // （plugin:<id>:chat:<chatId>），plugin_id 可能是 NULL 或空串。
            "OR (permission_mode = 'default' AND (" +
            "COALESCE(plugin_id, '') != '' OR COALESCE(external_chat_id, '') != '' " +
            "OR channel_route_key IS NOT NULL));");
        EnsureColumn("projects", "ssh_connection_id", "TEXT");
        EnsureColumn("projects", "plugin_id", "TEXT");
        EnsureColumn("global_task_dispatches", "source_session_id", "TEXT");
        EnsureColumn("messages", "usage", "TEXT");
        EnsureColumn("messages", "sort_order", "INTEGER");
        // Nullable on purpose: legacy rows keep NULL and the UI falls back to created_at.
        EnsureColumn("messages", "updated_at", "INTEGER");
        NormalizeChannelSessionMetadata();
        _db!.Execute("CREATE INDEX IF NOT EXISTS ix_sessions_channel_route ON sessions(channel_route_key);");
        EnsureColumn("goals", "plans_json", "TEXT");
        EnsureColumn("goals", "plan_count", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn("goals", "completed_plan_count", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn("goals", "current_plan_index", "INTEGER NOT NULL DEFAULT -1");
        EnsureColumn("goals", "working_folder", "TEXT");
        EnsureColumn("goals", "model_config_json", "TEXT");
        EnsureColumn("goals", "token_budget", "INTEGER");
        EnsureColumn("goals", "time_used_seconds", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn("goals", "project_id", "TEXT");
        EnsureColumn("cron_tasks", "name", "TEXT NOT NULL DEFAULT ''");
        EnsureColumn("cron_tasks", "session_id", "TEXT");
        EnsureColumn("cron_tasks", "scope", "TEXT NOT NULL DEFAULT 'global'");
        EnsureColumn("cron_tasks", "project_id", "TEXT");
        EnsureColumn("cron_tasks", "schedule_json", "TEXT NOT NULL DEFAULT '{}'");
        EnsureColumn("cron_tasks", "prompt", "TEXT NOT NULL DEFAULT ''");
        EnsureColumn("cron_tasks", "agent_id", "TEXT");
        EnsureColumn("cron_tasks", "model", "TEXT");
        EnsureColumn("cron_tasks", "thinking_enabled", "INTEGER");
        EnsureColumn("cron_tasks", "reasoning_effort", "TEXT");
        EnsureColumn("cron_tasks", "working_folder", "TEXT");
        EnsureColumn("cron_tasks", "delivery_mode", "TEXT NOT NULL DEFAULT 'desktop'");
        EnsureColumn("cron_tasks", "output_mode", "TEXT NOT NULL DEFAULT 'new_session'");
        EnsureColumn("cron_tasks", "reuse_session_id", "TEXT");
        EnsureColumn("cron_tasks", "run_mode", "TEXT NOT NULL DEFAULT 'background'");
        EnsureColumn("cron_tasks", "delivery_target", "TEXT");
        EnsureColumn("cron_tasks", "plugin_id", "TEXT");
        EnsureColumn("cron_tasks", "plugin_type", "TEXT");
        EnsureColumn("cron_tasks", "plugin_chat_id", "TEXT");
        EnsureColumn("cron_tasks", "delete_after_run", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn("cron_tasks", "max_iterations", "INTEGER NOT NULL DEFAULT 15");
        EnsureColumn("cron_tasks", "enabled", "INTEGER NOT NULL DEFAULT 1");
        EnsureColumn("cron_tasks", "deleted_at", "INTEGER");
        EnsureColumn("cron_tasks", "last_fired_at", "INTEGER");
        EnsureColumn("cron_tasks", "last_run_at", "INTEGER");
        EnsureColumn("cron_tasks", "last_run_status", "TEXT");
        EnsureColumn("cron_tasks", "last_run_summary", "TEXT");
        EnsureColumn("cron_tasks", "last_error", "TEXT");
        EnsureColumn("cron_tasks", "fire_count", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn("cron_tasks", "created_at", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn("cron_tasks", "updated_at", "INTEGER NOT NULL DEFAULT 0");
        _db!.Execute("UPDATE cron_tasks SET output_mode = 'reuse_session' WHERE output_mode = 'new_session' AND delivery_mode = 'session' AND delivery_target IS NOT NULL AND reuse_session_id IS NULL;");
        _db!.Execute("UPDATE cron_tasks SET output_mode = 'bot' WHERE output_mode = 'new_session' AND plugin_id IS NOT NULL;");
        _db!.Execute("CREATE INDEX IF NOT EXISTS ix_cron_tasks_enabled_next ON cron_tasks(enabled, deleted_at, updated_at);");
        _db!.Execute("CREATE INDEX IF NOT EXISTS ix_cron_tasks_session ON cron_tasks(session_id);");
        _db!.Execute("CREATE INDEX IF NOT EXISTS ix_cron_tasks_project ON cron_tasks(project_id, scope);");
        _db!.Execute("CREATE INDEX IF NOT EXISTS ix_cron_runs_cron_started ON cron_runs(cron_id, started_at DESC);");
        _db!.Execute("CREATE INDEX IF NOT EXISTS ix_cron_runs_session_started ON cron_runs(session_id, started_at DESC);");
        NormalizeGoalNumericColumns();
        NormalizeGoalStatuses();
        NormalizeGoalPlansJson();
        EnsureGoalHistorySchema();
        SweepInterruptedGoals();
        // Agent timeline retention (S-25.5): piggyback on startup, no timer.
        DbAgentTimelineTools.Prune(_db);
        WorkerLog.Info("DbClient: migrations completed");
    }

    private static void NormalizeGoalNumericColumns()
    {
        _db!.Execute(
            "UPDATE goals SET " +
            "plan_count = COALESCE(plan_count, 0), " +
            "completed_plan_count = COALESCE(completed_plan_count, 0), " +
            "current_plan_index = COALESCE(current_plan_index, -1), " +
            "time_used_seconds = COALESCE(time_used_seconds, 0) " +
            "WHERE plan_count IS NULL OR completed_plan_count IS NULL " +
            "OR current_plan_index IS NULL OR time_used_seconds IS NULL");
    }

    private static void NormalizeGoalStatuses()
    {
        _db!.Execute(
            "UPDATE goals SET status = CASE status " +
            "WHEN 'paused' THEN 'active' " +
            "WHEN 'completed' THEN 'complete' " +
            "WHEN 'completed_with_failures' THEN 'failed' " +
            "ELSE status END " +
            "WHERE status IN ('paused', 'completed', 'completed_with_failures')");
    }

    private static void NormalizeGoalPlansJson()
    {
        var rows = _db!.Query(
            "SELECT goal_id, plans_json FROM goals WHERE plans_json IS NOT NULL",
            reader => new GoalPlansJsonMigrationRow(
                reader.GetString("goal_id"),
                reader.GetString("plans_json")));

        foreach (var row in rows)
        {
            try
            {
                using var document = JsonDocument.Parse(row.PlansJson);
                if (document.RootElement.ValueKind != JsonValueKind.String)
                    continue;

                var innerJson = document.RootElement.GetString();
                if (string.IsNullOrWhiteSpace(innerJson))
                    continue;

                using var innerDocument = JsonDocument.Parse(innerJson);
                if (innerDocument.RootElement.ValueKind != JsonValueKind.Array)
                    continue;

                _db!.Execute(
                    "UPDATE goals SET plans_json = @plans WHERE goal_id = @goalId",
                    new SqliteParameter("@plans", innerDocument.RootElement.GetRawText()),
                    new SqliteParameter("@goalId", row.GoalId));
            }
            catch (JsonException)
            {
                // Preserve malformed legacy values for diagnostics instead of deleting data.
            }
        }
    }

    private sealed record GoalPlansJsonMigrationRow(string GoalId, string PlansJson);

    /// <summary>
    /// Add a column to an existing table if it doesn't exist.
    /// </summary>
    private static void EnsureColumn(string table, string column, string columnType)
    {
        try
        {
            var columns = _db!.Query(
                $"PRAGMA table_info({table});",
                r => r.GetString("name"));
            var hasColumn = columns.Any(c =>
                string.Equals(c, column, StringComparison.OrdinalIgnoreCase));

            if (!hasColumn)
            {
                _db!.Execute($"ALTER TABLE {table} ADD COLUMN {column} {columnType};");
            }
        }
        catch
        {
            // Ignore migration errors (column may already exist or table not created yet)
        }
    }
}

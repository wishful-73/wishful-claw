// 500 行豁免（2026-11-06，行数以实际为准）：单一数据对象 —— 手写 DDL 清单
// （CREATE TABLE / 索引 / FTS5 虚表 / 同步触发器）。内容全是「建表顺序 + 字段定义」，
// 拆开会让「一张表完整的建法」散落在多个文件里，排查 schema 问题反而要来回跳。
// DDL 本体是 2026-10-28 按 AGENTS.md 大文件拆分要求从 `DbClient.Initialize` 原样搬出的，
// 未做任何改写；搬的时候就是为了「一屏看完整个 schema」。

using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Hand-written schema bootstrap: CREATE TABLE / indexes / FTS5 virtual table / sync triggers.
/// Replaces SqlSugar CodeFirst. Split out of DbClient.Initialize per AGENTS.md 大文件拆分
/// (2026-10-28); the DDL bodies are moved verbatim.
/// </summary>
public static partial class DbClient
{
    /// <summary>
    /// Create all tables, indexes, FTS5 table and triggers (idempotent, IF NOT EXISTS).
    /// Requires <see cref="_db"/> to be set by the caller.
    /// </summary>
    private static void CreateSchema()
    {
        // ── Create tables (hand-written DDL, replaces SqlSugar CodeFirst) ──
        var tableSqls = new[]
        {
            @"CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                working_folder TEXT,
                ssh_connection_id TEXT,
                plugin_id TEXT,
                pinned INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );",
            @"CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                icon TEXT,
                mode TEXT NOT NULL DEFAULT 'chat',
                scope TEXT,
                collaboration_mode TEXT,
                permission_mode TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                message_count INTEGER NOT NULL DEFAULT 0,
                project_id TEXT,
                working_folder TEXT,
                ssh_connection_id TEXT,
                plan_id TEXT,
                pinned INTEGER NOT NULL DEFAULT 0,
                plugin_id TEXT,
                plugin_type TEXT,
                channel_route_key TEXT,
                external_chat_id TEXT,
                external_chat_type TEXT,
                provider_id TEXT,
                model_id TEXT,
                model_selection_mode TEXT NOT NULL DEFAULT 'inherit',
                persona_id TEXT,
                current_snapshot_id TEXT,
                context_revision INTEGER NOT NULL DEFAULT 0
            );",
            @"CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY NOT NULL,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                meta TEXT,
                created_at INTEGER NOT NULL,
                usage TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0
            );",
            // S-285：助手消息的块结构（thinking / text / tool_use）拆出独立表，工具调用改为
            // 「按 seq 单行覆盖」而不是「整条 meta 重新 stringify 后整行 upsert」。
            //
            // 老库自动建表：CREATE TABLE IF NOT EXISTS ⇒ 零迁移、零 ALTER、零数据搬运。
            // 反向验证（tests 里钉住）：把它改成不带 IF NOT EXISTS，第二次启动必须炸。
            //
            // 刻意不加 FK 到 messages.id：DbService 已开 PRAGMA foreign_keys = ON，加了隐式级联
            // 会让「删一条消息」静默带走它的全部 parts —— 一旦有 bug 误删 messages 行就不可恢复。
            // 删除走显式清（与 sub_agent_runs 等表一致），多一步但好排查（S-285 §8.5）。
            //
            // WITHOUT ROWID：行直接存在 (message_id, seq) 主键 B-tree 里，
            // 「message_id 等值 + seq 有序前缀扫描」正好命中，不需要额外索引（§8.2）。
            // 代价是不能用 rowid / AUTOINCREMENT —— 本条不需要自增，seq 是业务序号。
            @"CREATE TABLE IF NOT EXISTS message_parts (
                message_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                kind TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (message_id, seq)
            ) WITHOUT ROWID;",
            @"CREATE TABLE IF NOT EXISTS sub_agent_runs (
                tool_use_id TEXT PRIMARY KEY NOT NULL,
                session_id TEXT NOT NULL,
                agent_name TEXT NOT NULL DEFAULT '',
                data TEXT NOT NULL DEFAULT '',
                started_at INTEGER NOT NULL,
                completed_at INTEGER,
                success INTEGER
            );",
            @"CREATE TABLE IF NOT EXISTS ssh_connections (
                id TEXT PRIMARY KEY NOT NULL,
                group_id TEXT,
                name TEXT NOT NULL DEFAULT '',
                host TEXT NOT NULL DEFAULT '',
                port INTEGER NOT NULL DEFAULT 22,
                username TEXT NOT NULL DEFAULT '',
                auth_type TEXT NOT NULL DEFAULT 'password',
                encrypted_password TEXT,
                private_key_path TEXT,
                encrypted_passphrase TEXT,
                startup_command TEXT,
                default_directory TEXT,
                keep_alive_interval INTEGER NOT NULL DEFAULT 60,
                sort_order INTEGER NOT NULL DEFAULT 0,
                last_connected_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );",
            @"CREATE TABLE IF NOT EXISTS plans (
                id TEXT PRIMARY KEY NOT NULL,
                session_id TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'drafting',
                file_path TEXT,
                content TEXT,
                spec_json TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );",
            @"CREATE TABLE IF NOT EXISTS goals (
                goal_id TEXT PRIMARY KEY NOT NULL,
                session_id TEXT NOT NULL,
                project_id TEXT,
                objective TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                token_budget INTEGER,
                tokens_used INTEGER NOT NULL DEFAULT 0,
                time_used_seconds INTEGER NOT NULL DEFAULT 0,
                plans_json TEXT,
                plan_count INTEGER NOT NULL DEFAULT 0,
                completed_plan_count INTEGER NOT NULL DEFAULT 0,
                current_plan_index INTEGER NOT NULL DEFAULT -1,
                working_folder TEXT,
                model_config_json TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );",
            @"CREATE TABLE IF NOT EXISTS goal_plan_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                goal_id TEXT NOT NULL,
                plan_id TEXT NOT NULL,
                original_plan_id TEXT,
                plan_title TEXT,
                round INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'executing',
                description TEXT,
                steps_json TEXT,
                summary TEXT,
                evaluation_reasoning TEXT,
                evaluation_satisfied INTEGER,
                adjusted INTEGER NOT NULL DEFAULT 0,
                started_at INTEGER NOT NULL,
                finished_at INTEGER
            );",
            @"CREATE INDEX IF NOT EXISTS ix_goal_plan_tasks_goal_round " +
            "ON goal_plan_tasks(goal_id, round);",
            @"CREATE TABLE IF NOT EXISTS goal_plans (
                plan_id TEXT PRIMARY KEY NOT NULL,
                goal_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL DEFAULT 0,
                original_plan_id TEXT,
                title TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                content_json TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                retry_count INTEGER NOT NULL DEFAULT 0,
                result_summary TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                started_at INTEGER,
                completed_at INTEGER
            );",
            @"CREATE INDEX IF NOT EXISTS ix_goal_plans_goal_ordinal ON goal_plans(goal_id, ordinal);",
            @"CREATE TABLE IF NOT EXISTS goal_tasks (
                task_id TEXT PRIMARY KEY NOT NULL,
                goal_id TEXT NOT NULL,
                plan_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL DEFAULT 0,
                title TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                content_json TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                retry_count INTEGER NOT NULL DEFAULT 0,
                result_summary TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                started_at INTEGER,
                completed_at INTEGER
            );",
            @"CREATE UNIQUE INDEX IF NOT EXISTS ux_goal_tasks_plan_ordinal ON goal_tasks(plan_id, ordinal);",
            @"CREATE INDEX IF NOT EXISTS ix_goal_tasks_goal_plan ON goal_tasks(goal_id, plan_id, ordinal);", 
            @"CREATE TABLE IF NOT EXISTS goal_execution_runs (
                attempt_id TEXT PRIMARY KEY NOT NULL,
                goal_id TEXT NOT NULL,
                plan_id TEXT,
                task_id TEXT,
                attempt_no INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'executing',
                summary TEXT,
                error TEXT,
                started_at INTEGER NOT NULL,
                finished_at INTEGER
            );",
            @"CREATE INDEX IF NOT EXISTS ix_goal_execution_runs_task ON goal_execution_runs(task_id, attempt_no);", 
            @"CREATE TABLE IF NOT EXISTS cron_runs (
                run_id TEXT PRIMARY KEY NOT NULL,
                cron_id TEXT NOT NULL,
                session_id TEXT,
                fire_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'running',
                summary TEXT,
                error TEXT,
                tool_call_count INTEGER NOT NULL DEFAULT 0,
                started_at INTEGER NOT NULL,
                finished_at INTEGER
            );",
            @"CREATE INDEX IF NOT EXISTS ix_cron_runs_cron_started ON cron_runs(cron_id, started_at DESC);",
            @"CREATE INDEX IF NOT EXISTS ix_cron_runs_session_started ON cron_runs(session_id, started_at DESC);",
            @"CREATE TABLE IF NOT EXISTS goal_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                goal_id TEXT,
                event_type TEXT NOT NULL,
                message TEXT,
                metadata_json TEXT,
                created_at INTEGER NOT NULL
            );",
            @"CREATE TABLE IF NOT EXISTS memory_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scope TEXT NOT NULL DEFAULT 'global',
                title TEXT,
                content TEXT NOT NULL DEFAULT '',
                priority TEXT NOT NULL DEFAULT 'standard',
                status TEXT NOT NULL DEFAULT 'active',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );",
            @"CREATE TABLE IF NOT EXISTS memory_archive (
                id TEXT PRIMARY KEY NOT NULL,
                scope TEXT NOT NULL DEFAULT 'global',
                key TEXT NOT NULL DEFAULT '',
                title TEXT,
                content TEXT NOT NULL DEFAULT '',
                priority TEXT NOT NULL DEFAULT 'standard',
                created_at INTEGER NOT NULL,
                archived_at INTEGER NOT NULL
            );",
            @"CREATE TABLE IF NOT EXISTS session_compaction_snapshots (
                snapshot_id TEXT PRIMARY KEY NOT NULL,
                session_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                ""trigger"" TEXT NOT NULL,
                wire_conversation TEXT NOT NULL,
                compact_artifacts TEXT NOT NULL,
                summary_message TEXT,
                summary_text TEXT,
                through_created_at INTEGER NOT NULL,
                through_sort_order INTEGER NOT NULL,
                original_count INTEGER NOT NULL,
                new_count INTEGER NOT NULL,
                messages_summarized INTEGER NOT NULL,
                summarizer_failed INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );",

            @"CREATE TABLE IF NOT EXISTS cron_tasks (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                session_id TEXT,
                scope TEXT NOT NULL DEFAULT 'global',
                project_id TEXT,
                schedule_json TEXT NOT NULL DEFAULT '{}',
                prompt TEXT NOT NULL DEFAULT '',
                agent_id TEXT,
                model TEXT,
                thinking_enabled INTEGER,
                reasoning_effort TEXT,
                working_folder TEXT,
                delivery_mode TEXT NOT NULL DEFAULT 'desktop',
                output_mode TEXT NOT NULL DEFAULT 'new_session',
                reuse_session_id TEXT,
                run_mode TEXT NOT NULL DEFAULT 'background',
                delivery_target TEXT,
                plugin_id TEXT,
                plugin_type TEXT,
                plugin_chat_id TEXT,
                delete_after_run INTEGER NOT NULL DEFAULT 0,
                max_iterations INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                deleted_at INTEGER,
                last_fired_at INTEGER,
                last_run_at INTEGER,
                last_run_status TEXT,
                last_run_summary TEXT,
                last_error TEXT,
                fire_count INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );",
            @"CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY NOT NULL,
                session_id TEXT NOT NULL,
                plan_id TEXT,
                subject TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                active_form TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                owner TEXT,
                blocks TEXT DEFAULT '[]',
                blocked_by TEXT DEFAULT '[]',
                metadata TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );",
            @"CREATE INDEX IF NOT EXISTS ix_tasks_session ON tasks(session_id);",
            @"CREATE INDEX IF NOT EXISTS ix_tasks_plan ON tasks(plan_id);",
            @"CREATE TABLE IF NOT EXISTS session_follow_ups (
                id TEXT PRIMARY KEY NOT NULL,
                todo_id TEXT NOT NULL,
                source_session_id TEXT NOT NULL,
                target_session_id TEXT NOT NULL,
                follow_up_at INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'waiting',
                query_instruction TEXT NOT NULL DEFAULT '',
                last_query_result TEXT,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                claim_token TEXT,
                claimed_at INTEGER,
                plugin_id TEXT,
                plugin_type TEXT,
                plugin_chat_id TEXT,
                notification_key TEXT NOT NULL,
                desktop_notified_at INTEGER,
                channel_notified_at INTEGER,
                completed_at INTEGER,
                cancelled_at INTEGER,
                last_error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );",
            @"CREATE UNIQUE INDEX IF NOT EXISTS ux_session_follow_ups_notification ON session_follow_ups(notification_key);",
            @"CREATE INDEX IF NOT EXISTS ix_session_follow_ups_source ON session_follow_ups(source_session_id, created_at DESC);",
            @"CREATE INDEX IF NOT EXISTS ix_session_follow_ups_schedule ON session_follow_ups(status, follow_up_at);",
            @"CREATE INDEX IF NOT EXISTS ix_session_follow_ups_todo ON session_follow_ups(todo_id);",
            @"CREATE TABLE IF NOT EXISTS global_tasks (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                priority TEXT NOT NULL DEFAULT 'normal',
                tags TEXT NOT NULL DEFAULT '[]',
                due_at INTEGER,
                archived INTEGER NOT NULL DEFAULT 0,
                -- S-300: optional owning project. NULL = a pure global task, which is the
                -- only meaning an old row can honestly have — nothing is backfilled.
                project_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );",
            @"CREATE INDEX IF NOT EXISTS ix_global_tasks_status ON global_tasks(status);",
            @"CREATE INDEX IF NOT EXISTS ix_global_tasks_archived ON global_tasks(archived);",
            @"CREATE INDEX IF NOT EXISTS ix_global_tasks_project ON global_tasks(project_id);",
            @"CREATE TABLE IF NOT EXISTS global_task_dispatches (
                id TEXT PRIMARY KEY NOT NULL,
                global_task_id TEXT NOT NULL,
                project_id TEXT,
                session_id TEXT NOT NULL,
                source_session_id TEXT,
                kind TEXT NOT NULL DEFAULT 'message',
                instruction TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                latest_report TEXT,
                error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                completed_at INTEGER
            );",
            @"CREATE INDEX IF NOT EXISTS ix_global_dispatches_task ON global_task_dispatches(global_task_id);",
            @"CREATE INDEX IF NOT EXISTS ix_global_dispatches_session ON global_task_dispatches(session_id);",
            // ── S-279（v3-iter-5）：普通消息派活记录 ──
            // 为什么另建一张表而不是复用 global_task_dispatches：后者的 global_task_id 是
            // NOT NULL 且 Create 会校验任务存在 —— 普通消息（「就地问一句 / 催一下」）根本
            // 没有全局任务可挂。要么把 NOT NULL 放开（拿任务板唯一数据源去赌约束），要么
            // 砍掉这个场景。选确定的代价：两张表、两套状态机、一个公共层。
            //
            // 纯增量：CREATE TABLE IF NOT EXISTS，老库启动自动建，零数据搬运，
            // global_task_dispatches 一个字节不动。
            @"CREATE TABLE IF NOT EXISTS global_message_dispatches (
                id TEXT PRIMARY KEY NOT NULL,
                project_id TEXT,
                session_id TEXT NOT NULL,
                source_session_id TEXT,
                instruction TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                latest_report TEXT,
                error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                completed_at INTEGER
            );",
            @"CREATE INDEX IF NOT EXISTS ix_global_message_dispatches_session ON global_message_dispatches(session_id);",
            @"CREATE INDEX IF NOT EXISTS ix_global_message_dispatches_source ON global_message_dispatches(source_session_id);",
            // ── Request-level usage log (#1, iteration 28) ──
            // One row per HTTP request attempt (success or failure), written by the
            // AgentLoop main path via ProviderRetryPolicy. Auxiliary chains that skip
            // that retry policy write one terminal row via AuxiliaryUsageLog instead.
            @"CREATE TABLE IF NOT EXISTS request_usage_logs (
                id TEXT PRIMARY KEY NOT NULL,
                session_id TEXT,
                runtime_role TEXT,
                scope TEXT,
                collaboration_mode TEXT,
                provider_id TEXT,
                provider_type TEXT,
                model_id TEXT,
                status TEXT NOT NULL DEFAULT 'success',
                error_kind TEXT,
                error_message TEXT,
                http_status_code INTEGER,
                attempt_index INTEGER NOT NULL DEFAULT 1,
                total_attempts INTEGER,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                billable_input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                cache_read_tokens INTEGER NOT NULL DEFAULT 0,
                cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
                reasoning_tokens INTEGER NOT NULL DEFAULT 0,
                input_cost REAL,
                output_cost REAL,
                cache_creation_cost REAL,
                cache_hit_cost REAL,
                total_cost_usd REAL,
                started_at INTEGER NOT NULL,
                completed_at INTEGER,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                ttft_ms INTEGER,
                tps REAL,
                switched_from_provider_id TEXT
            );",
            @"CREATE INDEX IF NOT EXISTS ix_request_usage_started ON request_usage_logs(started_at DESC);",
            @"CREATE INDEX IF NOT EXISTS ix_request_usage_model ON request_usage_logs(model_id);",
            @"CREATE INDEX IF NOT EXISTS ix_request_usage_status ON request_usage_logs(status);",
            @"CREATE INDEX IF NOT EXISTS ix_request_usage_session ON request_usage_logs(session_id);",
            // ── Agent timeline events (S-25, iteration 29) ──
            // One row per decision-level agent action (task dispatch/report, todo
            // transitions, cron firings, sub-agent runs). session_id is nullable:
            // rows with NULL are app-level events visible across sessions.
            @"CREATE TABLE IF NOT EXISTS agent_timeline_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                project_id TEXT,
                event_type TEXT NOT NULL,
                message TEXT,
                metadata_json TEXT,
                created_at INTEGER NOT NULL
            );",
            @"CREATE INDEX IF NOT EXISTS ix_timeline_session_created ON agent_timeline_events(session_id, created_at DESC);",
            @"CREATE INDEX IF NOT EXISTS ix_timeline_project_created ON agent_timeline_events(project_id, created_at DESC);",
            @"CREATE INDEX IF NOT EXISTS ix_timeline_created ON agent_timeline_events(created_at);"
        };

        // 旧库的 global_tasks / agent_timeline_events 建表时没有 project_id 列，而
        // CREATE TABLE IF NOT EXISTS 不会给已存在的表补列 —— 下面的索引硬引用它，
        // 不先补这一列，旧库会在建索引这一步整体初始化失败（RunMigrations 排在这之后，
        // 救不了场）。表不存在时该调用自行忽略。
        EnsureColumn("global_tasks", "project_id", "TEXT");
        EnsureColumn("agent_timeline_events", "project_id", "TEXT");

        foreach (var sql in tableSqls)
        {
            _db!.Execute(sql);
        }
        WorkerLog.Info($"DbClient: {tableSqls.Length} DDL statements applied (tables + indexes)");

        // ── FTS5 virtual table (external content + trigram tokenizer) ──
        WorkerLog.Info("DbClient: creating memory_fts virtual table (external content)");
        _db!.Execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(" +
            "title, content, content='memory_entries', content_rowid='id', tokenize='trigram');");
        WorkerLog.Info("DbClient: memory_fts virtual table ready");

        // ── FTS5 sync triggers ──
        var triggerSqls = new[]
        {
            "CREATE TRIGGER IF NOT EXISTS memory_entries_ai AFTER INSERT ON memory_entries BEGIN " +
            "INSERT INTO memory_fts(rowid, title, content) " +
            "VALUES (new.id, COALESCE(new.title, ''), new.content); END;",
            "CREATE TRIGGER IF NOT EXISTS memory_entries_ad AFTER DELETE ON memory_entries BEGIN " +
            "INSERT INTO memory_fts(memory_fts, title, content) " +
            "VALUES ('delete', COALESCE(old.title, ''), old.content); END;",
            "CREATE TRIGGER IF NOT EXISTS memory_entries_au_del AFTER UPDATE ON memory_entries BEGIN " +
            "INSERT INTO memory_fts(memory_fts, title, content) " +
            "VALUES ('delete', COALESCE(old.title, ''), old.content); END;",
            "CREATE TRIGGER IF NOT EXISTS memory_entries_au_ins AFTER UPDATE ON memory_entries BEGIN " +
            "INSERT INTO memory_fts(rowid, title, content) " +
            "VALUES (new.id, COALESCE(new.title, ''), new.content); END;"
        };
        WorkerLog.Info($"DbClient: creating {triggerSqls.Length} FTS triggers");
        foreach (var tsql in triggerSqls)
        {
            _db!.Execute(tsql);
        }
        WorkerLog.Info("DbClient: all triggers created successfully");
    }
}
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Database client singleton + DB initialization.
/// Replaces SqlSugarScope with DbService (Microsoft.Data.Sqlite, zero reflection, AOT-safe).
/// dbPath = ~/.wishful-claw/index.db
/// </summary>
public static partial class DbClient
{
    private static readonly object InitLock = new();
    private static DbService? _db;
    private static string? _dbPath;
    private static bool _initialized;

    /// <summary>
    /// Resolve dbPath. Prioritize parameter, fallback to ~/.wishful-claw/index.db
    /// </summary>
    public static string ResolveDbPath(JsonElement? parameters = null)
    {
        if (parameters.HasValue &&
            parameters.Value.ValueKind == JsonValueKind.Object &&
            parameters.Value.TryGetProperty("dbPath", out var dbPathEl) &&
            dbPathEl.ValueKind == JsonValueKind.String &&
            !string.IsNullOrWhiteSpace(dbPathEl.GetString()))
        {
            return Path.GetFullPath(dbPathEl.GetString()!);
        }

        var dataDirectory = Environment.GetEnvironmentVariable("WISHFULCLAW_DATA_DIR");
        if (!string.IsNullOrWhiteSpace(dataDirectory))
        {
            return Path.Combine(Path.GetFullPath(dataDirectory), "index.db");
        }

        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".wishful-claw",
            "index.db");
    }

    /// <summary>
    /// Initialize DB: create directory, open connection, hand-written CREATE TABLE, PRAGMA.
    /// Thread-safe, executes once.
    /// </summary>
    public static DbInitializeResult Initialize(string? dbPathOverride = null)
    {
        var dbPath = dbPathOverride ?? ResolveDbPath();
        // DB-1: concurrent first access (multiple modules hitting IPC at
        // startup) must not run Initialize twice — guard with a lock.
        lock (InitLock)
        {
            // Idempotent early-out: once initialized, a later call with a
            // different dbPath must not silently re-point the global DB.
            if (_initialized && _db is not null)
            {
                if (!string.Equals(_dbPath, dbPath, StringComparison.OrdinalIgnoreCase))
                {
                    WorkerLog.Warn(
                        $"DbClient: ignoring Initialize for different dbPath={dbPath}; keeping {_dbPath}");
                }
                return new DbInitializeResult(true, _dbPath!, null);
            }

        try
        {
            var dir = Path.GetDirectoryName(dbPath);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
            }

            _dbPath = dbPath;
            var connectionString = $"Data Source={dbPath}";
            _db = new DbService(connectionString);

            WorkerLog.Info("DbClient: starting table creation");

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
                    persona_id TEXT
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
                    session_id TEXT PRIMARY KEY NOT NULL,
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
                @"CREATE INDEX IF NOT EXISTS idx_session_compaction_updated
                ON session_compaction_snapshots(updated_at DESC);",
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
                    max_iterations INTEGER NOT NULL DEFAULT 15,
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
                );"
            };

            foreach (var sql in tableSqls)
            {
                _db.Execute(sql);
            }
            WorkerLog.Info($"DbClient: {tableSqls.Length} tables created/verified");

            // ── FTS5 virtual table (external content + trigram tokenizer) ──
            WorkerLog.Info("DbClient: creating memory_fts virtual table (external content)");
            _db.Execute(
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
                _db.Execute(tsql);
            }
            WorkerLog.Info("DbClient: all triggers created successfully");

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
            EnsureColumn("projects", "ssh_connection_id", "TEXT");
            EnsureColumn("projects", "plugin_id", "TEXT");
            EnsureColumn("messages", "usage", "TEXT");
            EnsureColumn("messages", "sort_order", "INTEGER");
            NormalizeChannelSessionMetadata();
            _db.Execute("CREATE INDEX IF NOT EXISTS ix_sessions_channel_route ON sessions(channel_route_key);");
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
            _db.Execute("UPDATE cron_tasks SET output_mode = 'reuse_session' WHERE output_mode = 'new_session' AND delivery_mode = 'session' AND delivery_target IS NOT NULL AND reuse_session_id IS NULL;");
            _db.Execute("UPDATE cron_tasks SET output_mode = 'bot' WHERE output_mode = 'new_session' AND plugin_id IS NOT NULL;");
            _db.Execute("CREATE INDEX IF NOT EXISTS ix_cron_tasks_enabled_next ON cron_tasks(enabled, deleted_at, updated_at);");
            _db.Execute("CREATE INDEX IF NOT EXISTS ix_cron_tasks_session ON cron_tasks(session_id);");
            _db.Execute("CREATE INDEX IF NOT EXISTS ix_cron_tasks_project ON cron_tasks(project_id, scope);");
            _db.Execute("CREATE INDEX IF NOT EXISTS ix_cron_runs_cron_started ON cron_runs(cron_id, started_at DESC);");
            _db.Execute("CREATE INDEX IF NOT EXISTS ix_cron_runs_session_started ON cron_runs(session_id, started_at DESC);");
            NormalizeGoalNumericColumns();
            NormalizeGoalStatuses();
            NormalizeGoalPlansJson();
            EnsureGoalHistorySchema();
            SweepInterruptedGoals();
            WorkerLog.Info("DbClient: migrations completed");

            _initialized = true;
            WorkerLog.Info($"DbClient: initialization completed successfully dbPath={dbPath}");
            return new DbInitializeResult(true, dbPath, null);
        }
        catch (Exception ex)
        {
            _initialized = false;
            // Drop the half-opened client so the next GetClient rebuilds from a
            // clean slate instead of reusing a connection from a failed init.
            _db = null;
            WorkerLog.Error($"DbClient: initialization FAILED at dbPath={dbPath} error={ex.GetType().Name}: {ex.Message}\n{ex.StackTrace}");
            return new DbInitializeResult(false, dbPath, ex.Message);
        }
        }
    }

    /// <summary>
    /// Get the initialized DbService. Auto-initializes with default path if needed.
    /// </summary>
    public static DbService GetClient(JsonElement? parameters = null)
    {
        if (_db is null || !_initialized)
        {
            var dbPath = parameters.HasValue ? ResolveDbPath(parameters) : ResolveDbPath();
            var result = Initialize(dbPath);
            if (!result.Success)
            {
                throw new InvalidOperationException($"DB initialization failed: {result.Error}");
            }
        }

        return _db!;
    }

    /// <summary>
    /// Ensure DB is initialized (from IPC parameters).
    /// </summary>
    public static void EnsureInitialized(JsonElement parameters)
    {
        if (_db is null || !_initialized)
        {
            var dbPath = ResolveDbPath(parameters);
            var result = Initialize(dbPath);
            if (!result.Success)
            {
                throw new InvalidOperationException($"DB initialization failed: {result.Error}");
            }
        }
    }
    /// <summary>
    /// Ensure DB is initialized (no-arg version, for non-IPC contexts).
    /// </summary>
    public static void EnsureInitialized()
    {
        if (_db is null || !_initialized)
        {
            throw new InvalidOperationException("DB has not been initialized. Call EnsureInitialized(parameters) from an IPC handler first.");
        }
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

                _db.Execute(
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
                _db.Execute($"ALTER TABLE {table} ADD COLUMN {column} {columnType};");
            }
        }
        catch
        {
            // Ignore migration errors (column may already exist or table not created yet)
        }
    }
}

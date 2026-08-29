using Microsoft.Data.Sqlite;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Explicit entity mapper functions for SqliteDataReader → entity.
/// AOT-safe: no reflection — all column names are string constants resolved via GetOrdinal at runtime.
/// </summary>
public static class EntityMappers
{
    public static ProjectEntity MapProject(SqliteDataReader r) => new()
    {
        Id = r.GetString("id"),
        Name = r.GetString("name"),
        WorkingFolder = r.GetNullableString("working_folder"),
        SshConnectionId = r.GetNullableString("ssh_connection_id"),
        PluginId = r.GetNullableString("plugin_id"),
        Pinned = r.GetInt32("pinned"),
        CreatedAt = r.GetInt64("created_at"),
        UpdatedAt = r.GetInt64("updated_at")
    };

    public static SessionEntity MapSession(SqliteDataReader r) => new()
    {
        Id = r.GetString("id"),
        Title = r.GetString("title"),
        Icon = r.GetNullableString("icon"),
        Mode = r.GetString("mode"),
        CreatedAt = r.GetInt64("created_at"),
        UpdatedAt = r.GetInt64("updated_at"),
        MessageCount = r.GetInt32("message_count"),
        ProjectId = r.GetNullableString("project_id"),
        WorkingFolder = r.GetNullableString("working_folder"),
        SshConnectionId = r.GetNullableString("ssh_connection_id"),
        PlanId = r.GetNullableString("plan_id"),
        Pinned = r.GetInt32("pinned"),
        PluginId = r.GetNullableString("plugin_id"),
        PluginType = r.GetNullableString("plugin_type"),
        ChannelRouteKey = r.GetNullableString("channel_route_key"),
        ExternalChatId = r.GetNullableString("external_chat_id"),
        ExternalChatType = r.GetNullableString("external_chat_type"),
        ProviderId = r.GetNullableString("provider_id"),
        ModelId = r.GetNullableString("model_id"),
        ModelSelectionMode = r.GetString("model_selection_mode"),
        PersonaId = r.GetNullableString("persona_id")
    };

    public static MessageEntity MapMessage(SqliteDataReader r) => new()
    {
        Id = r.GetString("id"),
        SessionId = r.GetString("session_id"),
        Role = r.GetString("role"),
        Content = r.GetString("content"),
        Meta = r.GetNullableString("meta"),
        CreatedAt = r.GetInt64("created_at"),
        Usage = r.GetNullableString("usage"),
        SortOrder = r.GetInt32("sort_order")
    };

    public static TaskEntity MapTask(SqliteDataReader r) => new()
    {
        Id = r.GetString("id"),
        SessionId = r.GetString("session_id"),
        PlanId = r.GetNullableString("plan_id"),
        Subject = r.GetString("subject"),
        Description = r.GetString("description"),
        ActiveForm = r.GetNullableString("active_form"),
        Status = r.GetString("status"),
        Owner = r.GetNullableString("owner"),
        Blocks = r.GetNullableString("blocks") ?? "[]",
        BlockedBy = r.GetNullableString("blocked_by") ?? "[]",
        Metadata = r.GetNullableString("metadata"),
        SortOrder = r.GetInt32("sort_order"),
        CreatedAt = r.GetInt64("created_at"),
        UpdatedAt = r.GetInt64("updated_at")
    };

    public static GlobalTaskEntity MapGlobalTask(SqliteDataReader r) => new()
    {
        Id = r.GetString("id"),
        Title = r.GetString("title"),
        Description = r.GetString("description"),
        Status = r.GetString("status"),
        Priority = r.GetString("priority"),
        Tags = r.GetNullableString("tags") ?? "[]",
        DueAt = r.GetNullableInt64("due_at"),
        Archived = r.GetInt32("archived"),
        CreatedAt = r.GetInt64("created_at"),
        UpdatedAt = r.GetInt64("updated_at")
    };

    public static GlobalTaskDispatchEntity MapGlobalTaskDispatch(SqliteDataReader r) => new()
    {
        Id = r.GetString("id"),
        GlobalTaskId = r.GetString("global_task_id"),
        ProjectId = r.GetNullableString("project_id"),
        SessionId = r.GetString("session_id"),
        SourceSessionId = r.GetNullableString("source_session_id"),
        Kind = r.GetString("kind"),
        Instruction = r.GetString("instruction"),
        Status = r.GetString("status"),
        LatestReport = r.GetNullableString("latest_report"),
        Error = r.GetNullableString("error"),
        CreatedAt = r.GetInt64("created_at"),
        UpdatedAt = r.GetInt64("updated_at"),
        CompletedAt = r.GetNullableInt64("completed_at")
    };

    public static CompactionSnapshotEntity MapCompactionSnapshot(SqliteDataReader r) => new()
    {
        SessionId = r.GetString("session_id"),
        Version = r.GetInt32("version"),
        Trigger = r.GetString("trigger"),
        WireConversation = r.GetString("wire_conversation"),
        CompactArtifacts = r.GetString("compact_artifacts"),
        SummaryMessage = r.GetNullableString("summary_message"),
        SummaryText = r.GetNullableString("summary_text"),
        ThroughCreatedAt = r.GetInt64("through_created_at"),
        ThroughSortOrder = r.GetInt32("through_sort_order"),
        OriginalCount = r.GetInt32("original_count"),
        NewCount = r.GetInt32("new_count"),
        MessagesSummarized = r.GetInt32("messages_summarized"),
        SummarizerFailed = r.GetInt32("summarizer_failed") != 0,
        CreatedAt = r.GetInt64("created_at"),
        UpdatedAt = r.GetInt64("updated_at")
    };

    public static SshConnectionEntity MapSshConnection(SqliteDataReader r) => new()
    {
        Id = r.GetString("id"),
        GroupId = r.GetNullableString("group_id"),
        Name = r.GetString("name"),
        Host = r.GetString("host"),
        Port = r.GetInt32("port"),
        Username = r.GetString("username"),
        AuthType = r.GetString("auth_type"),
        EncryptedPassword = r.GetNullableString("encrypted_password"),
        PrivateKeyPath = r.GetNullableString("private_key_path"),
        EncryptedPassphrase = r.GetNullableString("encrypted_passphrase"),
        StartupCommand = r.GetNullableString("startup_command"),
        DefaultDirectory = r.GetNullableString("default_directory"),
        KeepAliveInterval = r.GetInt32("keep_alive_interval"),
        SortOrder = r.GetInt32("sort_order"),
        LastConnectedAt = r.GetNullableInt64("last_connected_at"),
        CreatedAt = r.GetInt64("created_at"),
        UpdatedAt = r.GetInt64("updated_at")
    };

    public static PlanEntity MapPlan(SqliteDataReader r) => new()
    {
        Id = r.GetString("id"),
        SessionId = r.GetString("session_id"),
        Title = r.GetString("title"),
        Status = r.GetString("status"),
        FilePath = r.GetNullableString("file_path"),
        Content = r.GetNullableString("content"),
        SpecJson = r.GetNullableString("spec_json"),
        CreatedAt = r.GetInt64("created_at"),
        UpdatedAt = r.GetInt64("updated_at")
    };

    public static GoalEntity MapGoal(SqliteDataReader r) => new()
    {
        GoalId = r.GetString("goal_id"),
        SessionId = r.GetString("session_id"),
        ProjectId = r.GetNullableString("project_id"),
        Objective = r.GetString("objective"),
        Status = r.GetString("status"),
        TokenBudget = r.GetNullableInt64("token_budget"),
        TokensUsed = r.GetInt64("tokens_used"),
        TimeUsedSeconds = r.GetInt64("time_used_seconds"),
        PlansJson = r.GetNullableString("plans_json"),
        PlanCount = r.GetInt32("plan_count"),
        CompletedPlanCount = r.GetInt32("completed_plan_count"),
        CurrentPlanIndex = r.GetInt32("current_plan_index"),
        WorkingFolder = r.GetNullableString("working_folder"),
        ModelConfigJson = r.GetNullableString("model_config_json"),
        CreatedAt = r.GetInt64("created_at"),
        UpdatedAt = r.GetInt64("updated_at")
    };

    public static GoalPlanTaskEntity MapGoalPlanTask(SqliteDataReader r) => new()
    {
        Id = r.GetInt64("id"),
        SessionId = r.GetString("session_id"),
        GoalId = r.GetString("goal_id"),
        PlanId = r.GetString("plan_id"),
        OriginalPlanId = r.GetNullableString("original_plan_id"),
        PlanTitle = r.GetNullableString("plan_title"),
        Round = r.GetInt32("round"),
        Status = r.GetString("status"),
        Description = r.GetNullableString("description"),
        StepsJson = r.GetNullableString("steps_json"),
        Summary = r.GetNullableString("summary"),
        EvaluationReasoning = r.GetNullableString("evaluation_reasoning"),
        EvaluationSatisfied = r.GetNullableInt32("evaluation_satisfied") is int v && v != 0,
        Adjusted = r.GetBoolAsInt("adjusted") != 0,
        StartedAt = r.GetInt64("started_at"),
        FinishedAt = r.GetNullableInt64("finished_at")
    };

    public static GoalPlanEntity MapGoalPlan(SqliteDataReader r) => new()
    {
        PlanId = r.GetString("plan_id"),
        GoalId = r.GetString("goal_id"),
        SessionId = r.GetString("session_id"),
        Ordinal = r.GetInt32("ordinal"),
        OriginalPlanId = r.GetNullableString("original_plan_id"),
        Title = r.GetString("title"),
        Description = r.GetString("description"),
        ContentJson = r.GetNullableString("content_json"),
        Status = r.GetString("status"),
        RetryCount = r.GetInt32("retry_count"),
        ResultSummary = r.GetNullableString("result_summary"),
        CreatedAt = r.GetInt64("created_at"),
        UpdatedAt = r.GetInt64("updated_at"),
        StartedAt = r.GetNullableInt64("started_at"),
        CompletedAt = r.GetNullableInt64("completed_at")
    };

    public static GoalTaskEntity MapGoalTask(SqliteDataReader r) => new()
    {
        TaskId = r.GetString("task_id"),
        GoalId = r.GetString("goal_id"),
        PlanId = r.GetString("plan_id"),
        SessionId = r.GetString("session_id"),
        Ordinal = r.GetInt32("ordinal"),
        Title = r.GetString("title"),
        Description = r.GetString("description"),
        ContentJson = r.GetNullableString("content_json"),
        Status = r.GetString("status"),
        RetryCount = r.GetInt32("retry_count"),
        ResultSummary = r.GetNullableString("result_summary"),
        CreatedAt = r.GetInt64("created_at"),
        UpdatedAt = r.GetInt64("updated_at"),
        StartedAt = r.GetNullableInt64("started_at"),
        CompletedAt = r.GetNullableInt64("completed_at")
    };

    public static GoalExecutionRunEntity MapGoalExecutionRun(SqliteDataReader r) => new()
    {
        AttemptId = r.GetString("attempt_id"),
        GoalId = r.GetString("goal_id"),
        PlanId = r.GetNullableString("plan_id"),
        TaskId = r.GetNullableString("task_id"),
        AttemptNo = r.GetInt32("attempt_no"),
        Status = r.GetString("status"),
        Summary = r.GetNullableString("summary"),
        Error = r.GetNullableString("error"),
        StartedAt = r.GetInt64("started_at"),
        FinishedAt = r.GetNullableInt64("finished_at")
    };

    public static GoalEventEntity MapGoalEvent(SqliteDataReader r) => new()
    {
        Id = r.GetInt64("id"),
        SessionId = r.GetString("session_id"),
        GoalId = r.GetNullableString("goal_id"),
        EventType = r.GetString("event_type"),
        Message = r.GetNullableString("message"),
        MetadataJson = r.GetNullableString("metadata_json"),
        CreatedAt = r.GetInt64("created_at")
    };

    public static SubAgentRunEntity MapSubAgentRun(SqliteDataReader r) => new()
    {
        ToolUseId = r.GetString("tool_use_id"),
        SessionId = r.GetString("session_id"),
        AgentName = r.GetString("agent_name"),
        Data = r.GetString("data"),
        StartedAt = r.GetInt64("started_at"),
        CompletedAt = r.GetNullableInt64("completed_at"),
        Success = r.GetNullableInt32("success")
    };

    public static MemoryEntryEntity MapMemoryEntry(SqliteDataReader r) => new()
    {
        Id = r.GetInt64("id"),
        Scope = r.GetString("scope"),
        Title = r.GetNullableString("title"),
        Content = r.GetString("content"),
        Priority = r.GetString("priority"),
        Status = r.GetString("status"),
        CreatedAt = r.GetInt64("created_at"),
        UpdatedAt = r.GetInt64("updated_at")
    };

    public static MemoryArchiveEntity MapMemoryArchive(SqliteDataReader r) => new()
    {
        Id = r.GetString("id"),
        Scope = r.GetString("scope"),
        Key = r.GetString("key"),
        Title = r.GetNullableString("title"),
        Content = r.GetString("content"),
        Priority = r.GetString("priority"),
        CreatedAt = r.GetInt64("created_at"),
        ArchivedAt = r.GetInt64("archived_at")
    };

    public static CronRunEntity MapCronRun(SqliteDataReader r) => new()
    {
        RunId = r.GetString("run_id"),
        CronId = r.GetString("cron_id"),
        SessionId = r.GetNullableString("session_id"),
        FireId = r.GetString("fire_id"),
        Status = r.GetString("status"),
        Summary = r.GetNullableString("summary"),
        Error = r.GetNullableString("error"),
        ToolCallCount = r.GetInt32("tool_call_count"),
        StartedAt = r.GetInt64("started_at"),
        FinishedAt = r.GetNullableInt64("finished_at")
    };

    public static CronEntity MapCron(SqliteDataReader r) => new()
    {
        Id = r.GetString("id"),
        Name = r.GetString("name"),
        SessionId = r.GetNullableString("session_id"),
        Scope = r.GetString("scope"),
        ProjectId = r.GetNullableString("project_id"),
        ScheduleJson = r.GetString("schedule_json"),
        Prompt = r.GetString("prompt"),
        AgentId = r.GetNullableString("agent_id"),
        Model = r.GetNullableString("model"),
        WorkingFolder = r.GetNullableString("working_folder"),
        DeliveryMode = r.GetString("delivery_mode"),
        OutputMode = r.GetString("output_mode"),
        ReuseSessionId = r.GetNullableString("reuse_session_id"),
        RunMode = r.GetString("run_mode"),
        DeliveryTarget = r.GetNullableString("delivery_target"),
        PluginId = r.GetNullableString("plugin_id"),
        PluginType = r.GetNullableString("plugin_type"),
        PluginChatId = r.GetNullableString("plugin_chat_id"),
        DeleteAfterRun = r.GetBoolAsInt("delete_after_run") != 0,
        MaxIterations = r.GetInt32("max_iterations"),
        Enabled = r.GetBoolAsInt("enabled") != 0,
        DeletedAt = r.GetNullableInt64("deleted_at"),
        LastFiredAt = r.GetNullableInt64("last_fired_at"),
        LastRunAt = r.GetNullableInt64("last_run_at"),
        LastRunStatus = r.GetNullableString("last_run_status"),
        LastRunSummary = r.GetNullableString("last_run_summary"),
        LastError = r.GetNullableString("last_error"),
        FireCount = r.GetInt64("fire_count"),
        CreatedAt = r.GetInt64("created_at"),
        UpdatedAt = r.GetInt64("updated_at")
    };
}

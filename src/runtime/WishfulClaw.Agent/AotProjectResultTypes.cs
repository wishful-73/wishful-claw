namespace WishfulClaw.Agent;

// AOT-safe record types for AgentRuntimeProjectExecutor results.
// All properties use PascalCase; JsonOptions with CamelCase naming policy
// serializes them as camelCase to match previous anonymous-type behavior.

public record ProjectListRow(
    string Id,
    string Name,
    string? WorkingFolder,
    int SessionCount,
    int ActiveSessionCount);

public record ProjectListResult(
    List<ProjectListRow> Projects,
    int Total);

public record SessionListRow(
    string Id,
    string Title,
    string Mode,
    int MessageCount,
    long CreatedAt,
    long UpdatedAt);

public record ProjectDetailResult(
    string Id,
    string Name,
    string? WorkingFolder,
    List<SessionListRow> Sessions,
    string TaskStatus,
    bool HasTaskStatus,
    bool StatusFileNeedsUpdate,
    string StatusUpdateTemplate,
    string SuggestedSessionId);

public record CreateSessionResult(
    string SessionId,
    string Title,
    string? ProjectId,
    long CreatedAt);

// S-103: create_project 的结果。WorkingFolder 是服务端拼出来的绝对路径（回显给模型，
// 免得它去猜落在哪）；ReusedExistingDirectory 说明这个目录本来就存在、只是挂了个新项目上去。
public record CreateProjectResult(
    string Id,
    string Name,
    string WorkingFolder,
    string ParentDirectory,
    bool ReusedExistingDirectory);

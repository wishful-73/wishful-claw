namespace WishfulClaw.Agent;

// AOT-safe record types for AgentRuntimeGlobalTaskExecutor results.
// All properties use PascalCase; JsonOptions with CamelCase naming policy
// serializes them as camelCase.

public record GlobalTaskCreateToolResult(
    string TaskId,
    string Title,
    string Status,
    long CreatedAt);

public record GlobalTaskMutationToolResult(
    bool Success,
    string TaskId,
    int Changed,
    string? Error);

public record GlobalDispatchCreateToolResult(
    bool Success,
    string DispatchId,
    string GlobalTaskId,
    string SessionId,
    string Status,
    string? Error);

public record GlobalDispatchUpdateToolResult(
    bool Success,
    string DispatchId,
    int Changed,
    string? Error);

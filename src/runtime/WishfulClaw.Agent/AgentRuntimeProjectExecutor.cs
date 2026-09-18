using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using Microsoft.Data.Sqlite;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Project management tools executor — list_projects / get_project_details / create_session / send_session_message.
/// The first three tools execute directly in Worker (DB operations).
/// send_session_message uses a reverse-request to the renderer, which dispatches it via normal sendMessage.
/// </summary>
public static class AgentRuntimeProjectExecutor
{
    private static readonly HashSet<string> ProjectToolNames = new(StringComparer.Ordinal)
    {
        "list_projects", "get_project_details", "create_session", "send_session_message", "update_session_follow_up"
    };

    public static bool IsProjectTool(string toolName)
    {
        return ProjectToolNames.Contains(toolName);
    }

    public static async Task<string> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        JsonElement parameters,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        return call.Name switch
        {
            "list_projects" => await ListProjectsAsync(call.Input, parameters, cancellationToken),
            "get_project_details" => await GetProjectDetailsAsync(call.Input, parameters, cancellationToken),
            "create_session" => await CreateSessionAsync(call.Input, parameters, cancellationToken),
            "send_session_message" => await SendSessionMessageAsync(call.Input, parameters, context, cancellationToken),
            "update_session_follow_up" => await UpdateSessionFollowUpAsync(call.Input, parameters, context, cancellationToken),
            _ => EncodeError($"Project tool not registered: {call.Name}")
        };
    }

    // ── list_projects ──

    private static Task<string> ListProjectsAsync(
        JsonElement input, JsonElement parameters, CancellationToken cancellationToken)
    {
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            var filter = JsonHelpers.GetString(input, "filter")?.Trim() ?? string.Empty;

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            string sql = filter.Length > 0
                ? "SELECT * FROM projects WHERE name LIKE @filter ORDER BY pinned DESC, updated_at DESC"
                : "SELECT * FROM projects ORDER BY pinned DESC, updated_at DESC";
            var filterParam = filter.Length > 0
                ? new[] { new SqliteParameter("@filter", $"%{filter}%") }
                : Array.Empty<SqliteParameter>();
            var entities = db.Query(sql, EntityMappers.MapProject, filterParam);

            var rows = entities.Select(e =>
            {
                var sessionCount = db.QueryScalar<int>(
                    "SELECT COUNT(*) FROM sessions WHERE project_id = @id",
                    new SqliteParameter("@id", e.Id));

                var activeSessionCount = db.QueryScalar<int>(
                    "SELECT COUNT(*) FROM sessions WHERE project_id = @id AND updated_at > @cutoff",
                    new SqliteParameter("@id", e.Id),
                    new SqliteParameter("@cutoff", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 3600000));

                return new ProjectListRow(
                    e.Id, e.Name, e.WorkingFolder, sessionCount, activeSessionCount);
            }).ToList();

            var result = JsonSerializer.Serialize(
                new ProjectListResult(rows, rows.Count),
                WorkerJsonHelper.GetTypeInfo<ProjectListResult>());

            return Task.FromResult(result);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            return Task.FromResult(EncodeError($"Failed to list projects: {ex.Message}"));
        }
    }

    // ── get_project_details ──

    private static async Task<string> GetProjectDetailsAsync(
        JsonElement input, JsonElement parameters, CancellationToken cancellationToken)
    {
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            var projectId = RequireString(input, "projectId");

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            // Find project
            var project = db.QueryFirstOrDefault("SELECT * FROM projects WHERE id = @id",
                EntityMappers.MapProject, new SqliteParameter("@id", projectId));
            if (project is null)
            {
                return EncodeError($"Project not found: {projectId}");
            }

            // Get sessions for this project (last 20)
            var sessions = db.Query(
                "SELECT * FROM sessions WHERE project_id = @pid ORDER BY updated_at DESC LIMIT 20",
                EntityMappers.MapSession, new SqliteParameter("@pid", projectId));

            var sessionRows = sessions.Select(s => new SessionListRow(
                s.Id, s.Title, s.Mode, s.MessageCount, s.CreatedAt, s.UpdatedAt)).ToList();

            // Check project-status.md: exists, stale, and provide update template
            string? taskStatus = null;
            bool statusFileNeedsUpdate = false;
            long statusFileAge = 0;

            if (!string.IsNullOrEmpty(project.WorkingFolder))
            {
                var statusFilePath = Path.Combine(project.WorkingFolder, WishfulClawPaths.DataDirName, "project-status.md");
                if (File.Exists(statusFilePath))
                {
                    taskStatus = File.ReadAllText(statusFilePath);
                    var lastWrite = File.GetLastWriteTimeUtc(statusFilePath);
                    statusFileAge = (long)(DateTime.UtcNow - lastWrite).TotalMilliseconds;
                    // Stale if older than 1 hour
                    if (statusFileAge > 3600000)
                    {
                        statusFileNeedsUpdate = true;
                    }
                }
                else
                {
                    statusFileNeedsUpdate = true;
                }
            }

            // Fixed template message for Agent to send via send_session_message
            var statusUpdateTemplate = statusFileNeedsUpdate
                ? GenerateStatusUpdateTemplate(project.Name, project.WorkingFolder ?? "")
                : "";

            // Find the most recent active session (updated within last hour) for convenience
            var activeSessionId = sessions
                .Where(s => s.UpdatedAt > (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 3600000))
                .OrderByDescending(s => s.UpdatedAt)
                .Select(s => s.Id)
                .FirstOrDefault() ?? sessions.FirstOrDefault()?.Id;

            var result = JsonSerializer.Serialize(
                new ProjectDetailResult(
                    project.Id,
                    project.Name,
                    project.WorkingFolder,
                    sessionRows,
                    taskStatus ?? "",
                    taskStatus is not null,
                    statusFileNeedsUpdate,
                    statusUpdateTemplate,
                    activeSessionId ?? ""),
                WorkerJsonHelper.GetTypeInfo<ProjectDetailResult>());

            return result;
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            return EncodeError($"Failed to get project details: {ex.Message}");
        }
    }

    // ── create_session ──

    private static Task<string> CreateSessionAsync(
        JsonElement input, JsonElement parameters, CancellationToken cancellationToken)
    {
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            var projectId = RequireString(input, "projectId");
            var sessionName = JsonHelpers.GetString(input, "sessionName")?.Trim();
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            // Find project to get working folder
            var project = db.QueryFirstOrDefault("SELECT * FROM projects WHERE id = @id",
                EntityMappers.MapProject, new SqliteParameter("@id", projectId));
            if (project is null)
            {
                return Task.FromResult(EncodeError($"Project not found: {projectId}"));
            }

            var sessionId = $"wc_{Guid.NewGuid():N}";
            var title = sessionName ?? $"New Task - {DateTime.UtcNow:yyyy-MM-dd HH:mm}";

            var entity = new SessionEntity
            {
                Id = sessionId,
                Title = title,
                Mode = "chat",
                CreatedAt = now,
                UpdatedAt = now,
                MessageCount = 0,
                ProjectId = projectId,
                WorkingFolder = project.WorkingFolder,
                SshConnectionId = project.SshConnectionId,
                Pinned = 0
            };

            db.Execute(
                "INSERT INTO sessions (id, title, mode, created_at, updated_at, message_count, " +
                "project_id, working_folder, ssh_connection_id, pinned) " +
                "VALUES (@id, @title, @mode, @ca, @ua, 0, @pid, @wf, @ssh, 0)",
                new SqliteParameter("@id", entity.Id),
                new SqliteParameter("@title", entity.Title),
                new SqliteParameter("@mode", entity.Mode),
                new SqliteParameter("@ca", entity.CreatedAt),
                new SqliteParameter("@ua", entity.UpdatedAt),
                new SqliteParameter("@pid", (object?)entity.ProjectId ?? DBNull.Value),
                new SqliteParameter("@wf", (object?)entity.WorkingFolder ?? DBNull.Value),
                new SqliteParameter("@ssh", (object?)entity.SshConnectionId ?? DBNull.Value));

            var result = JsonSerializer.Serialize(
                new CreateSessionResult(sessionId, title, projectId, now),
                WorkerJsonHelper.GetTypeInfo<CreateSessionResult>());

            return Task.FromResult(result);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            return Task.FromResult(EncodeError($"Failed to create session: {ex.Message}"));
        }
    }

    // ── send_session_message ──

    private static async Task<string> SendSessionMessageAsync(
        JsonElement input, JsonElement parameters, IWorkerRequestContext context, CancellationToken cancellationToken)
    {
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            var sessionId = RequireString(input, "sessionId");
            var content = RequireString(input, "content");
            var workingFolder = JsonHelpers.GetString(input, "workingFolder")?.Trim();
            var projectId = JsonHelpers.GetString(input, "projectId")?.Trim();
            var sourceSessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim();
            var hasFollowUp = input.TryGetProperty("followUp", out var followUp) &&
                followUp.ValueKind == JsonValueKind.Object;
            if (hasFollowUp && string.IsNullOrWhiteSpace(sourceSessionId))
                throw new InvalidOperationException("A source session is required for follow-up tracking");

            // Build reverse request params
            var reverseParams = WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                w.WriteString("sessionId", sessionId);
                w.WriteString("content", content);
                w.WriteString("workingFolder", workingFolder ?? string.Empty);
                w.WriteString("projectId", projectId ?? string.Empty);
                if (hasFollowUp)
                {
                    w.WritePropertyName("followUp");
                    w.WriteStartObject();
                    w.WriteString("id", $"sf_{Guid.NewGuid():N}");
                    w.WriteString("todoId", RequireString(followUp, "todoId"));
                    w.WriteString("sourceSessionId", sourceSessionId);
                    w.WriteString("targetSessionId", sessionId);
                    if (!followUp.TryGetProperty("delayMs", out var delayMs) ||
                        delayMs.ValueKind != JsonValueKind.Number || !delayMs.TryGetInt64(out var delay) || delay < 1000)
                        throw new InvalidOperationException("Missing or invalid required field: followUp.delayMs (minimum 1000)");
                    var followUpAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + delay;
                    w.WriteNumber("followUpAt", followUpAt);
                    w.WriteString("queryInstruction", RequireString(followUp, "queryInstruction"));
                    if (followUp.TryGetProperty("notificationKey", out var notificationKey) &&
                        notificationKey.ValueKind == JsonValueKind.String)
                        w.WriteString("notificationKey", notificationKey.GetString());
                    w.WriteEndObject();
                }
                w.WriteEndObject();
            });

            // Emit reverse request to renderer
            var result = await AgentRuntimeReverseRequests.RequestAsync(
                context, "project/send-session-message", reverseParams, cancellationToken);

            // S-58：渲染端 handler 返回 { success, result?, error?, followUpId? }。以前这里直接
            // ToString() 把整份 JSON 交给 agent —— 「已受理但排队」那条分支的回执里带着
            // success:false，agent 读到原文就当成派发失败。按 success 决定输出走向：
            // 失败才进错误通道，成功只把 result 文案交出去。
            return FormatSendSessionMessageResult(result);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            return EncodeError($"Failed to send session message: {ex.Message}");
        }
    }

    private static async Task<string> UpdateSessionFollowUpAsync(
        JsonElement input, JsonElement parameters, IWorkerRequestContext context, CancellationToken cancellationToken)
    {
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            var followUpId = RequireString(input, "followUpId");
            var claimToken = RequireString(input, "claimToken");
            var action = RequireString(input, "action");
            var result = RequireString(input, "lastQueryResult");
            var sourceSessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim();
            if (string.IsNullOrWhiteSpace(sourceSessionId))
                throw new InvalidOperationException("A source session is required to update a follow-up");
            var status = action switch
            {
                "complete" => "completed",
                "reschedule" => "waiting",
                "fail" => "failed",
                _ => throw new InvalidOperationException("action must be complete, reschedule, or fail")
            };

            long? followUpAt = null;
            if (status == "waiting")
            {
                if (!input.TryGetProperty("delayMs", out var delayMsElement) ||
                    delayMsElement.ValueKind != JsonValueKind.Number ||
                    !delayMsElement.TryGetInt64(out var delay) || delay < 1000)
                    throw new InvalidOperationException("delayMs is required for reschedule and must be at least 1000");
                followUpAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + delay;
            }

            var reverseParams = WorkerJsonHelper.BuildJsonElement(writer =>
            {
                writer.WriteStartObject();
                writer.WriteString("followUpId", followUpId);
                writer.WriteString("claimToken", claimToken);
                writer.WriteString("sourceSessionId", sourceSessionId);
                writer.WriteString("action", action);
                writer.WriteString("lastQueryResult", result);
                if (followUpAt.HasValue) writer.WriteNumber("followUpAt", followUpAt.Value);
                var error = JsonHelpers.GetString(input, "error")?.Trim();
                if (!string.IsNullOrWhiteSpace(error)) writer.WriteString("error", error);
                writer.WriteEndObject();
            });

            var response = await AgentRuntimeReverseRequests.RequestAsync(
                context, "session-follow-up/update", reverseParams, cancellationToken);
            return response.ValueKind == JsonValueKind.String
                ? response.GetString() ?? string.Empty
                : response.ToString();
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            return EncodeError($"Failed to update session follow-up: {ex.Message}");
        }
    }

    // ── Helpers ──

    private static string RequireString(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException($"Expected object, got {element.ValueKind}");

        if (!element.TryGetProperty(name, out var prop) || prop.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException($"Missing or invalid required field: {name}");

        var value = prop.GetString()?.Trim();
        if (string.IsNullOrEmpty(value))
            throw new InvalidOperationException($"Required field '{name}' is empty");

        return value;
    }

    /// <summary>
    /// 把渲染端 send-session-message handler 的返回对象转成工具输出。
    /// 返回对象形如 { success, result?, error?, followUpId? }：只有 success 为 false
    /// 才走错误通道（EncodeError），成功时只交出 result 文案，避免 agent 读到整份 JSON。
    /// </summary>
    internal static string FormatSendSessionMessageResult(JsonElement result)
    {
        if (result.ValueKind != JsonValueKind.Object)
        {
            var text = result.ValueKind == JsonValueKind.String
                ? result.GetString() ?? string.Empty
                : result.ToString();
            return string.IsNullOrEmpty(text) ? "Message sent successfully." : text;
        }

        var succeeded = !result.TryGetProperty("success", out var success) ||
            success.ValueKind != JsonValueKind.False;
        var message = JsonHelpers.GetString(result, "result")?.Trim();

        if (!succeeded)
        {
            var error = JsonHelpers.GetString(result, "error")?.Trim();
            return EncodeError(string.IsNullOrEmpty(error) ? "Failed to send session message." : error);
        }

        return string.IsNullOrEmpty(message) ? "Message sent successfully." : message;
    }

    private static string EncodeError(string message)
    {
        var buffer = new System.Buffers.ArrayBufferWriter<byte>();
        using (var writer = new System.Text.Json.Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("error", message);
            writer.WriteEndObject();
        }
        return System.Text.Encoding.UTF8.GetString(buffer.WrittenSpan);
    }
    /// <summary>
    /// Generate a fixed template message for the Agent to send to a project session,
    /// instructing it to organize and write a clean project-status.md summary.
    /// </summary>
    private static string GenerateStatusUpdateTemplate(string projectName, string workingFolder)
    {
        return $"Please organize the current task status for project **{projectName}** " +
            $"and write a clean summary to `.wishful-claw/project-status.md` in the working directory.\n\n" +
            "The status file should include:\n" +
            "- **Active tasks**: what's currently being worked on\n" +
            "- **Recent changes**: what was done recently\n" +
            "- **Next steps**: what's planned next\n" +
            "- **Blockers**: any issues that need attention\n\n" +
            "Please review the current conversation history, plans, and goals to produce " +
            "an accurate and up-to-date summary. Write the file in Markdown format " +
            $"at `{workingFolder}/.wishful-claw/project-status.md`.";
    }
}
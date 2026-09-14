using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// DB endpoints for the agent timeline (agent_timeline_events table, S-25).
/// One row per decision-level agent action. Endpoints follow the db/* contract:
/// camelCase input params, snake_case JSON results. The <see cref="Log"/> helper
/// is the in-worker write path used by instrumentation sites; it must never
/// throw — timeline persistence failure must not break the main flow.
/// </summary>
public static class DbAgentTimelineTools
{
    private const string SelectColumns =
        "SELECT id, session_id, project_id, event_type, message, metadata_json, created_at FROM agent_timeline_events";

    // Retention: 30 days AND at most 20,000 rows (whichever trims first).
    // Public: the regression suite and the panel footer read them as contract.
    public const int RetentionDays = 30;
    public const int RetentionMaxRows = 20_000;

    /// <summary>
    /// In-worker write path for instrumentation sites. Best-effort: swallows and
    /// logs any failure so timeline writes can never break the caller's flow.
    /// </summary>
    public static void Log(
        DbService db,
        string? sessionId,
        string? projectId,
        string eventType,
        string? message,
        string? metadataJson)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(eventType)) return;
            db.Execute(
                "INSERT INTO agent_timeline_events (session_id, project_id, event_type, message, metadata_json, created_at) " +
                "VALUES (@sid, @pid, @et, @msg, @mj, @ca)",
                new SqliteParameter("@sid", (object?)sessionId ?? DBNull.Value),
                new SqliteParameter("@pid", (object?)projectId ?? DBNull.Value),
                new SqliteParameter("@et", eventType),
                new SqliteParameter("@msg", (object?)message ?? DBNull.Value),
                new SqliteParameter("@mj", (object?)metadataJson ?? DBNull.Value),
                new SqliteParameter("@ca", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbAgentTimelineTools.Log failed: {ex.Message}");
        }
    }

    public static WorkerResponse Add(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var eventType = GetString(parameters, "eventType");
            if (string.IsNullOrWhiteSpace(eventType))
                return WorkerResponse.Json(
                    new AgentTimelineMutationResult(false, null, "eventType is required"),
                    InfrastructureJsonContext.Default.AgentTimelineMutationResult);

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            db.Execute(
                "INSERT INTO agent_timeline_events (session_id, project_id, event_type, message, metadata_json, created_at) " +
                "VALUES (@sid, @pid, @et, @msg, @mj, @ca)",
                new SqliteParameter("@sid", (object?)GetString(parameters, "sessionId") ?? DBNull.Value),
                new SqliteParameter("@pid", (object?)GetString(parameters, "projectId") ?? DBNull.Value),
                new SqliteParameter("@et", eventType),
                new SqliteParameter("@msg", (object?)GetString(parameters, "message") ?? DBNull.Value),
                new SqliteParameter("@mj", (object?)GetString(parameters, "metadataJson") ?? DBNull.Value),
                new SqliteParameter("@ca", now));

            var row = new AgentTimelineEventRow
            {
                SessionId = GetString(parameters, "sessionId"),
                ProjectId = GetString(parameters, "projectId"),
                EventType = eventType,
                Message = GetString(parameters, "message"),
                MetadataJson = GetString(parameters, "metadataJson"),
                CreatedAt = now
            };
            return WorkerResponse.Json(
                new AgentTimelineMutationResult(true, row, null),
                InfrastructureJsonContext.Default.AgentTimelineMutationResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbAgentTimelineTools.Add failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    /// <summary>
    /// List events with cursor pagination (newest first). Optional sessionId
    /// filter; when omitted returns the global feed (all sessions + app-level
    /// rows). Cursor = (beforeCreatedAt, beforeId) from the previous page tail.
    /// </summary>
    public static WorkerResponse ListPage(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var limit = Math.Clamp(GetInt(parameters, "limit", 100), 1, 500);
            var sessionId = GetString(parameters, "sessionId");
            var projectId = GetString(parameters, "projectId");
            var beforeCreatedAt = GetLong(parameters, "beforeCreatedAt");
            var beforeId = GetLong(parameters, "beforeId");

            var sql = $"{SelectColumns} WHERE 1=1";
            var sqlParams = new List<SqliteParameter> { new("@limit", limit) };
            if (!string.IsNullOrEmpty(sessionId))
            {
                sql += " AND session_id = @sid";
                sqlParams.Add(new SqliteParameter("@sid", sessionId));
            }
            if (!string.IsNullOrEmpty(projectId))
            {
                sql += " AND project_id = @pid";
                sqlParams.Add(new SqliteParameter("@pid", projectId));
            }
            if (beforeCreatedAt is { } bc && beforeId is { } bi)
            {
                sql += " AND (created_at < @bca OR (created_at = @bca AND id < @bid))";
                sqlParams.Add(new SqliteParameter("@bca", bc));
                sqlParams.Add(new SqliteParameter("@bid", bi));
            }
            sql += " ORDER BY created_at DESC, id DESC LIMIT @limit";

            var rows = db.Query(sql, MapRow, [.. sqlParams]);
            var hasMore = rows.Count == limit;
            AgentTimelinePageResult result = hasMore && rows.Count > 0
                ? new AgentTimelinePageResult(rows, true, rows[^1].CreatedAt, rows[^1].Id)
                : new AgentTimelinePageResult(rows, false, null, null);
            return WorkerResponse.Json(result, InfrastructureJsonContext.Default.AgentTimelinePageResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbAgentTimelineTools.ListPage failed: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    /// <summary>
    /// Retention enforcement (plan S-25.5): keep 30 days and at most
    /// <see cref="RetentionMaxRows"/> rows, whichever trims first. Called once
    /// per worker DB init from <see cref="DbClient"/> — no dedicated timer.
    /// </summary>
    public static void Prune(DbService db)
    {
        try
        {
            var cutoff = DateTimeOffset.UtcNow.AddDays(-RetentionDays).ToUnixTimeMilliseconds();
            var byAge = db.Execute(
                "DELETE FROM agent_timeline_events WHERE created_at < @cutoff",
                new SqliteParameter("@cutoff", cutoff));
            var byCount = db.Execute(
                $"DELETE FROM agent_timeline_events WHERE id NOT IN " +
                "(SELECT id FROM agent_timeline_events ORDER BY created_at DESC, id DESC LIMIT @max)",
                new SqliteParameter("@max", RetentionMaxRows));
            if (byAge > 0 || byCount > 0)
                WorkerLog.Info($"DbAgentTimelineTools: pruned timeline events (byAge={byAge}, byCount={byCount})");
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbAgentTimelineTools.Prune failed: {ex.Message}");
        }
    }

    private static AgentTimelineEventRow MapRow(SqliteDataReader r) => new()
    {
        Id = r.GetInt64(0),
        SessionId = r.IsDBNull(1) ? null : r.GetString(1),
        ProjectId = r.IsDBNull(2) ? null : r.GetString(2),
        EventType = r.IsDBNull(3) ? string.Empty : r.GetString(3),
        Message = r.IsDBNull(4) ? null : r.GetString(4),
        MetadataJson = r.IsDBNull(5) ? null : r.GetString(5),
        CreatedAt = r.GetInt64(6)
    };

    private static string? GetString(JsonElement parameters, string name) =>
        parameters.ValueKind == JsonValueKind.Object &&
        parameters.TryGetProperty(name, out var v) &&
        v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    private static int GetInt(JsonElement parameters, string name, int fallback)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty(name, out var v) ||
            v.ValueKind != JsonValueKind.Number)
            return fallback;
        return v.TryGetInt32(out var i) ? i : fallback;
    }

    private static long? GetLong(JsonElement parameters, string name)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty(name, out var v) ||
            v.ValueKind != JsonValueKind.Number)
            return null;
        return v.TryGetInt64(out var l) ? l : null;
    }
}

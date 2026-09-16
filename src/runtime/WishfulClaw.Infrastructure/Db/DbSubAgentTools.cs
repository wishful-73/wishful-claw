using System.Text.Json.Serialization.Metadata;
﻿using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Infrastructure.Db;

public static class DbSubAgentTools
{
    public static WorkerResponse ReadByToolUseId(JsonElement parameters)
    {
        try
        {
            var toolUseId = RequireString(parameters, "toolUseId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var entity = db.QueryFirstOrDefault(
                "SELECT * FROM sub_agent_runs WHERE tool_use_id = @id",
                EntityMappers.MapSubAgentRun, new SqliteParameter("@id", toolUseId));

            if (entity is null)
                return WorkerResponse.Json(new SubAgentFindResult(false), InfrastructureJsonContext.Default.SubAgentFindResult);

            // JsonDocument.Parse is AOT-safe (no reflection needed for DOM types).
            using var doc = JsonDocument.Parse(entity.Data);
            return WorkerResponse.Json(new SubAgentFindResult(true, doc.RootElement.Clone()), InfrastructureJsonContext.Default.SubAgentFindResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbSubAgentTools.ReadByToolUseId failed: {ex.GetType().Name}: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse ReadSession(JsonElement parameters)
    {
        try
        {
            var sessionId = RequireString(parameters, "sessionId");
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var entities = db.Query(
                "SELECT * FROM sub_agent_runs WHERE session_id = @sid ORDER BY started_at DESC",
                EntityMappers.MapSubAgentRun, new SqliteParameter("@sid", sessionId));

            var rows = entities.Select(SubAgentRunRow.FromEntity).ToList();
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListSubAgentRunRow);
        }
        catch (Exception ex) { WorkerLog.Error($"DbSubAgentTools.ReadSession failed: {ex.GetType().Name}: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Index(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var sessions = db.Query(
                "SELECT session_id, COUNT(*) AS cnt, MAX(started_at) AS latest " +
                "FROM sub_agent_runs GROUP BY session_id ORDER BY latest DESC",
                r => new SubAgentSessionSummary(r.GetString("session_id"), r.GetInt32("cnt"), r.GetInt64("latest")));

            var total = db.QueryScalar<int>("SELECT COUNT(*) FROM sub_agent_runs");
            return WorkerResponse.Json(new SubAgentIndexResult(total, sessions), InfrastructureJsonContext.Default.SubAgentIndexResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbSubAgentTools.Index failed: {ex.GetType().Name}: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Apply(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            if (parameters.TryGetProperty("upserts", out var upsertsEl) && upsertsEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in upsertsEl.EnumerateArray())
                {
                    var entity = ParseSubAgentRecord(item);
                    if (entity is null) continue;

                    var existing = db.QueryFirstOrDefault(
                        "SELECT * FROM sub_agent_runs WHERE tool_use_id = @id",
                        EntityMappers.MapSubAgentRun, new SqliteParameter("@id", entity.ToolUseId));

                    if (existing is not null)
                    {
                        // 渲染端 upsert 带的是它自己那份 data，会把 Worker 落库的 finalOutput
                        // 冲掉 —— 更新前先把库里的权威报告键搬过去（S-36）。
                        var mergedData = PreserveFinalOutput(existing.Data, entity.Data);
                        db.Execute(
                            "UPDATE sub_agent_runs SET agent_name = @name, data = @data, started_at = @sa, " +
                            "completed_at = @ca, success = @suc WHERE tool_use_id = @id",
                            new SqliteParameter("@name", entity.AgentName),
                            new SqliteParameter("@data", mergedData),
                            new SqliteParameter("@sa", entity.StartedAt),
                            new SqliteParameter("@ca", (object?)entity.CompletedAt ?? DBNull.Value),
                            new SqliteParameter("@suc", (object?)entity.Success ?? DBNull.Value),
                            new SqliteParameter("@id", entity.ToolUseId));
                    }
                    else
                    {
                        InsertSubAgentRun(db, entity);
                    }
                }
            }

            if (parameters.TryGetProperty("removeIds", out var removeIdsEl) && removeIdsEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var id in removeIdsEl.EnumerateArray())
                {
                    var idStr = id.GetString();
                    if (!string.IsNullOrEmpty(idStr))
                        db.Execute("DELETE FROM sub_agent_runs WHERE tool_use_id = @id", new SqliteParameter("@id", idStr));
                }
            }

            if (parameters.TryGetProperty("removeSessionIds", out var removeSidsEl) && removeSidsEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var sid in removeSidsEl.EnumerateArray())
                {
                    var sidStr = sid.GetString();
                    if (!string.IsNullOrEmpty(sidStr))
                        db.Execute("DELETE FROM sub_agent_runs WHERE session_id = @sid", new SqliteParameter("@sid", sidStr));
                }
            }

            return WorkerResponse.Json(new SubAgentSimpleResult(true), InfrastructureJsonContext.Default.SubAgentSimpleResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbSubAgentTools.Apply failed: {ex.GetType().Name}: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    public static WorkerResponse Replace(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            db.Execute("DELETE FROM sub_agent_runs");

            if (parameters.TryGetProperty("snapshot", out var snapshotEl) && snapshotEl.ValueKind == JsonValueKind.Object)
            {
                if (snapshotEl.TryGetProperty("sessionSubAgentSummaries", out var summariesEl) && summariesEl.ValueKind == JsonValueKind.Object)
                {
                    foreach (var prop in summariesEl.EnumerateObject())
                    {
                        var sid = prop.Name;
                        if (prop.Value.ValueKind == JsonValueKind.Array)
                            InsertBatch(db, sid, prop.Value);
                    }
                }

                if (snapshotEl.TryGetProperty("subAgentHistory", out var historyEl) && historyEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in historyEl.EnumerateArray())
                    {
                        var entity = ParseSubAgentRecord(item);
                        if (entity is null) continue;

                        var exists = db.QueryScalar<int>(
                            "SELECT COUNT(*) FROM sub_agent_runs WHERE tool_use_id = @id",
                            new SqliteParameter("@id", entity.ToolUseId)) > 0;
                        if (!exists)
                            InsertSubAgentRun(db, entity);
                    }
                }
            }

            return WorkerResponse.Json(new SubAgentSimpleResult(true), InfrastructureJsonContext.Default.SubAgentSimpleResult);
        }
        catch (Exception ex) { WorkerLog.Error($"DbSubAgentTools.Replace failed: {ex.GetType().Name}: {ex.Message}"); return WorkerResponse.Error(ex.Message); }
    }

    // ─── Helpers ───

    /// <summary>
    /// 渲染端 upsert 用的是它自己那份 data，会把 Worker 落库的 finalOutput 冲掉。
    /// 新 data 里没有 finalOutput 而库里有的时候，把库里那对键搬到新 data 上（S-36）。
    /// </summary>
    private static string PreserveFinalOutput(string? existingData, string newData)
    {
        if (string.IsNullOrWhiteSpace(existingData)) return newData;

        try
        {
            using var existingDoc = JsonDocument.Parse(existingData);
            if (existingDoc.RootElement.ValueKind != JsonValueKind.Object) return newData;

            var finalOutput = GetString(existingDoc.RootElement, "finalOutput");
            if (finalOutput is null) return newData;

            using var newDoc = JsonDocument.Parse(newData);
            if (newDoc.RootElement.ValueKind != JsonValueKind.Object) return newData;
            if (newDoc.RootElement.TryGetProperty("finalOutput", out _)) return newData;

            var buffer = new System.Buffers.ArrayBufferWriter<byte>();
            using (var writer = new Utf8JsonWriter(buffer))
            {
                writer.WriteStartObject();
                foreach (var prop in newDoc.RootElement.EnumerateObject())
                {
                    prop.WriteTo(writer);
                }
                writer.WriteString("finalOutput", finalOutput);
                var finalReportAt = GetLongOrNull(existingDoc.RootElement, "finalReportAt");
                if (finalReportAt.HasValue) writer.WriteNumber("finalReportAt", finalReportAt.Value);
                writer.WriteEndObject();
            }

            return System.Text.Encoding.UTF8.GetString(buffer.WrittenSpan);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"DbSubAgentTools.PreserveFinalOutput failed: {ex.GetType().Name}: {ex.Message}");
            return newData;
        }
    }

    internal static void InsertSubAgentRun(DbService db, SubAgentRunEntity entity)
    {
        db.Execute(
            "INSERT INTO sub_agent_runs (tool_use_id, session_id, agent_name, data, started_at, completed_at, success) " +
            "VALUES (@tuid, @sid, @name, @data, @sa, @ca, @suc)",
            new SqliteParameter("@tuid", entity.ToolUseId),
            new SqliteParameter("@sid", entity.SessionId),
            new SqliteParameter("@name", entity.AgentName),
            new SqliteParameter("@data", entity.Data),
            new SqliteParameter("@sa", entity.StartedAt),
            new SqliteParameter("@ca", (object?)entity.CompletedAt ?? DBNull.Value),
            new SqliteParameter("@suc", (object?)entity.Success ?? DBNull.Value));
    }

    private static SubAgentRunEntity? ParseSubAgentRecord(JsonElement item)
    {
        if (item.ValueKind != JsonValueKind.Object) return null;
        var toolUseId = GetString(item, "toolUseId");
        if (string.IsNullOrEmpty(toolUseId)) return null;

        return new SubAgentRunEntity
        {
            ToolUseId = toolUseId,
            SessionId = GetString(item, "sessionId") ?? "_unknown",
            AgentName = GetString(item, "name") ?? GetString(item, "displayName") ?? "unknown",
            Data = item.GetRawText(),
            StartedAt = GetLong(item, "startedAt"),
            CompletedAt = GetLongOrNull(item, "completedAt"),
            Success = GetBoolOrNull(item, "success")
        };
    }

    private static void InsertBatch(DbService db, string sessionId, JsonElement array)
    {
        foreach (var item in array.EnumerateArray())
        {
            var entity = ParseSubAgentRecord(item);
            if (entity is null) continue;
            InsertSubAgentRun(db, entity);
        }
    }

    private static string RequireString(JsonElement parameters, string key)
    {
        if (parameters.TryGetProperty(key, out var el) && el.ValueKind == JsonValueKind.String)
            return el.GetString()!;
        throw new ArgumentException($"Missing required parameter: {key}");
    }

    private static string? GetString(JsonElement obj, string key)
        => obj.TryGetProperty(key, out var el) && el.ValueKind == JsonValueKind.String ? el.GetString() : null;

    private static long GetLong(JsonElement obj, string key)
        => obj.TryGetProperty(key, out var el) && el.ValueKind == JsonValueKind.Number ? el.GetInt64() : 0;

    private static long? GetLongOrNull(JsonElement obj, string key)
        => obj.TryGetProperty(key, out var el) && el.ValueKind == JsonValueKind.Number ? el.GetInt64() : null;

    private static int? GetBoolOrNull(JsonElement obj, string key)
    {
        if (obj.TryGetProperty(key, out var el))
        {
            if (el.ValueKind == JsonValueKind.True) return 1;
            if (el.ValueKind == JsonValueKind.False) return 0;
        }
        return null;
    }
}

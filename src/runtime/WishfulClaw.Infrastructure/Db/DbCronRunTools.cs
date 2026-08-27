using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

public static class DbCronRunTools
{
    public static WorkerResponse Start(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var runId = RequireString(parameters, "runId");
            var cronId = RequireString(parameters, "cronId");
            var fireId = RequireString(parameters, "fireId");
            var sessionId = GetString(parameters, "sessionId");
            var startedAt = GetLong(parameters, "startedAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            var db = DbClient.GetClient(parameters);
            db.Execute(
                "INSERT INTO cron_runs (run_id, cron_id, session_id, fire_id, status, tool_call_count, started_at) " +
                "VALUES (@runId, @cronId, @sessionId, @fireId, 'running', 0, @startedAt)",
                new SqliteParameter("@runId", runId),
                new SqliteParameter("@cronId", cronId),
                new SqliteParameter("@sessionId", (object?)sessionId ?? DBNull.Value),
                new SqliteParameter("@fireId", fireId),
                new SqliteParameter("@startedAt", startedAt));
            var entity = db.QueryFirstOrDefault(
                "SELECT * FROM cron_runs WHERE run_id = @runId LIMIT 1",
                EntityMappers.MapCronRun,
                new SqliteParameter("@runId", runId));
            return WorkerResponse.Json(
                new CronRunMutationResult(entity is not null, entity is null ? null : CronRunRow.FromEntity(entity),
                    entity is null ? "Cron run not found" : null),
                InfrastructureJsonContext.Default.CronRunMutationResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbCronRunTools.Start failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse Finish(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var runId = RequireString(parameters, "runId");
            var status = RequireString(parameters, "status");
            var summary = GetString(parameters, "summary");
            var error = GetString(parameters, "error");
            var finishedAt = GetLong(parameters, "finishedAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            var toolCallCount = GetInt(parameters, "toolCallCount", 0);
            var db = DbClient.GetClient(parameters);
            var changed = db.Execute(
                "UPDATE cron_runs SET status = @status, summary = @summary, error = @error, " +
                "tool_call_count = @toolCallCount, finished_at = @finishedAt " +
                "WHERE run_id = @runId AND status = 'running'",
                new SqliteParameter("@status", status),
                new SqliteParameter("@summary", (object?)summary ?? DBNull.Value),
                new SqliteParameter("@error", (object?)error ?? DBNull.Value),
                new SqliteParameter("@toolCallCount", toolCallCount),
                new SqliteParameter("@finishedAt", finishedAt),
                new SqliteParameter("@runId", runId));
            var entity = db.QueryFirstOrDefault(
                "SELECT * FROM cron_runs WHERE run_id = @runId LIMIT 1",
                EntityMappers.MapCronRun,
                new SqliteParameter("@runId", runId));
            return WorkerResponse.Json(
                new CronRunMutationResult(changed == 1, entity is null ? null : CronRunRow.FromEntity(entity),
                    entity is null ? "Cron run not found" : changed == 1 ? null : "Cron run is already finished"),
                InfrastructureJsonContext.Default.CronRunMutationResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbCronRunTools.Finish failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse Get(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var runId = RequireString(parameters, "runId");
            var db = DbClient.GetClient(parameters);
            var entity = db.QueryFirstOrDefault(
                "SELECT * FROM cron_runs WHERE run_id = @runId LIMIT 1",
                EntityMappers.MapCronRun,
                new SqliteParameter("@runId", runId));
            return WorkerResponse.Json(
                new CronRunMutationResult(entity is not null, entity is null ? null : CronRunRow.FromEntity(entity),
                    entity is null ? "Cron run not found" : null),
                InfrastructureJsonContext.Default.CronRunMutationResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbCronRunTools.Get failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static WorkerResponse List(JsonElement parameters)
    {
        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);
            var cronId = GetString(parameters, "cronId");
            var sessionId = GetString(parameters, "sessionId");
            var limit = Math.Clamp(GetInt(parameters, "limit", 50), 1, 200);

            // 'running' is a projection of the executor's in-memory state. The
            // caller passes the set of runIds that are actually still executing;
            // any 'running' row not in that set is an orphan (crash/quit/HMR
            // reload) and is finalized lazily at read time — no startup writes,
            // no time heuristics.
            var activeIds = new List<string>();
            if (parameters.TryGetProperty("activeRunIds", out var activeEl) && activeEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in activeEl.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.String)
                    {
                        var s = item.GetString();
                        if (!string.IsNullOrEmpty(s)) activeIds.Add(s);
                    }
                }
            }

            var orphanParams = new List<SqliteParameter>
            {
                new SqliteParameter("@orphanError", "Interrupted: run did not finish"),
                new SqliteParameter("@now", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
            };
            var orphanSql = new System.Text.StringBuilder(
                "UPDATE cron_runs SET status = 'aborted', error = @orphanError, finished_at = @now " +
                "WHERE status = 'running'");
            if (activeIds.Count > 0)
            {
                var names = new List<string>();
                for (var i = 0; i < activeIds.Count; i++)
                {
                    var name = $"@active{i}";
                    names.Add(name);
                    orphanParams.Add(new SqliteParameter(name, activeIds[i]));
                }
                orphanSql.Append(" AND run_id NOT IN (").Append(string.Join(", ", names)).Append(')');
            }
            db.Execute(orphanSql.ToString(), orphanParams.ToArray());

            var conditions = new List<string>();
            var values = new List<SqliteParameter>();
            if (cronId is not null) { conditions.Add("cron_id = @cronId"); values.Add(new SqliteParameter("@cronId", cronId)); }
            if (sessionId is not null) { conditions.Add("session_id = @sessionId"); values.Add(new SqliteParameter("@sessionId", sessionId)); }
            var sql = "SELECT * FROM cron_runs" + (conditions.Count == 0 ? string.Empty : " WHERE " + string.Join(" AND ", conditions)) +
                      " ORDER BY started_at DESC, run_id DESC LIMIT @limit";
            values.Add(new SqliteParameter("@limit", limit));
            var rows = db.Query(sql, EntityMappers.MapCronRun, values.ToArray())
                .Select(CronRunRow.FromEntity).ToList();
            return WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListCronRunRow);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbCronRunTools.List failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    private static string RequireString(JsonElement parameters, string name) =>
        GetString(parameters, name) ?? throw new InvalidOperationException($"{name} is required");

    private static string? GetString(JsonElement parameters, string name) =>
        parameters.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() : null;

    private static int GetInt(JsonElement parameters, string name, int fallback) =>
        parameters.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var result)
            ? result : fallback;

    private static long GetLong(JsonElement parameters, string name, long fallback) =>
        parameters.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var result)
            ? result : fallback;
}

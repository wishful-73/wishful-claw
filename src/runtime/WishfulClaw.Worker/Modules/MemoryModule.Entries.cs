using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.Workspace.Memory;

namespace WishfulClaw.Worker.Modules;

/// <summary>
/// Memory-library listing endpoints, split out of <c>MemoryModule</c> to keep that file inside
/// the 500-line budget (iter-33 S-98). Publishing and paging the same rows belong together.
/// </summary>
internal sealed partial class MemoryModule
{
    /// <summary>
    /// Upper bound on a single page. The parameter used to be taken at face value, so a caller
    /// could ask for the entire table in one response (S-98).
    /// </summary>
    private const int MaxEntriesLimit = 200;

    /// <summary>
    /// Lists entries by status for the tier browser / restore UI. Cold includes
    /// legacy 'deprecated' rows. scope="all" scans every scope; explicit scopes
    /// are exact, same semantics as demotion-candidates.
    /// </summary>
    private static Task<WorkerResponse> MemoryEntriesByStatus(JsonElement parameters)
    {
        var status = GetString(parameters, "status")?.ToLowerInvariant();
        if (status != "active" && status != "warm" && status != "cold")
            return Task.FromResult(WorkerResponse.Json(new MemoryEntriesByStatusResponse([]), WishfulClawJsonContext.Default.MemoryEntriesByStatusResponse));
        var rawScope = GetString(parameters, "scope");
        var explicitAll = string.IsNullOrWhiteSpace(rawScope) || rawScope == "all";
        var scope = explicitAll ? null : GetScope(parameters);
        var limit = Math.Clamp(GetInt(parameters, "limit", MaxEntriesLimit), 1, MaxEntriesLimit);

        return RunAsync(() =>
        {
            var db = DbClient.GetClient();
            var scopeClause = scope is null
                ? ""
                : $" AND scope = '{EscapeSql(scope)}'";
            var statusClause = status == "cold"
                ? "status IN ('cold', 'deprecated')"
                : "status = @status";
            var entries = new List<MemoryEntryRow>();
            using (var reader = db.ExecuteReader(
                       "SELECT id, scope, title, content, priority, status, updated_at FROM memory_entries " +
                       $"WHERE {statusClause}{scopeClause} ORDER BY updated_at DESC, id DESC LIMIT @limit",
                       new SqliteParameter("@status", status),
                       new SqliteParameter("@limit", limit)))
            {
                while (reader.Read())
                {
                    entries.Add(ReadEntryRow(reader));
                }
            }
            return Task.FromResult(WorkerResponse.Json(
                new MemoryEntriesByStatusResponse(entries),
                WishfulClawJsonContext.Default.MemoryEntriesByStatusResponse));
        });
    }

    /// <summary>
    /// Lists every entry of a scope regardless of status (iter-33 S-91). The
    /// entries-by-status variant returns an empty list for an empty status, so it cannot
    /// express "everything" — this is the read the archive page's memory library needs.
    /// scope="all" (or omitted) scans every scope; explicit scopes are exact, same
    /// semantics as entries-by-status / demotion-candidates.
    ///
    /// Server-side paging (iter-33 S-98): <c>offset</c> + <c>order</c> in, one page of rows
    /// plus the scope's total out. The ordering is <c>updated_at, id</c> — <c>updated_at</c>
    /// alone is not unique (a batch insert shares one second), and without a total order a
    /// row can be returned twice across two pages, or skipped entirely.
    /// </summary>
    private static Task<WorkerResponse> MemoryEntries(JsonElement parameters)
    {
        var rawScope = GetString(parameters, "scope");
        var explicitAll = string.IsNullOrWhiteSpace(rawScope) || rawScope == "all";
        var scope = explicitAll ? null : GetScope(parameters);
        var limit = Math.Clamp(GetInt(parameters, "limit", MaxEntriesLimit), 1, MaxEntriesLimit);
        var offset = Math.Max(0, GetInt(parameters, "offset", 0));
        // Whitelist rather than interpolation: the direction is spliced into the ORDER BY text,
        // so it must never be the caller's string. Anything that is not "asc" means newest
        // first, which keeps the pre-S-98 default.
        var descending = !string.Equals(GetString(parameters, "order"), "asc", StringComparison.OrdinalIgnoreCase);

        return RunAsync(() =>
        {
            var db = DbClient.GetClient();
            var scopeClause = scope is null
                ? ""
                : $" AND scope = '{EscapeSql(scope)}'";
            var direction = descending ? "DESC" : "ASC";
            var entries = new List<MemoryEntryRow>();
            using (var reader = db.ExecuteReader(
                       "SELECT id, scope, title, content, priority, status, updated_at FROM memory_entries " +
                       $"WHERE 1 = 1{scopeClause} " +
                       $"ORDER BY updated_at {direction}, id {direction} LIMIT @limit OFFSET @offset",
                       new SqliteParameter("@limit", limit),
                       new SqliteParameter("@offset", offset)))
            {
                while (reader.Read())
                {
                    entries.Add(ReadEntryRow(reader));
                }
            }

            return Task.FromResult(WorkerResponse.Json(
                new MemoryEntriesResponse(entries, CountScope(db, scope)),
                WishfulClawJsonContext.Default.MemoryEntriesResponse));
        });
    }

    private static int CountScope(DbService db, string? scope)
    {
        var scopeClause = scope is null ? "" : $" AND scope = '{EscapeSql(scope)}'";
        using var reader = db.ExecuteReader($"SELECT COUNT(*) FROM memory_entries WHERE 1 = 1{scopeClause}");
        return reader.Read() ? (int)reader.GetInt64(0) : 0;
    }

    private static MemoryEntryRow ReadEntryRow(SqliteDataReader reader)
    {
        var id = reader.GetInt64(reader.GetOrdinal("id"));
        var entryScope = reader.GetString("scope");
        var title = reader.IsDBNull(reader.GetOrdinal("title")) ? null : reader.GetString("title");
        var content = reader.IsDBNull(reader.GetOrdinal("content")) ? "" : reader.GetString("content");
        var priority = reader.GetString("priority");
        var entryStatus = reader.GetString("status");
        var updatedAt = reader.IsDBNull(reader.GetOrdinal("updated_at")) ? 0 : reader.GetInt64("updated_at");
        return new MemoryEntryRow(id, entryScope, title, content, priority, entryStatus, updatedAt);
    }
}

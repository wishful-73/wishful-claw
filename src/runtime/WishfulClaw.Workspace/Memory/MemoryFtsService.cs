using Microsoft.Data.Sqlite;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.Workspace.Memory;

namespace WishfulClaw.Workspace.Memory;

public sealed class MemoryFtsService : IMemorySearch
{
    public Task<IReadOnlyList<MemorySearchResult>> SearchAsync(
        string query, string? scope = null, int limit = 10,
        bool includeDeprecated = false, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(query) || limit <= 0)
            return Task.FromResult<IReadOnlyList<MemorySearchResult>>([]);

        limit = Math.Clamp(limit, 1, 50);
        var q = query.Trim();
        var db = DbClient.GetClient();
        var results = new List<MemorySearchResult>();
        var statusFilter = includeDeprecated ? "" : " AND status = 'active'";
        var scopeFilter = string.IsNullOrWhiteSpace(scope) || scope == "global"
            ? "" : $" AND scope = '{EscapeSql(scope)}'";

        // ── Method 1: FTS trigram search ──
        try
        {
            var ftsSql = $"""
                SELECT e.id, e.title, e.content, e.scope, e.priority, e.status, e.updated_at
                FROM memory_fts f
                JOIN memory_entries e ON f.rowid = e.id
                WHERE memory_fts MATCH @query{scopeFilter}{statusFilter}
                ORDER BY rank
                LIMIT @limit
                """;
            using var reader = db.ExecuteReader(ftsSql,
                new SqliteParameter("@query", q),
                new SqliteParameter("@limit", limit));
            while (reader.Read())
            {
                ct.ThrowIfCancellationRequested();
                results.Add(RowToResult(reader));
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            // FTS failed — log it and fall through to LIKE with a clean slate
            // (drop any partial rows read before the failure).
            WorkerLog.Warn($"memory fts search failed, falling back to LIKE: {ex.GetType().Name}: {ex.Message}");
            results.Clear();
        }

        // ── Method 2: LIKE fallback ──
        if (results.Count == 0)
        {
            var likeSql = $"""
                SELECT id, title, content, scope, priority, status, updated_at
                FROM memory_entries
                WHERE (content LIKE @pattern OR title LIKE @pattern){scopeFilter}{statusFilter}
                ORDER BY updated_at DESC
                LIMIT @limit
                """;
            using var reader = db.ExecuteReader(likeSql,
                new SqliteParameter("@pattern", $"%{q}%"),
                new SqliteParameter("@limit", limit));
            while (reader.Read())
            {
                ct.ThrowIfCancellationRequested();
                results.Add(RowToResult(reader));
            }
        }

        return Task.FromResult<IReadOnlyList<MemorySearchResult>>(results);
    }

    private static MemorySearchResult RowToResult(SqliteDataReader row)
    {
        var id = row.GetInt64(row.GetOrdinal("id"));
        var title = row.GetString("title");
        var content = row.GetString("content");
        var scope = row.GetString("scope");
        var priority = row.GetString("priority");
        var status = row.GetString("status");
        var updatedAt = row.GetNullableInt64("updated_at") ?? 0;

        return new MemorySearchResult
        {
            Id = id, Title = title, Content = content, Scope = scope,
            Priority = priority, Status = status,
            UpdatedAt = DateTimeOffset.FromUnixTimeSeconds(updatedAt)
        };
    }

    private static string EscapeSql(string s) => s.Replace("'", "''", StringComparison.Ordinal);
}

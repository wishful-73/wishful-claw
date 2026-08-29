using Microsoft.Data.Sqlite;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.Workspace.Memory;

namespace WishfulClaw.Workspace.Memory;

public sealed class MemoryFtsService : IMemorySearch, IMemoryReheat
{
    public Task<int> ReheatAsync(IReadOnlyList<long> ids, CancellationToken ct = default)
    {
        if (ids.Count == 0)
            return Task.FromResult(0);
        ct.ThrowIfCancellationRequested();

        var db = DbClient.GetClient();
        var idParams = new SqliteParameter[ids.Count];
        var placeholders = new string[ids.Count];
        for (var i = 0; i < ids.Count; i++)
        {
            placeholders[i] = $"@id{i}";
            idParams[i] = new SqliteParameter($"@id{i}", ids[i]);
        }
        var sql =
            "UPDATE memory_entries SET " +
            "status = CASE status WHEN 'warm' THEN 'active' WHEN 'cold' THEN 'warm' ELSE status END, " +
            "updated_at = @ua " +
            $"WHERE id IN ({string.Join(",", placeholders)}) AND status IN ('warm', 'cold')";
        var affected = db.Execute(sql, idParams.Append(new SqliteParameter("@ua", DateTimeOffset.UtcNow.ToUnixTimeSeconds())).ToArray());
        return Task.FromResult(affected);
    }

    public Task<IReadOnlyList<MemorySearchResult>> SearchAsync(
        string query, string? scope = null, int limit = 10,
        bool includeDeprecated = false, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(query) || limit <= 0)
            return Task.FromResult<IReadOnlyList<MemorySearchResult>>([]);

        limit = Math.Clamp(limit, 1, 50);
        var q = query.Trim();
        var ftsQuery = BuildFtsLiteralQuery(q);
        var db = DbClient.GetClient();
        var results = new List<MemorySearchResult>();
        // Tier model: active + warm are recallable by default (warm sorts
        // below active); include_deprecated additionally surfaces cold /
        // legacy deprecated entries.
        var statusFilter = includeDeprecated ? "" : " AND status IN ('active', 'warm')";
        var scopeFilter = string.IsNullOrWhiteSpace(scope)
            ? "" : $" AND scope = '{EscapeSql(scope)}'";

        // ── Method 1: FTS trigram search ──
        try
        {
            var ftsSql = $"""
                SELECT e.id, e.title, e.content, e.scope, e.priority, e.status, e.updated_at, -rank AS score
                FROM memory_fts f
                JOIN memory_entries e ON f.rowid = e.id
                WHERE memory_fts MATCH @query{scopeFilter}{statusFilter}
                ORDER BY CASE WHEN e.status = 'active' THEN 0 ELSE 1 END, rank
                LIMIT @limit
                """;
            using var reader = db.ExecuteReader(ftsSql,
                new SqliteParameter("@query", ftsQuery),
                new SqliteParameter("@limit", limit));
            while (reader.Read())
            {
                ct.ThrowIfCancellationRequested();
                results.Add(RowToResult(reader, hasScore: true));
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
                ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, updated_at DESC
                LIMIT @limit
                """;
            using var reader = db.ExecuteReader(likeSql,
                new SqliteParameter("@pattern", $"%{q}%"),
                new SqliteParameter("@limit", limit));
            while (reader.Read())
            {
                ct.ThrowIfCancellationRequested();
                results.Add(RowToResult(reader, hasScore: false));
            }
        }

        return Task.FromResult<IReadOnlyList<MemorySearchResult>>(results);
    }

    private static MemorySearchResult RowToResult(SqliteDataReader row, bool hasScore)
    {
        var id = row.GetInt64(row.GetOrdinal("id"));
        var title = row.GetString("title");
        var content = row.GetString("content");
        var scope = row.GetString("scope");
        var priority = row.GetString("priority");
        var status = row.GetString("status");
        var updatedAt = row.GetNullableInt64("updated_at") ?? 0;
        double? score = null;
        if (hasScore && !row.IsDBNull(row.GetOrdinal("score")))
            score = row.GetDouble(row.GetOrdinal("score"));

        return new MemorySearchResult
        {
            Id = id, Title = title, Content = content, Scope = scope,
            Priority = priority, Status = status,
            UpdatedAt = DateTimeOffset.FromUnixTimeSeconds(updatedAt),
            Score = score
        };
    }

    private static string BuildFtsLiteralQuery(string query) =>
        $"\"{query.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    private static string EscapeSql(string s) => s.Replace("'", "''", StringComparison.Ordinal);
}

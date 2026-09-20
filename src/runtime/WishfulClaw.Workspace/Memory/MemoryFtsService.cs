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
        bool includeDeprecated = false, long? from = null, long? to = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(query) || limit <= 0)
            return Task.FromResult<IReadOnlyList<MemorySearchResult>>([]);

        limit = Math.Clamp(limit, 1, 50);
        var q = query.Trim();
        // A query is a set of whitespace-separated keywords combined with AND (S-99). Handing
        // the raw string to FTS produced a *single* phrase — "a b c" had to appear verbatim,
        // spaces and all — and the LIKE fallback matched that same whole string, so a
        // multi-keyword query could never match anything.
        var tokens = SplitTokens(q);
        var db = DbClient.GetClient();
        var results = new List<MemorySearchResult>();
        // Tier model: active + warm are recallable by default (warm sorts
        // below active); include_deprecated additionally surfaces cold /
        // legacy deprecated entries.
        var statusFilter = includeDeprecated ? "" : " AND status IN ('active', 'warm')";
        var scopeFilter = string.IsNullOrWhiteSpace(scope)
            ? "" : $" AND scope = '{EscapeSql(scope)}'";
        // 时间区间（S-101）：FTS 那一段的表别名是 e，LIKE 那一段没有别名 —— 同一个构造器，
        // 只差一个列限定符，免得两处各写一份条件然后各漂一半。
        var ftsTime = MemoryTimeFilter.Build(from, to, "e.");
        var likeTime = MemoryTimeFilter.Build(from, to);

        // ── Method 1: FTS trigram search ──
        // The index is tokenize='trigram', whose lower bound is 3 characters: a 1-2
        // character query (i.e. every 2-character CJK word) can never match. Skip FTS
        // entirely for those instead of burning a query and falling through anyway (S-94).
        // Trigram FTS cannot match a token shorter than the tokenizer's lower bound, so a
        // keyword set containing one goes straight to LIKE (S-94 covered the single-token
        // case; S-99 extends the rule to keyword sets).
        if (tokens.All(t => t.Length >= MinFtsQueryLength))
        {
            var ftsQuery = BuildFtsQuery(tokens);
            try
            {
                var ftsSql = $"""
                    SELECT e.id, e.title, e.content, e.scope, e.priority, e.status, e.updated_at, -rank AS score
                    FROM memory_fts f
                    JOIN memory_entries e ON f.rowid = e.id
                    WHERE memory_fts MATCH @query{scopeFilter}{statusFilter}{ftsTime.Sql}
                    ORDER BY CASE WHEN e.status = 'active' THEN 0 ELSE 1 END, rank
                    LIMIT @limit
                    """;
                using var reader = db.ExecuteReader(ftsSql,
                    [new SqliteParameter("@query", ftsQuery), new SqliteParameter("@limit", limit), .. ftsTime.Parameters]);
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
        }

        // ── Method 2: LIKE fallback (also the only path for short queries) ──
        if (results.Count == 0)
        {
            // Synthesise a score so LIKE hits are ordered and thresholdable like FTS
            // hits: a title hit (2) outranks a content-only hit (1), and updated_at
            // breaks ties. Without this, PassesThreshold saw a null score and let
            // everything through, so short queries came back unordered (S-94).
            // NOTE: this 0..2 scale is NOT comparable to the FTS path's -bm25 rank.
            // MemoryRecallService merges both channels and applies one minScore to the
            // result, so a non-zero threshold filters the two sources with different
            // yardsticks; ordering is only meaningful within a channel.
            // One LIKE clause per keyword, ANDed — the same "all keywords must match"
            // semantics as the FTS path. The synthetic score accumulates per keyword
            // (title 2 / content 1), so an entry carrying more of the keywords in its title
            // outranks one that only has them in the body. Under AND every returned row
            // matches *every* keyword, so "how many keywords matched" is a constant — where
            // they matched is the only variable left (S-99).
            var conditions = new List<string>(tokens.Count);
            var scoreTerms = new List<string>(tokens.Count);
            var likeParams = new List<SqliteParameter>(tokens.Count + 1);
            for (var i = 0; i < tokens.Count; i++)
            {
                var p = $"@like{i}";
                likeParams.Add(new SqliteParameter(p, $"%{tokens[i]}%"));
                conditions.Add($"(title LIKE {p} OR content LIKE {p})");
                scoreTerms.Add(
                    $"(CASE WHEN title LIKE {p} THEN 2 ELSE 0 END " +
                    $"+ CASE WHEN content LIKE {p} THEN 1 ELSE 0 END)");
            }
            likeParams.Add(new SqliteParameter("@limit", limit));
            var likeSql = $"""
                SELECT id, title, content, scope, priority, status, updated_at,
                       ({string.Join(" + ", scoreTerms)}) AS score
                FROM memory_entries
                WHERE ({string.Join(" AND ", conditions)}){scopeFilter}{statusFilter}{likeTime.Sql}
                ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, score DESC, updated_at DESC
                LIMIT @limit
                """;
            using var reader = db.ExecuteReader(likeSql, [.. likeParams, .. likeTime.Parameters]);
            while (reader.Read())
            {
                ct.ThrowIfCancellationRequested();
                results.Add(RowToResult(reader, hasScore: true));
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

    /// <summary>
    /// Lower bound of the FTS trigram tokenizer: a query shorter than this cannot match
    /// any trigram, so it goes straight to the LIKE path (S-94).
    /// </summary>
    private const int MinFtsQueryLength = 3;

    /// <summary>
    /// Upper bound on how many keywords one query may carry. Each keyword costs a LIKE clause
    /// and a bound parameter; past this the clause stops buying recall and only widens the
    /// statement (S-99).
    /// </summary>
    private const int MaxQueryTokens = 8;

    /// <summary>
    /// Splits a query into whitespace-separated keywords, dropping blanks and duplicates while
    /// preserving order. A single-keyword query yields exactly one token, and that is what
    /// keeps the pre-S-99 behaviour intact for that (the common) case.
    /// </summary>
    private static List<string> SplitTokens(string query)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var tokens = new List<string>();
        foreach (var part in query.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
        {
            if (tokens.Count >= MaxQueryTokens)
                break;
            if (seen.Add(part))
                tokens.Add(part);
        }
        return tokens;
    }

    /// <summary>
    /// FTS5 expression for a keyword set: each keyword stays a quoted literal (so punctuation
    /// inside it is inert — same reasoning as the pre-S-99 single-phrase build), and the
    /// literals are ANDed so every keyword has to appear somewhere in the row. A single
    /// keyword degenerates to the bare literal, matching the old query exactly.
    /// </summary>
    private static string BuildFtsQuery(IReadOnlyList<string> tokens) =>
        string.Join(" AND ", tokens.Select(BuildFtsLiteralQuery));

    private static string BuildFtsLiteralQuery(string query) =>
        $"\"{query.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    private static string EscapeSql(string s) => s.Replace("'", "''", StringComparison.Ordinal);
}

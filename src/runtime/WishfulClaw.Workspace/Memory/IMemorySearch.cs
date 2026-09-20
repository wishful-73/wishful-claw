namespace WishfulClaw.Workspace.Memory;

/// <summary>
/// Search memory entries in SQLite.
/// Uses FTS5 trigram index first, falls back to LIKE for short queries or when FTS returns nothing.
/// </summary>
public interface IMemorySearch
{
    /// <summary>
    /// Search memory entries by query string.
    /// FTS trigram first; if no results, falls back to LIKE.
    /// </summary>
    /// <param name="query">Search query.</param>
    /// <param name="scope">Scope filter ("project:{id}" or "global"). If null, searches all scopes.</param>
    /// <param name="limit">Max results (default 10, max 50).</param>
    /// <param name="includeDeprecated">Include deprecated entries in results (default false).</param>
    /// <param name="from">Inclusive lower bound on updated_at (Unix seconds, iter-33 S-101). Null or non-positive = unbounded.</param>
    /// <param name="to">Inclusive upper bound on updated_at (Unix seconds). Null or non-positive = unbounded.</param>
    /// <param name="ct">Cancellation token.</param>
    Task<IReadOnlyList<MemorySearchResult>> SearchAsync(
        string query,
        string? scope = null,
        int limit = 10,
        bool includeDeprecated = false,
        long? from = null,
        long? to = null,
        CancellationToken ct = default);
}

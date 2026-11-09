using Microsoft.Data.Sqlite;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// <c>memory_entries</c> 表的**唯一 SQL 出口**（S-326）。
///
/// 补这一层之前，这张表的语句散在 5 个文件、横跨 3 个程序集：Worker 的
/// <c>MemoryModule</c> 与 <c>MemoryModule.Entries</c>（11 处）、Agent 的
/// <c>MemoryAppendTool</c> / <c>MemoryUpdateTool</c>（3 处）、Workspace 的
/// <c>MemoryFtsService</c>（1 处）。Worker 与 Agent 那两条 <c>INSERT</c> 逐字相同，
/// 连 7 个参数名都一样 —— 改表结构要改两处，漏一处不会编译报错，是运行时静默失效。
///
/// 建这层不是「为了分层好看」，是因为上面三个消费方**各自认为自己是唯一写入者**。
/// 与 <c>MemoryTimeFilter</c> 同一理由（它只收口了时间子句，主体 SQL 一直没收）。
///
/// **不收口的部分**：FTS 检索（<c>MemoryFtsService.SearchAsync</c>）留在 Workspace ——
/// 那是检索逻辑（trigram 分词、bm25、score 合成），不是行级 CRUD，塞进这里会把
/// FTS 知识搬进基础设施层。但 <c>re-heat</c> 是行级状态变更，收在这里。
///
/// **返回类型只用 <see cref="MemoryEntryEntity"/>**：DTO（<c>MemoryEntryRow</c> /
/// <c>MemoryDemotionCandidate</c>）定义在 Workspace，本层引用不到，DTO 转换留在上层。
/// </summary>
public static class DbMemoryTools
{
    private const string EntryColumns =
        "id, scope, title, content, priority, status, created_at, updated_at";

    // ─── 读 ───

    /// <summary>按主键取一条。该条不存在返回 <c>null</c>。</summary>
    public static MemoryEntryEntity? GetById(long id) =>
        DbClient.GetClient().QueryFirstOrDefault(
            $"SELECT {EntryColumns} FROM memory_entries WHERE id = @id",
            EntityMappers.MapMemoryEntry,
            new SqliteParameter("@id", id));

    /// <summary>按状态集合计数。<paramref name="statuses"/> 为空返回 0。</summary>
    public static int CountByStatus(string? scope, params string[] statuses)
    {
        if (statuses.Length == 0)
            return 0;

        var parameters = new List<SqliteParameter>(statuses.Length + 1);
        var statusClause = BuildStatusClause(statuses, parameters);
        var scopeClause = BuildScopeClause(scope, parameters);
        return (int)DbClient.GetClient().QueryScalar<long>(
            $"SELECT COUNT(*) FROM memory_entries WHERE 1 = 1{statusClause}{scopeClause}",
            parameters.ToArray());
    }

    /// <summary>
    /// 按状态集合取一页，最新的在前。<c>entries-by-status</c> 端点用；
    /// cold 会把历史遗留的 <c>deprecated</c> 一起带上（调用方传两个状态即可）。
    /// </summary>
    public static List<MemoryEntryEntity> ListByStatus(string? scope, string[] statuses, int limit)
    {
        if (statuses.Length == 0)
            return [];

        var parameters = new List<SqliteParameter>(statuses.Length + 2);
        var statusClause = BuildStatusClause(statuses, parameters);
        var scopeClause = BuildScopeClause(scope, parameters);
        parameters.Add(new SqliteParameter("@limit", limit));
        return DbClient.GetClient().Query(
            $"SELECT {EntryColumns} FROM memory_entries WHERE 1 = 1{statusClause}{scopeClause} " +
            "ORDER BY updated_at DESC, id DESC LIMIT @limit",
            EntityMappers.MapMemoryEntry,
            parameters.ToArray());
    }

    /// <summary>
    /// 按时间区间分页取（<c>entries</c> 端点用）。
    /// 排序固定为 <c>updated_at, id</c> —— 单独 <c>updated_at</c> 不唯一（同秒批量插入），
    /// 没有全序时同一条会在两页里重复出现或被整页跳过（S-98）。
    /// <paramref name="descending"/> 是 bool 而非字符串：方向要拼进 ORDER BY 的文本里，
    /// 绝不能是调用方传来的字符串。
    /// </summary>
    public static List<MemoryEntryEntity> ListPaged(
        string? scope, MemoryTimeClause time, bool descending, int limit, int offset)
    {
        var direction = descending ? "DESC" : "ASC";
        var parameters = new List<SqliteParameter>(time.Parameters) { new("@limit", limit), new("@offset", offset) };
        var scopeClause = BuildScopeClause(scope, parameters);
        return DbClient.GetClient().Query(
            $"SELECT {EntryColumns} FROM memory_entries WHERE 1 = 1{scopeClause}{time.Sql} " +
            $"ORDER BY updated_at {direction}, id {direction} LIMIT @limit OFFSET @offset",
            EntityMappers.MapMemoryEntry,
            parameters.ToArray());
    }

    /// <summary>
    /// 与 <see cref="ListPaged"/> 同条件的总数。**必须带同一个 <paramref name="time"/>** ——
    /// 少了它，「共 N 条 / 第 X 页」会按全量算，翻到区间内最后一页就露白（S-98）。
    /// </summary>
    public static int CountPaged(string? scope, MemoryTimeClause time)
    {
        var parameters = new List<SqliteParameter>(time.Parameters);
        var scopeClause = BuildScopeClause(scope, parameters);
        return (int)DbClient.GetClient().QueryScalar<long>(
            $"SELECT COUNT(*) FROM memory_entries WHERE 1 = 1{scopeClause}{time.Sql}",
            parameters.ToArray());
    }

    /// <summary>
    /// 降级候选：永久条目除外，只看 active / warm。
    /// **刻意不读 <c>content</c>** —— 降级判定只用到优先级与 <c>updated_at</c>，
    /// 而这条语句会扫全表，把内容一起读出来是白扛整表的大字段。
    /// 返回的实体 <c>Content</c> 为空串、<c>CreatedAt</c> 为 0，不要当完整实体用。
    /// </summary>
    public static List<MemoryEntryEntity> ListDemotionCandidates(string? scope)
    {
        var parameters = new List<SqliteParameter>(1);
        var scopeClause = BuildScopeClause(scope, parameters);
        return DbClient.GetClient().Query(
            "SELECT id, scope, title, priority, status, updated_at FROM memory_entries " +
            $"WHERE priority <> 'permanent' AND status IN ('active', 'warm'){scopeClause}",
            MapDemotionCandidate,
            parameters.ToArray());
    }

    // ─── 写 ───

    /// <summary>插入一条，返回自增 id。</summary>
    public static long Insert(MemoryEntryEntity entry) =>
        DbClient.GetClient().ExecuteReturnIdentity(
            "INSERT INTO memory_entries (scope, title, content, priority, status, created_at, updated_at) " +
            "VALUES (@scope, @title, @content, @priority, @status, @ca, @ua)",
            new SqliteParameter("@scope", entry.Scope),
            new SqliteParameter("@title", (object?)entry.Title ?? DBNull.Value),
            new SqliteParameter("@content", entry.Content),
            new SqliteParameter("@priority", entry.Priority),
            new SqliteParameter("@status", entry.Status),
            new SqliteParameter("@ca", entry.CreatedAt),
            new SqliteParameter("@ua", entry.UpdatedAt));

    /// <summary>
    /// 按主键整行更新（title / content / priority / status / updated_at）。
    /// 调用方负责先把要改的字段填进实体、再调这里 —— 只传改动字段的「部分更新」不在这层，
    /// 因为那需要区分「未提供」与「显式置空」，属于端点语义。
    /// </summary>
    public static int Update(MemoryEntryEntity entry) =>
        DbClient.GetClient().Execute(
            "UPDATE memory_entries SET title = @title, content = @content, priority = @priority, " +
            "status = @status, updated_at = @ua WHERE id = @id",
            new SqliteParameter("@title", (object?)entry.Title ?? DBNull.Value),
            new SqliteParameter("@content", entry.Content),
            new SqliteParameter("@priority", entry.Priority),
            new SqliteParameter("@status", entry.Status),
            new SqliteParameter("@ua", entry.UpdatedAt),
            new SqliteParameter("@id", entry.Id));

    /// <summary>
    /// 批量改状态。<paramref name="touch"/> 为真时同时刷新 <c>updated_at</c>
    /// （召回再热用）；降级**不**刷新，否则闲置时长被清零、下一轮又选不中它。
    /// <paramref name="scope"/> 非空时追加范围限制，越权 id 会静默不计入 affected。
    /// </summary>
    public static int BatchSetStatus(
        IReadOnlyList<long> ids, string status, string? scope, bool touch)
    {
        if (ids.Count == 0)
            return 0;

        var parameters = new List<SqliteParameter>(ids.Count + 3);
        var placeholders = new string[ids.Count];
        for (var i = 0; i < ids.Count; i++)
        {
            placeholders[i] = $"@id{i}";
            parameters.Add(new SqliteParameter(placeholders[i], ids[i]));
        }
        var inList = string.Join(", ", placeholders);

        var sql = touch
            ? $"UPDATE memory_entries SET status = @status, updated_at = @ua WHERE id IN ({inList})"
            : $"UPDATE memory_entries SET status = @status WHERE id IN ({inList})";
        parameters.Add(new SqliteParameter("@status", status));
        if (touch)
            parameters.Add(new SqliteParameter("@ua", DateTimeOffset.UtcNow.ToUnixTimeSeconds()));

        if (scope is not null)
        {
            sql += " AND scope = @scope";
            parameters.Add(new SqliteParameter("@scope", scope));
        }

        return DbClient.GetClient().Execute(sql, parameters.ToArray());
    }

    /// <summary>
    /// 召回再热：cold → warm、warm → active，并刷新 <c>updated_at</c>。
    /// 只动 warm / cold 两类 —— active 本来就是最新态，再热它没有意义；
    /// deprecated 是被人工判定过时的，不能靠一次召回复活。返回实际变更行数。
    /// </summary>
    public static int Reheat(IReadOnlyList<long> ids)
    {
        if (ids.Count == 0)
            return 0;

        var parameters = new List<SqliteParameter>(ids.Count + 2);
        var placeholders = new string[ids.Count];
        for (var i = 0; i < ids.Count; i++)
        {
            placeholders[i] = $"@id{i}";
            parameters.Add(new SqliteParameter(placeholders[i], ids[i]));
        }
        parameters.Add(new SqliteParameter("@ua", DateTimeOffset.UtcNow.ToUnixTimeSeconds()));

        return DbClient.GetClient().Execute(
            "UPDATE memory_entries SET " +
            "status = CASE status WHEN 'warm' THEN 'active' WHEN 'cold' THEN 'warm' ELSE status END, " +
            $"updated_at = @ua WHERE id IN ({string.Join(", ", placeholders)}) " +
            "AND status IN ('warm', 'cold')",
            parameters.ToArray());
    }

    // ─── Helpers ───

    /// <summary>
    /// 单状态用 <c>=</c>、多状态用 <c>IN</c>，参数化。
    /// 原先调用方是 <c>$" AND scope = '{EscapeSql(scope)}'"</c> 这种字符串拼接，
    /// 手工转义单引号看着够用，但参数化没有「够不够用」这个问题。
    /// 最后一处拼串调用方（<see cref="Memory.SearchAsync"/> 的 scope 条件）已于 2026-11-09 收口，
    /// 全仓再无手工拼值的 SQL 条件。
    /// </summary>
    private static string BuildStatusClause(string[] statuses, List<SqliteParameter> parameters)
    {
        var names = new string[statuses.Length];
        for (var i = 0; i < statuses.Length; i++)
        {
            names[i] = $"@status{i}";
            parameters.Add(new SqliteParameter(names[i], statuses[i]));
        }
        return names.Length == 1
            ? $" AND status = {names[0]}"
            : $" AND status IN ({string.Join(", ", names)})";
    }

    /// <summary>
    /// <c>scope</c> 为 <c>null</c> 表示「全 scope 扫描」（调用方传 <c>scope="all"</c>
    /// 或缺省时就是这个语义），非空则按精确值收窄。
    /// </summary>
    private static string BuildScopeClause(string? scope, List<SqliteParameter> parameters)
    {
        if (scope is null)
            return string.Empty;

        parameters.Add(new SqliteParameter("@scope", scope));
        return " AND scope = @scope";
    }

    /// <summary>降级候选的轻量映射，不碰 <c>content</c> / <c>created_at</c>。</summary>
    private static MemoryEntryEntity MapDemotionCandidate(SqliteDataReader reader) => new()
    {
        Id = reader.GetInt64("id"),
        Scope = reader.GetString("scope"),
        Title = reader.GetNullableString("title"),
        Content = string.Empty,
        Priority = reader.GetString("priority"),
        Status = reader.GetString("status"),
        CreatedAt = 0,
        UpdatedAt = reader.GetInt64("updated_at")
    };
}

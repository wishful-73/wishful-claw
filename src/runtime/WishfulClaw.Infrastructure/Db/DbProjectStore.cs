using Microsoft.Data.Sqlite;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Table access for <c>projects</c> (S-333 / S-328 刀 26).
///
/// Contract: this class owns every SQL literal that touches <c>projects</c>. Five read shapes,
/// each with a distinct caller — the shapes look similar but the WHERE clauses are NOT
/// interchangeable, so they are five methods rather than one method with flags.
/// <list type="bullet">
/// <item><see cref="ListAll"/> — 项目列表面板（有/无关键词两种 SQL）</item>
/// <item><see cref="GetById"/> — 项目详情 / 建会话时取工作目录</item>
/// <item><see cref="ListSandboxRoots"/> — 沙箱根集合（**带 ssh 过滤**）</item>
/// <item><see cref="GetWorkingFolder"/> — 单个项目的沙箱根（S-144 回查）</item>
/// <item><see cref="ListForWorkingFolderDedup"/> — 建项目查重（**不带 ssh 过滤**）</item>
/// </list>
///
/// <see cref="ListSandboxRoots"/> 与 <see cref="ListForWorkingFolderDedup"/> 的 WHERE 只差一个
/// <c>ssh_connection_id</c> 条件 —— 那是刻意的，别合并（见两个方法各自的注释）。
/// </summary>
public static class DbProjectStore
{
    /// <summary>
    /// Explicit column list, matching <see cref="ProjectEntity"/> field for field. Written out
    /// rather than <c>SELECT *</c> so that adding a column to the table cannot silently shift
    /// what <c>EntityMappers.MapProject</c> reads.
    /// </summary>
    private const string SelectColumns =
        "SELECT id, name, working_folder, ssh_connection_id, plugin_id, pinned, created_at, updated_at FROM projects";

    /// <summary>
    /// 项目列表，按置顶、最近更新排序。<paramref name="nameFilter"/> 非空时按名称模糊匹配。
    ///
    /// 有/无关键词是**两条 SQL 二选一**，不是一条 `WHERE (@f IS NULL OR name LIKE @f)` ——
    /// 后者会让 SQLite 放弃走索引，属于语义之外的性能变更（S-328 §四：不顺便改 SQL 语义）。
    /// </summary>
    public static List<ProjectEntity> ListAll(DbService db, string? nameFilter = null)
    {
        if (string.IsNullOrEmpty(nameFilter))
        {
            return db.Query(
                $"{SelectColumns} ORDER BY pinned DESC, updated_at DESC",
                EntityMappers.MapProject);
        }

        return db.Query(
            $"{SelectColumns} WHERE name LIKE @filter ORDER BY pinned DESC, updated_at DESC",
            EntityMappers.MapProject,
            DbService.Param("@filter", $"%{nameFilter}%"));
    }

    public static ProjectEntity? GetById(DbService db, string id) =>
        db.QueryFirstOrDefault(
            $"{SelectColumns} WHERE id = @id",
            EntityMappers.MapProject,
            DbService.Param("@id", id));

    /// <summary>
    /// 沙箱的全局分支要做的事：拿到**所有本地项目**的工作目录，当全局会话的可读写根。
    ///
    /// ⚠️ WHERE 里的 <c>ssh_connection_id</c> 过滤不能去掉：SSH 项目的工作目录是**远端路径**，
    /// 放进本地沙箱根集合毫无意义，更糟的是它可能恰好和某个本地路径同形，把保护扩大到不该到的地方。
    /// </summary>
    public static List<string> ListSandboxRoots(DbService db) =>
        db.Query(
            "SELECT working_folder FROM projects " +
            "WHERE working_folder IS NOT NULL AND working_folder <> '' " +
            "AND (ssh_connection_id IS NULL OR ssh_connection_id = '')",
            r => r.GetString("working_folder"));

    /// <summary>
    /// 单个项目的工作目录，供项目会话在 run params 漏传 <c>workingFolder</c> 时回查（S-144）。
    ///
    /// 漏传一处的后果不是「少一层保护」，而是**整个项目目录变成越界** —— 工具用的基准路径与
    /// 根集合会一起退化成「只剩数据根」，项目内的正常写入被拦，报错还在劝用户「把目录加进
    /// 项目工作目录」（他早就加了）。所以这个方法存在的理由就是兜住那种漏传。
    /// </summary>
    public static string? GetWorkingFolder(DbService db, string projectId)
    {
        var rows = db.Query(
            "SELECT working_folder FROM projects WHERE id = @id LIMIT 1",
            r => r.GetString("working_folder"),
            DbService.Param("@id", projectId));
        return rows.Count > 0 && !string.IsNullOrWhiteSpace(rows[0]) ? rows[0] : null;
    }

    /// <summary>
    /// 建项目查重：把带工作目录的项目全拉回来，由调用方在 C# 里比（大小写不敏感 + 忽略尾随分隔符）。
    ///
    /// 不在 SQL 里做归一化是既有的决定：RTRIM + REPLACE + LOWER 拼起来读不懂，而且 SQLite 的
    /// LOWER 只对 ASCII 生效。projects 表是几十行的量级，全表扫无所谓。
    ///
    /// ⚠️ 这里**故意没有** <c>ssh_connection_id</c> 过滤（与 <see cref="ListSandboxRoots"/> 相反）：
    /// 查重问的是「这个目录已经被哪个项目占了」，远端项目同样占着它，滤掉就重复建。
    /// </summary>
    public static List<ProjectEntity> ListForWorkingFolderDedup(DbService db) =>
        db.Query(
            $"{SelectColumns} WHERE working_folder IS NOT NULL AND working_folder <> ''",
            EntityMappers.MapProject);
}

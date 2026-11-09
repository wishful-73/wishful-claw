using Microsoft.Data.Sqlite;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Table access for <c>sessions</c> (S-337 / S-328 刀 27).
///
/// Contract: this class owns every SQL literal that the **agent layer** used to write against
/// <c>sessions</c>. The renderer-facing endpoints in <c>DbSessionTools.*</c> still carry their own
/// copies — thinning those is S-336, and they are not interchangeable with these methods (see
/// <see cref="InsertProjectSession"/>).
/// </summary>
public static class DbSessionStore
{
    /// <summary>总会话数（项目列表卡片）。全表最热的两个 count 之一，N+1 是本族不动的事。</summary>
    public static int CountByProject(DbService db, string projectId) =>
        db.QueryScalar<int>(
            "SELECT COUNT(*) FROM sessions WHERE project_id = @id",
            DbService.Param("@id", projectId));

    /// <summary>
    /// 活跃会话数（项目列表卡片的「1 小时内有动静」）。
    ///
    /// ⚠️ 时间窗口本身**不在这里算**：<paramref name="cutoffMs"/> 由调用方给。把
    /// 「活跃」的定义（1 小时？30 分钟？）埋进基础设施层，改口径就得改 Db 层，那是错的。
    /// </summary>
    public static int CountActiveByProject(DbService db, string projectId, long cutoffMs) =>
        db.QueryScalar<int>(
            "SELECT COUNT(*) FROM sessions WHERE project_id = @id AND updated_at > @cutoff",
            DbService.Param("@id", projectId),
            DbService.Param("@cutoff", cutoffMs));

    /// <summary>
    /// 项目下最近的会话，按更新时间倒序。
    ///
    /// 这里用 <c>SELECT *</c> 而 <c>DbPlanStore</c> 用显式列 —— 差别在列数：
    /// <c>plans</c> 只有 9 列、可控；<c>sessions</c> 有 29 列，而 <c>EntityMappers.MapSession</c>
    /// 是**按列名**读（`GetOrdinal`），`SELECT *` 不存在错位风险；反过来写 29 个列名，实体每加
    /// 一个字段就要同步一处，漏了才是真炸。按名读的表，宽表用 `*` 更安全。
    /// </summary>
    public static List<SessionEntity> ListRecentByProject(DbService db, string projectId, int limit = 20) =>
        db.Query(
            "SELECT * FROM sessions WHERE project_id = @pid ORDER BY updated_at DESC LIMIT @limit",
            EntityMappers.MapSession,
            DbService.Param("@pid", projectId),
            DbService.Param("@limit", limit));

    /// <summary>
    /// 项目执行器建会话的旁路直插 —— **只写 12 列的全量子集**，和 <c>DbSessionTools.Create</c>
    /// 那个 24 列全量 INSERT **不是同一件事，别合并**：
    /// <list type="bullet">
    /// <item><c>message_count</c> / <c>pinned</c> 在原 SQL 里是**字面量 0**，不是绑定参数 ——
    /// 保持原样（S-328 §四：不顺便改语义）</item>
    /// <item><c>icon</c> / <c>context_cap_*</c> / <c>compression_threshold</c> / <c>plan_id</c> /
    /// <c>plugin_*</c> / <c>external_chat_*</c> / <c>provider_id</c> / <c>model_id</c> /
    /// <c>persona_id</c> 走建表默认值</item>
    /// </list>
    ///
    /// <para>
    /// <b>model_selection_mode 是 NOT NULL 且无默认值</b>：存量库该列由 SqlSugar 迁移建出，
    /// 只有类型没有 DEFAULT，漏列直接撞 NOT NULL 约束（<b>S-115</b>）。值随 <see cref="SessionEntity"/>
    /// 默认走。
    /// </para>
    /// <para>
    /// <b>collaboration_mode / permission_mode 的缺省取决于渲染端用户设置</b>（worker 读不到），
    /// 继续留 NULL，由 <c>rowToSession</c> 首次读取时按当前设置归一化回填（<b>S-189</b>）。
    /// </para>
    /// </summary>
    public static void InsertProjectSession(DbService db, SessionEntity entity) =>
        db.Execute(
            "INSERT INTO sessions (id, title, mode, scope, created_at, updated_at, message_count, " +
            "project_id, working_folder, ssh_connection_id, pinned, model_selection_mode) " +
            "VALUES (@id, @title, @mode, @scope, @ca, @ua, 0, @pid, @wf, @ssh, 0, @msm)",
            DbService.Param("@id", entity.Id),
            DbService.Param("@title", entity.Title),
            DbService.Param("@mode", entity.Mode),
            DbService.Param("@scope", (object?)entity.Scope ?? DBNull.Value),
            DbService.Param("@ca", entity.CreatedAt),
            DbService.Param("@ua", entity.UpdatedAt),
            DbService.Param("@pid", (object?)entity.ProjectId ?? DBNull.Value),
            DbService.Param("@wf", (object?)entity.WorkingFolder ?? DBNull.Value),
            DbService.Param("@ssh", (object?)entity.SshConnectionId ?? DBNull.Value),
            DbService.Param("@msm", entity.ModelSelectionMode));

    /// <summary>
    /// 会话所属项目，供全局任务定位项目。
    ///
    /// 不按 <c>working_folder</c> 反推：两个项目可以共用一个目录（一个 repo 里放几个项目），
    /// 目录并不唯一定位项目。空串与 NULL 一视同仁（都返回 null）。
    /// </summary>
    public static string? GetProjectId(DbService db, string sessionId)
    {
        var projectId = db.QueryScalar<string?>(
            "SELECT project_id FROM sessions WHERE id = @id",
            DbService.Param("@id", sessionId));
        return string.IsNullOrWhiteSpace(projectId) ? null : projectId;
    }
}

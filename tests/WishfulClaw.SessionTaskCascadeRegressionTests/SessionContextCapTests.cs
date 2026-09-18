using Microsoft.Data.Sqlite;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.SessionTaskCascadeRegressionTests;

/// <summary>
/// iter-32 S-73 —— 会话级「请求上下文上限」开关的存储层。
///
/// 这个开关是会话自己的一列（context_cap_enabled，0/1），不像压缩阈值那样是全局设置：
/// 同一台机器上有的会话想省 token、有的会话要跑长任务，两者必须能各存各的。
/// Worker 侧 AgentLoop.ApplyContextCap 只读渲染端随 run 下发的值，所以这一层要是丢了，
/// 开关就白点 —— 因此把 Create / Update / 读回三条路都钉住。
/// </summary>
internal static partial class Program
{
    private static void RunSessionContextCapSuite(string dbPath, DbService db)
    {
        ExpectNoError(DbProjectTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "p-cap");
            w.WriteString("name", "Context Cap Suite Project");
        })), "context cap suite project created");

        // ── 缺省：不开 ──
        ExpectNoError(DbSessionTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "s-cap-off");
            w.WriteString("title", "Session s-cap-off");
            w.WriteString("scope", "global");
        })), "session without the flag is created");
        AssertEqual(0, ContextCapOf(db, "s-cap-off"), "缺省不开上限");

        // ── 创建时开启 ──
        ExpectNoError(DbSessionTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "s-cap-on");
            w.WriteString("title", "Session s-cap-on");
            w.WriteString("scope", "global");
            w.WriteBoolean("contextCapEnabled", true);
        })), "session with the flag is created");
        AssertEqual(1, ContextCapOf(db, "s-cap-on"), "创建时带上限开关");

        // ── 更新路径：patch 能开也能关 ──
        ExpectNoError(DbSessionTools.Update(Params(dbPath, w =>
        {
            w.WriteString("id", "s-cap-off");
            w.WritePropertyName("patch");
            w.WriteStartObject();
            w.WriteBoolean("contextCapEnabled", true);
            w.WriteEndObject();
        })), "patch 可以开上限");
        AssertEqual(1, ContextCapOf(db, "s-cap-off"), "更新路径开启生效");

        ExpectNoError(DbSessionTools.Update(Params(dbPath, w =>
        {
            w.WriteString("id", "s-cap-off");
            w.WritePropertyName("patch");
            w.WriteStartObject();
            w.WriteBoolean("contextCapEnabled", false);
            w.WriteEndObject();
        })), "patch 可以关上限");
        AssertEqual(0, ContextCapOf(db, "s-cap-off"), "更新路径关闭生效");

        // ── 不相关的 patch 不能把它冲掉 ──
        ExpectNoError(DbSessionTools.Update(Params(dbPath, w =>
        {
            w.WriteString("id", "s-cap-on");
            w.WritePropertyName("patch");
            w.WriteStartObject();
            w.WriteString("title", "Renamed");
            w.WriteEndObject();
        })), "改标题不报错");
        AssertEqual(1, ContextCapOf(db, "s-cap-on"), "改别的字段不影响上限开关");

        // ── 读回：SessionRow 必须把这个字段带出去，否则渲染端读不到 ──
        var found = DbSessionTools.Get(Params(dbPath, w => w.WriteString("id", "s-cap-on")));
        ExpectNoError(found, "Get 返回带开关的会话");
        var entity = db.QueryFirstOrDefault(
            "SELECT * FROM sessions WHERE id = @id",
            EntityMappers.MapSession,
            new SqliteParameter("@id", "s-cap-on"));
        AssertEqual(1, entity?.ContextCapEnabled ?? -1, "MapSession 读出 context_cap_enabled");
        AssertEqual(1, SessionRow.FromEntity(entity!).ContextCapEnabled, "SessionRow 转发该字段");
    }

    private static int ContextCapOf(DbService db, string sessionId)
        => db.QueryScalar<int>(
            "SELECT context_cap_enabled FROM sessions WHERE id = @id",
            new SqliteParameter("@id", sessionId));
}

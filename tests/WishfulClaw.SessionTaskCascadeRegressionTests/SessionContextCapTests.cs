using Microsoft.Data.Sqlite;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.SessionTaskCascadeRegressionTests;

/// <summary>
/// iter-32 S-73 / S-84 —— 会话级「请求上下文上限」的存储层。
///
/// 上限是会话自己的两列（context_cap_tokens + context_cap_model_id），不像压缩阈值那样是
/// 全局设置：同一台机器上有的会话想省 token、有的会话要跑长任务，两者必须能各存各的。
/// tokens 与 model id 必须成对存活 —— 换模型后上限作废，靠的就是这对值能一起读回来；
/// Worker 侧 AgentLoop.ApplyContextCap 只读渲染端随 run 下发的数，所以这一层要是丢了，
/// 用户拖的那一刀就白拖了 —— 因此把 Create / Update / 读回三条路都钉住。
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

        // ── 缺省：不限制 ──
        ExpectNoError(DbSessionTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "s-cap-off");
            w.WriteString("title", "Session s-cap-off");
            w.WriteString("scope", "global");
        })), "session without the cap is created");
        AssertEqual(0, CapTokensOf(db, "s-cap-off"), "缺省不限制");
        AssertEqual<string?>(null, CapModelOf(db, "s-cap-off"), "缺省没有 model id");

        // ── 创建时带上限：tokens 与 model id 一起落 ──
        ExpectNoError(DbSessionTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "s-cap-on");
            w.WriteString("title", "Session s-cap-on");
            w.WriteString("scope", "global");
            w.WriteNumber("contextCapTokens", 262_144);
            w.WriteString("contextCapModelId", "model-a");
        })), "session with a cap is created");
        AssertEqual(262_144, CapTokensOf(db, "s-cap-on"), "创建时带上限数值");
        AssertEqual("model-a", CapModelOf(db, "s-cap-on"), "创建时带上限所属模型");

        // ── 更新路径：patch 能设也能清 ──
        ExpectNoError(DbSessionTools.Update(Params(dbPath, w =>
        {
            w.WriteString("id", "s-cap-off");
            w.WritePropertyName("patch");
            w.WriteStartObject();
            w.WriteNumber("contextCapTokens", 204_800);
            w.WriteString("contextCapModelId", "model-b");
            w.WriteEndObject();
        })), "patch 可以设上限");
        AssertEqual(204_800, CapTokensOf(db, "s-cap-off"), "更新路径设置生效");
        AssertEqual("model-b", CapModelOf(db, "s-cap-off"), "更新路径一并写入模型 id");

        // tokens = 0 表示「不限制」，model id 必须一起清掉 —— 留着会让人以为上限还在。
        ExpectNoError(DbSessionTools.Update(Params(dbPath, w =>
        {
            w.WriteString("id", "s-cap-off");
            w.WritePropertyName("patch");
            w.WriteStartObject();
            w.WriteNumber("contextCapTokens", 0);
            w.WriteEndObject();
        })), "patch 可以取消上限");
        AssertEqual(0, CapTokensOf(db, "s-cap-off"), "更新路径取消生效");
        AssertEqual<string?>(null, CapModelOf(db, "s-cap-off"), "取消上限顺手清掉模型 id");

        // ── 不相关的 patch 不能把它冲掉 ──
        ExpectNoError(DbSessionTools.Update(Params(dbPath, w =>
        {
            w.WriteString("id", "s-cap-on");
            w.WritePropertyName("patch");
            w.WriteStartObject();
            w.WriteString("title", "Renamed");
            w.WriteEndObject();
        })), "改标题不报错");
        AssertEqual(262_144, CapTokensOf(db, "s-cap-on"), "改别的字段不影响上限");
        AssertEqual("model-a", CapModelOf(db, "s-cap-on"), "改别的字段不影响上限所属模型");

        // ── 读回：SessionRow 必须把这对字段带出去，否则渲染端读不到 ──
        var found = DbSessionTools.Get(Params(dbPath, w => w.WriteString("id", "s-cap-on")));
        ExpectNoError(found, "Get 返回带上限的会话");
        var entity = db.QueryFirstOrDefault(
            "SELECT * FROM sessions WHERE id = @id",
            EntityMappers.MapSession,
            new SqliteParameter("@id", "s-cap-on"));
        AssertEqual(262_144, entity?.ContextCapTokens ?? -1, "MapSession 读出 context_cap_tokens");
        AssertEqual("model-a", entity?.ContextCapModelId, "MapSession 读出 context_cap_model_id");
        AssertEqual(262_144, SessionRow.FromEntity(entity!).ContextCapTokens, "SessionRow 转发 token 数");
        AssertEqual("model-a", SessionRow.FromEntity(entity!).ContextCapModelId, "SessionRow 转发模型 id");
    }

    private static int CapTokensOf(DbService db, string sessionId)
        => db.QueryScalar<int>(
            "SELECT context_cap_tokens FROM sessions WHERE id = @id",
            new SqliteParameter("@id", sessionId));

    private static string? CapModelOf(DbService db, string sessionId)
        => db.QueryScalar<string?>(
            "SELECT context_cap_model_id FROM sessions WHERE id = @id",
            new SqliteParameter("@id", sessionId));
}

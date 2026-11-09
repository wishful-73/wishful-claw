using Microsoft.Data.Sqlite;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// <c>sub_agent_runs</c> 的表访问入口（S-328 / S-335）。
///
/// 为什么有这个类：Db 层原本只有「端点」形状的出口（<see cref="DbSubAgentTools"/>，
/// 进出都是 <c>WorkerResponse (JsonElement)</c>），Agent 层要读写一行只能自己拼 SQL。
/// 这里放的是**表访问**形状：进强类型、出强类型，不碰 JsonElement、不碰 WorkerResponse。
///
/// 与端点的分工：本类只管「读/写这张表」，端点管「收请求、组装 JSON、错误码」。
/// 端点内部应转调本类，**同一份 SQL 只允许存在一处**（S-328 §三）。
///
/// DDL 事实（<c>DbClient.Schema</c>）：<c>data TEXT NOT NULL DEFAULT ''</c>，
/// 所以 <see cref="GetByToolUseId"/> 返回 <c>null</c> 只表示**行不存在**，
/// 不表示「行在但 data 为空」—— 后者返回的实体 <c>Data</c> 是 <c>""</c>。
/// 调用方若用「读到的 data 是否为 null」来判断走 INSERT 还是 UPDATE，这个区分就是生命线。
/// </summary>
public static class DbSubAgentRunStore
{
    /// <summary>按主键 <c>tool_use_id</c> 取整行；不存在返回 null。</summary>
    public static SubAgentRunEntity? GetByToolUseId(DbService db, string toolUseId)
    {
        return db.QueryFirstOrDefault(
            "SELECT tool_use_id, session_id, agent_name, data, started_at, completed_at, success " +
            "FROM sub_agent_runs WHERE tool_use_id = @id",
            EntityMappers.MapSubAgentRun,
            new SqliteParameter("@id", toolUseId));
    }

    /// <summary>
    /// 插一行。调用方负责决定各字段的取值（例如主键不存在时的兜底 session_id、
    /// 「没有开始时间就拿完成时间顶上」这类业务约定）—— 本方法不做任何默认值填充。
    /// </summary>
    public static void Insert(DbService db, SubAgentRunEntity entity)
    {
        db.Execute(
            "INSERT INTO sub_agent_runs (tool_use_id, session_id, agent_name, data, started_at, completed_at, success) " +
            "VALUES (@tuid, @sid, @name, @data, @sa, @ca, @suc)",
            new SqliteParameter("@tuid", entity.ToolUseId),
            new SqliteParameter("@sid", entity.SessionId),
            new SqliteParameter("@name", entity.AgentName),
            new SqliteParameter("@data", entity.Data),
            new SqliteParameter("@sa", entity.StartedAt),
            new SqliteParameter("@ca", (object?)entity.CompletedAt ?? DBNull.Value),
            new SqliteParameter("@suc", (object?)entity.Success ?? DBNull.Value));
    }

    /// <summary>
    /// 只更新 <c>data</c> 一列。返回受影响行数 —— 0 表示<b>行不存在</b>，
    /// 调用方若据此当「更新成功」会把报告悄悄丢掉。
    /// </summary>
    public static int UpdateData(DbService db, string toolUseId, string data)
    {
        return db.Execute(
            "UPDATE sub_agent_runs SET data = @data WHERE tool_use_id = @id",
            new SqliteParameter("@data", data),
            new SqliteParameter("@id", toolUseId));
    }
}

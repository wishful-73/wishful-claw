using Microsoft.Data.Sqlite;

namespace WishfulClaw.Workspace.Memory;

/// <summary>
/// 「按修改时间筛选」的 SQL 条件构造（iter-33 S-101）。
///
/// 两个消费方都要按 <c>updated_at</c> 收窄范围：记忆库列表（Worker 的 <c>memory/entries</c>
/// 端点）与召回检索链（<see cref="MemoryFtsService"/>）。它们必须共用同一份拼装 ——
/// 各写一份必然漂移，而漂移的表现是「列表里翻得到的条目搜不到」，最难排查。
///
/// 落在这层的另一个理由：它是纯函数、不碰数据库，可以被
/// <c>WishfulClaw.MemoryRecallRegressionTests</c> 直接断言。Worker 层的端点函数是
/// <c>private static</c>，且没有任何测试工程引用 Worker，端点级断言根本写不出来。
/// </summary>
public static class MemoryTimeFilter
{
    /// <summary>
    /// 构造区间条件，返回值**带前导 <c>" AND "</c>**，可直接拼在既有 WHERE 之后。
    /// 参数名固定为 <c>@updatedFrom</c> / <c>@updatedTo</c>：每个语句各自绑定一份，
    /// 同一批 SQL 里不会重名。
    ///
    /// 闭区间（两端都含）。非正数一律当「不限」—— 前端表示「全部」就是不给这个字段，
    /// 但传 0 也按同义处理，免得一个 0 把区间收成「1970 年那一秒」。
    ///
    /// <paramref name="qualifier"/> 是给带表别名的语句准备的（FTS 路径里表叫 <c>e</c>），
    /// 只接受调用方的字面量，**不是**用户输入。
    /// </summary>
    public static MemoryTimeClause Build(long? from, long? to, string qualifier = "")
    {
        var sql = string.Empty;
        var parameters = new List<SqliteParameter>(2);

        if (from is > 0)
        {
            sql += $" AND {qualifier}updated_at >= @updatedFrom";
            parameters.Add(new SqliteParameter("@updatedFrom", from.Value));
        }
        if (to is > 0)
        {
            sql += $" AND {qualifier}updated_at <= @updatedTo";
            parameters.Add(new SqliteParameter("@updatedTo", to.Value));
        }

        return new MemoryTimeClause(sql, parameters);
    }
}

/// <summary>时间区间的 SQL 片段与它的绑定参数。</summary>
public readonly record struct MemoryTimeClause(string Sql, IReadOnlyList<SqliteParameter> Parameters);

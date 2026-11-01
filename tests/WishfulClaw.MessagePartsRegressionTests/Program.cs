// iter-v3-4 S-285 —— 助手消息块结构拆出 message_parts。
//
// 钉住四件容易做错的事：
//   1. 零迁移：老库启动自动建表（CREATE TABLE IF NOT EXISTS），老数据一行不动。
//   2. 老格式原样：库里 meta 已带 segments/toolCalls ⇒ 整行写回，一个字节不变，parts 不碰。
//   3. 新格式：块结构进 parts，meta 只留非块字段；读侧合并回来形状不变。
//   4. seq 稳定：同一 toolCallId 状态更新走单行 INSERT OR REPLACE，绝不追加新行。
//
// 反向验证（§8.4 要求）：把 CREATE TABLE IF NOT EXISTS 改成 CREATE TABLE，
// 第二次启动必须炸 —— 见 RunIfNotExistsGuardSuite。

using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Infrastructure;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.TestSupport;

namespace WishfulClaw.MessagePartsRegressionTests;

internal static class Program
{
    private static int _passed;

    public static int Main()
    {
        try
        {
            WorkerJsonHelper.ConfigureAotResolver(InfrastructureJsonContext.Default);

            var testRoot = Path.Combine(TestOutputRoot.Resolve(), $"message-parts-{Guid.NewGuid():N}");
            Directory.CreateDirectory(testRoot);
            try
            {
                var dbPath = Path.Combine(testRoot, "regression.db");
                var initialization = DbClient.Initialize(dbPath);
                Assert(initialization.Success, $"database initializes: {initialization.Error}");

                var db = DbClient.GetClient();

                RunTableExistsSuite(db);
                RunIfNotExistsGuardSuite(dbPath);
                RunSeqEncodingSuite();
                RunSeqFallbackSuite();
                RunLegacyToolCallsSeqSuite(db);
                RunNewFormatWriteSuite(db);
                RunRoundTripSuite(db);
                RunLegacyFormatSuite(db);
                RunDeleteSuite(db);

                Console.WriteLine($"message-parts (worker): {_passed} passed");
                return 0;
            }
            finally
            {
                TryDeleteDirectory(testRoot);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"message-parts (worker) FAILED: {ex}");
            return 1;
        }
    }

    // ─── 1. 建表 ───

    private static void RunTableExistsSuite(DbService db)
    {
        var count = db.QueryScalar<int>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='message_parts'");
        AssertEqual(1, count, "老库初始化后 message_parts 表存在（零迁移自动建表）");

        var columns = db.Query(
            "SELECT name FROM pragma_table_info('message_parts') ORDER BY cid",
            r => r.GetString(0));
        AssertEqual("message_id,seq,kind,payload,created_at", string.Join(",", columns),
            "列顺序与 §4.1 一致");

        // WITHOUT ROWID 表的标志：sqlite_master.sql 里带 WITHOUT ROWID。
        var ddl = db.QueryScalar<string>(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='message_parts'");
        Assert(ddl.Contains("WITHOUT ROWID", StringComparison.OrdinalIgnoreCase),
            "message_parts 是 WITHOUT ROWID（主键即索引，不再加索引）");

        // §8.4 反向验证：SQLite 会把 IF NOT EXISTS 从 sqlite_master 存的文本里剥掉，
        // 所以「读回 DDL 再执行」这条路测不到幂等（必然红，已实测）。真正的幂等由
        // RunIfNotExistsGuardSuite 的机制断言 + 一次人工反向验证兜底（见需求单 §8.4：
        // 把 Schema.cs 这条 DDL 临时改成不带 IF NOT EXISTS，测试当场炸
        // "table message_parts already exists"）。
    }

    /// <summary>
    /// §8.4 反向验证：把 IF NOT EXISTS 去掉，第二次建表必须抛。
    /// 不抛说明 SQLite 版本行为变了，或者这条 DDL 根本没在跑。
    /// </summary>
    private static void RunIfNotExistsGuardSuite(string dbPath)
    {
        using var conn = new SqliteConnection($"Data Source={dbPath}");
        conn.Open();

        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText =
                "CREATE TABLE IF NOT EXISTS guard_probe (id TEXT PRIMARY KEY);";
            cmd.ExecuteNonQuery();
        }

        // 第二遍带 IF NOT EXISTS —— 必须安静通过。
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "CREATE TABLE IF NOT EXISTS guard_probe (id TEXT PRIMARY KEY);";
            cmd.ExecuteNonQuery();
        }
        Assert(true, "CREATE TABLE IF NOT EXISTS 第二次执行不抛（幂等）");

        // 第二遍不带 —— 必须炸。
        var threw = false;
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "CREATE TABLE guard_probe (id TEXT PRIMARY KEY);";
            cmd.ExecuteNonQuery();
        }
        catch (SqliteException)
        {
            threw = true;
        }
        Assert(threw, "不带 IF NOT EXISTS 第二次建表必须炸（证明 IF NOT EXISTS 不是摆设）");

        using var drop = conn.CreateCommand();
        drop.CommandText = "DROP TABLE guard_probe;";
        drop.ExecuteNonQuery();
    }

    // ─── 2. seq 编码 ───

    private static void RunSeqEncodingSuite()
    {
        // 同一 (iteration, kind) 恒定映射同一 seq。
        AssertEqual(DbMessageParts.EncodeSeq(1, DbMessageParts.Kinds.Thinking, 0),
                     DbMessageParts.EncodeSeq(1, DbMessageParts.Kinds.Thinking, 0),
            "同 iteration 同 kind 的 thinking seq 恒定");

        AssertEqual(DbMessageParts.EncodeSeq(1, DbMessageParts.Kinds.Text, 0),
                     DbMessageParts.EncodeSeq(1, DbMessageParts.Kinds.Text, 0),
            "同 iteration 同 kind 的 text seq 恒定");

        // 段内次序：thinking < text < tool_use。
        var thinking = DbMessageParts.EncodeSeq(2, DbMessageParts.Kinds.Thinking, 0);
        var text = DbMessageParts.EncodeSeq(2, DbMessageParts.Kinds.Text, 0);
        var tool = DbMessageParts.EncodeSeq(2, DbMessageParts.Kinds.ToolUse, 0);
        Assert(thinking < text && text < tool,
            "同 iteration 内 seq 序 = thinking < text < tool_use（与 SEGMENT_KIND_ORDER 一致）");

        // 跨 iteration 不撞：iteration 2 的 thinking 必须大于 iteration 1 的所有段。
        Assert(DbMessageParts.EncodeSeq(2, DbMessageParts.Kinds.Thinking, 0) >
               DbMessageParts.EncodeSeq(1, DbMessageParts.Kinds.ToolUse, 99),
            "iteration 2 的 seq 全部大于 iteration 1 的 seq（不串轮）");

        // 并行工具：ordinal 递增不撞。
        Assert(DbMessageParts.EncodeSeq(1, DbMessageParts.Kinds.ToolUse, 0) <
               DbMessageParts.EncodeSeq(1, DbMessageParts.Kinds.ToolUse, 1),
            "同轮并行工具按 ordinal 递增，不撞 seq");
    }

    // ─── 2b. 兜底 seq（缺 iteration 的老段） ───

    /// <summary>
    /// 缺 <c>iteration</c> 的段不许当第 1 轮算 —— 那会和真实第 1 轮抢 ordinal，
    /// clamp 到 99 之后 seq 重复，<c>INSERT OR REPLACE</c> 静默吞段。
    /// 兜底走负区间：整体排在所有真实段之前，内部按数组序保序。
    /// </summary>
    private static void RunSeqFallbackSuite()
    {
        Assert(DbMessageParts.EncodeFallbackSeq(0) < 0,
            "兜底 seq 恒为负（与所有真实段 seq >= 0 不相交）");

        Assert(DbMessageParts.EncodeFallbackSeq(0) <
               DbMessageParts.EncodeSeq(1, DbMessageParts.Kinds.Thinking, 0),
            "兜底 seq 全部小于真实第 1 轮的任何段（老段整体在前）");

        Assert(DbMessageParts.EncodeFallbackSeq(0) < DbMessageParts.EncodeFallbackSeq(1),
            "兜底 seq 内部按数组下标保序");

        Assert(DbMessageParts.EncodeFallbackSeq(5) - DbMessageParts.EncodeFallbackSeq(0) == 5,
            "兜底 seq 严格等差（相邻段不撞）");

        // SplitMeta 层面：整条段都缺 iteration ⇒ 全走兜底，且保序。
        var (_, missingIteration) = DbMessageParts.SplitMeta(
            """{"segments":[{"type":"text","text":"a"},{"type":"text","text":"b"},{"type":"thinking","thinking":"c"}]}""",
            0);
        AssertEqual(3, missingIteration.Count, "缺 iteration 的段全部生成 parts（一段不丢）");
        Assert(missingIteration.All(p => p.Seq < 0), "缺 iteration 的段 seq 全为负");
        Assert(missingIteration[0].Seq < missingIteration[1].Seq &&
               missingIteration[1].Seq < missingIteration[2].Seq,
            "缺 iteration 的段 seq 严格递增 = 数组原始先后");
        AssertEqual("text,text,thinking", string.Join(",", missingIteration.Select(p => p.Kind)),
            "缺 iteration 时段的种类与顺序原样保留");

        // 混排：有 iteration 的走正常编码，缺的走负区间，两边不打架。
        var (_, mixed) = DbMessageParts.SplitMeta(
            """{"segments":[{"type":"text","iteration":1,"text":"正常"},{"type":"tool_use","toolCallId":"x","toolName":"Read"}]}""",
            0);
        AssertEqual(2, mixed.Count, "混排时两段都在");
        var normal = mixed.Single(p => p.Kind == DbMessageParts.Kinds.Text);
        var fallback = mixed.Single(p => p.Kind == DbMessageParts.Kinds.ToolUse);
        Assert(normal.Seq > 0, "带 iteration 的段走正常正区间编码");
        Assert(fallback.Seq < 0, "缺 iteration 的段走兜底负区间编码");
    }

    // ─── 2c. 老 toolCalls 大批量不吞段 ───

    /// <summary>
    /// 只有 toolCalls、没有 segments 的老数据：<b>反向验证</b>用。
    /// 旧实现按 <c>EncodeSeq(1, tool_use, ordinal)</c> 分配，ordinal 被 clamp 到 99，
    /// 第 100 个之后全部撞同一个 seq ⇒ 148 次调用只剩 100 行。
    /// 现在走保序兜底，148 行一个不少。
    /// </summary>
    private static void RunLegacyToolCallsSeqSuite(DbService db)
    {
        const int callCount = 148;
        var calls = string.Join(",",
            Enumerable.Range(0, callCount)
                .Select(i => $$"""{"id":"c{{i}}","name":"Read","input":{"i":{{i}}},"status":"completed"}"""));

        var (_, parts) = DbMessageParts.SplitMeta($$"""{"toolCalls":[{{calls}}]}""", 0);

        AssertEqual(callCount, parts.Count, $"老 toolCalls {callCount} 次调用全部生成 parts 段");
        AssertEqual(callCount, parts.Select(p => p.Seq).Distinct().Count(),
            $"老 toolCalls 的 {callCount} 个 seq 全唯一（clamp 不再把 ordinal 压成同一个值）");

        // 真写库再读回来 —— INSERT OR REPLACE 是 (message_id, seq) 主键，seq 重复才会吞。
        const string messageId = "msg-legacy-toolcalls";
        db.ExecuteInTransaction((conn, tx) =>
            DbMessageParts.WriteParts(conn, tx, messageId, parts, 0));

        var loaded = DbMessageParts.LoadParts(db, [messageId]);
        AssertEqual(callCount, loaded[messageId].Count,
            $"写库后 {callCount} 行都在（没有段被 INSERT OR REPLACE 覆盖掉）");

        // 顺序必须与 toolCalls 数组原始先后一致。
        var firstPayload = loaded[messageId][0].Payload;
        var lastPayload = loaded[messageId][callCount - 1].Payload;
        Assert(firstPayload.Contains("\"c0\"", StringComparison.Ordinal),
            "读回的第一段是 toolCalls[0]（顺序未乱）");
        Assert(lastPayload.Contains($"\"c{callCount - 1}\"", StringComparison.Ordinal),
            $"读回的最后一段是 toolCalls[{callCount - 1}]（顺序未乱）");

        db.ExecuteInTransaction((conn, tx) => DbMessageParts.DeleteForMessage(conn, tx, messageId));
        AssertEqual(0, DbMessageParts.LoadParts(db, [messageId]).Count, "测试数据已清理");
    }

    // ─── 3. 新格式写入 ───

    private static void RunNewFormatWriteSuite(DbService db)
    {
        const string sessionId = "session-new";
        const string messageId = "msg-new";

        // S-276 之后 ListByTurns 只数真实用户消息（role='user' 且非压缩卡），
        // 没有 user 消息就没有窗口 —— 补一条轮起点，否则读侧断言拿不到任何行。
        SeedUserTurn(db, sessionId, "msg-new-user", 900);

        var meta = """
            {
              "thinking": "整体思考汇总",
              "segments": [
                {"type":"thinking","iteration":1,"thinking":"第一轮思考","startedAt":100,"completedAt":200},
                {"type":"text","iteration":1,"text":"第一轮正文"},
                {"type":"tool_use","iteration":1,"toolCallId":"call-1","toolName":"Read","input":{"path":"a.ts"},"status":"running","startedAt":300}
              ],
              "toolCalls": [
                {"id":"call-1","name":"Read","input":{"path":"a.ts"},"status":"running","startedAt":300}
              ],
              "error": "无"
            }
            """;

        Upsert(messageId, sessionId, "assistant", "正文", meta, 1_000);

        // 3a. meta 里不能再有块结构。
        var storedMeta = ReadMeta(db, messageId);
        Assert(storedMeta is not null, "新格式写入后 meta 不为 null");
        Assert(!storedMeta!.Contains("\"segments\"", StringComparison.Ordinal),
            "新格式 meta 里不含 segments（已搬进 parts）");
        Assert(!storedMeta.Contains("\"toolCalls\"", StringComparison.Ordinal),
            "新格式 meta 里不含 toolCalls（已搬进 parts）");

        // 3b. 非块字段必须原样保留。
        Assert(storedMeta.Contains("\"thinking\":\"整体思考汇总\"", StringComparison.Ordinal),
            "顶层 thinking 留在 meta（是整条消息的汇总，不是块结构）");
        Assert(storedMeta.Contains("\"error\":\"无\"", StringComparison.Ordinal),
            "error 等非块字段原样保留");

        // 3c. parts 三行，kind 齐全。
        var parts = DbMessageParts.LoadParts(db, [messageId]);
        Assert(parts.ContainsKey(messageId), "新格式写入后 parts 有行");
        var rows = parts[messageId];
        AssertEqual(3, rows.Count, "三个段 = 三行 parts");
        AssertEqual("thinking,text,tool_use", string.Join(",", rows.Select(r => r.Kind)),
            "kind 按 seq 升序 = thinking,text,tool_use");

        // 3d. 读侧合并回来，形状恢复。
        var readBack = ListByTurns(sessionId);
        Assert(readBack.Success, $"ListByTurns succeeds: {readBack.Error}");
        var row = readBack.Messages.Single(m => m.Id == messageId);
        Assert(row.Meta is not null, "读回来的 meta 不为 null");
        Assert(row.Meta!.Contains("\"segments\"", StringComparison.Ordinal),
            "读侧把 segments 合并回 meta（渲染层零改动）");
        Assert(row.Meta.Contains("\"toolCalls\"", StringComparison.Ordinal),
            "读侧把 toolCalls 合并回 meta");
        Assert(row.Meta.Contains("call-1", StringComparison.Ordinal),
            "合并回来的 toolCalls 带 toolCallId");

        // 3e. seq 稳定：状态更新只改同一行。
        var updatedMeta = meta.Replace("\"status\":\"running\"", "\"status\":\"completed\"")
                              .Replace("\"startedAt\":300}", "\"startedAt\":300,\"output\":\"读到了\"}");
        Upsert(messageId, sessionId, "assistant", "正文", updatedMeta, 1_000);

        var afterUpdate = DbMessageParts.LoadParts(db, [messageId]);
        AssertEqual(3, afterUpdate[messageId].Count,
            "状态更新后 parts 行数不变（单行 INSERT OR REPLACE，不追加）");
        var toolRow = afterUpdate[messageId].Single(r => r.Kind == DbMessageParts.Kinds.ToolUse);
        Assert(toolRow.Payload.Contains("\"completed\"", StringComparison.Ordinal),
            "tool_use 行的 payload 被原地更新为 completed");
        Assert(toolRow.Payload.Contains("读到了", StringComparison.Ordinal),
            "tool_use 行的 payload 带上了 output");
    }

    // ─── 3b. 往返一致（渲染端读取路） ───

    /// <summary>
    /// <b>派单点名的那条断言</b>：一条新消息（写库后 meta 里已无块结构）重开读回，
    /// 气泡里的 thinking / text / tool_use 序列必须与写库前<b>逐项相同</b>。
    ///
    /// <para>渲染端 <c>deserializeMessage</c>（<c>db-helpers.ts:154</c>）读的是
    /// <c>row.meta</c> 的 <c>segments</c> / <c>toolCalls</c> / <c>thinking</c> 三个键。
    /// 只要 IPC 出口把 parts 合并回 meta（<c>ToRowsWithParts</c>），渲染层就零改动；
    /// 这条断言就是钉住那个「合并回来」的出口，光看 SQL 里有 parts 不算数。</para>
    ///
    /// <para><b>修复前必红</b>：若读侧不合并，<c>segments</c> 键在 meta 里根本不存在，
    /// 断言在 <c>TryGetProperty</c> 上直接炸。</para>
    /// </summary>
    private static void RunRoundTripSuite(DbService db)
    {
        const string sessionId = "session-roundtrip";
        const string messageId = "msg-roundtrip";

        SeedUserTurn(db, sessionId, "msg-roundtrip-user", 4_000);

        const string meta = """
            {
              "thinking": "整体思考汇总",
              "segments": [
                {"type":"thinking","iteration":1,"thinking":"第一轮思考","startedAt":10,"completedAt":20},
                {"type":"text","iteration":1,"text":"第一轮正文"},
                {"type":"tool_use","iteration":1,"toolCallId":"c1","toolName":"Read",
                 "input":{"path":"a.ts","nested":{"k":[1,2,3]}},"status":"completed","output":"读到了",
                 "startedAt":30,"completedAt":40},
                {"type":"thinking","iteration":2,"thinking":"第二轮思考","startedAt":50,"completedAt":60},
                {"type":"tool_use","iteration":2,"toolCallId":"c2","toolName":"Bash",
                 "input":{"cmd":"ls"},"status":"running","startedAt":70}
              ],
              "toolCalls": [
                {"id":"c1","name":"Read","input":{"path":"a.ts","nested":{"k":[1,2,3]}},
                 "status":"completed","output":"读到了","startedAt":30,"completedAt":40},
                {"id":"c2","name":"Bash","input":{"cmd":"ls"},"status":"running","startedAt":70}
              ]
            }
            """;

        Upsert(messageId, sessionId, "assistant", "正文", meta, 4_001);

        var readBack = ListByTurns(sessionId);
        Assert(readBack.Success, $"往返读回成功: {readBack.Error}");
        var row = readBack.Messages.Single(m => m.Id == messageId);
        Assert(row.Meta is not null, "往返后 meta 不为 null");

        using var expectedDoc = JsonDocument.Parse(meta);
        using var actualDoc = JsonDocument.Parse(row.Meta!);

        // ① segments：thinking / text / tool_use 序列逐项相同（种类、顺序、每个字段的值）。
        Assert(actualDoc.RootElement.TryGetProperty("segments", out var actualSegments),
            "读回的 meta 带 segments 键（渲染端 deserializeMessage 靠它渲染气泡）");
        Assert(JsonDeepEquals(expectedDoc.RootElement.GetProperty("segments"), actualSegments),
            "往返后 segments 逐项相同（thinking/text/tool_use 序列与写库前一致）");

        // ② toolCalls：从 tool_use 段重建，字段完全重叠 ⇒ 也必须逐项相同。
        Assert(actualDoc.RootElement.TryGetProperty("toolCalls", out var actualToolCalls),
            "读回的 meta 带 toolCalls 键");
        Assert(JsonDeepEquals(expectedDoc.RootElement.GetProperty("toolCalls"), actualToolCalls),
            "往返后 toolCalls 逐项相同");

        // ③ 顶层 thinking 是整条消息的汇总，不走 parts，往返也不许变。
        AssertEqual("整体思考汇总",
            actualDoc.RootElement.GetProperty("thinking").GetString(),
            "往返后顶层 thinking 不变");

        // ④ 顺序断言：seq 排序必须还原出原始数组顺序，不能按 kind 分组。
        var kinds = actualSegments.EnumerateArray()
            .Select(s => s.GetProperty("type").GetString())
            .ToList();
        AssertEqual("thinking,text,tool_use,thinking,tool_use", string.Join(",", kinds),
            "往返后段序 = 原始数组序（两轮交错，不是按 kind 分组）");
    }

    // ─── 4. 老格式原样 ───

    private static void RunLegacyFormatSuite(DbService db)
    {
        const string sessionId = "session-legacy";
        const string messageId = "msg-legacy";

        SeedUserTurn(db, sessionId, "msg-legacy-user", 1_900);

        var legacyMeta =
            "{\"segments\":[{\"type\":\"text\",\"iteration\":1,\"text\":\"老格式正文\"}]," +
            "\"toolCalls\":[{\"id\":\"legacy-call\",\"name\":\"Bash\",\"input\":{},\"status\":\"completed\"}]}";

        // 直接写库，模拟「历史行」——不经过 Upsert 的拆分。
        db.Execute(
            "INSERT INTO messages (id, session_id, role, content, meta, created_at, updated_at, sort_order) " +
            "VALUES (@id, @sid, 'assistant', '老正文', @meta, 2000, 2000, 1)",
            new SqliteParameter("@id", messageId),
            new SqliteParameter("@sid", sessionId),
            new SqliteParameter("@meta", legacyMeta));

        // 老格式被再次 upsert（比如压缩状态修复）——必须原样写回。
        Upsert(messageId, sessionId, "assistant", "老正文改过", legacyMeta, 2_000);

        var storedMeta = ReadMeta(db, messageId);
        AssertEqual(legacyMeta, storedMeta,
            "老格式消息再次 upsert 后 meta 逐字节不变（一个字节都不动）");

        var parts = DbMessageParts.LoadParts(db, [messageId]);
        Assert(!parts.ContainsKey(messageId),
            "老格式消息不产生任何 parts 行（零迁移）");

        // 读侧对老格式也是原样返回。
        var readBack = ListByTurns(sessionId);
        var row = readBack.Messages.Single(m => m.Id == messageId);
        AssertEqual(legacyMeta, row.Meta,
            "老格式消息读出来的 meta 与库里完全一致（兼容层没改它）");
    }

    // ─── 5. 删除清 parts ───

    private static void RunDeleteSuite(DbService db)
    {
        const string sessionId = "session-delete";

        var meta = """
            {"segments":[{"type":"text","iteration":1,"text":"待删"}],
             "toolCalls":[{"id":"del-call","name":"Read","input":{},"status":"completed"}]}
            """;

        Upsert("del-1", sessionId, "assistant", "x", meta, 3_000);
        Upsert("del-2", sessionId, "assistant", "y", meta, 3_001);

        var before = DbMessageParts.LoadParts(db, ["del-1", "del-2"]);
        AssertEqual(2, before.Count, "两条消息各自有 parts");

        // 单条删除：先清 parts 再删行。
        DeleteMessage(sessionId, "del-1");
        var afterOne = DbMessageParts.LoadParts(db, ["del-1", "del-2"]);
        Assert(!afterOne.ContainsKey("del-1"), "Delete 单条后它的 parts 被清掉");
        Assert(afterOne.ContainsKey("del-2"), "Delete 单条不影响其它消息的 parts");

        // 整个会话清空。
        ClearSession(sessionId);
        var afterClear = DbMessageParts.LoadParts(db, ["del-2"]);
        Assert(!afterClear.ContainsKey("del-2"), "Clear 会话后 parts 全部清掉");

        var orphan = db.QueryScalar<int>(
            "SELECT COUNT(*) FROM message_parts WHERE message_id LIKE 'del-%'");
        AssertEqual(0, orphan, "没有孤儿 parts 行残留");
    }

    // ─── helpers ───

    private static void Upsert(
        string id,
        string sessionId,
        string role,
        string content,
        string? meta,
        long createdAt)
    {
        var parameters = WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("id", id);
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("role", role);
            writer.WriteString("content", content);
            if (meta is not null) writer.WriteString("meta", meta);
            writer.WriteNumber("createdAt", createdAt);
            writer.WriteNumber("sortOrder", 1);
            writer.WriteEndObject();
        });

        var response = DbMessageTools.Upsert(parameters);
        var result = ParseResult(response);
        Assert(result.GetProperty("success").GetBoolean(), $"upsert {id} succeeds");
    }

    private static void DeleteMessage(string sessionId, string messageId)
    {
        var parameters = WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("messageId", messageId);
            writer.WriteEndObject();
        });

        var response = DbMessageTools.Delete(parameters);
        Assert(ParseResult(response).GetProperty("deleted").GetBoolean(), $"delete {messageId} succeeds");
    }

    private static void ClearSession(string sessionId)
    {
        var parameters = WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("sessionId", sessionId);
            writer.WriteEndObject();
        });

        var response = DbMessageTools.Clear(parameters);
        Assert(ParseResult(response).GetProperty("success").GetBoolean(), "clear session succeeds");
    }

    private static void SeedUserTurn(DbService db, string sessionId, string messageId, long createdAt)
    {
        db.Execute(
            "INSERT INTO messages (id, session_id, role, content, meta, created_at, updated_at, sort_order) " +
            "VALUES (@id, @sid, 'user', '起点', NULL, @ts, @ts, 0)",
            new SqliteParameter("@id", messageId),
            new SqliteParameter("@sid", sessionId),
            new SqliteParameter("@ts", createdAt));
    }

    private static string ReadMeta(DbService db, string messageId)
    {
        return db.QueryFirstOrDefault(
            "SELECT meta FROM messages WHERE id = @id",
            r => r.IsDBNull(0) ? string.Empty : r.GetString(0),
            new SqliteParameter("@id", messageId)) ?? string.Empty;
    }

    private readonly record struct ListResult(bool Success, List<MessageRow> Messages, string? Error);

    private static ListResult ListByTurns(string sessionId)
    {
        var parameters = WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("sessionId", sessionId);
            writer.WriteNumber("turns", 10);
            writer.WriteEndObject();
        });

        var response = DbMessageTools.ListByTurns(parameters);
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        var result = document.RootElement.GetProperty("result");

        var messages = new List<MessageRow>();
        foreach (var item in result.GetProperty("messages").EnumerateArray())
        {
            messages.Add(new MessageRow
            {
                Id = item.GetProperty("id").GetString() ?? string.Empty,
                SessionId = item.GetProperty("sessionId").GetString() ?? string.Empty,
                Role = item.GetProperty("role").GetString() ?? string.Empty,
                Content = item.GetProperty("content").GetString() ?? string.Empty,
                Meta = item.TryGetProperty("meta", out var meta) && meta.ValueKind == JsonValueKind.String
                    ? meta.GetString()
                    : null
            });
        }

        return new ListResult(
            result.GetProperty("success").GetBoolean(),
            messages,
            result.TryGetProperty("error", out var err) && err.ValueKind == JsonValueKind.String
                ? err.GetString()
                : null);
    }

    private static JsonElement ParseResult(WorkerResponse response)
    {
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        return document.RootElement.GetProperty("result").Clone();
    }

    /// <summary>
    /// 结构化深度比较 —— 属性顺序无关、数值按原文本比。
    /// 库里 payload 是原始 raw text，读回时会经 JsonDocument 重新序列化（空白被规范化），
    /// 所以不能拿 <c>GetRawText()</c> 直接比，必须逐层走。
    /// </summary>
    private static bool JsonDeepEquals(JsonElement expected, JsonElement actual)
    {
        if (expected.ValueKind != actual.ValueKind) return false;

        switch (expected.ValueKind)
        {
            case JsonValueKind.Object:
                var expectedProps = expected.EnumerateObject().ToList();
                var actualProps = actual.EnumerateObject().ToList();
                if (expectedProps.Count != actualProps.Count) return false;
                foreach (var prop in expectedProps)
                {
                    if (!actual.TryGetProperty(prop.Name, out var actualValue)) return false;
                    if (!JsonDeepEquals(prop.Value, actualValue)) return false;
                }
                return true;

            case JsonValueKind.Array:
                var expectedItems = expected.EnumerateArray().ToList();
                var actualItems = actual.EnumerateArray().ToList();
                if (expectedItems.Count != actualItems.Count) return false;
                for (var i = 0; i < expectedItems.Count; i++)
                {
                    if (!JsonDeepEquals(expectedItems[i], actualItems[i])) return false;
                }
                return true;

            default:
                return expected.GetRawText() == actual.GetRawText();
        }
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException($"assertion failed: {message}");
        _passed += 1;
    }

    private static void AssertEqual<T>(T expected, T actual, string message)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException(
                $"assertion failed: {message} (expected {expected}, actual {actual})");
        }

        _passed += 1;
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
        }
        catch
        {
            // best effort
        }
    }
}

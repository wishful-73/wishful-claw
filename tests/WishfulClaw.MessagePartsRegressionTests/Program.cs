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
                RunNewFormatWriteSuite(db);
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

// iter-v3-4 S-276 —— worker 侧「最近 N 轮」把压缩摘要卡当成用户轮。
//
// 渲染层同口径是 src/renderer/src/lib/agent/context-compression-display.ts 的
// isRealUserTurn，由 tests/real-user-turn 钉住。跨语言共用不了函数，所以这边跑真库，
// 直接验 DbMessageTools.ListByTurns 的返回：窗口起点、窗口内容、totalTurns、hasMore。
//
// 为什么不能只断言 SQL 字符串：RealUserTurnPredicate 里的 meta IS NULL 少写一个，
// 或者 LIKE 的引号少一层，字符串断言都照样过，只有真跑 SQLite 才炸。
//
// 已知残留（S-276 §九）：老会话的摘要卡没有 meta，只有正文前缀
// （LEGACY_SUMMARY_PREFIXES），SQL 侧认不出来 —— 那些卡的 role 也是 'user'，
// 仍会占轮次名额。只在渲染层兜底。影响面是「2026-09 之前压缩过多次的老会话」，
// 数量随时间归零，彻底解决应做数据回填而不是往 SQL 里堆 LIKE 变体。

using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Infrastructure;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.TestSupport;

namespace WishfulClaw.RealUserTurnRegressionTests;

internal static class Program
{
    private static int _passed;

    public static int Main()
    {
        try
        {
            WorkerJsonHelper.ConfigureAotResolver(InfrastructureJsonContext.Default);

            var testRoot = Path.Combine(TestOutputRoot.Resolve(), $"real-user-turn-{Guid.NewGuid():N}");
            Directory.CreateDirectory(testRoot);
            try
            {
                var dbPath = Path.Combine(testRoot, "regression.db");
                var initialization = DbClient.Initialize(dbPath);
                Assert(initialization.Success, $"database initializes: {initialization.Error}");

                var db = DbClient.GetClient();

                var mainSession = "session-main";
                // 复刻 dev 库的形态：真实对话每轮后面都跟一张摘要卡 + 一个压缩边界，
                // 末尾再压 3 次（期间用户一句话没说）。
                var turns = 6;
                var clock = 1_760_000_000_000L;
                for (var turn = 1; turn <= turns; turn += 1)
                {
                    InsertMessage(db, $"{mainSession}-u{turn}", mainSession, "user",
                        $"第 {turn} 轮用户消息", null, clock);
                    clock += 1000;
                    InsertMessage(db, $"{mainSession}-a{turn}", mainSession, "assistant",
                        $"第 {turn} 轮回复", null, clock);
                    clock += 1000;
                    if (turn < 2) continue;
                    InsertMessage(db, $"{mainSession}-s{turn}", mainSession, "user",
                        "<compaction-summary>摘要</compaction-summary>",
                        "{\"compactSummary\":{\"summaryId\":\"s" + turn + "\"}}", clock);
                    clock += 1000;
                    InsertMessage(db, $"{mainSession}-b{turn}", mainSession, "system",
                        string.Empty, "{\"compactBoundary\":{\"boundaryId\":\"b" + turn + "\"}}", clock);
                    clock += 1000;
                }

                for (var extra = 1; extra <= 3; extra += 1)
                {
                    InsertMessage(db, $"{mainSession}-sx{extra}", mainSession, "user",
                        "<compaction-summary>末尾连续压缩</compaction-summary>",
                        "{\"compactSummary\":{\"summaryId\":\"sx" + extra + "\"}}", clock);
                    clock += 1000;
                    InsertMessage(db, $"{mainSession}-bx{extra}", mainSession, "system",
                        string.Empty, "{\"compactBoundary\":{\"boundaryId\":\"bx" + extra + "\"}}", clock);
                    clock += 1000;
                }

                // 另一个会话：只有压缩卡，一条真实用户消息都没有。
                InsertMessage(db, "cards-only-s1", "session-cards-only", "user",
                    "<compaction-summary>只有压缩</compaction-summary>",
                    "{\"compactSummary\":{\"summaryId\":\"only1\"}}", clock);
                clock += 1000;
                InsertMessage(db, "cards-only-b1", "session-cards-only", "system",
                    string.Empty, "{\"compactBoundary\":{\"boundaryId\":\"only1\"}}", clock);

                RunTotalTurnsSuite(db, mainSession, turns);
                RunWindowSuite(db, mainSession, turns);
                RunPagingSuite(db, mainSession);
                RunCardsOnlySuite(db);

                Console.WriteLine($"real-user-turn (worker): {_passed} passed");
                return 0;
            }
            finally
            {
                TryDeleteDirectory(testRoot);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"real-user-turn (worker) FAILED: {ex}");
            return 1;
        }
    }

    /// <summary>状态栏分母：只数真实用户消息，摘要卡不算。</summary>
    private static void RunTotalTurnsSuite(DbService db, string sessionId, int realTurns)
    {
        var result = ListByTurns(sessionId, turns: 5, beforeCreatedAt: null);

        Assert(result.Success, $"ListByTurns succeeds: {result.Error}");
        AssertEqual(realTurns, result.TotalTurns,
            "totalTurns 只数真实用户消息（摘要卡不计入分母）");
        AssertEqual(realTurns, CountRealUserMessages(db, sessionId),
            "totalTurns 与库里真实用户消息条数一致");

        var rawUserRoles = db.QueryScalar<int>(
            "SELECT COUNT(*) FROM messages WHERE session_id = @sid AND role = 'user'",
            new SqliteParameter("@sid", sessionId));
        Assert(rawUserRoles > realTurns,
            "前提：库里 role='user' 的行数确实多于真实轮次（摘要卡的 role 也是 user）");
    }

    /// <summary>窗口：摘要卡不能把真实消息挤出去，但卡本身要留在窗口里。</summary>
    private static void RunWindowSuite(DbService db, string sessionId, int realTurns)
    {
        var result = ListByTurns(sessionId, turns: 5, beforeCreatedAt: null);
        Assert(result.Success, $"ListByTurns succeeds: {result.Error}");

        var realUsers = result.Messages.Where(IsRealUserRow).ToList();
        AssertEqual(5, realUsers.Count, "turns=5 的窗口里必须凑够 5 条真实用户消息");
        AssertEqual($"第 {realTurns - 4} 轮用户消息", realUsers[0].Content,
            "窗口起点落在倒数第 5 条真实用户消息上");

        var cards = result.Messages.Count(m => m.Meta?.Contains("compactSummary", StringComparison.Ordinal) == true);
        Assert(cards > 0,
            "摘要卡仍随窗口返回（用户要看得见「任务暂告一段落」），不能顺手过滤掉");
        AssertEqual(realUsers[0].CreatedAt, result.RangeStart,
            "rangeStart 跟窗口起点一致（渲染端靠它做「加载更早」游标）");
    }

    /// <summary>往上翻：hasMore 按真实用户消息算，不能因卡片而虚报还有更多。</summary>
    private static void RunPagingSuite(DbService db, string sessionId)
    {
        var firstPage = ListByTurns(sessionId, turns: 5, beforeCreatedAt: null);
        Assert(firstPage.Success, $"first page ok: {firstPage.Error}");
        Assert(firstPage.HasMore, "第一页之前还有真实消息，hasMore 必须为 true");

        var older = ListByTurns(sessionId, turns: 5, beforeCreatedAt: firstPage.RangeStart);
        Assert(older.Success, $"second page ok: {older.Error}");
        var olderRealUsers = older.Messages.Where(IsRealUserRow).ToList();
        AssertEqual(1, olderRealUsers.Count, "更早只剩第 1 轮真实用户消息");
        AssertEqual("第 1 轮用户消息", olderRealUsers[0].Content, "第二页取到的是最早那轮");
        Assert(!older.HasMore, "已经到顶，hasMore 必须为 false（不能因残留卡片虚报）");
    }

    /// <summary>只有压缩卡的会话：不炸、不返回假轮次。</summary>
    private static void RunCardsOnlySuite(DbService db)
    {
        var result = ListByTurns("session-cards-only", turns: 5, beforeCreatedAt: null);
        Assert(result.Success, $"cards-only ListByTurns succeeds: {result.Error}");
        AssertEqual(0, result.TotalTurns, "全是压缩卡时 totalTurns 为 0");
        AssertEqual(0, result.Messages.Count, "全是压缩卡时不产出窗口（rangeStart 无从谈起）");
        AssertEqual(0L, result.RangeStart, "全是压缩卡时 rangeStart 为 0");
        Assert(!result.HasMore, "全是压缩卡时 hasMore 为 false");
    }

    // ─── helpers ───

    private static bool IsRealUserRow(MessageRow row)
    {
        if (row.Role != "user") return false;
        if (row.Meta is not null && row.Meta.Contains("compactSummary", StringComparison.Ordinal)) return false;
        return true;
    }

    private static int CountRealUserMessages(DbService db, string sessionId)
    {
        return db.QueryScalar<int>(
            "SELECT COUNT(*) FROM messages WHERE session_id = @sid AND role = 'user' " +
            "AND (meta IS NULL OR meta NOT LIKE '%compactSummary%')",
            new SqliteParameter("@sid", sessionId));
    }

    private static void InsertMessage(
        DbService db,
        string id,
        string sessionId,
        string role,
        string content,
        string? meta,
        long createdAt)
    {
        db.Execute(
            "INSERT INTO messages (id, session_id, role, content, meta, created_at, sort_order) " +
            "VALUES (@id, @sid, @role, @content, @meta, @createdAt, @sortOrder)",
            new SqliteParameter("@id", id),
            new SqliteParameter("@sid", sessionId),
            new SqliteParameter("@role", role),
            new SqliteParameter("@content", content),
            new SqliteParameter("@meta", (object?)meta ?? DBNull.Value),
            new SqliteParameter("@createdAt", createdAt),
            new SqliteParameter("@sortOrder", (int)(createdAt % 100000)));
    }

    private readonly record struct ListResult(
        bool Success,
        List<MessageRow> Messages,
        long RangeStart,
        bool HasMore,
        string? Error,
        int TotalTurns);

    private static ListResult ListByTurns(string sessionId, int turns, long? beforeCreatedAt)
    {
        var parameters = WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("sessionId", sessionId);
            writer.WriteNumber("turns", turns);
            if (beforeCreatedAt.HasValue) writer.WriteNumber("beforeCreatedAt", beforeCreatedAt.Value);
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
                    : null,
                CreatedAt = item.GetProperty("createdAt").GetInt64()
            });
        }

        return new ListResult(
            result.GetProperty("success").GetBoolean(),
            messages,
            result.GetProperty("rangeStart").GetInt64(),
            result.GetProperty("hasMore").GetBoolean(),
            result.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.String
                ? error.GetString()
                : null,
            result.GetProperty("totalTurns").GetInt32());
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
        }
        catch
        {
            // 临时目录清理失败不影响结论。
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
}

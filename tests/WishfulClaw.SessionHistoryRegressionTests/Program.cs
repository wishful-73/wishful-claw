// iter-v3-6 S-301 —— agent 回看「当前会话里用户说过的话」。
//
// 跑真库，直接验 DbMessageTools.ListUserMessages 与 AgentRuntimeSessionHistoryExecutor 两条路：
// 时区切日、只回 user 侧、压缩卡不进结果、附件摘要、limit/truncated、日期格式校验，
// 以及「sessionId 由服务端注入、模型传了也不算」这条唯一的安全边界。
//
// 为什么不能只断言 SQL 字符串：切日边界是本地时区换算出来的两个毫秒值，
// 换算写错方向（DateOnly → Kind=Unspecified → 按本地解释两次）在字符串上看不出来，
// 只有真跑一遍、拿北京时间早上 7 点那条去撞，才会红。

using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Agent.Executors;
using WishfulClaw.Agent;
using WishfulClaw.Contracts;
using WishfulClaw.Infrastructure;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.TestSupport;

namespace WishfulClaw.SessionHistoryRegressionTests;

internal static class Program
{
    private static int _passed;

    public static int Main()
    {
        try
        {
            WorkerJsonHelper.ConfigureAotResolver(InfrastructureJsonContext.Default);

            var testRoot = Path.Combine(TestOutputRoot.Resolve(), $"session-history-{Guid.NewGuid():N}");
            Directory.CreateDirectory(testRoot);
            try
            {
                var dbPath = Path.Combine(testRoot, "regression.db");
                var initialization = DbClient.Initialize(dbPath);
                Assert(initialization.Success, $"database initializes: {initialization.Error}");

                var db = DbClient.GetClient();

                const string sessionId = "session-main";
                const string otherSessionId = "session-other";

                var today = DateTime.Today;
                var localMorning = AtLocal(today, 7, 30);
                var localEvening = AtLocal(today, 21, 5);
                var yesterdayNoon = AtLocal(today.AddDays(-1), 12, 0);

                // 昨天中午 + 今天早/晚各一条，外加一张压缩摘要卡（role 也是 user）。
                InsertMessage(db, "u-yesterday", sessionId, "user", "昨天中午说的话", null, yesterdayNoon);
                InsertMessage(db, "a-yesterday", sessionId, "assistant", "昨天的回复", null, yesterdayNoon + 1000);
                InsertMessage(db, "u-morning", sessionId, "user", "今天早上七点半说的话", null, localMorning);
                InsertMessage(db, "u-evening", sessionId, "user", "今天晚上说的话", null, localEvening);
                InsertMessage(db, "s-card", sessionId, "user",
                    "<compaction-summary>压缩摘要</compaction-summary>",
                    "{\"compactSummary\":{\"summaryId\":\"s1\"}}", localEvening + 1000);

                // 带附件的两条：图片（meta.content 块数组）+ 折叠粘贴块（正文标签）。
                InsertMessage(db, "u-image", sessionId, "user", "你看下这张图",
                    "{\"content\":[{\"type\":\"text\",\"text\":\"你看下这张图\"}," +
                    "{\"type\":\"image\",\"source\":{\"type\":\"base64\",\"data\":\"AAAA\"}}]}",
                    localEvening + 2000);
                InsertMessage(db, "u-paste", sessionId, "user",
                    "参考一下这段<pasted-block>" +
                    "{\"label\":\"粘贴 · 3 行\",\"text\":\"line-a\\nline-b\\nline-c\"}" +
                    "</pasted-block>谢谢",
                    null, localEvening + 3000);

                // 另一个会话：executor 边界测试要证明读不到它。
                InsertMessage(db, "u-other", otherSessionId, "user", "另一个会话的私货", null, localEvening + 4000);

                RunNoDateSuite(sessionId);
                RunDateSuite(sessionId, today);
                RunAttachmentSuite(sessionId, localEvening);
                RunLimitSuite(sessionId, today);
                RunBadDateSuite(sessionId);
                RunExecutorBoundarySuite(sessionId);

                Console.WriteLine($"session-history (worker): {_passed} passed");
                return 0;
            }
            finally
            {
                TryDeleteDirectory(testRoot);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"session-history (worker) FAILED: {ex}");
            return 1;
        }
    }

    /// <summary>不传 date ⇒ 最近 limit 条，正序返回，且只有 user 侧。</summary>
    private static void RunNoDateSuite(string sessionId)
    {
        var result = ListUserMessages(sessionId, date: null, limit: 50);
        Assert(result.Success, $"list without date succeeds: {result.Error}");

        Assert(result.Messages.All(m => !m.Text.Contains("昨天的回复", StringComparison.Ordinal)),
            "只返回 user 侧：assistant 正文不进结果");
        Assert(result.Messages.All(m => !m.Text.Contains("<compaction-summary>", StringComparison.Ordinal)),
            "压缩摘要卡不进结果（复用 RealUserTurnPredicate）");

        var texts = result.Messages.Select(m => m.Text).ToList();
        AssertEqual(5, texts.Count, "会话里 5 条真实用户消息（4 条普通 + 1 条粘贴）");
        AssertEqual("昨天中午说的话", texts[0], "不传 date 时按时间正序返回，最早的在最前");
        Assert(texts[texts.Count - 1].StartsWith("参考一下这段", StringComparison.Ordinal),
            "最后一条是最近的粘贴消息");
        AssertEqual(5, result.TotalOnDate, "不传 date 时 totalOnDate 是全会话真实用户消息总数");
        Assert(!result.Truncated, "5 条没到 limit，truncated 必须为 false");
    }

    /// <summary>时区：北京时间早上 7:30 的话必须落在「今天」，不能落到昨天（UTC 切日就会）。</summary>
    private static void RunDateSuite(string sessionId, DateTime today)
    {
        var todayKey = today.ToString("yyyy-MM-dd");
        var todayResult = ListUserMessages(sessionId, todayKey, limit: 50);
        Assert(todayResult.Success, $"list by today succeeds: {todayResult.Error}");

        var todayTexts = todayResult.Messages.Select(m => m.Text).ToList();
        Assert(todayTexts.Contains("今天早上七点半说的话"),
            "本地时区切日：早上 7:30 的发言必须能按「今天」查到");
        Assert(!todayTexts.Contains("昨天中午说的话"), "昨天的发言不能混进今天");
        AssertEqual(4, todayResult.Messages.Count, "今天共 4 条真实用户消息（早、晚、图片、粘贴）");

        var yesterdayKey = today.AddDays(-1).ToString("yyyy-MM-dd");
        var yesterdayResult = ListUserMessages(sessionId, yesterdayKey, limit: 50);
        Assert(yesterdayResult.Success, $"list by yesterday succeeds: {yesterdayResult.Error}");
        AssertEqual(1, yesterdayResult.Messages.Count, "昨天只有 1 条真实用户消息");
        AssertEqual("昨天中午说的话", yesterdayResult.Messages[0].Text, "昨天查到的是昨天那条");

        // 反向：本地偏移为正（东半球）时，早上 7:30 在 UTC 上属于前一天。
        // 若实现按 UTC 切日，上面「今天能查到」就已经红了；这条再钉一次「昨天查不到」，
        // 防止有人把两边边界都放宽成「±1 天」来糊过去。
        var offset = TimeZoneInfo.Local.GetUtcOffset(today);
        if (offset > TimeSpan.Zero && offset < TimeSpan.FromHours(7.5))
        {
            Assert(!yesterdayResult.Messages.Any(m => m.Text.Contains("今天早上七点半", StringComparison.Ordinal)),
                "按 UTC 切日会把早 7:30 算到前一天 —— 这里必须查不到");
        }
    }

    /// <summary>附件摘要：图片数 + 粘贴字数，粘贴块正文要展开成占位。</summary>
    private static void RunAttachmentSuite(string sessionId, long localEvening)
    {
        var result = ListUserMessages(sessionId, date: null, limit: 50);
        Assert(result.Success, $"list for attachments succeeds: {result.Error}");

        var image = result.Messages.Single(m => m.CreatedAt == localEvening + 2000);
        AssertEqual("图片 ×1", image.AttachmentSummary, "图片消息的 attachmentSummary 是「图片 ×1」");
        AssertEqual("你看下这张图", image.Text, "图片消息的正文原样返回");

        var paste = result.Messages.Single(m => m.CreatedAt == localEvening + 3000);
        AssertEqual("粘贴 20 字", paste.AttachmentSummary, "粘贴块字数按 payload.text 计（line-a\\nline-b\\nline-c = 20）");
        Assert(!paste.Text.Contains("<pasted-block>", StringComparison.Ordinal),
            "粘贴块标签不能原样喂给模型（那是渲染层 chip 形态）");
        Assert(paste.Text.Contains("[粘贴 · 20 字]", StringComparison.Ordinal),
            "粘贴块展开成「[粘贴 · N 字]」占位");
        Assert(paste.Text.StartsWith("参考一下这段", StringComparison.Ordinal) &&
               paste.Text.EndsWith("谢谢", StringComparison.Ordinal),
            "占位前后的正文保留");

        var plain = result.Messages.Single(m => m.Text == "昨天中午说的话");
        Assert(plain.AttachmentSummary is null, "无附件的消息 attachmentSummary 为 null");
    }

    /// <summary>limit 撞上限：truncated 与 totalOnDate 都要如实。</summary>
    private static void RunLimitSuite(string sessionId, DateTime today)
    {
        var todayKey = today.ToString("yyyy-MM-dd");
        var limited = ListUserMessages(sessionId, todayKey, limit: 2);
        Assert(limited.Success, $"limited list succeeds: {limited.Error}");
        AssertEqual(2, limited.Messages.Count, "limit=2 只回 2 条");
        Assert(limited.Truncated, "撞到 limit 时 truncated 必须为 true");
        AssertEqual(4, limited.TotalOnDate, "truncated 时 totalOnDate 仍是该日真实总数");

        var recent = ListUserMessages(sessionId, date: null, limit: 2);
        AssertEqual(2, recent.Messages.Count, "不传 date + limit=2 也只回 2 条");
        Assert(recent.Truncated, "不传 date 撞 limit 时 truncated 同样为 true");
        AssertEqual(5, recent.TotalOnDate, "不传 date 时 totalOnDate 是全会话总数");
    }

    /// <summary>日期格式错误必须报错，不能静默当成今天。</summary>
    private static void RunBadDateSuite(string sessionId)
    {
        foreach (var bad in new[] { "2026/11/02", "11-02", "2026-13-01", "" })
        {
            if (bad.Length == 0) continue; // 空串等价于「不传」，走 NoDate 那条
            var result = ListUserMessages(sessionId, bad, limit: 50);
            Assert(!result.Success, $"日期格式 \"{bad}\" 必须被拒绝");
            Assert(result.Error is not null && result.Error.Contains("YYYY-MM-DD", StringComparison.Ordinal),
                $"错误信息要告诉模型正确格式（got \"{bad}\"）");
        }
    }

    /// <summary>
    /// 唯一的安全边界：sessionId 从 run 参数注入，模型在工具入参里传什么都不算。
    /// 这条是反向验证 —— 若哪天有人把 <c>parameters.sessionId</c> 改成读 <c>input.sessionId</c>，
    /// 这里就会拿到别的会话的私货，判据变红。
    /// </summary>
    private static void RunExecutorBoundarySuite(string sessionId)
    {
        var parameters = WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("sessionId", sessionId);
            w.WriteEndObject();
        });

        var input = WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("sessionId", "session-other");
            w.WriteNumber("limit", 50);
            w.WriteEndObject();
        });

        var json = AgentRuntimeSessionHistoryExecutor.Execute(input, parameters);
        Assert(!json.Contains("另一个会话的私货", StringComparison.Ordinal),
            "模型传 sessionId 无效：读不到别的会话的用户消息");
        Assert(json.Contains("昨天中午说的话", StringComparison.Ordinal),
            "读的仍然是 run 参数里那个会话");

        // 空 sessionId（__default__ 无历史）要明确报错，而不是回空列表骗模型。
        var emptyParameters = WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("sessionId", "");
            w.WriteEndObject();
        });
        var emptyJson = AgentRuntimeSessionHistoryExecutor.Execute(input, emptyParameters);
        Assert(emptyJson.Contains("\"error\":true", StringComparison.Ordinal),
            "无会话的 run 要回错误，不能回空列表");
    }

    // ─── helpers ───

    private readonly record struct ListUserResult(
        bool Success,
        List<MessageUserRow> Messages,
        bool Truncated,
        int TotalOnDate,
        string? Error);

    private static ListUserResult ListUserMessages(string sessionId, string? date, int limit)
    {
        var parameters = WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("sessionId", sessionId);
            if (date is not null) writer.WriteString("date", date);
            writer.WriteNumber("limit", limit);
            writer.WriteEndObject();
        });

        var response = DbMessageTools.ListUserMessages(parameters);
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        var result = document.RootElement.GetProperty("result");

        var messages = new List<MessageUserRow>();
        foreach (var item in result.GetProperty("messages").EnumerateArray())
        {
            messages.Add(new MessageUserRow(
                item.GetProperty("createdAt").GetInt64(),
                item.GetProperty("text").GetString() ?? string.Empty,
                item.TryGetProperty("attachmentSummary", out var summary) &&
                summary.ValueKind == JsonValueKind.String
                    ? summary.GetString()
                    : null));
        }

        return new ListUserResult(
            result.GetProperty("success").GetBoolean(),
            messages,
            result.GetProperty("truncated").GetBoolean(),
            result.GetProperty("totalOnDate").GetInt32(),
            result.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.String
                ? error.GetString()
                : null);
    }

    /// <summary>某一天的本机本地时刻，换回 unix 毫秒。</summary>
    private static long AtLocal(DateTime day, int hour, int minute)
    {
        var local = DateTime.SpecifyKind(day.Date.AddHours(hour).AddMinutes(minute), DateTimeKind.Local);
        return new DateTimeOffset(local).ToUnixTimeMilliseconds();
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

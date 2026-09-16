using WishfulClaw.Agent;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.GoalRegressionTests;

internal static partial class Program
{
    /// <summary>
    /// S-44：会话 todo 现状的每轮注入。
    /// 契约：只渲染未完成项、completed 只计数、全部收尾后不再注入、只给事实不给嘱咐。
    /// </summary>
    private static void RunSessionTodoInjectionSuite()
    {
        static TaskRow Row(string id, string subject, string status) => new()
        {
            Id = id,
            Subject = subject,
            Status = status
        };

        // ── 不需要注入的四种情形 ──
        Assert(AgentLoop.BuildSessionTodoBlock(null) is null, "no task list → no injection");
        Assert(AgentLoop.BuildSessionTodoBlock([]) is null, "empty task list → no injection");
        Assert(AgentLoop.BuildSessionTodoBlock([Row("1", "a", "completed")]) is null,
            "all completed → no injection");
        Assert(AgentLoop.BuildSessionTodoBlock([Row("1", "a", "deleted")]) is null,
            "all deleted → no injection");

        // ── 基本渲染 ──
        AssertEqual(
            "<todo_status>\n0/1 completed. Remaining:\n- [pending] 审核 spill 实现\n</todo_status>",
            AgentLoop.BuildSessionTodoBlock([Row("1", "审核 spill 实现", "pending")]),
            "single pending task renders in full");

        // ── 混合状态：completed 只计数，未完成的才逐条列出 ──
        var mixed = AgentLoop.BuildSessionTodoBlock([
            Row("1", "已完成项", "completed"),
            Row("2", "当前项", "in_progress"),
            Row("3", "后续项", "pending"),
            Row("4", "另一完成项", "completed")
        ])!;
        Assert(mixed.Contains("2/4 completed", StringComparison.Ordinal), "completed counted over total");
        Assert(mixed.Contains("- [in_progress] 当前项", StringComparison.Ordinal), "in_progress item listed");
        Assert(mixed.Contains("- [pending] 后续项", StringComparison.Ordinal), "pending item listed");
        Assert(!mixed.Contains("- [completed]", StringComparison.Ordinal), "completed items not listed");

        // ── 超过上限折叠 ──
        var many = Enumerable.Range(0, 9)
            .Select(i => Row(i.ToString(), $"任务{i}", "pending"))
            .ToList();
        var folded = AgentLoop.BuildSessionTodoBlock(many)!;
        AssertEqual(8, folded.Split('\n').Count(line => line.StartsWith("- [", StringComparison.Ordinal)),
            "rendered items capped at MaxTodoItemsInjected");
        Assert(folded.Contains("... +1 more", StringComparison.Ordinal), "overflow gets a fold marker");

        // ── 超长标题截断 ──
        var longTitle = new string('x', 200);
        var truncated = AgentLoop.BuildSessionTodoBlock([Row("1", longTitle, "pending")])!;
        Assert(truncated.Contains(new string('x', 80) + "…", StringComparison.Ordinal),
            "overlong subject truncated with ellipsis");
        Assert(!truncated.Contains(longTitle, StringComparison.Ordinal), "untruncated subject absent");

        // ── 只给事实：不得混入「记得更新」这类嘱咐 ──
        // 注入每一轮都要付 token；给状态是数据，给指令是开销，而且 agent 会自己核对不一致。
        foreach (var forbidden in new[] { "remember", "make sure", "don't forget", "you must" })
        {
            Assert(!mixed.Contains(forbidden, StringComparison.OrdinalIgnoreCase),
                $"injection stays factual — no instruction phrasing ('{forbidden}')");
        }

        Console.WriteLine("  session todo injection (S-44): 17 assertions passed");
    }
}

using WishfulClaw.Agent;

namespace WishfulClaw.GoalRegressionTests;

internal static partial class Program
{
    /// <summary>
    /// S-53：子代理轮次提醒 + 轮次配置的键名解析。
    /// 契约：提醒点之前不注入、到点后如实报轮次、只给事实不给嘱咐、换行一律 '\n'；
    /// 以及 maxTurns / maxIterations 两个键都认，未配置时默认「不限」。
    /// </summary>
    private static void RunSubAgentReminderSuite()
    {
        // ── 提醒点之前不注入：实测正常的子代理 3~5 轮就收工，够不到这里 ──
        Assert(AgentLoop.BuildSubAgentTurnReminderBlock(1) is null, "turn 1 → no reminder");
        Assert(AgentLoop.BuildSubAgentTurnReminderBlock(AgentLoop.SubAgentTurnReminderAfter - 1) is null,
            "just below the reminder point → no reminder");

        // ── 到点即注入 ──
        var block = AgentLoop.BuildSubAgentTurnReminderBlock(AgentLoop.SubAgentTurnReminderAfter)!;
        Assert(block.StartsWith("<sub_agent_status>\n", StringComparison.Ordinal), "block opens with the tag");
        Assert(block.EndsWith("</sub_agent_status>", StringComparison.Ordinal), "block closes with the tag");
        Assert(block.Contains($"Turn {AgentLoop.SubAgentTurnReminderAfter}.", StringComparison.Ordinal),
            "reminder states the current turn");

        // ── 两句事实各自对应一个实测失败，各测一条 ──
        Assert(block.Contains("No turn limit is enforced on this run", StringComparison.Ordinal),
            "reminder states there is no turn limit");
        Assert(block.Contains("Only the text you emit is delivered back to the caller", StringComparison.Ordinal),
            "reminder states that only emitted text reaches the caller");

        // ── 只给事实：不得混入「记得收尾」这类嘱咐 ──
        // 注入每一轮都要付 token；给事实是数据，给指令是开销。
        foreach (var forbidden in new[] { "remember", "make sure", "don't forget", "you must" })
        {
            Assert(!block.Contains(forbidden, StringComparison.OrdinalIgnoreCase),
                $"reminder stays factual — no instruction phrasing ('{forbidden}')");
        }

        // ── 换行一律 '\n'：AppendLine 在 Windows 上会产出 '\r\n' ──
        Assert(!block.Contains('\r'), "reminder uses \\n only");

        // ── 更晚的轮次仍注入，且报的是真实轮次 ──
        var later = AgentLoop.BuildSubAgentTurnReminderBlock(AgentLoop.SubAgentTurnReminderAfter + 5)!;
        Assert(later.Contains($"Turn {AgentLoop.SubAgentTurnReminderAfter + 5}.", StringComparison.Ordinal),
            "later turns keep reporting the real turn number");

        // ── 轮次配置的键名解析 ──
        // 内置的 16 份 agent 定义里有 15 份写的是 maxIterations，而解析器一直只读 maxTurns，
        // 那些配置被静默忽略、全部回落默认值 —— 这才是 12 轮天花板真正的来源。
        static SubAgentDefinition? Parse(string frontmatter) =>
            SubAgentDefinitionLoader.ParseAgentFile($"---\n{frontmatter}\n---\n\nbody\n", "t.md");

        AssertEqual(10, Parse("name: a\ndescription: b\nmaxTurns: 10")!.MaxTurns, "maxTurns is read");
        AssertEqual(7, Parse("name: a\ndescription: b\nmaxIterations: 7")!.MaxTurns,
            "maxIterations alias is read");
        AssertEqual(0, Parse("name: a\ndescription: b\nmaxIterations: 0")!.MaxTurns,
            "maxIterations: 0 means unlimited, not 'fall back to default'");
        AssertEqual(0, Parse("name: a\ndescription: b")!.MaxTurns, "unset → unlimited by default");

        Console.WriteLine("  sub-agent turn reminder + maxTurns parsing (S-53): 17 assertions passed");
    }
}

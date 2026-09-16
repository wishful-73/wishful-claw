using System.Text.Json;
using WishfulClaw.Agent;

namespace WishfulClaw.GoalRegressionTests;

internal static partial class Program
{
    /// <summary>
    /// S-36：子 agent 最终报告落库时对 data JSON 的合并，只能覆盖自己那两个键。
    /// 同一份 data 渲染端也在写（transcript / report / reportStatus …），少保留一个字段
    /// 都会让界面上的子 agent 卡片丢状态。
    /// </summary>
    private static void RunSubAgentReportStoreSuite()
    {
        const long completedAt = 1_760_000_000_000L;

        // 库里还没有这条记录：只写自己的两个键，产物必须是合法 JSON 对象。
        var fresh = SubAgentReportStore.MergeFinalOutput(null, "final report body", completedAt);
        using (var doc = JsonDocument.Parse(fresh))
        {
            AssertEqual(JsonValueKind.Object, doc.RootElement.ValueKind,
                "merged data is a JSON object");
            AssertEqual("final report body", doc.RootElement.GetProperty("finalOutput").GetString(),
                "finalOutput is written");
            AssertEqual(completedAt, doc.RootElement.GetProperty("finalReportAt").GetInt64(),
                "finalReportAt is written");
        }

        // 渲染端已经 upsert 过：它维护的字段必须原样保留。
        const string existing =
            "{\"toolUseId\":\"call_1\",\"report\":\"I'll start\",\"reportStatus\":\"submitted\",\"isRunning\":true}";
        var merged = SubAgentReportStore.MergeFinalOutput(existing, "the real report", completedAt);
        using (var doc = JsonDocument.Parse(merged))
        {
            var root = doc.RootElement;
            AssertEqual("call_1", root.GetProperty("toolUseId").GetString(),
                "existing toolUseId survives the merge");
            AssertEqual("I'll start", root.GetProperty("report").GetString(),
                "existing streaming report survives the merge");
            AssertEqual("submitted", root.GetProperty("reportStatus").GetString(),
                "existing reportStatus survives the merge");
            Assert(root.GetProperty("isRunning").GetBoolean(), "existing isRunning survives the merge");
            AssertEqual("the real report", root.GetProperty("finalOutput").GetString(),
                "finalOutput is added alongside the renderer fields");
        }

        // 重复落库：值归新的，键不重复。
        var twice = SubAgentReportStore.MergeFinalOutput(merged, "second pass", completedAt + 1);
        using (var doc = JsonDocument.Parse(twice))
        {
            AssertEqual("second pass", doc.RootElement.GetProperty("finalOutput").GetString(),
                "a second write updates finalOutput");
            AssertEqual(completedAt + 1, doc.RootElement.GetProperty("finalReportAt").GetInt64(),
                "a second write updates finalReportAt");
            var keyCount = 0;
            foreach (var _ in doc.RootElement.EnumerateObject()) keyCount++;
            AssertEqual(6, keyCount, "a rewrite does not duplicate keys");
        }

        // 旧值被改坏：不抛异常，仍然产出合法对象。
        var recovered = SubAgentReportStore.MergeFinalOutput("not json at all", "body", completedAt);
        using (var doc = JsonDocument.Parse(recovered))
        {
            AssertEqual("body", doc.RootElement.GetProperty("finalOutput").GetString(),
                "corrupt existing data still yields a valid object");
        }

        // 旧值是合法 JSON 但不是对象：同样只写自己的键，不试图展开它。
        var fromArray = SubAgentReportStore.MergeFinalOutput("[1,2,3]", "body", completedAt);
        using (var doc = JsonDocument.Parse(fromArray))
        {
            AssertEqual(JsonValueKind.Object, doc.RootElement.ValueKind,
                "a non-object existing value is replaced with an object");
            AssertEqual("body", doc.RootElement.GetProperty("finalOutput").GetString(),
                "finalOutput is written when the old value was an array");
        }

        Console.WriteLine("  [ok] S-36 sub-agent report store");
    }
}

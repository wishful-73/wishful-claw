using System.Text;
using WishfulClaw.Agent;
using WishfulClaw.Contracts;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.GoalRegressionTests;

internal static partial class Program
{
    /// <summary>
    /// S-26：工具输出超限时落盘（spill）——内联只留首尾预览 + 取回提示，落盘内容完整可读回，
    /// 且任何失败路径都不改变这次调用的成败。
    /// </summary>
    private static void RunSpillRegressionSuite()
    {
        var call = new AgentRuntimeNativeToolCall(
            "spill-1", "Bash", WorkerJsonHelper.BuildJsonElement(writer =>
            {
                writer.WriteStartObject();
                writer.WriteString("command", "cat big.log");
                writer.WriteEndObject();
            }));

        // 含多字节字符的超大输出，顺带压 UTF-8 边界。
        var bigOutput = new string('a', 8_000) + new string('中', 20_000) + new string('z', 8_000);
        Assert(Encoding.UTF8.GetByteCount(bigOutput) > 32 * 1024,
            "the spill fixture actually exceeds the inline limit");

        var smallOutput = new string('a', 100);
        AssertEqual(smallOutput,
            ToolCallProcessor.ApplyToolOutputLimit(call, smallOutput, "session-spill"),
            "output within the limit is returned unchanged");

        // 没有 sessionId（旧调用点 / 无会话上下文）时退回普通截断，不落盘。
        var withoutSession = ToolCallProcessor.ApplyToolOutputLimit(call, bigOutput);
        Assert(withoutSession.Contains("[truncated ", StringComparison.Ordinal)
               && !withoutSession.Contains("saved to", StringComparison.Ordinal),
            "without a session id the output falls back to plain truncation");

        // 有 sessionId 时落盘：内联带取回提示，不再出现截断提示。
        var spilled = ToolCallProcessor.ApplyToolOutputLimit(call, bigOutput, "session-spill");
        Assert(spilled.Contains("saved to ", StringComparison.Ordinal)
               && spilled.Contains("Read(file_path:", StringComparison.Ordinal),
            "oversized output is spilled and the inline result carries a retrieval hint");
        Assert(!spilled.Contains("[truncated ", StringComparison.Ordinal),
            "spilled output replaces the truncation notice with the spill notice");
        Assert(Encoding.UTF8.GetByteCount(spilled) <= 32 * 1024,
            "the replaced inline content never exceeds the 32KB tool output limit");
        Assert(spilled.StartsWith(new string('a', 64), StringComparison.Ordinal),
            "the head of the original output survives as a preview");
        Assert(spilled.EndsWith(new string('z', 64), StringComparison.Ordinal),
            "the tail of the original output survives as a preview");

        // 落盘内容完整，且路径落在会话私有的 spill 目录下。
        var locator = ExtractSpilledLocator(spilled);
        Assert(File.Exists(locator), "the spilled file exists on disk");
        AssertEqual(bigOutput, File.ReadAllText(locator),
            "the spilled file holds the complete, unmodified output");
        Assert(locator.StartsWith(WishfulClawDataDir.Resolve("spill"), StringComparison.Ordinal),
            "spilled files live under the data dir's spill folder");

        // Read 是取回工具：不落盘，避免 read → spill → read 死循环。
        var readCall = new AgentRuntimeNativeToolCall(
            "spill-read", "Read", WorkerJsonHelper.BuildJsonElement(writer =>
            {
                writer.WriteStartObject();
                writer.WriteString("file_path", locator);
                writer.WriteEndObject();
            }));
        var readOutput = ToolCallProcessor.ApplyToolOutputLimit(readCall, bigOutput, "session-spill");
        Assert(readOutput.Contains("[truncated ", StringComparison.Ordinal)
               && !readOutput.Contains("saved to", StringComparison.Ordinal),
            "retrieval tools are never spilled, so Read cannot re-spill its own output");
    }

    private static string ExtractSpilledLocator(string spillNotice)
    {
        const string marker = "saved to ";
        var start = spillNotice.IndexOf(marker, StringComparison.Ordinal) + marker.Length;
        var end = spillNotice.IndexOf(" — ", start, StringComparison.Ordinal);
        Assert(start >= marker.Length && end > start,
            "the spill notice exposes a locator between the expected markers");
        return spillNotice[start..end];
    }
}

/*
 * S-290 回归：带 filePath 的 image 块不许被截断。
 *
 * 缺陷形态（2026-10-30 dev 真机日志）：
 *   agent tool output truncated tool=use_capability originalBytes=712499 truncatedBytes=32768
 * 截图经 use_capability 代理调用，output 是一段字符串化 JSON（image 块 + 一行文本），
 * 700 KB 走 spill：内联只留 head 16 KB + tail 16 KB ⇒ 模型拿到的**不是 image 块，
 * 是一段砍断的 JSON 文本**，PNG 只剩 16 KB 解不出来，还得再 Read 一次盘上文件补看。
 *
 * 本套件钉两件事：①带路径的 image 块原样放行；②其余输出照旧被限流（别顺手放开了）。
 */

using System.Text;
using System.Text.Json;
using WishfulClaw.Agent;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.ToolOutputLimitRegressionTests;

internal static class Program
{
    private static int _checks;

    public static int Main()
    {
        try
        {
            RunImageBlockExemptionSuite();
            RunNonImageStillLimitedSuite();
            Console.WriteLine($"Tool output limit regression checks passed ({_checks} assertions).");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Tool output limit regression test failed: {ex}");
            return 1;
        }
    }

    /// <summary>
    /// 造一份和桌面截图同形的输出：字符串化 content 数组，image 块在最前、里面是 base64。
    /// 长度刻意超过 32 KB —— 不超限的话走不到任何限流分支，测不出东西。
    /// </summary>
    private static string ScreenshotOutput(string? filePath, int base64Length = 700_000)
    {
        var data = new string('A', base64Length);
        var imageBlock = filePath is null
            ? "{\"type\":\"image\",\"source\":{\"type\":\"base64\",\"mediaType\":\"image/png\",\"data\":\""
              + data + "\"}}"
            : "{\"type\":\"image\",\"source\":{\"type\":\"base64\",\"mediaType\":\"image/png\",\"data\":\""
              + data + "\",\"filePath\":" + JsonSerializer.Serialize(filePath) + "}}";
        var textBlock = "{\"type\":\"text\",\"text\":\"Captured desktop screenshot 2520x1680 (origin 0,0, scale 1.5)\"}";
        return "[" + imageBlock + "," + textBlock + "]";
    }

    private static AgentRuntimeNativeToolCall ToolCall(string name, string inputJson = "{}")
    {
        using var doc = JsonDocument.Parse(inputJson);
        return new AgentRuntimeNativeToolCall("call-1", name, doc.RootElement.Clone());
    }

    private static void RunImageBlockExemptionSuite()
    {
        var output = ScreenshotOutput("C:\\tmp\\shot.png");
        Assert(Encoding.UTF8.GetByteCount(output) > 32 * 1024, "样本必须真的超过 32 KB 才有意义");

        // 1. 核心：带 filePath 的 image 块原样放行，一个字节都不许动
        var result = ToolCallProcessor.ApplyToolOutputLimit(
            ToolCall("use_capability", "{\"action\":\"call\"}"), output, "session-1");
        Assert(
            result.Length == output.Length,
            $"带 filePath 的 image 块必须原样放行（原 {output.Length} 字符，实得 {result.Length}）");
        Assert(
            !result.Contains("[tool output too large", StringComparison.Ordinal),
            "不许出现 spill 提示 —— 放行的输出不该走落盘");
        Assert(
            !result.Contains("[truncated", StringComparison.Ordinal),
            "不许出现截断提示");
        Assert(
            result.Contains("\"filePath\":\"C:\\\\tmp\\\\shot.png\"", StringComparison.Ordinal),
            "filePath 必须还在（模型/渲染层都靠它回盘取图）");

        // 2. 无 sessionId（旧调用点）同样豁免 —— 判据排在 sessionId 分支之前
        var withoutSession = ToolCallProcessor.ApplyToolOutputLimit(
            ToolCall("use_capability", "{\"action\":\"call\"}"), output, null);
        Assert(withoutSession.Length == output.Length, "没有 sessionId 时也必须豁免");

        // 3. 直接调用（不走 use_capability 代理）也豁免 —— 判据看内容不看工具名
        var directCall = ToolCallProcessor.ApplyToolOutputLimit(
            ToolCall("DesktopScreenshot"), output, "session-1");
        Assert(directCall.Length == output.Length, "工具名不认识也必须按内容豁免");

        // 4. Read 也豁免 —— 它本来走内联截断，但带路径的 image 块同样不该被砍
        var readCall = ToolCallProcessor.ApplyToolOutputLimit(ToolCall("Read"), output, "session-1");
        Assert(readCall.Length == output.Length, "Read 返回的 image 块同样不该被砍");
    }

    private static void RunNonImageStillLimitedSuite()
    {
        // 5. `filePath` 为空串（S-284 剥掉 data 后的落库形态）**不豁免**：取不回任何东西
        var emptyPath = "[" + "{\"type\":\"image\",\"source\":{\"type\":\"base64\",\"data\":\""
            + new string('A', 700_000) + "\",\"filePath\":\"\"}}" + "]";
        var emptyPathResult = ToolCallProcessor.ApplyToolOutputLimit(
            ToolCall("use_capability", "{\"action\":\"call\"}"), emptyPath, "session-1");
        Assert(
            emptyPathResult.Length < emptyPath.Length,
            "filePath 为空串时不许豁免（那是个取不回来的路径）");

        // 6. 没有 filePath 的 image 块**不豁免**：放行它就是纯吃上下文
        var noPath = ScreenshotOutput(null);
        var noPathResult = ToolCallProcessor.ApplyToolOutputLimit(
            ToolCall("use_capability", "{\"action\":\"call\"}"), noPath, "session-1");
        Assert(
            noPathResult.Length < noPath.Length,
            "没有 filePath 的 image 块不许豁免");

        // 7. 纯文本大输出照旧被限流（反证：本条没有顺手把限流整体关掉）
        var bigText = new string('x', 200_000);
        var bigTextResult = ToolCallProcessor.ApplyToolOutputLimit(
            ToolCall("WebFetch"), bigText, "session-1");
        Assert(
            bigTextResult.Length < bigText.Length,
            "纯文本大输出必须照旧被限流/落盘");

        // 8. 小输出一根汗毛都不动
        var small = "short output";
        Assert(
            ToolCallProcessor.ApplyToolOutputLimit(ToolCall("Bash"), small, "session-1") == small,
            "小输出必须原样返回");

        // 9. 空输出不许炸
        Assert(
            ToolCallProcessor.ApplyToolOutputLimit(ToolCall("Bash"), string.Empty, "session-1") == string.Empty,
            "空输出必须原样返回");
    }

    private static void Assert(bool condition, string message)
    {
        _checks++;
        if (!condition)
            throw new InvalidOperationException($"Assertion failed: {message}");
    }
}

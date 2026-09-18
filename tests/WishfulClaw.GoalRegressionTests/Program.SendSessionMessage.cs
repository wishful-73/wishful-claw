using System.Text.Json;
using WishfulClaw.Contracts;
using static WishfulClaw.Agent.AgentRuntimeProjectExecutor;

namespace WishfulClaw.GoalRegressionTests;

internal static partial class Program
{
    /// <summary>
    /// S-58：跨会话派发的工具输出按 success 决定走向。
    ///
    /// 渲染端 handler 返回的是一整份对象（{ success, result?, error?, followUpId? }），以前
    /// Worker 直接 ToString() 丢给 agent —— 「已受理但排队」那条分支曾回 success:false，
    /// agent 读到原文就当成派发失败，于是重试 / 改道 / 向用户报错，而消息其实已经在队列里。
    /// 这个套件钉住两条：成功只出 result 文案，失败才进错误通道。
    /// </summary>
    private static void RunSendSessionMessageResultSuite()
    {
        // 成功 —— 只交 result 文案，不能把整份信封抖给 agent。
        var sent = FormatSendSessionMessageResult(WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteBoolean("success", true);
            writer.WriteString("result", "Message sent to session \"s1\". The target session is now processing.");
            writer.WriteEndObject();
        }));
        Assert(sent.StartsWith("Message sent to session", StringComparison.Ordinal),
            "successful dispatch returns the result text");
        Assert(!sent.Contains("success", StringComparison.Ordinal),
            "successful dispatch does not leak the raw result envelope");

        // 排队 —— S-58 的核心。这条现在回 success:true，必须走成功通道；
        // 一旦被当成错误，agent 就会重试一条已经在队列里的消息。
        var queued = FormatSendSessionMessageResult(WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteBoolean("success", true);
            writer.WriteString("result", "Message queued for session \"s1\"; it will run after the current turn finishes.");
            writer.WriteEndObject();
        }));
        Assert(queued.Contains("queued", StringComparison.Ordinal),
            "queued dispatch keeps the queue wording");
        Assert(!queued.Contains("error", StringComparison.Ordinal),
            "queued dispatch is not reported as an error");

        // 失败 —— 只有 success 为 false 才进错误通道，且只带 error 字段。
        var failed = FormatSendSessionMessageResult(WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteBoolean("success", false);
            writer.WriteString("error", "Target session \"s1\" does not exist.");
            writer.WriteEndObject();
        }));
        using (var doc = JsonDocument.Parse(failed))
        {
            AssertEqual("Target session \"s1\" does not exist.",
                doc.RootElement.GetProperty("error").GetString(),
                "failed dispatch surfaces the handler error message");
            Assert(!doc.RootElement.TryGetProperty("success", out _),
                "the error envelope carries only the error field");
        }

        // 失败但没有 error 文案 —— 给一句兜底，不能返回空输出。
        var failedWithoutMessage = FormatSendSessionMessageResult(WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteBoolean("success", false);
            writer.WriteEndObject();
        }));
        using (var doc = JsonDocument.Parse(failedWithoutMessage))
        {
            AssertEqual("Failed to send session message.",
                doc.RootElement.GetProperty("error").GetString(),
                "failure without a message still produces an error envelope");
        }

        // 成功但没有 result / 只有空白 —— 回落默认说明。
        var blankResult = FormatSendSessionMessageResult(WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteBoolean("success", true);
            writer.WriteString("result", "   ");
            writer.WriteEndObject();
        }));
        AssertEqual("Message sent successfully.", blankResult,
            "blank result text falls back to the default confirmation");

        // 没有 success 字段 —— 不能当成失败。
        var missingSuccess = FormatSendSessionMessageResult(WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("result", "envelope without a success flag");
            writer.WriteEndObject();
        }));
        AssertEqual("envelope without a success flag", missingSuccess,
            "an envelope without a success flag is not treated as a failure");

        // 非对象返回 —— 原样透传。
        AssertEqual("plain text",
            FormatSendSessionMessageResult(
                WorkerJsonHelper.BuildJsonElement(writer => writer.WriteStringValue("plain text"))),
            "a string payload passes through unchanged");

        AssertEqual("Message sent successfully.",
            FormatSendSessionMessageResult(
                WorkerJsonHelper.BuildJsonElement(writer => writer.WriteStringValue(string.Empty))),
            "an empty payload falls back to the default confirmation");
    }
}

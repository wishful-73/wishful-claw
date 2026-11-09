// iter-v3-5 S-279 收尾（2026-10-31）—— 普通消息的 wire 正文必须带 dispatch_id。
//
// 钉住一件事：目标会话的 agent 必须能拿到 dispatchId。没有它，`reply_global_dispatch`
// 的必填项凑不齐 ⇒ **结构上回不了**，只能靠 S-280 的归档层代标 completed_implicit，
// 全局会话永远拿不到对方说了什么。
//
// 这条缺陷**不报错、不抛异常**：初版 wire 里没有 dispatch_id，一切照常 ——
// 消息照发、会话照跑、状态照标、真机验收的 SQL 判据（id 前缀、source_session_id、
// 不串表）全绿。只有「全局会话到底收没收到回答」这件事是空的。
// 所以只能断言字符串 —— 这也是它当初漏掉的原因。
//
// 与 `tests/global-dispatch-meta`（TS 侧）的分工：那边管 S-278 的派活 wire 形状 +
// 跨语言源码闸；这里管普通消息的 wire。两者都是「协议说明只进 content、不进 displayContent」。

using WishfulClaw.Agent.Executors;
using WishfulClaw.Agent;

namespace WishfulClaw.SessionMessageWireRegressionTests;

internal static class Program
{
    private static int _passed;
    private static int _failed;

    public static int Main()
    {
        const string dispatchId = "gm_3f8a9b2c4d5e6f7a";
        const string content = "帮我看看 v3-iter-5 的文档欠账补到哪了。";

        var wire = AgentRuntimeProjectExecutor.BuildSessionMessageWireText(dispatchId, content);

        // ── 1. 模型必须看到 dispatch 身份 ──
        Assert(wire.Contains($"dispatch_id={dispatchId}"), "wire 必须带 dispatch_id");
        Assert(
            wire.Contains("\"dispatchId\": \"" + dispatchId + "\""),
            "回执示例里必须带可复制的 dispatchId（模型会照抄这个 JSON）");

        // ── 2. 原话必须在其中，且不被改写 ──
        Assert(wire.Contains(content), "wire 必须包含原话");
        Assert(wire.Contains(content + "\n\n"), "原话后必须紧跟空行再进指引");

        // ── 3. 回执指引必须是**代理调法** ──
        // 这个工具只通过 use_capability 暴露，教「直接调 reply_global_dispatch」模型会调失败
        // （同 S-278 那轮踩过的漂移）。
        Assert(wire.Contains("builtin:reply_global_dispatch"), "回执指引必须走 builtin:reply_global_dispatch");
        Assert(wire.Contains("use_capability"), "回执指引必须说明用 use_capability 代理调用");
        Assert(!wire.Contains("call the reply_global_dispatch"), "不许出现「直接调 reply_global_dispatch」的旧措辞");

        // ── 4. 前缀与派活区分开 ──
        Assert(wire.StartsWith("[GLOBAL SESSION MESSAGE]"), "wire 必须以 [GLOBAL SESSION MESSAGE] 开头");
        Assert(!wire.Contains("[GLOBAL AGENT WORK REQUEST]"), "普通消息不许冒用派活前缀");

        // ── 5. 不许带「拒绝回执」的措辞 ──
        // 工具描述里原本有「Do not use it for ordinary user messages」，已删；
        // 这条断言防止它从 wire 侧再溜回来。
        Assert(
            !wire.Contains("Do not use it for ordinary user messages"),
            "wire 不许带「不要用于普通消息」这类反向禁令");

        // ── 6. 允许不回执的场景必须写明 ──
        // 否则模型会把每条「收到，谢谢」都当成需要回执，反向制造噪音。
        Assert(wire.Contains("Skip the reply"), "必须说明纯通知类消息可以不回执");

        Console.WriteLine($"session-message-wire: {_passed} passed, {_failed} failed");
        return _failed == 0 ? 0 : 1;
    }

    private static void Assert(bool condition, string description)
    {
        if (condition)
        {
            _passed++;
            return;
        }
        _failed++;
        Console.WriteLine($"  FAIL {description}");
    }
}

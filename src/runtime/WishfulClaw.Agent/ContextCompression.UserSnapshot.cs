namespace WishfulClaw.Agent;

/// <summary>
/// ContextCompression 的快照分部类（S-208）：压缩时把「用户最后说了什么、什么时候说的、
/// 当时跑到哪一步」写进摘要正文最前面。
///
/// 为什么单独成文件：这块跟压缩流程本身是两件事 —— 压缩负责「怎么切、怎么摘要」，
/// 这里负责「给模型交代用户当前处境」。它自洽、可单读（连同渲染端的
/// <c>context-compression-display.ts</c> 一起看就完整了），留在主文件里只会让人翻 1000 行。
/// </summary>
public static partial class ContextCompression
{
    // ── S-208：用户末条消息的快照 ──

    /// <summary>快照块的第一行前缀。渲染端据此把它从给人看的正文里剔掉。</summary>
    private const string LatestUserHeadingPrefix = "【用户消息";

    /// <summary>压缩时刻块的前缀，同上。</summary>
    private const string CompactStampHeadingPrefix = "【压缩时刻";

    internal const string LatestUserNotStarted = "用户消息尚未开始执行";
    internal const string LatestUserRunning = "用户消息正在执行中";
    internal const string LatestUserAnswered = "用户消息已答复完毕";

    /// <summary>
    /// 压缩时刻「用户最后说了什么」的快照：干净原话 + 发送时刻 + 相对于发送时刻的执行进度。
    ///
    /// 为什么不能只放原文（首版的做法）：压缩有两种时机，而原文在两种时机下该有的地位
    /// 是相反的 ——
    /// ① 用户刚发消息、run 第一轮就压缩 ⇒ 这条消息一条 assistant 都还没跟，它是**当前指令**，
    ///    必须顶在摘要正文最前；
    /// ② 用户发消息、已经跑了几分钟几十轮才压缩 ⇒ 它是**任务目标的出处**，当前进度由摘要
    ///    和尾巴交代，再把它标成「当前指令」会让 agent 回头重做已经做完的活。
    /// 光给时间戳分不开这两种：差 5 分钟可能是刚交卷，差 10 分钟可能是任务还在跑。
    /// 真正的判据是这条消息后面有没有交卷的 assistant 轮，所以状态由代码算、直接写进快照。
    /// </summary>
    private sealed record LatestUserSnapshot(
        string Text,
        DateTimeOffset? SentAt,
        string State);

    /// <summary>
    /// S-208：对话里**最后一条真人用户消息**的快照，找不到返回 null。
    ///
    /// 为什么从后往前扫而不是直接取末尾：尾巴最后一条可能是工具结果轮
    /// （<c>UserToolResults</c>，Role 同样是 "user" 但正文为空），也可能是上一轮的压缩摘要
    /// —— 两者都不是「用户现在说的话」，拿它们当快照等于把抢跑的毛病换个姿势再犯一遍。
    /// </summary>
    private static LatestUserSnapshot? FindLatestUserSnapshot(List<AgentRuntimeChatMessage> conversation)
    {
        for (var i = conversation.Count - 1; i >= 0; i--)
        {
            var message = conversation[i];
            if (message.Role != "user") continue;
            if (message.ToolResults.Count > 0) continue;
            if (IsCompactionSummary(message)) continue;

            // 有这个字段就读它：OriginalText 是 InjectTransientPrefix 盖戳时留下的干净原文。
            // 恢复链路的历史消息没有它（那些行落库时就带着运行时块），退回剥一次 ——
            // StripInjectedBlocks 是 S-92 为「召回要跑在用户自己的话上」写的现成实现。
            var text = message.OriginalText ?? AgentLoop.StripInjectedBlocks(message.Text);
            if (string.IsNullOrWhiteSpace(text)) continue;

            return new LatestUserSnapshot(
                text,
                message.SentAt,
                DescribeLatestUserProgress(conversation, i));
        }

        return null;
    }

    /// <summary>
    /// 这条用户消息之后走到了哪一步。三选一，全部由结构判定，不看时钟：
    /// 有交卷的 assistant 轮 ⇒ 已答复；有工具调用或工具结果轮 ⇒ 执行中；什么都没有 ⇒ 未开始。
    ///
    /// 空正文且无工具调用的 assistant 不算交卷 —— 那是 S-209 那类「思考完没开口」的轮次，
    /// 它后面还有活要干。
    /// </summary>
    private static string DescribeLatestUserProgress(List<AgentRuntimeChatMessage> conversation, int userIndex)
    {
        var sawProgress = false;

        for (var i = userIndex + 1; i < conversation.Count; i++)
        {
            var message = conversation[i];

            if (message.Role == "user" && message.ToolResults.Count > 0)
            {
                sawProgress = true;
                continue;
            }

            if (message.Role != "assistant") continue;

            if (message.ToolUses.Count > 0)
            {
                sawProgress = true;
                continue;
            }

            if (!string.IsNullOrWhiteSpace(message.Text))
            {
                return LatestUserAnswered;
            }

            sawProgress = true;
        }

        return sawProgress ? LatestUserRunning : LatestUserNotStarted;
    }

    /// <summary>
    /// 拼出快照块。格式固定（渲染端靠这两行前缀把它从给人看的正文里认出来并剔除）：
    /// <code>
    /// 【用户消息 · MM-dd HH:mm】
    /// 用户原话
    ///
    /// 【压缩时刻 · MM-dd HH:mm · 执行进度】
    /// 以上为压缩时刻的快照；此后用户若再有消息，以对话中最新消息为准。
    /// </code>
    /// 发送时刻拿不到时（极端边界）省略时间，不塞占位符。
    /// </summary>
    private static string BuildLatestUserSnapshotBlock(LatestUserSnapshot snapshot, DateTimeOffset compactedAt)
    {
        var heading = snapshot.SentAt is { } sent
            ? $"{LatestUserHeadingPrefix} · {sent.ToString("MM-dd HH:mm")}】"
            : $"{LatestUserHeadingPrefix}】";

        return $"{heading}\n{snapshot.Text}\n\n" +
               $"{CompactStampHeadingPrefix} · {compactedAt.ToString("MM-dd HH:mm")} · {snapshot.State}】\n" +
               "以上为压缩时刻的快照；此后用户若再有消息，以对话中最新消息为准。";
    }
}

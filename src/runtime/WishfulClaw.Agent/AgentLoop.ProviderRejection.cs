namespace WishfulClaw.Agent;

/// <summary>
/// 请求级 400 的自愈与告知（S-262）。
///
/// **要解决的不是「怎么重试」，是「怎么不把会话钉死」。** 图像 / 工具配对 / 上下文超限三类
/// 400 各有专项分支（见 <c>AgentLoop</c> 的 catch 链），认不出的那些过去一律直接抛 —— run
/// 当场终止，模型全程不知道自己上一步做错了什么，用户看到的是一个看起来废掉的会话。
///
/// 本文件的动作只有一句：**把本轮最后一条工具结果换成「这次结果被上游拒绝」**，然后让上层
/// 重发。它一石二鸟：
/// <list type="bullet">
/// <item><b>告知</b> —— 模型下一轮在对话里就看到「我上一步失败了 + 原文」，自己决定换工具、
/// 换参数，还是直接告诉用户；</item>
/// <item><b>修好</b> —— 坏数据从本轮请求里消失了，重发**真的可能成功**。</item>
/// </list>
///
/// 只追加一条提醒治不了根（坏数据还在，必再 400），所以这里必须替换而不是旁白。
///
/// **替换只发生在临时副本上。** 注入走 <c>ExecuteTurnAsync</c> 每轮现造的 wire conversation，
/// 与 <c>InjectSessionTodo</c> / <c>InjectEmptyTurnNudge</c> / <c>InjectSandboxTransition</c>
/// 同一形状：不落库、不进 durable conversation、切回会话后原始工具结果仍在。
///
/// **`ToolUseId` 一个字不许动。** 删消息或换 id 会立刻制造配对错，把 400 变成另一种 400。
///
/// 三道安全阀（对治 2026-10-27 撤掉 400 重试的教训 —— 当时 <c>MissingSessionID</c> 从
/// attempt 1/20 一路烧到 20/20、请求体一个字没变）：
/// <list type="number">
/// <item>上限 <see cref="MaxProviderRejectionRecoveriesPerRun"/>；</item>
/// <item>报文指纹去重 —— 同一指纹最多试一次，绝不对着同一个错反复烧；</item>
/// <item>本轮没有可替换的工具结果就不进这条路（坏数据是用户消息时我们无权替它删）。</item>
/// </list>
/// </summary>
internal static partial class AgentLoop
{
    /// <summary>
    /// 一次 run 里最多尝试几次「替换工具结果后重发」。
    ///
    /// 2 而不是 1：一个长 run 里可能先后撞上两个**不同**的 400（指纹不同），各修一次是合理的。
    /// 真正的防火墙是指纹去重 —— 它保证浪费的上界固定为「每个不同报文一次」，所以即便额度
    /// 是 2，对着同一个错反复烧也不可能发生。
    /// </summary>
    internal const int MaxProviderRejectionRecoveriesPerRun = 2;

    /// <summary>
    /// 换上去的工具结果文本。用中文，与 <c>EmptyTurnNudge</c> 一致 —— 这条不做缓存前缀，
    /// 逐字稳定即可，不必跟系统提示词同语言。
    ///
    /// 三句话分别对应模型需要的三件事：发生了什么、为什么、现在可以怎么办。
    /// </summary>
    private const string RejectedToolResultHeader =
        "[系统提醒] 你上一步的工具调用结果被上游拒绝了（HTTP 400），这次结果已作废。\n" +
        "常见原因：结果太大、格式不被这个模型接受，或含有上游不认识的内容。\n" +
        "请换一种方式拿需要的信息（读片段而不是整份、换路径、换工具），或者直接告诉用户这一步没做成。\n" +
        "上游原文：\n";

    /// <summary>
    /// 能不能对这次 400 做恢复。**纯判定，不改变任何状态** —— catch 的 <c>when</c> 子句里
    /// 不许有副作用，否则 filter 求值本身就会把额度吃掉。
    ///
    /// <c>internal</c> 是为了让 <c>WishfulClaw.ProviderRejectionRegressionTests</c> 直接把
    /// 三道安全阀钉成断言 —— 这三条一旦被改松，烧的是用户的请求费，必须有回归守着。
    /// </summary>
    internal static bool CanRecoverFromProviderRejection(
        AgentRuntimeRunState state,
        List<AgentRuntimeChatMessage> conversation,
        Exception exception)
    {
        if (state.ProviderRejectionRecoveryCount >= MaxProviderRejectionRecoveriesPerRun)
        {
            return false;
        }

        // 安全阀 3：本轮一条工具结果都没有 ⇒ 坏数据不在我们能改的那一份里
        // （多半在用户消息里），替换无从下手，直接放它走原报错路径。
        if (!HasTrailingToolResults(conversation))
        {
            return false;
        }

        // 安全阀 2：同一份报文已经试过一次，改成这样还是同一个错 —— 别再烧。
        var fingerprint = ProviderRejectionErrors.Fingerprint(
            ProviderRejectionErrors.Describe(exception));
        if (fingerprint.Length > 0 &&
            string.Equals(fingerprint, state.LastProviderRejectionFingerprint, StringComparison.Ordinal))
        {
            return false;
        }

        return true;
    }

    /// <summary>
    /// 有待注入的拒绝报文时，把本轮最后一条工具结果换成拒绝说明（临时副本）。
    /// 消费标记：同一次拒绝只注入一轮。
    ///
    /// <c>internal</c> 同 <see cref="CanRecoverFromProviderRejection"/>：替换语义（只换最后一条、
    /// `ToolUseId` 不变、`IsError` 置真）是回归锚点。</summary>
    internal static List<AgentRuntimeChatMessage> InjectProviderRejectionNotice(
        AgentRuntimeRunState state,
        List<AgentRuntimeChatMessage> conversation)
    {
        var report = state.PendingProviderRejectionReport;
        if (string.IsNullOrEmpty(report)) return conversation;

        state.PendingProviderRejectionReport = null;
        return ReplaceTrailingToolResults(conversation, RejectedToolResultHeader + report);
    }

    /// <summary>
    /// 把**最后一条带工具结果**的消息里的每条结果换成 <paramref name="replacement"/>。
    ///
    /// 选最后一条而不是全部：一轮里可能有十几条工具结果，只有最新那批是本轮刚产生的。
    /// 全换会把模型前几轮辛苦拿到的信息一并抹掉，比不修还糟。
    /// </summary>
    private static List<AgentRuntimeChatMessage> ReplaceTrailingToolResults(
        List<AgentRuntimeChatMessage> conversation,
        string replacement)
    {
        var index = FindTrailingToolResultIndex(conversation);
        if (index < 0) return conversation;

        var message = conversation[index];
        var replaced = new List<AgentRuntimeToolResult>(message.ToolResults.Count);
        foreach (var result in message.ToolResults)
        {
            // ToolUseId 原样保留 —— 换了或丢了就是配对错。
            replaced.Add(result with
            {
                Content = AgentRuntimeProviderSupport.CreateStringElement(replacement),
                IsError = true
            });
        }

        var updated = new List<AgentRuntimeChatMessage>(conversation.Count);
        for (var i = 0; i < conversation.Count; i++)
        {
            updated.Add(i == index ? message with { ToolResults = replaced } : conversation[i]);
        }

        return updated;
    }

    /// <summary>这份对话里有没有可替换的工具结果（安全阀 3 的判据）。</summary>
    private static bool HasTrailingToolResults(List<AgentRuntimeChatMessage> conversation)
    {
        return FindTrailingToolResultIndex(conversation) >= 0;
    }

    /// <summary>最后一条带工具结果的消息下标；没有返回 -1。</summary>
    private static int FindTrailingToolResultIndex(List<AgentRuntimeChatMessage> conversation)
    {
        for (var index = conversation.Count - 1; index >= 0; index--)
        {
            if (conversation[index].ToolResults is { Count: > 0 })
            {
                return index;
            }
        }

        return -1;
    }
}

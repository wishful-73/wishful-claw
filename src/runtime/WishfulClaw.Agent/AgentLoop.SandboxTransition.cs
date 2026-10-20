using System.Text.Json;

namespace WishfulClaw.Agent;

/// <summary>
/// 沙箱状态与系统提示词的口径拉平（S-207）。
///
/// 系统提示词在 run 开头构建一次就进了 cacheKey，整个 run 不会再重建 —— 这是对的，
/// 提示词是缓存前缀，逐轮变就等于逐轮击穿缓存。但「临时关闭沙箱」恰恰是一个
/// **run 进行中**才会发生的状态变化：用户批准之后 <c>PathBoundary.IsEnabled</c> 立刻
/// 返回 false，提示词里却还写着「沙箱开着」。模型照着自己的提示词办事，就会在明明
/// 已经放行的路径上自我否决、回头去请求用户 —— 用户看到的是「批准了还是不动」。
///
/// 修法沿用 <c>InjectSessionTodo</c> / <c>InjectEmptyTurnNudge</c> 的临时副本注入：
/// 每轮 provider 调用前比对实时状态与提示词口径，不一致就追加一条 user 提示，
/// 并把基准更新成实时值（所以每次状态变化只提示一次，不会每轮念一遍）。提示不落库、
/// 不进 durable conversation，压缩摘要也看不到它。
/// </summary>
internal static partial class AgentLoop
{
    /// <summary>沙箱被临时关掉之后的提示。</summary>
    private const string SandboxReleasedNudge =
        "[系统提醒] 用户已批准临时关闭沙箱模式。\n" +
        "现在可以读写工作目录之外的路径，不必再申请、也不要回头问用户。\n" +
        "一小时后自动恢复；用户也可能随时手动恢复，恢复后会再提醒你一次。";

    /// <summary>沙箱重新开启之后的提示。</summary>
    private const string SandboxRestoredNudge =
        "[系统提醒] 沙箱模式已重新开启。\n" +
        "工作目录之外的路径不再放行，访问它们会被拒绝。需要越界时请先调用 RequestSandboxElevation 申请，等用户批准。";

    /// <summary>
    /// 把「提示词里的沙箱状态」和「实时判定」拉平，必要时返回一份追加了提示的副本。
    /// 没有变化时原样返回原列表（零拷贝路径）。
    /// </summary>
    private static List<AgentRuntimeChatMessage> InjectSandboxTransition(
        JsonElement parameters,
        List<AgentRuntimeChatMessage> conversation,
        AgentRuntimeRunState state)
    {
        var current = Tools.PathBoundary.IsEnabled(parameters);
        if (current == state.SandboxEnabledInPrompt) return conversation;

        state.SandboxEnabledInPrompt = current;
        var injected = new List<AgentRuntimeChatMessage>(conversation.Count + 1);
        injected.AddRange(conversation);
        injected.Add(AgentRuntimeChatMessage.User(current ? SandboxRestoredNudge : SandboxReleasedNudge));
        return injected;
    }
}

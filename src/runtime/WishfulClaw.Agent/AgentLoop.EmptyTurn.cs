using System.Text.Json;

namespace WishfulClaw.Agent;

/// <summary>
/// 空回复催办（iter-40 S-209）。
///
/// 现象：有的模型（GLM-5.3-flash 实测）会以**正常的结束原因**收尾，却既没有正文、
/// 也没有工具调用 —— 内容全落在思考里。用户那边看到的是一条空气泡：
/// <c>openai-chat returned no usable assistant output (stopReason=stop, textLength=0, toolCalls=0)</c>。
///
/// 放宽判定（<c>EnsureProviderTurnHasOutput</c> 认 reasoningContent 也算有输出）只是让它
/// 不再被当故障抛出 —— 真正的缺口是**没人催它把话说完**：主循环见到「无工具调用」
/// 就直接 <c>completed = true</c>，等于静默的空回复还丢掉了重试机会。
///
/// 这里补上催办：本轮无工具调用、正文为空、但有思考时，发一条临时提醒再跑一轮，上限
/// <see cref="MaxEmptyTurnNudges"/> 次。额度用尽就按正常完成收尾，绝不无限重试。
///
/// 注入走**临时副本**（与 <c>InjectSessionTodo</c> 同法）：提醒不落库、不进 durable
/// conversation、聊天窗看不见。写进历史会污染下一轮压缩的摘要输入 —— 摘要的身份判定
/// 靠消息形状，多一条来路不明的 user 消息是实打实的风险。
/// </summary>
internal static partial class AgentLoop
{
    /// <summary>一次 run 内最多催办几轮。用尽即放行，避免与弱模型互相消耗。</summary>
    internal const int MaxEmptyTurnNudges = 2;

    /// <summary>
    /// 给模型看的提醒。用中文：这条不作缓存前缀，逐字稳定即可，不必跟系统提示词同语言。
    /// </summary>
    private const string EmptyTurnNudge =
        "[系统提醒] 你上一轮只输出了思考过程，既没有正文，也没有调用任何工具。\n" +
        "需要回答用户，就把结论写出来；需要继续做事，就调用相应工具。\n" +
        "不要在思考里结束这一轮 —— 那样用户只会看到一片空白。";

    /// <summary>
    /// 有待催办标记时，把提醒作为临时 user 消息追加到喂给 provider 的消息末尾（零拷贝路径
    /// 除外）。消费标记：同一次提醒只注入一轮。
    /// </summary>
    private static List<AgentRuntimeChatMessage> InjectEmptyTurnNudge(
        AgentRuntimeRunState state,
        List<AgentRuntimeChatMessage> conversation)
    {
        if (!state.PendingEmptyTurnNudge) return conversation;

        state.PendingEmptyTurnNudge = false;
        var injected = new List<AgentRuntimeChatMessage>(conversation.Count + 1);
        injected.AddRange(conversation);
        injected.Add(AgentRuntimeChatMessage.User(EmptyTurnNudge));
        return injected;
    }
}

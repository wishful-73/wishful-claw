using System.Text;
using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// 子代理的轮次提醒（iter-31 S-53）。
///
/// 为什么需要它：子代理曾经有一个硬性轮次上限（默认 12），跑到就被掐断 ——
/// 而它往往还没输出结论，实测报告只剩一句开场白，且结束原因被记成 completed，
/// 外面完全看不出来。硬上限撤掉之后（见 SubAgentDefinition.DefaultMaxTurns），
/// 「防跑飞」的职责改由这里承担：从第若干轮起把当前进度如实推到它眼前，
/// 由它自己判断继续还是收尾。
///
/// 刻意只给事实、不给嘱咐 —— 「记得收尾」这类句子每轮都要付 token，
/// 而它看到「没有轮次上限」这个事实之后自己会做判断。
///
/// 注入方式与 InjectSessionTodo 完全一致：追加一条临时 user 消息、走临时副本，
/// 原 conversation 一字不动（改写历史会废掉下一轮请求的 prompt cache 前缀）。
/// 作用域仅子代理，主会话不注入。
/// </summary>
internal static partial class AgentLoop
{
    /// <summary>
    /// 从第几轮起开始提醒。取值沿用被撤掉的那个默认上限 —— 它的角色从「闸门」变成
    /// 「提醒点」。定在这里的前提是实测：正常子代理 3~5 轮就收工，够不到这个数。
    /// </summary>
    internal const int SubAgentTurnReminderAfter = 12;

    /// <summary>
    /// 构造要注入的 &lt;sub_agent_status&gt; 文本块；未到提醒点则返回 null。
    /// internal 供回归测试直接调用。
    /// </summary>
    internal static string? BuildSubAgentTurnReminderBlock(int iteration)
    {
        if (iteration < SubAgentTurnReminderAfter)
        {
            return null;
        }

        // 一律用 '\n'，不用 AppendLine —— Windows 上 AppendLine 产出 '\r\n'，
        // 同一份注入内容跨平台就不一样了，测试断言也跟着漂。
        //
        // 两句话各自都有实测依据：
        //   1) 无轮次上限 —— 它此前不知道自己还剩多少轮，一感觉「跑挺久了」就急着
        //      想说结论（或干脆不说），这正是报告只剩开场白的一半原因；
        //   2) 只有文本会被交付 —— 另一半原因是它把成果留在工具调用里，
        //      而 GetFinalOutput() 只串联 text 事件，工具结果不进报告。
        var sb = new StringBuilder();
        sb.Append("<sub_agent_status>\n");
        sb.Append("Turn ").Append(iteration)
          .Append(". No turn limit is enforced on this run — you may keep working until the task is complete.\n");
        sb.Append("Only the text you emit is delivered back to the caller.\n");
        sb.Append("</sub_agent_status>");
        return sb.ToString();
    }

    /// <summary>
    /// 返回喂给 provider 的消息列表。不需要注入时原样返回入参（零拷贝）。
    /// </summary>
    private static List<AgentRuntimeChatMessage> InjectSubAgentTurnReminder(
        JsonElement parameters,
        List<AgentRuntimeChatMessage> conversation,
        int iteration)
    {
        if (!IsSubAgentRun(parameters))
        {
            return conversation;
        }

        var block = BuildSubAgentTurnReminderBlock(iteration);
        if (block is null)
        {
            return conversation;
        }

        var injected = new List<AgentRuntimeChatMessage>(conversation.Count + 1);
        injected.AddRange(conversation);
        injected.Add(AgentRuntimeChatMessage.User(block));
        return injected;
    }

    /// <summary>
    /// 当前 run 是不是子代理。判据与 ExecuteLoopAsync 里 isSubAgentLoop 的推导同源
    /// （parameters.sessionMode），避免出现两套口径。
    /// </summary>
    private static bool IsSubAgentRun(JsonElement parameters)
    {
        var mode = JsonHelpers.GetString(parameters, "sessionMode");
        return string.Equals(mode, "subAgent", StringComparison.Ordinal)
            || string.Equals(mode, "goalSubAgent", StringComparison.Ordinal);
    }
}

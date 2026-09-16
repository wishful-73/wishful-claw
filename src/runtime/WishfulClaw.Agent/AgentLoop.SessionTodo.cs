using System.Text;
using System.Text.Json;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// 会话 Todo 现状的每轮上下文注入（iter-30 S-44）。
///
/// 为什么需要它：todo 工具本身没问题，问题是 agent 建完之后就不再维护。
/// 原来的 todo 说明放在系统提示词的 &lt;session_todo&gt; 块里，只在 turn 开始时注入一次，
/// 而 todo 恰恰是 turn 执行过程中才创建的 —— 注入那一刻它还不存在。
/// 之后 agent 只能从 TodoTask* 的返回值里看到 todo，可它不调用那些工具时永远看不到，
/// 于是形成「不调 → 看不到 → 更不会调」的闭环。
///
/// 这里补上真正的缺口：每轮把当前清单推送到它眼前。
/// 刻意只给事实、不给「记得更新 todo」这类嘱咐 —— 它看到 in_progress 与自己正在做的事对不上，
/// 自己就会去纠正。嘱咐每轮都要付 token，而事实是它会主动去核对的。
///
/// 注入走临时副本（见 InjectSessionTodo），原 conversation 一字不动：
/// 任何写进历史的消息都会成为下一轮的前缀，前缀一变整段缓存作废。
/// </summary>
internal static partial class AgentLoop
{
    /// <summary>单次注入渲染的未完成项上限。超过则折叠成「+N more」，防止长清单吃 token。</summary>
    internal const int MaxTodoItemsInjected = 8;

    /// <summary>单个标题的渲染上限，避免超长标题把注入撑爆。</summary>
    private const int MaxTodoSubjectChars = 80;

    /// <summary>
    /// 构造要注入的 &lt;todo_status&gt; 文本块。
    /// 返回 null 表示不需要注入 —— 无任务，或全部已收尾（这时再提醒只是噪音）。
    /// internal 供回归测试直接调用。
    /// </summary>
    internal static string? BuildSessionTodoBlock(IReadOnlyList<TaskRow>? tasks)
    {
        if (tasks is null || tasks.Count == 0)
        {
            return null;
        }

        var open = new List<TaskRow>();
        var completed = 0;
        foreach (var task in tasks)
        {
            if (task.Status == "completed")
            {
                completed++;
            }
            else if (task.Status != "deleted")
            {
                open.Add(task);
            }
        }

        // 全部收尾或全部被删 —— 没有需要维护的东西了。
        if (open.Count == 0)
        {
            return null;
        }

        // 一律用 '\n'，不用 AppendLine —— Windows 上 AppendLine 产出 '\r\n'，
        // 同一份注入内容在不同平台就不一样了，测试断言和历史内容也跟着漂。
        var sb = new StringBuilder();
        sb.Append("<todo_status>\n");
        sb.Append(completed).Append('/').Append(tasks.Count).Append(" completed. Remaining:\n");
        for (var i = 0; i < open.Count && i < MaxTodoItemsInjected; i++)
        {
            var task = open[i];
            sb.Append("- [").Append(task.Status).Append("] ").Append(TruncateSubject(task.Subject)).Append('\n');
        }
        if (open.Count > MaxTodoItemsInjected)
        {
            sb.Append("... +").Append(open.Count - MaxTodoItemsInjected).Append(" more\n");
        }
        sb.Append("</todo_status>");
        return sb.ToString();
    }

    private static string TruncateSubject(string subject)
    {
        var trimmed = subject.Trim();
        return trimmed.Length <= MaxTodoSubjectChars
            ? trimmed
            : trimmed[..MaxTodoSubjectChars] + "…";
    }

    /// <summary>
    /// 返回喂给 provider 的消息列表。没有可注入的 todo 时原样返回入参（零拷贝）。
    ///
    /// 注入方式是「追加一条临时 user 消息」，而不是改写任何已有消息：
    /// 已有消息会作为下一轮请求的前缀参与缓存，改它们等于每轮全量重算。
    /// 追加在最末尾的内容不属于任何后续请求的前缀，缓存不受影响。
    /// </summary>
    private static List<AgentRuntimeChatMessage> InjectSessionTodo(
        JsonElement parameters,
        List<AgentRuntimeChatMessage> conversation,
        AgentRuntimeRunState state)
    {
        var block = LoadSessionTodoBlock(parameters, state);
        if (block is null)
        {
            return conversation;
        }

        var injected = new List<AgentRuntimeChatMessage>(conversation.Count + 1);
        injected.AddRange(conversation);
        injected.Add(AgentRuntimeChatMessage.User(block));
        return injected;
    }

    /// <summary>读当前会话的 todo 并渲染成注入块；无内容时返回 null。</summary>
    private static string? LoadSessionTodoBlock(JsonElement parameters, AgentRuntimeRunState state)
    {
        var rows = AgentRuntimeTaskExecutor.LoadSessionTodoSnapshot(parameters, state.SessionId);
        var block = BuildSessionTodoBlock(rows);
        if (block is not null)
        {
            WorkerLog.Debug($"session todo injected runId={state.RunId} tasks={rows!.Count}");
        }

        return block;
    }
}

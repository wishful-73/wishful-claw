using System.Collections.Concurrent;

using WishfulClaw.Agent.Executors;
namespace WishfulClaw.Agent;

/// <summary>
/// S-308：toolUseId → 子 agent 自己的 run state。给外部一条真正能中断执行的通路
/// （渲染端停止按钮 / agent 自己的 SubAgentStop 工具）。
///
/// **为什么不另建一个 CancellationTokenSource**：子 agent 的取消源就是
/// <see cref="AgentRuntimeRunState"/> 内那个 CTS —— AgentLoop、工具派发、provider 请求全链路
/// 只认它的 Token。另建一份 linked source 只能取消它自己，停不掉任何东西；而「link 父 CTS、
/// 父 run 结束时只 Dispose link」这套时序是 SA-2 踩过 ObjectDisposedException 的地方，
/// 现成的父子联动（父 Cancel → 子 Cancel 的注册回调）已经是通的，不重写。
/// 所以这里只存句柄，取消仍然调用 state.Cancel()。
///
/// **生命周期**：Register 在子 runState 建好之后、进 loop 之前；Unregister 在 finally，
/// 且必须排在 state.Dispose() 之前 —— Dispose 之后再 Cancel 会被
/// <see cref="AgentRuntimeRunState.Cancel"/> 自己吞掉（ObjectDisposedException），
/// 那时它已经不在跑了，谎报「已停止」比失败更糟。
/// </summary>
public static class SubAgentRunControl
{
    private static readonly ConcurrentDictionary<string, AgentRuntimeRunState> _runs =
        new(StringComparer.Ordinal);

    public static void Register(string toolUseId, AgentRuntimeRunState childState)
    {
        if (string.IsNullOrWhiteSpace(toolUseId) || childState is null)
        {
            return;
        }

        _runs[toolUseId] = childState;
    }

    public static void Unregister(string toolUseId)
    {
        if (string.IsNullOrWhiteSpace(toolUseId))
        {
            return;
        }

        _runs.TryRemove(toolUseId, out _);
    }

    /// <summary>
    /// 真正中断执行。返回 false = 没有这条登记（已结束 / 从未登记 / 不是子 agent），
    /// 调用方**不得**在这种情况下声称已取消 —— 状态与实际不符正是 S-308 要修的那类缺陷。
    /// 已经在取消中的视为成功（重复点停止不该报错）。
    /// </summary>
    public static bool TryStop(string toolUseId, string reason)
    {
        if (string.IsNullOrWhiteSpace(toolUseId))
        {
            return false;
        }

        if (!_runs.TryGetValue(toolUseId, out var state))
        {
            return false;
        }

        if (state.IsCancellationRequested)
        {
            return true;
        }

        state.Cancel(string.IsNullOrWhiteSpace(reason) ? "user" : reason);
        return true;
    }

    public static bool IsActive(string toolUseId)
    {
        return !string.IsNullOrWhiteSpace(toolUseId) && _runs.ContainsKey(toolUseId);
    }
}

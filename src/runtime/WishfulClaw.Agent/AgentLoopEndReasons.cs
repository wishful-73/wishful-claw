namespace WishfulClaw.Agent;

/// <summary>
/// loop_end 的结束原因取值（S-210）。
///
/// 这几个值是**数据**，不是文案：渲染端拿它去落库（<c>meta.runEnd.reason</c>）并按真实
/// 原因显示。改名字等于改协议，两侧要一起动。
/// </summary>
public static class AgentLoopEndReasons
{
    /// <summary>正常跑完（模型自己给了收尾回答）。</summary>
    public const string Completed = "completed";

    /// <summary>撞到单轮迭代上限。</summary>
    public const string MaxIterations = "max_iterations";

    /// <summary>被中断，但不由用户直接按下停止（父 run 收尾、会话被替换等）。</summary>
    public const string Aborted = "aborted";

    /// <summary>用户按了停止 —— <c>agent/cancel</c> 的 CancelReason 是 "user"。</summary>
    public const string UserCancelled = "user_cancelled";

    /// <summary>抛异常中断，具体成因看同一事件上的 errorType / statusCode。</summary>
    public const string Error = "error";
}

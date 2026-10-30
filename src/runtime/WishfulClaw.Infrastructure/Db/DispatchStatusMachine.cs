using System.Text.Json;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// S-279（v3-iter-5）：两张派活表的**唯一**路由点。
///
/// <c>global_task_dispatches</c> 挂全局任务（<c>gd_</c> 前缀，<c>global_task_id</c> NOT NULL）；
/// <c>global_message_dispatches</c> 是普通消息派活（<c>gm_</c> 前缀，没有全局任务）。
///
/// 为什么用 id 前缀而不是加一列 <c>table_name</c>：回执入口拿到的只有 <c>dispatchId</c>
/// 一个字符串（<c>reply_global_dispatch</c> 的入参就是它），前缀是唯一不需要额外查询
/// 就能分辨表的信息。改前缀规则 = 改路由，所以前缀常量集中在这里，别处不许再写
/// <c>"gm_"</c> 字面量。
/// </summary>
public static class DispatchTableRouter
{
    /// <summary>普通消息派活的 id 前缀。</summary>
    public const string MessageDispatchIdPrefix = "gm_";

    /// <summary>全局任务派活的 id 前缀（沿用既有约定，不做改动）。</summary>
    public const string TaskDispatchIdPrefix = "gd_";

    public const string TaskDispatchTable = "global_task_dispatches";

    public const string MessageDispatchTable = "global_message_dispatches";

    /// <summary>按 id 前缀判定这张派活记录落在哪张表。</summary>
    public static string ResolveTable(string? dispatchId)
    {
        return dispatchId is not null
            && dispatchId.StartsWith(MessageDispatchIdPrefix, StringComparison.Ordinal)
            ? MessageDispatchTable
            : TaskDispatchTable;
    }

    /// <summary>这条派活记录是不是普通消息派活（走 <c>gm_</c> 那张表）。</summary>
    public static bool IsMessageDispatch(string? dispatchId)
    {
        return ResolveTable(dispatchId) == MessageDispatchTable;
    }

    public static string NewMessageDispatchId()
    {
        return MessageDispatchIdPrefix + Guid.NewGuid().ToString("N");
    }
}

/// <summary>
/// S-279 / S-280（v3-iter-5）：两张派活表共用的状态流转层。
///
/// **只写一份。** 复制粘贴到第二张表上，两边的终态判定迟早漂移 —— S-276 那轮
/// 「四处轮次判据各写各的」就是这么栽的。
///
/// 状态机（两张表同构）：
/// <code>
///   pending / sent / acknowledged / in_progress
///        ├─ 显式回执 ──→ in_progress / completed / blocked
///        ├─ 我们代标 ──→ completed_implicit   （S-280：目标跑完但没回执）
///        ├─ 投递失败 ──→ failed
///        └─ 主动取消 ──→ cancelled
///   completed / failed / cancelled 为终态，不再流转
/// </code>
///
/// **铁律：显式永远覆盖隐式。** <c>completed_implicit</c> 不是终态 —— 目标会话
/// 事后补一条显式回执，必须能把它改成 <c>completed</c>。这是 S-280 的验收底线。
/// </summary>
public static class DispatchStatusMachine
{
    /// <summary>目标会话 agent 可以显式声明的状态（<c>reply_global_dispatch</c> 的入参值域）。</summary>
    public static readonly string[] AllowedExplicitReplyStatuses =
    {
        GlobalTaskDispatchStatusValues.InProgress,
        GlobalTaskDispatchStatusValues.Completed,
        GlobalTaskDispatchStatusValues.Blocked
    };

    /// <summary>终态：不再接受任何流转（含显式回执）。</summary>
    public static bool IsTerminal(string? status)
    {
        return status is GlobalTaskDispatchStatusValues.Completed
            or GlobalTaskDispatchStatusValues.Failed
            or GlobalTaskDispatchStatusValues.Cancelled;
    }

    /// <summary>
    /// 我们代标的隐式完成。**不算终态** —— 显式回执能覆盖它。
    /// 这一条与 <see cref="IsTerminal"/> 分开写，就是为了防止有人图省事把
    /// completed_implicit 并进终态集合，那样 S-280 的「显式覆盖隐式」直接失效。
    /// </summary>
    public static bool IsImplicitCompletion(string? status)
    {
        return status == GlobalTaskDispatchStatusValues.CompletedImplicit;
    }

    /// <summary>显式回执是否还允许写在这条记录上。</summary>
    public static bool AcceptsExplicitReply(string? currentStatus)
    {
        if (IsTerminal(currentStatus)) return false;
        // completed_implicit 明确放行（显式覆盖隐式）。
        if (IsImplicitCompletion(currentStatus)) return true;
        return true;
    }

    /// <summary>
    /// 显式回执的状态决议：入参给了就用入参，没给则「没动过的派活」变成 acknowledged，
    /// 已经在动的保持原状。
    /// </summary>
    public static string ResolveExplicitReply(string currentStatus, string? requestedStatus)
    {
        if (!string.IsNullOrEmpty(requestedStatus))
        {
            if (Array.IndexOf(AllowedExplicitReplyStatuses, requestedStatus) < 0)
                throw new InvalidOperationException("status must be one of: in_progress / completed / blocked");
            return requestedStatus;
        }

        // S-280：已隐式完成的记录收到一条不带 status 的显式回执，说明目标确实干完了，
        // 只是补交回执。这里**必须**升级成 completed。若与 pending / sent 一起返回
        // acknowledged，等于把「跑完没回执」退回「刚确认收到」—— 那是降级，
        // 与「显式永远覆盖隐式」正好相反。
        if (IsImplicitCompletion(currentStatus))
            return GlobalTaskDispatchStatusValues.Completed;

        return currentStatus is GlobalTaskDispatchStatusValues.Pending
            or GlobalTaskDispatchStatusValues.Sent
            ? GlobalTaskDispatchStatusValues.Acknowledged
            : currentStatus;
    }

    /// <summary>
    /// S-280：目标会话跑完（那一轮结束了）却没有显式回执时，我们代标隐式完成。
    /// 已有显式结论（completed / blocked / failed / cancelled）的**绝不覆盖**。
    /// </summary>
    public static bool ShouldMarkImplicitCompletion(string? currentStatus)
    {
        return currentStatus is GlobalTaskDispatchStatusValues.Pending
            or GlobalTaskDispatchStatusValues.Sent
            or GlobalTaskDispatchStatusValues.Acknowledged
            or GlobalTaskDispatchStatusValues.InProgress;
    }

    /// <summary>可以主动取消的状态（终态不可取消，与既有 <c>Cancel</c> 行为一致）。</summary>
    public static bool CanCancel(string? currentStatus)
    {
        return !IsTerminal(currentStatus);
    }

    /// <summary>读取 snake_case 派活行里的 <c>status</c>；缺失或非字符串返回空串。</summary>
    public static string ReadStatus(JsonElement dispatchRow)
    {
        return dispatchRow.TryGetProperty("status", out var status)
            && status.ValueKind == JsonValueKind.String
            ? status.GetString() ?? string.Empty
            : string.Empty;
    }

    /// <summary>读取 snake_case 派活行里的 <c>latest_report</c>；缺失或 null 返回 null。</summary>
    public static string? ReadLatestReport(JsonElement dispatchRow)
    {
        return dispatchRow.TryGetProperty("latest_report", out var report)
            && report.ValueKind == JsonValueKind.String
            ? report.GetString()
            : null;
    }
}

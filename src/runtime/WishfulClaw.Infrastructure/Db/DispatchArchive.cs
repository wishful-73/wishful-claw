using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// S-280（v3-iter-5）：**统一的派活归档层** —— 一个入口覆盖两张派活表。
///
/// 背景：S-279 给普通消息派活建了 <c>gm_</c> 记录，但目标会话的 agent 拿不到 dispatchId
/// （普通消息的 wire 正文就是用户原话，不塞协议说明），所以它**不可能**显式回执。
/// 不代标的话，这些记录永远停在 pending，S-279 白建。
///
/// 三条硬规矩（老大 2026-10-30 定）：
/// <list type="number">
///   <item>标 <c>completed_implicit</c>，**不是** <c>completed</c>；</item>
///   <item>卡片必须写明「未显式回复」，不许把隐式完成伪装成显式完成；</item>
///   <item>显式永远覆盖隐式 —— 目标会话事后补一条显式回执必须能改写它
///         （由 <see cref="DispatchStatusMachine.IsTerminal"/> 保证：completed_implicit 不是终态）。</item>
/// </list>
///
/// 任务派活（<c>gd_</c>）与普通消息派活（<c>gm_</c>）走**同一个方法**，只是 List/Update 的实现
/// 按表不同 —— 状态流转本身一份，不复制粘贴。
///
/// 放在 Infrastructure 而不是 Agent：这里只做 DB 读写，不碰 run 上下文；放这儿测试不用引
/// 整个 Agent 工程。
/// </summary>
public static class DispatchArchive
{
    /// <summary>隐式完成时代填的 <c>latest_report</c> 文案。渲染端另有 status 判据，这行是给全局会话读的。</summary>
    public const string ImplicitCompletionReport = "（未显式回复）";

    /// <summary>
    /// 目标会话一轮**正常跑完**后，把它名下还没有显式结论的派活记录归档成
    /// <c>completed_implicit</c>。
    ///
    /// 只在正常完成时调用：用户取消 / 中断 / 报错时目标会话并没有干完，那些记录
    /// 该留在 pending，让全局会话看到「还没回执」，而不是被伪造成完成。
    /// </summary>
    /// <returns>本次被归档的记录条数（幂等：已归档的不会被重复计数）。</returns>
    public static int ArchiveImplicitCompletions(string? sessionId)
    {
        if (string.IsNullOrWhiteSpace(sessionId)) return 0;

        var archived = 0;
        archived += ArchiveTable(
            DispatchTableRouter.TaskDispatchTable,
            DbGlobalTaskDispatchTools.List,
            DbGlobalTaskDispatchTools.Update,
            sessionId);
        archived += ArchiveTable(
            DispatchTableRouter.MessageDispatchTable,
            DbGlobalMessageDispatchTools.List,
            DbGlobalMessageDispatchTools.Update,
            sessionId);
        return archived;
    }

    /// <summary>
    /// 一张表的归档过程。两张表共用这一份 —— 状态判据全部来自
    /// <see cref="DispatchStatusMachine.ShouldMarkImplicitCompletion"/>。
    /// </summary>
    private static int ArchiveTable(
        string tableName,
        Func<JsonElement, WorkerResponse> list,
        Func<JsonElement, WorkerResponse> update,
        string sessionId)
    {
        var listParams = WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("sessionId", sessionId);
            w.WriteEndObject();
        });

        if (!TryReadRows(list(listParams), out var rows, out var listError))
        {
            WorkerLog.Warn($"DispatchArchive: listing {tableName} failed: {listError}");
            return 0;
        }

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var archived = 0;
        foreach (var row in rows)
        {
            var dispatchId = row.TryGetProperty("id", out var idValue) && idValue.ValueKind == JsonValueKind.String
                ? idValue.GetString()
                : null;
            if (string.IsNullOrEmpty(dispatchId)) continue;

            var currentStatus = DispatchStatusMachine.ReadStatus(row);
            if (!DispatchStatusMachine.ShouldMarkImplicitCompletion(currentStatus)) continue;

            var updateParams = WorkerJsonHelper.BuildJsonElement(w =>
            {
                w.WriteStartObject();
                w.WriteString("id", dispatchId);
                w.WritePropertyName("patch");
                w.WriteStartObject();
                w.WriteString("status", GlobalTaskDispatchStatusValues.CompletedImplicit);
                w.WriteString("latestReport", ImplicitCompletionReport);
                w.WriteNumber("completedAt", now);
                w.WriteEndObject();
                w.WriteEndObject();
            });

            if (TryMutation(update(updateParams), out var updateError))
            {
                archived += 1;
            }
            else
            {
                WorkerLog.Warn(
                    $"DispatchArchive: archiving {dispatchId} in {tableName} failed: {updateError}");
            }
        }

        return archived;
    }

    private static bool TryReadRows(WorkerResponse response, out List<JsonElement> rows, out string? error)
    {
        rows = new List<JsonElement>();
        try
        {
            using var document = JsonDocument.Parse(response.ToJsonBytes(null));
            var root = document.RootElement;
            if (root.TryGetProperty("error", out var envelopeError))
            {
                error = envelopeError.GetString();
                return false;
            }

            var result = root.GetProperty("result");
            if (result.ValueKind != JsonValueKind.Array)
            {
                error = $"expected an array of dispatches, got {result.ValueKind}";
                return false;
            }

            foreach (var row in result.EnumerateArray())
            {
                if (row.ValueKind == JsonValueKind.Object) rows.Add(row.Clone());
            }

            error = null;
            return true;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
    }

    private static bool TryMutation(WorkerResponse response, out string? error)
    {
        try
        {
            using var document = JsonDocument.Parse(response.ToJsonBytes(null));
            var root = document.RootElement;
            if (root.TryGetProperty("error", out var envelopeError))
            {
                error = envelopeError.GetString();
                return false;
            }

            var result = root.GetProperty("result");
            if (result.ValueKind == JsonValueKind.Object
                && result.TryGetProperty("success", out var success)
                && !success.GetBoolean())
            {
                error = result.TryGetProperty("error", out var resultError)
                    ? resultError.GetString()
                    : "operation failed";
                return false;
            }

            error = null;
            return true;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
    }
}

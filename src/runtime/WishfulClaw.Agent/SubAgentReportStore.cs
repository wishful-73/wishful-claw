/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Buffers;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// 把子 agent 的最终报告写进 sub_agent_runs.data.finalOutput（S-36）。
///
/// 背景：子 agent 的流式文本转发绑在父 run 的 transport 上 —— 父 run 一旦 finalize，
/// transport 被 dispose，后续文本事件全部丢失，渲染端只能累积到父 run 死之前那点内容。
/// 唯一始终完整的是 SubAgentRunCollector.GetFinalOutput()（走 childState.EventObserver
/// 直连，不经过父 run transport）。把它写进库里，报告就与父 run 生死、与进程重启都解耦。
///
/// 写入策略：读-改-写，只覆盖自己管的两个键，其余字段原样保留（同一份 data 渲染端也在维护）。
/// 记录尚不存在时先插一条最小行，等渲染端 upsert 时补齐。
///
/// 尽力而为：任何失败只记日志，绝不向上抛 —— 落库失败不能影响子 agent 的正常返回。
/// </summary>
internal static class SubAgentReportStore
{
    private const string FinalOutputKey = "finalOutput";
    private const string FinalReportAtKey = "finalReportAt";

    public static void SaveFinalOutput(
        string toolUseId,
        string? sessionId,
        string agentName,
        string finalOutput,
        long completedAt,
        bool success)
    {
        if (string.IsNullOrWhiteSpace(toolUseId) || string.IsNullOrEmpty(finalOutput)) return;

        try
        {
            var db = DbClient.GetClient();
            var existingData = db.QueryScalar<string?>(
                "SELECT data FROM sub_agent_runs WHERE tool_use_id = @id",
                new SqliteParameter("@id", toolUseId));

            var mergedData = MergeFinalOutput(existingData, finalOutput, completedAt);

            if (existingData is null)
            {
                db.Execute(
                    "INSERT INTO sub_agent_runs (tool_use_id, session_id, agent_name, data, started_at, completed_at, success) " +
                    "VALUES (@tuid, @sid, @name, @data, @sa, @ca, @suc)",
                    new SqliteParameter("@tuid", toolUseId),
                    new SqliteParameter("@sid", sessionId ?? "_unknown"),
                    new SqliteParameter("@name", agentName),
                    new SqliteParameter("@data", mergedData),
                    new SqliteParameter("@sa", completedAt),
                    new SqliteParameter("@ca", completedAt),
                    new SqliteParameter("@suc", success ? 1 : 0));
            }
            else
            {
                db.Execute(
                    "UPDATE sub_agent_runs SET data = @data WHERE tool_use_id = @id",
                    new SqliteParameter("@data", mergedData),
                    new SqliteParameter("@id", toolUseId));
            }
        }
        catch (Exception ex)
        {
            WorkerLog.Warn(
                $"sub-agent final report persist failed toolUseId={toolUseId} " +
                $"error={ex.GetType().Name}: {ex.Message}");
        }
    }

    /// <summary>
    /// 在现有 data JSON 上覆盖 finalOutput / finalReportAt，其余键原样透传。
    /// 旧值不是 JSON 对象时（被外部改坏或为空）只写这两个键，不抛异常。
    /// internal 以便回归测试直接覆盖这段纯逻辑。
    /// </summary>
    internal static string MergeFinalOutput(string? existingData, string finalOutput, long completedAt)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();

            if (!string.IsNullOrWhiteSpace(existingData))
            {
                try
                {
                    using var doc = JsonDocument.Parse(existingData);
                    if (doc.RootElement.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var prop in doc.RootElement.EnumerateObject())
                        {
                            if (prop.Name == FinalOutputKey || prop.Name == FinalReportAtKey) continue;
                            prop.WriteTo(writer);
                        }
                    }
                }
                catch (JsonException)
                {
                    // 旧值坏了就当没有；下面补上自己的键即可。
                }
            }

            writer.WriteString(FinalOutputKey, finalOutput);
            writer.WriteNumber(FinalReportAtKey, completedAt);
            writer.WriteEndObject();
        }

        return System.Text.Encoding.UTF8.GetString(buffer.WrittenSpan);
    }
}

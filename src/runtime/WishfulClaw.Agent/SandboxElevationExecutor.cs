using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Agent.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// RequestSandboxElevation 执行器（S-207）：agent 主动申请「临时关闭沙箱模式」。
///
/// 与 AskUser 同族 —— 都是 reverse-request 交互类工具：Worker 发一条反向请求，桌面端弹窗、
/// 渠道端走文字审批，用户裁决后回传 <c>approved</c>。区别只有两点：
/// ① 工作台/渠道都没有可点的地方时它就是一次纯文本往返，渠道端由渲染端自己把请求文本发回渠道；
/// ② 批准后写的是 <see cref="SandboxElevationStore"/>（进程级豁免），不是会话内状态。
///
/// 状态是进程级而非 run 级的理由见 <see cref="SandboxElevationStore"/>：用户批准的是这台机器上
/// 的一个决定，与哪一次 run 无关。
/// </summary>
internal static class AgentRuntimeSandboxElevationExecutor
{
    private const string SandboxElevationToolName = "RequestSandboxElevation";

    public static bool IsSandboxElevationTool(string toolName)
    {
        return string.Equals(toolName, SandboxElevationToolName, StringComparison.Ordinal);
    }

    public static async Task<RendererToolResult> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        JsonElement parameters,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        // 已经有豁免：别重复弹窗，直接告诉模型可以继续。模型可能因为工具列表里的描述
        // 而多调一次，这里短路掉，免得用户被同一个请求连点两遍。
        if (SandboxElevationStore.IsActive())
        {
            var remaining = SandboxElevationStore.RemainingMinutes();
            var already = $"Sandbox mode is already temporarily off on this machine (about {remaining} minute(s) left). " +
                "Continue with the operation you were trying to do.";
            return new RendererToolResult(CreateStringElement(already), false, null);
        }

        var request = BuildRequest(call, parameters);

        var response = await AgentRuntimeReverseRequests.RequestAsync(
            context,
            "sandbox/elevation-request",
            request,
            cancellationToken);

        if (response.ValueKind == JsonValueKind.Object &&
            response.TryGetProperty("approved", out var approved) &&
            approved.ValueKind == JsonValueKind.True)
        {
            var until = SandboxElevationStore.Grant();
            // 审计：放行是安全面的关键动作，必须留痕（"恢复"方向 AgentRuntimeTools 里已经记了，
            // 只记撤销不记放行等于漏掉最该看的那一条）。
            WorkerLog.Info(
                $"sandbox elevation granted: session={JsonHelpers.GetString(parameters, "sessionId") ?? "-"} " +
                $"run={JsonHelpers.GetString(parameters, "runId") ?? "-"} " +
                $"until={DateTimeOffset.FromUnixTimeMilliseconds(until).ToLocalTime():yyyy-MM-dd HH:mm:ss} " +
                $"reason={JsonHelpers.GetString(parameters, "reason") ?? "-"}");
            var remaining = SandboxElevationStore.RemainingMinutes();
            var granted = $"The user approved temporarily turning sandbox mode off for 1 hour " +
                $"(about {remaining} minute(s) left). You can now access paths outside the working directories " +
                "on this machine. Sandbox mode turns back on automatically when the hour is up, and the user can " +
                "also turn it back on at any time. Continue with the operation you were trying to do.";
            return new RendererToolResult(CreateStringElement(granted), false, null);
        }

        // 未批准 / 缺字段 / 超时（渲染端把超时也回成 approved:false）都走这条：这是预期内的拒绝，
        // 不是故障 —— 文案自己说清了处境和出路，交给模型读。
        const string denied = "The user did not approve turning sandbox mode off. Sandbox mode is still on, " +
            "so paths outside the allowed working directories are still rejected. " +
            "Pick a path inside an allowed directory, or ask the user to approve a temporary elevation first.";
        return new RendererToolResult(CreateStringElement(EncodeError(denied)), true, denied);
    }

    /// <summary>
    /// 组装反向请求。字段与渲染端 <c>SandboxElevationRequest</c> 对齐：toolUseId / sessionId /
    /// runId / reason / channelSession。
    ///
    /// <c>channelSession</c> 必须由 Worker 带过来：渲染端要靠它决定"弹窗"还是"发渠道文字"，
    /// 而它是对 run params 的判定（<see cref="AgentRunContextPolicy.IsChannelSession"/>），
    /// 渲染端拿不到 run params。用 Utf8JsonWriter 手写而不是 <c>JsonSerializer</c>：
    /// 匿名类型经反射序列化在 AOT 打包下不可靠，本项目一律走 writer。
    /// </summary>
    /// <remarks>
    /// <c>internal</c> 而非 <c>private</c>：请求包的形状本身就是这条工具最容易出错的地方
    /// （S-207 真机报错 <c>CannotWritePropertyWithinArray</c>，根因是漏了 StartObject/EndObject），
    /// 得让回归套件能直接断言它。
    /// </remarks>
    internal static JsonElement BuildRequest(AgentRuntimeNativeToolCall call, JsonElement parameters)
    {
        return WorkerJsonHelper.BuildJsonElement(writer =>
        {
            // BuildJsonElement 只负责建 writer，不给外壳：这里必须自己成对写
            // StartObject/EndObject，否则第一个 token 就是属性名，Utf8JsonWriter 直接抛
            // "Cannot write a JSON property ... as the first JSON token"（AOT 裁剪后资源串
            // 丢失，只剩 CannotWritePropertyWithinArray 这个键名，极难认）。
            writer.WriteStartObject();
            writer.WriteString("toolUseId", call.Id);
            WriteNullableString(writer, "sessionId", JsonHelpers.GetString(parameters, "sessionId"));
            WriteNullableString(writer, "runId", JsonHelpers.GetString(parameters, "runId"));
            WriteNullableString(writer, "reason", JsonHelpers.GetString(parameters, "reason"));
            if (AgentRunContextPolicy.IsChannelSession(parameters))
            {
                writer.WriteBoolean("channelSession", true);
            }
            writer.WriteEndObject();
        });
    }

    private static void WriteNullableString(Utf8JsonWriter writer, string name, string? value)
    {
        if (!string.IsNullOrEmpty(value))
        {
            writer.WriteString(name, value);
        }
    }

    private static JsonElement CreateStringElement(string value)
    {
        using var document = JsonDocument.Parse($"\"{value.Replace("\\", "\\\\").Replace("\"", "\\\"")}\"");
        return document.RootElement.Clone();
    }

    private static string EncodeError(string message)
    {
        // 与 AskUserAnswerBuilder.EncodeError 同形：产出 {"error":"..."} 的 JSON 文本，
        // 外层再被 CreateStringElement 包成字符串内容。
        return WorkerJsonHelper.BuildJsonString(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("error", message);
            writer.WriteEndObject();
        });
    }
}

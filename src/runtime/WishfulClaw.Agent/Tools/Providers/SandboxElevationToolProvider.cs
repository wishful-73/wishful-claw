using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers the RequestSandboxElevation tool definition (S-207).
/// Execution: ToolDispatchRouter → AgentRuntimeSandboxElevationExecutor (reverse-request to renderer).
/// </summary>
public sealed class SandboxElevationToolProvider : IToolProvider
{
    public string Category => "sandbox";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "RequestSandboxElevation",
            "Ask the user to temporarily turn sandbox mode off (for 1 hour) when the sandbox is blocking a path you genuinely need. " +
            "Use it only after a path was rejected as outside the working directories and the path really is one the user wants you to reach. " +
            "It takes effect only if the user approves; do not call it to bypass the sandbox casually, and do not spam it.",
            // 无参数：申请就是申请，理由由系统上下文（越界的那次工具调用）自然带出，不让模型编参数。
            ToolSchemaBuilder.Object(new(), []),
            // 可见范围内联写、不动 ToolVisibilityScopes：桌面（chat / cowork）弹窗，渠道也要能申请
            // （渠道裁决由渲染端回退成文字审批，不是弹窗，所以不能直接用 HumanAttended —— 那个集合
            // 会把渠道会话排除掉，渠道就永远申请不了）。
            visibleScopes: ["*:chat@*", "*:cowork@*", "*:channel@*"],
            // 子 agent / 后台自动化不给：没人能当场裁决，工具只会挂在那儿等一个不会来的批准。
            excludedScopes: ToolVisibilityScopes.UnattendedRoles));
    }
}

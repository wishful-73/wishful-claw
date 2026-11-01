using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers the dispatch-reply tool for target project sessions (normal/goal).
/// When the global agent dispatches work (<c>[GLOBAL AGENT WORK REQUEST]</c>) or sends a
/// plain message (<c>[GLOBAL SESSION MESSAGE]</c>), the target session agent uses
/// reply_global_dispatch to report its explicit result, blocker or follow-up
/// question back to the global agent. Execution: ToolDispatchRouter ->
/// AgentRuntimeGlobalDispatchReplyExecutor.
///
/// 2026-10-31（S-279 收尾）：普通消息现在也带 dispatch_id 了（以前只带渲染端 meta，
/// 模型侧拿不到 id ⇒ 结构上回不了）。所以描述里那句「Do not use it for ordinary
/// user messages」必须去掉 —— 它会让模型主动拒绝回普通消息。
/// </summary>
public sealed class GlobalDispatchReplyToolProvider : IToolProvider
{
    public string Category => "global-dispatch-reply";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "reply_global_dispatch",
            "Report the outcome of a dispatch from the global agent back to it. Use it when a message in " +
            "this conversation starts with [GLOBAL AGENT WORK REQUEST] or [GLOBAL SESSION MESSAGE]: " +
            "after finishing, when blocked, or when the global agent asks you a question. The report is " +
            "recorded on the dispatch and delivered to the global session. Do not use it for messages the " +
            "user typed themselves.",
            ToolSchemaBuilder.Object(
                new Dictionary<string, System.Text.Json.JsonElement>
                {
                    ["dispatchId"] = ToolSchemaBuilder.String(
                        "The dispatch_id from the [GLOBAL AGENT WORK REQUEST] or [GLOBAL SESSION MESSAGE] header."),
                    ["report"] = ToolSchemaBuilder.String(
                        "Clear, self-contained result summary, blocker description or follow-up question."),
                    ["status"] = ToolSchemaBuilder.String(
                        "Optional outcome: in_progress (still working) / completed (work done) / " +
                        "blocked (cannot proceed). Omit to only acknowledge the request.")
                },
                ["dispatchId", "report"]),
                availableModes: new[] { "normal", "goal" },
                visibleScopes: ["project:chat@*", "*:cowork@*"]));
    }
}

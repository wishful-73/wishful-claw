using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers the dispatch-reply tool for target project sessions (normal/goal).
/// When the global agent sends a work request, the target session agent uses
/// reply_global_dispatch to report its explicit result, blocker or follow-up
/// question back to the global agent. Execution: ToolDispatchRouter ->
/// AgentRuntimeGlobalDispatchReplyExecutor.
/// </summary>
public sealed class GlobalDispatchReplyToolProvider : IToolProvider
{
    public string Category => "global-dispatch-reply";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "reply_global_dispatch",
            "Report the outcome of a global agent work request back to the global agent. Use it when a " +
            "message in this conversation starts with [GLOBAL AGENT WORK REQUEST]: after finishing, when " +
            "blocked, or when you need to answer a follow-up question from the global agent. The report " +
            "is recorded on the dispatch and delivered to the global session. Do not use it for ordinary " +
            "user messages.",
            ToolSchemaBuilder.Object(
                new Dictionary<string, System.Text.Json.JsonElement>
                {
                    ["dispatchId"] = ToolSchemaBuilder.String(
                        "The dispatch_id from the [GLOBAL AGENT WORK REQUEST] message."),
                    ["report"] = ToolSchemaBuilder.String(
                        "Clear, self-contained result summary, blocker description or follow-up question."),
                    ["status"] = ToolSchemaBuilder.String(
                        "Optional outcome: in_progress (still working) / completed (work done) / " +
                        "blocked (cannot proceed). Omit to only acknowledge the request.")
                },
                ["dispatchId", "report"]),
                availableModes: new[] { "normal", "goal" }));
    }
}

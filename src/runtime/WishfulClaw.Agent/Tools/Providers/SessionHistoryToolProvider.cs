using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// S-301: the agent reading back what the <b>user</b> said in <b>this</b> session.
///
/// <para>Why it exists: context compression drops early user turns out of the window, so an
/// agent that has run for a while starts re-asking things the user already settled. This tool
/// pulls the user's own words back out of the DB. It is deliberately <b>user side only</b> —
/// the assistant's own replies are what its memory and summaries are for.</para>
///
/// <para>Execution: ToolDispatchRouter -> AgentRuntimeSessionHistoryExecutor. The session id
/// comes from the run state, never from the model's tool input — see that executor's note.</para>
/// </summary>
public sealed class SessionHistoryToolProvider : IToolProvider
{
    public string Category => "session-history";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "list_user_messages",
            "Read back what the USER said in THIS session — including turns that have already " +
            "dropped out of your context through compression. Use it before asking the user to " +
            "repeat a decision, a preference or an instruction they gave earlier. " +
            "Returns only the user's own messages (never your replies, never tool output), each with " +
            "a timestamp and an attachment summary (images / pasted text). " +
            "Scope is fixed to this session; it cannot read other sessions. " +
            "Pass date (YYYY-MM-DD, the user's local day) to list one day, or omit it for the most " +
            "recent messages across days.",
            ToolSchemaBuilder.Object(
                new Dictionary<string, System.Text.Json.JsonElement>
                {
                    ["date"] = ToolSchemaBuilder.String(
                        "Optional single day to list, as YYYY-MM-DD in the user's local time zone. " +
                        "Omit to get the most recent messages regardless of day."),
                    ["limit"] = ToolSchemaBuilder.Number(
                        "Optional maximum number of messages. Defaults to 50, clamped to 1-200.")
                },
                []),
            availableModes: null,
            visibleScopes: ToolVisibilityScopes.GlobalSideAndWorkRuns));
    }
}

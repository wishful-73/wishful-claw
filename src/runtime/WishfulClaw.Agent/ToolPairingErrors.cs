namespace WishfulClaw.Agent;

/// <summary>
/// 识别上游因「工具调用没配对」而拒绝请求的错误。
///
/// 触发场景：assistant 消息带着工具调用，但紧随其后没有对应的结果消息。
/// 常驻会话里一旦留下这种悬空调用，之后每次请求都会被上游以 HTTP 400 拒绝，
/// 只有把缺失的结果补上才能恢复（见 SessionConversation.RepairToolPairing）。
///
/// 各家 provider 的文案不同（OpenAI 系说 tool_calls / tool_call_id，Anthropic 系说
/// tool_use / tool_result），所以按特征串并集匹配，不锚定某一家。
///
/// 判定刻意保守：只认「明确在讲配对」的文案。其它 400 一律不匹配 ——
/// 自 S-237（2026-10-27）起 400 本身已不进重试（`ProviderRetryPolicy.IsRetryableStatus`
/// 只认 429 / 5xx），所以这里截不走的那些 400 会直接报错给用户；
/// 而这里认出来的，走 AgentLoop 的配对修复分支修完再发一次。
/// </summary>
internal static class ToolPairingErrors
{
    private static readonly string[] Markers =
    [
        // OpenAI 及兼容中转（实测：Console Go 中转返回这条）
        "must be followed by tool messages",
        "insufficient tool messages following tool_calls",
        // OpenAI：孤立的 tool 消息（结果在、调用不在）
        "must be a response to a preceding message with 'tool_calls'",
        // Anthropic：tool_use 没有对应的 tool_result。注意它的文案把标识符用反引号包起来
        //（`tool_use` / `tool_result`），所以特征串不能跨过标识符本身去匹配。
        "ids were found without",
        // 通用措辞
        "tool_calls must be followed"
    ];

    internal static bool IsToolPairingError(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            if (string.IsNullOrEmpty(current.Message))
            {
                continue;
            }

            foreach (var marker in Markers)
            {
                if (current.Message.Contains(marker, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
        }

        return false;
    }
}

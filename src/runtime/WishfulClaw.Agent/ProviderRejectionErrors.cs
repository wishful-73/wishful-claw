namespace WishfulClaw.Agent;

/// <summary>
/// 识别上游因「请求体本身有问题」而拒绝的错误（S-262）。
///
/// **为什么需要这一层。** S-236 / S-246 / S-261 只把「图像不吃」「工具没配对」「上下文超限」
/// 三种 400 归了因。剩下那些认不出原因的 400 一律直接抛，run 当场终止 —— 用户看到的是
/// 「这个会话废了」，而模型全程不知道自己做错了什么。
///
/// 本类只负责**判定与取料**，不含任何修复动作：
/// <list type="number">
/// <item><see cref="IsRequestRejected"/> —— 这是不是一个 400；</item>
/// <item><see cref="Describe"/> —— 报文原文（给模型看、给日志看、给提示看）；</item>
/// <item><see cref="Fingerprint"/> —— 报文指纹，用来判「这次和上次是不是同一个错」。</item>
/// </list>
///
/// **判据不认文案，只认状态码。** 三条 provider 主链路（<c>OpenAIChatProvider.Sse</c> /
/// <c>OpenAIResponsesProvider</c> / <c>AnthropicMessagesProvider</c>）失败时全部经
/// <c>ProviderHttpException.CreateAsync</c> 抛错，异常自带 <c>StatusCode</c>。这比 S-261
/// 那套 marker 表硬得多 —— marker 会漏词形，状态码不会。
///
/// **为什么不把 429 / 5xx 也算进来。** 那两类由 <see cref="ProviderRetryPolicy"/> 用同一条
/// 请求重试，语义是「稍后再试」；本类处理的是「这条请求本身就发不出去」，语义是「改请求」。
/// 混在一起会让重试策略失去意义。
/// </summary>
internal static class ProviderRejectionErrors
{
    /// <summary>HTTP 400 —— 请求体被拒。</summary>
    internal const int RejectedStatusCode = 400;

    /// <summary>
    /// 报文带进对话 / 日志 / 事件的最大长度。与 <c>ProviderRetryPolicy.UsageLog</c> 的
    /// 请求明细口径一致（那里也是 500），免得同一条错误在两个地方长短不一。
    /// </summary>
    internal const int MaxReportedLength = 500;

    /// <summary>
    /// 指纹取报文归一化后的前多少字符。取 120 是因为各家 400 报文的有效信息（哪一个字段、
    /// 哪一条消息、为什么不行）基本都在这段里，后面的堆栈式补充可有可无。
    /// </summary>
    private const int FingerprintLength = 120;

    /// <summary>
    /// 异常链上有没有一个 400。遍历 <c>InnerException</c>：provider 可能把 HTTP 异常
    /// 包一层业务异常再抛，只看最外层会漏。
    /// </summary>
    internal static bool IsRequestRejected(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            if (current is ProviderHttpException { StatusCode: RejectedStatusCode })
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// 取 400 的报文原文（截断到 <see cref="MaxReportedLength"/>）。
    ///
    /// 优先取 <see cref="ProviderHttpException"/> 自己的 Message —— 它的格式是
    /// <c>{providerName} request failed HTTP 400: {responseBody}</c>，provider 名一并留着，
    /// 用户在多渠道之间切换时能立刻看出是哪个渠道在闹。找不到 400 时退回最内层异常的
    /// Message，保证调用方永远拿到非空字符串。
    /// </summary>
    internal static string Describe(Exception exception)
    {
        string? message = null;
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            if (current is ProviderHttpException { StatusCode: RejectedStatusCode })
            {
                message = current.Message;
                break;
            }
        }

        message ??= exception.GetBaseException().Message;
        message = message?.Trim() ?? string.Empty;

        return message.Length <= MaxReportedLength
            ? message
            : string.Concat(message.AsSpan(0, MaxReportedLength), "…");
    }

    /// <summary>
    /// 报文指纹：只保留字母与汉字，去掉空白、标点、数字，转小写后截断。
    ///
    /// 去掉数字是**故意的**：上游报错常把索引写进正文（<c>.messages[477].image[0]</c>）。
    /// 如果索引算进指纹，那么「把第 477 条修掉、换成第 478 条出问题」会被当成新问题，
    /// 于是又烧一次请求 —— 而它其实是同一个毛病在下一处复发。
    ///
    /// 空报文返回空串，调用方据此跳过指纹比对（空 == 空 会误判成「同一错误」）。
    /// </summary>
    internal static string Fingerprint(string? report)
    {
        if (string.IsNullOrEmpty(report)) return string.Empty;

        var buffer = new System.Text.StringBuilder(FingerprintLength);
        foreach (var ch in report)
        {
            if (char.IsWhiteSpace(ch) || char.IsDigit(ch)) continue;
            if (char.IsPunctuation(ch) || char.IsSymbol(ch)) continue;

            buffer.Append(char.ToLowerInvariant(ch));
            if (buffer.Length >= FingerprintLength) break;
        }

        return buffer.ToString();
    }
}

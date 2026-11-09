using System.Net.Http;
using WishfulClaw.Agent.Llm;
using WishfulClaw.Agent;

namespace WishfulClaw.ProviderHeaderRegressionTests;

/// <summary>
/// S-304（2026-11-02）：流式响应中途断连必须重试。
///
/// 生产现场（2026-11-02 15:35:38）：
///   agent run failed runId=wc-agent-... error=HttpIOException:
///   net_http_invalid_response_premature_eof (ResponseEnded)
/// 那个 run 从 15:12 就在跑工具，断流时 UI 上早已一大片输出，却直接整轮失败。
///
/// 根因不是「守卫太严」，而是**类型认错**：两个 provider 与 ProviderCompletionService
/// 都只 catch HttpRequestException，而 .NET 对流中途断流抛的是 HttpIOException
/// （HttpRequestError.ResponseEnded），它继承 IOException，与 HttpRequestException
/// 毫无关系 —— 三处一个都捕不到。
///
/// 所以这里钉两件事：
///   1. 判定函数必须认这两种类型；
///   2. 判定**不能过宽**（裸 IOException 会误伤文件 IO，取消不能被当成重试）。
/// 第二条是防「修复时顺手改成 catch (IOException)」。
/// </summary>
internal static class TransportRetryChecks
{
    public static void Run()
    {
        AssertTypeRelations();
        AssertRetryable();
        AssertNotRetryable();
        Console.WriteLine("Transport retry checks passed (S-304).");
    }

    /// <summary>
    /// 根因固化：这两种异常没有继承关系。若将来有人把它们合并成一个 catch 分支，
    /// 或误以为 HttpIOException 是 HttpRequestException 的子类，这里会先红。
    /// </summary>
    private static void AssertTypeRelations()
    {
        Assert(
            !typeof(HttpRequestException).IsAssignableFrom(typeof(HttpIOException)),
            "HttpIOException is NOT a HttpRequestException — this is why the old catch never fired");
        Assert(
            typeof(IOException).IsAssignableFrom(typeof(HttpIOException)),
            "HttpIOException derives from IOException");
    }

    private static void AssertRetryable()
    {
        // 生产现场那一例。
        AssertRetryableTransportError(
            new HttpIOException(HttpRequestError.ResponseEnded, "net_http_invalid_response_premature_eof"),
            "ResponseEnded (the production failure) is retryable");

        // 同族的协议层断连，一并覆盖。
        AssertRetryableTransportError(
            new HttpIOException(HttpRequestError.InvalidResponse, "net_http_invalid_response"),
            "InvalidResponse is retryable");

        // 原本就认的那一类，别在修的过程中丢掉。
        AssertRetryableTransportError(
            new HttpRequestException("connection reset"),
            "HttpRequestException stays retryable");

        // 包装过的也要认（GetBaseException 场景下外层可能是它自己）。
        AssertRetryableTransportError(
            new HttpIOException(HttpRequestError.ResponseEnded, "wrapped", new IOException("socket closed")),
            "HttpIOException with an inner exception is retryable");
    }

    private static void AssertNotRetryable()
    {
        // 裸 IOException 必须拒绝：文件读写、管道、数据目录都用它，
        // 把它们拖进重试路径会变成静默死循环。
        AssertNotRetryableTransportError(
            new IOException("disk full"),
            "bare IOException is NOT retryable (would swallow file IO)");

        // 用户取消不是故障，重试会违背用户意图。
        AssertNotRetryableTransportError(
            new OperationCanceledException(),
            "cancellation is NOT retryable");

        // 真 4xx 类业务错误与网络无关。
        AssertNotRetryableTransportError(
            new InvalidOperationException("bad request body"),
            "InvalidOperationException is NOT retryable");
    }

    private static void AssertRetryableTransportError(Exception ex, string message)
    {
        Assert(ProviderRetryPolicy.IsRetryableTransportError(ex), message);
    }

    private static void AssertNotRetryableTransportError(Exception ex, string message)
    {
        Assert(!ProviderRetryPolicy.IsRetryableTransportError(ex), message);
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException($"Assertion failed: {message}");
        }
    }
}

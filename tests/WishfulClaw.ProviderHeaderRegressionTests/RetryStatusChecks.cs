using WishfulClaw.Agent;

namespace WishfulClaw.ProviderHeaderRegressionTests;

/// <summary>
/// S-237（2026-10-27）：400 退出盲目重试。
///
/// 之前的判据是 "400 / 429 / 5xx 都可重试"，理由是「有服务商把过载报成 400」。
/// 现在两件事把它否掉了：
///   1. 渠道限流一律回 429（商汤 token plan 实测 13 次限流全是 429，一次 400 都没有）；
///   2. 日志里 74 条 400 全是真错误，重试只是把同一个错误重发十几遍、烧掉十几分钟。
///
/// 400 里真正值得「修完再发一次」的三类（上下文超限 / 工具配对错 / 不吃图像输入）
/// 走 AgentLoop 的错误驱动分支，不经过这里 —— 所以下面同时断言「别再退回去」。
/// </summary>
internal static class RetryStatusChecks
{
    public static void Run()
    {
        // 收紧面：400 一律不重试。
        Assert(!ProviderRetryPolicy.IsRetryableStatus(400), "HTTP 400 is no longer retryable (S-237)");

        // 保留面：限流与上游故障照旧重试。
        Assert(ProviderRetryPolicy.IsRetryableStatus(429), "HTTP 429 rate limit stays retryable");
        Assert(ProviderRetryPolicy.IsRetryableStatus(500), "HTTP 500 stays retryable");
        Assert(ProviderRetryPolicy.IsRetryableStatus(502), "HTTP 502 stays retryable");
        Assert(ProviderRetryPolicy.IsRetryableStatus(503), "HTTP 503 stays retryable");
        Assert(ProviderRetryPolicy.IsRetryableStatus(504), "HTTP 504 stays retryable");

        // 其余 4xx 也是真错误 —— 请求体一个字没变，重发只是再拿一次同样的拒绝。
        Assert(!ProviderRetryPolicy.IsRetryableStatus(401), "HTTP 401 (bad key) is not retryable");
        Assert(!ProviderRetryPolicy.IsRetryableStatus(403), "HTTP 403 is not retryable");
        Assert(!ProviderRetryPolicy.IsRetryableStatus(404), "HTTP 404 (unknown model) is not retryable");
        Assert(!ProviderRetryPolicy.IsRetryableStatus(422), "HTTP 422 is not retryable");

        Console.WriteLine("Retry status checks passed (S-237).");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException($"Assertion failed: {message}");
        }
    }
}

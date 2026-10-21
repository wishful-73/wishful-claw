namespace WishfulClaw.Agent.Tools;

/// <summary>
/// 「临时关闭沙箱」的豁免状态（S-207）。
///
/// 只存一个到期时间戳，0 表示没有豁免。
///
/// 状态刻意做成**进程级、不是 run 级**：用户批准的是「在这台机器上临时关掉沙箱」这一个决定，
/// 而不是「放行某一次运行」。沙箱边界本来就是机器维度的（根集合是这台机器上的目录），
/// 用户按下批准时脑子里想的也是"接下来一小时别再拦我"，所以所有会话共用同一份豁免；
/// 到期（<see cref="DurationSeconds"/> 固定 1 小时）自动失效，用户也可以随时手动
/// <see cref="Clear"/>（渲染端「恢复」按钮 → Worker 的 sandbox/clear-elevation）。
///
/// 用 <see cref="Volatile"/> 读写：申请在执行工具的线程、判定在任意工具调用线程、
/// 清除在 IPC 线程，三处并发，必须保证可见性。
/// </summary>
public static class SandboxElevationStore
{
    /// <summary>一次申请放行多久：固定 1 小时。渲染端倒计时用它换算（60 * 60 * 1000 ms）。</summary>
    public const int DurationSeconds = 60 * 60;

    private static long _untilUnixMs; // 0 = 无豁免

    /// <summary>到期时刻（Unix 毫秒）；0 表示无豁免。</summary>
    public static long UntilUnixMs => Volatile.Read(ref _untilUnixMs);

    /// <summary>当前是否有未到期的豁免。</summary>
    public static bool IsActive()
    {
        var until = Volatile.Read(ref _untilUnixMs);
        return until > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    /// <summary>写入 now + <see cref="DurationSeconds"/>，返回到期时刻（Unix 毫秒）。</summary>
    public static long Grant()
    {
        var until = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + DurationSeconds * 1000L;
        Volatile.Write(ref _untilUnixMs, until);
        return until;
    }

    /// <summary>剩余整分钟数（向上取整）；无豁免或已到期返回 0。</summary>
    public static int RemainingMinutes()
    {
        var remainingMs = Volatile.Read(ref _untilUnixMs) - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (remainingMs <= 0)
        {
            return 0;
        }

        return (int)((remainingMs + 59_999L) / 60_000L);
    }

    /// <summary>立即清零豁免（用户手动恢复 / 渲染端通知）。</summary>
    public static void Clear() => Volatile.Write(ref _untilUnixMs, 0);
}

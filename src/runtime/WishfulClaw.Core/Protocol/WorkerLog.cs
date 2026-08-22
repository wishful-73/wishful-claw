namespace WishfulClaw.Core.Protocol;

using System.Globalization;

public static class WorkerLog
{
    private const int DefaultSlowRequestMs = 750;

    /// <summary>
    /// High-frequency polling methods whose success logs would flood the
    /// console (the goal panel polls goal/live every second). Failures and
    /// slow requests for these methods are still logged.
    /// </summary>
    private static readonly HashSet<string> SilentPollingMethods = new(StringComparer.Ordinal)
    {
        "goal/live"
    };

    public static bool DebugEnabled { get; } = ResolveDebugEnabled();

    public static int SlowRequestMs { get; } = ResolveSlowRequestMs();

    /// <summary>
    /// Minimum log level. Levels: DEBUG=0, INFO=1, WARN=2, ERROR=3.
    /// Default is WARN (production). Set WISHFUL_CLAW_LOG_LEVEL=info or debug for more verbosity.
    /// </summary>
    public static int MinLevel { get; } = ResolveLogLevel();

    public const int LevelDebug = 0;
    public const int LevelInfo = 1;
    public const int LevelWarn = 2;
    public const int LevelError = 3;

    public static void Info(string message)
    {
        if (MinLevel <= LevelInfo)
            Write("INFO", message);
    }

    public static void Warn(string message)
    {
        if (MinLevel <= LevelWarn)
            Write("WARN", message);
    }

    public static void Error(string message)
    {
        if (MinLevel <= LevelError)
            Write("ERROR", message);
    }

    public static void Debug(string message)
    {
        if (MinLevel <= LevelDebug)
            Write("DEBUG", message);
    }

    public static void RequestCompleted(
        string method,
        string id,
        long elapsedMs,
        int requestBytes,
        int responseBytes,
        Exception? error)
    {
        if (error is not null)
        {
            Warn(
                $"request failed id={id} method={method} elapsedMs={elapsedMs} " +
                $"requestBytes={requestBytes} responseBytes={responseBytes} " +
                $"error={error.GetType().Name}: {error.Message}");
            return;
        }

        var message =
            $"request ok id={id} method={method} elapsedMs={elapsedMs} " +
            $"requestBytes={requestBytes} responseBytes={responseBytes}";

        if (elapsedMs >= SlowRequestMs)
        {
            Warn($"slow {message}");
            return;
        }

        // High-frequency polls: success is the expected steady state — logging
        // every tick would drown the console. Only failures/slow calls log.
        if (SilentPollingMethods.Contains(method))
        {
            return;
        }

        Debug(message);
    }

    private static void Write(string level, string message)
    {
        Console.Error.WriteLine(
            $"[WishfulClawWorker][{DateTimeOffset.Now.ToString("O", CultureInfo.InvariantCulture)}][{level}] {message}");
    }

    private static bool ResolveDebugEnabled()
    {
        return ReadBooleanEnvironment("WISHFUL_CLAW_DEBUG") ?? false;
    }

    private static int ResolveSlowRequestMs()
    {
        var raw = Environment.GetEnvironmentVariable("WISHFUL_CLAW_SLOW_MS");
        return int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) &&
            value > 0
                ? value
                : DefaultSlowRequestMs;
    }

    /// <summary>
    /// Resolve min log level from WISHFUL_CLAW_LOG_LEVEL env var.
    /// Default: warn (production — only warnings and errors).
    /// </summary>
    private static int ResolveLogLevel()
    {
        // WISHFUL_CLAW_DEBUG=true is shorthand for log level=debug (backward compat)
        if (DebugEnabled)
            return LevelDebug;

        var raw = Environment.GetEnvironmentVariable("WISHFUL_CLAW_LOG_LEVEL");
        return raw?.Trim().ToLowerInvariant() switch
        {
            "debug" or "0" => LevelDebug,
            "info" or "1" => LevelInfo,
            "warn" or "warning" or "2" => LevelWarn,
            "error" or "3" => LevelError,
            _ => LevelWarn // default: production
        };
    }

    private static bool? ReadBooleanEnvironment(string name)
    {
        var raw = Environment.GetEnvironmentVariable(name);
        if (raw is null)
        {
            return null;
        }

        return raw.Trim().ToLowerInvariant() switch
        {
            "1" or "true" or "yes" or "on" => true,
            "0" or "false" or "no" or "off" => false,
            _ => null
        };
    }
}

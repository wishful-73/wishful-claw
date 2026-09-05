namespace WishfulClaw.Agent;

public static partial class ContextCompression
{
    private static readonly string[] ContextWindowExceededMarkers =
    [
        "context_length_exceeded",
        "context length exceeded",
        "exceeds the context window",
        "context window of this model",
        "maximum context length",
        "prompt is too long",
        "exceed context limit",
        "exceeds the maximum number of tokens",
        "input token count exceeds"
    ];

    internal static bool IsContextWindowExceededError(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            if (string.IsNullOrEmpty(current.Message))
            {
                continue;
            }

            foreach (var marker in ContextWindowExceededMarkers)
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

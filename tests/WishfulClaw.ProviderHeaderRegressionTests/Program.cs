using System.Net.Http;
using System.Text.Json;
using WishfulClaw.Agent;

namespace WishfulClaw.ProviderHeaderRegressionTests;

internal static class Program
{
    public static int Main()
    {
        try
        {
            RunGateSuite();
            RunOverrideSuite();
            Console.WriteLine("Provider header regression checks passed.");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Provider header regression test failed: {ex}");
            return 1;
        }
    }

    private static void RunGateSuite()
    {
        AssertHeaders("opencode-go", "session-123", "session-123", "exact opencode-go gate injects the session header");
        AssertHeaders(null, "session-123", null, "missing builtin id does not inject the session header");
        AssertHeaders("opencode", "session-123", null, "opencode Zen does not inject the session header");
        AssertHeaders("anthropic", "session-123", null, "anthropic does not inject the session header");
        AssertHeaders("OpenCode-Go", "session-123", null, "case variant does not inject the session header");
        AssertHeaders("opencode-go", null, null, "null session id does not inject the session header");
        AssertHeaders("opencode-go", string.Empty, null, "empty session id does not inject the session header");
        AssertHeaders("opencode-go", "   ", null, "whitespace session id does not inject the session header");
    }

    private static void RunOverrideSuite()
    {
        AssertHeaders("opencode-go", "session-123", "custom", "explicit request override wins and is not duplicated", "custom");
    }

    private static void AssertHeaders(
        string? builtinId,
        string? sessionId,
        string? expected,
        string message,
        string? overrideValue = null)
    {
        var provider = CreateProvider(builtinId, overrideValue);
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://example.test/v1/chat/completions");
        OpenAIChatProvider.ApplyHeaders(request, provider, "secret-key", sessionId);
        var debug = OpenAIChatProvider.BuildDebugHeaders(provider, sessionId);

        var actualValues = request.Headers.TryGetValues("x-opencode-session", out var values)
            ? values.ToArray()
            : [];
        var debugHasValue = debug.TryGetValue("x-opencode-session", out var debugValue);

        if (expected is null)
        {
            Assert(actualValues.Length == 0, message + ": actual request has no session header");
            Assert(!debugHasValue, message + ": debug headers have no session header");
        }
        else
        {
            Assert(actualValues.Length == 1 && actualValues[0] == expected, message + ": actual request has one expected session header");
            Assert(debugHasValue && debugValue == expected, message + ": debug headers mirror the expected session header");
        }

        Assert(actualValues.Length == (debugHasValue ? 1 : 0), message + ": actual and debug header presence matches");
        if (debugHasValue)
        {
            Assert(actualValues[0] == debugValue, message + ": actual and debug header values match");
        }

        Assert(request.Headers.Authorization?.Scheme == "Bearer", message + ": Authorization scheme remains Bearer");
        Assert(request.Headers.Authorization?.Parameter == "secret-key", message + ": Authorization value remains unchanged");
        Assert(request.Headers.UserAgent.Count == 1 && request.Headers.UserAgent.First().ToString() == "test-agent", message + ": User-Agent remains unchanged");
        Assert(debug["Authorization"] == "Bearer ***", message + ": debug Authorization remains redacted");
        Assert(debug["User-Agent"] == "test-agent", message + ": debug User-Agent remains unchanged");
    }

    private static JsonElement CreateProvider(string? builtinId, string? overrideValue)
    {
        var provider = new Dictionary<string, object?>
        {
            ["apiKey"] = "secret-key",
            ["userAgent"] = "test-agent"
        };
        if (builtinId is not null)
        {
            provider["providerBuiltinId"] = builtinId;
        }
        if (overrideValue is not null)
        {
            provider["requestOverrides"] = new Dictionary<string, object?>
            {
                ["headers"] = new Dictionary<string, string>
                {
                    ["x-opencode-session"] = overrideValue
                }
            };
        }
        return JsonSerializer.SerializeToElement(provider);
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException($"Assertion failed: {message}");
        }
    }
}

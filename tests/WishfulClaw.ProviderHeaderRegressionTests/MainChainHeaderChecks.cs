using System.Net.Http;
using System.Text.Json;
using WishfulClaw.Agent;

namespace WishfulClaw.ProviderHeaderRegressionTests;

/// <summary>
/// S-172: the main chain (streaming chat / responses / anthropic, and the
/// context-compression summarizer) used to hand-copy the provider header chain
/// into four files, each trimmed to what its author thought that path needed.
/// Two paths silently dropped `organization` / `project`, and the summarizer
/// dropped `Ensure` (the empty-User-Agent backstop that keeps Cloudflare-fronted
/// gateways from answering 1010).
///
/// These checks pin the converged behaviour: every path reaches
/// <see cref="ProviderHttpHeaders"/>, and the two families there — OpenAI and
/// Anthropic — each expose a live chain and a debug mirror that cannot drift
/// apart, because the `request_debug` event is supposed to show what was sent.
/// </summary>
internal static class MainChainHeaderChecks
{
    public static void Run()
    {
        AssertSummaryPathsCarryTheConfiguredChain();
        AssertSummarizerKeepsProtocolAuthHeaders();
        AssertDebugChainMirrorsLiveChain();
        AssertProviderDebugHeadersRedactAuth();
        AssertOpenCodeGateFollowsTheProtocol();
        AssertHeaderOverridesWinInBothChains();
    }

    // ── the two摘要 paths used to lose organization / project ──

    private static void AssertSummaryPathsCarryTheConfiguredChain()
    {
        const string url = "https://example.test/v1/chat/completions";
        using var anthropic = ContextCompression.BuildAnthropicSummaryRequest(
            "https://example.test/v1/messages", "{}", ConfiguredProvider(), "secret-key");
        using var openAi = ContextCompression.BuildOpenAiSummaryRequest(
            url, "{}", ConfiguredProvider(), "secret-key", "session-123");

        Assert(Header(anthropic, "User-Agent") == "summary-agent",
            "anthropic summary applies the configured User-Agent");
        Assert(Header(anthropic, "x-custom") == "custom-value",
            "anthropic summary applies request override headers");
        Assert(Header(anthropic, "OpenAI-Organization") is null,
            "anthropic summary sends no OpenAI-branded organization header");

        Assert(Header(openAi, "User-Agent") == "summary-agent",
            "openai summary applies the configured User-Agent");
        Assert(Header(openAi, "x-custom") == "custom-value",
            "openai summary applies request override headers");
        Assert(Header(openAi, "OpenAI-Organization") == "org-123",
            "openai summary forwards organization (previously dropped)");
        Assert(Header(openAi, "OpenAI-Project") == "proj-456",
            "openai summary forwards project (previously dropped)");
        Assert(Header(openAi, "x-opencode-session") == "session-123",
            "openai summary forwards the opencode session for the routed builtin");
    }

    private static void AssertSummarizerKeepsProtocolAuthHeaders()
    {
        using var anthropic = ContextCompression.BuildAnthropicSummaryRequest(
            "https://example.test/v1/messages", "{}", ConfiguredProvider(), "secret-key");
        using var openAi = ContextCompression.BuildOpenAiSummaryRequest(
            "https://example.test/v1/chat/completions", "{}", ConfiguredProvider(), "secret-key", null);

        Assert(Header(anthropic, "x-api-key") == "secret-key",
            "anthropic summary keeps its x-api-key auth header");
        Assert(Header(anthropic, "anthropic-version") == "2023-06-01",
            "anthropic summary keeps anthropic-version");
        Assert(anthropic.Headers.Authorization is null,
            "anthropic summary sends no Bearer authorization");
        Assert(openAi.Headers.Authorization?.Parameter == "secret-key",
            "openai summary keeps its Bearer auth header");
        Assert(Header(openAi, "x-api-key") is null,
            "openai summary sends no x-api-key header");
    }

    // ── the live chain and the debug mirror must not drift apart ──

    private static void AssertDebugChainMirrorsLiveChain()
    {
        var provider = ConfiguredProvider();
        const string sessionId = "session-123";

        using var chat = new HttpRequestMessage(HttpMethod.Post, "https://example.test/v1/chat/completions");
        ProviderHttpHeaders.ApplyOpenAiChat(chat, provider, sessionId);
        var chatDebug = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        ProviderHttpHeaders.ApplyOpenAiChatDebug(chatDebug, provider, sessionId);
        AssertSameHeaders(LiveHeaders(chat), chatDebug, "openai-chat live and debug chains match");

        using var anthropic = new HttpRequestMessage(HttpMethod.Post, "https://example.test/v1/messages");
        ProviderHttpHeaders.ApplyAnthropic(anthropic, provider);
        var anthropicDebug = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        ProviderHttpHeaders.ApplyAnthropicDebug(anthropicDebug, provider);
        AssertSameHeaders(LiveHeaders(anthropic), anthropicDebug, "anthropic live and debug chains match");
    }

    private static void AssertProviderDebugHeadersRedactAuth()
    {
        var chatDebug = OpenAIChatProvider.BuildDebugHeaders(ConfiguredProvider(), "session-123");
        Assert(chatDebug["Authorization"] == "Bearer ***",
            "chat debug headers redact the Authorization value");
        Assert(chatDebug["Content-Type"] == "application/json",
            "chat debug headers declare the JSON content type");

        var anthropicDebug = AnthropicMessagesProvider.BuildDebugHeadersForTests(AnthropicProvider());
        Assert(anthropicDebug["x-api-key"] == "***",
            "anthropic debug headers redact x-api-key");
        Assert(anthropicDebug["anthropic-version"] == "2023-06-01",
            "anthropic debug headers declare anthropic-version");
        Assert(anthropicDebug.ContainsKey("Authorization") == false,
            "anthropic debug headers omit Bearer for non-longcat builtins");
    }

    // ── the opencode gate is a routing rule, so it follows the protocol ──

    private static void AssertOpenCodeGateFollowsTheProtocol()
    {
        var provider = JsonSerializer.SerializeToElement(new Dictionary<string, object?>
        {
            ["userAgent"] = "summary-agent",
            ["providerBuiltinId"] = "opencode-go"
        });

        using var openAi = new HttpRequestMessage(HttpMethod.Post, "https://example.test/v1/responses");
        ProviderHttpHeaders.ApplyOpenAiChat(openAi, provider, "session-123");
        Assert(Header(openAi, "x-opencode-session") == "session-123",
            "the openai family injects the session header for the routed builtin");

        using var anthropic = new HttpRequestMessage(HttpMethod.Post, "https://example.test/v1/messages");
        ProviderHttpHeaders.ApplyAnthropic(anthropic, provider);
        Assert(Header(anthropic, "x-opencode-session") is null,
            "the anthropic family never injects the session header");
    }

    // ── request overrides are the user's escape hatch, so they win ──

    private static void AssertHeaderOverridesWinInBothChains()
    {
        var provider = JsonSerializer.SerializeToElement(new Dictionary<string, object?>
        {
            ["userAgent"] = "summary-agent",
            ["organization"] = "org-123",
            ["project"] = "proj-456",
            ["requestOverrides"] = new Dictionary<string, object?>
            {
                ["headers"] = new Dictionary<string, string>
                {
                    ["User-Agent"] = "override-agent",
                    ["OpenAI-Organization"] = "override-org"
                }
            }
        });

        using var request = new HttpRequestMessage(HttpMethod.Post, "https://example.test/v1/chat/completions");
        ProviderHttpHeaders.ApplyOpenAiChat(request, provider, null);
        var debug = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        ProviderHttpHeaders.ApplyOpenAiChatDebug(debug, provider, null);

        Assert(Header(request, "User-Agent") == "override-agent",
            "a User-Agent override wins over the configured User-Agent");
        Assert(Header(request, "OpenAI-Organization") == "override-org",
            "an organization override wins over the configured organization");
        Assert(Header(request, "OpenAI-Project") == "proj-456",
            "an unrelated configured header survives the overrides");
        AssertSameHeaders(LiveHeaders(request), debug, "overridden openai-chat chain still mirrors debug");
    }

    // ── helpers ──

    private static JsonElement ConfiguredProvider()
    {
        return JsonSerializer.SerializeToElement(new Dictionary<string, object?>
        {
            ["userAgent"] = "summary-agent",
            ["providerBuiltinId"] = "opencode-go",
            ["organization"] = "org-123",
            ["project"] = "proj-456",
            ["requestOverrides"] = new Dictionary<string, object?>
            {
                ["headers"] = new Dictionary<string, string> { ["x-custom"] = "custom-value" }
            }
        });
    }

    private static JsonElement AnthropicProvider()
    {
        return JsonSerializer.SerializeToElement(new Dictionary<string, object?>
        {
            ["userAgent"] = "summary-agent",
            ["providerBuiltinId"] = "anthropic",
            ["requestOverrides"] = new Dictionary<string, object?>
            {
                ["headers"] = new Dictionary<string, string> { ["x-custom"] = "custom-value" }
            }
        });
    }

    private static Dictionary<string, string> LiveHeaders(HttpRequestMessage request)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var header in request.Headers)
        {
            result[header.Key] = string.Join(", ", header.Value);
        }

        return result;
    }

    private static void AssertSameHeaders(
        IReadOnlyDictionary<string, string> live,
        IReadOnlyDictionary<string, string> debug,
        string message)
    {
        foreach (var (name, value) in live)
        {
            Assert(debug.TryGetValue(name, out var debugValue),
                $"{message}: debug headers are missing {name}");
            Assert(debugValue == value,
                $"{message}: debug value for {name} is {debugValue}, live value is {value}");
        }

        foreach (var name in debug.Keys)
        {
            Assert(live.ContainsKey(name),
                $"{message}: live request is missing {name}");
        }
    }

    private static string? Header(HttpRequestMessage request, string name) =>
        request.Headers.TryGetValues(name, out var values) ? values.FirstOrDefault() : null;

    private static void Assert(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException($"Assertion failed: {message}");
        }
    }
}

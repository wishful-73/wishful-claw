using System.Net.Http;
using System.Text.Json;
using WishfulClaw.Agent;

namespace WishfulClaw.ProviderHeaderRegressionTests;

/// <summary>
/// The auxiliary (single-shot) channel — prompt optimizer and persona
/// generation — used to send nothing but `Authorization`, so a per-provider
/// User-Agent, `organization` / `project`, custom `requestOverrides` headers or
/// the opencode-go routing header configured in Settings changed nothing for it.
/// These checks pin the chain it now shares with a normal chat turn.
/// </summary>
internal static class AuxiliaryHeaderChecks
{
    public static void Run()
    {
        AssertOpenAiChatCarriesConfiguredHeaders();
        AssertOpenAiChatAppliesHeaderOverrides();
        AssertOpenAiChatGatesOpenCodeSession();
        AssertAnthropicCarriesConfiguredHeaders();
        AssertEmptyProviderFallsBackToDefaults();
    }

    private static void AssertOpenAiChatCarriesConfiguredHeaders()
    {
        var provider = JsonSerializer.SerializeToElement(new Dictionary<string, object?>
        {
            ["userAgent"] = "aux-agent",
            ["organization"] = "org-123",
            ["project"] = "proj-456"
        });

        using var request = NewRequest("/v1/chat/completions");
        ProviderHttpHeaders.ApplyOpenAiChat(request, provider, ProviderHttpHeaders.AuxiliarySessionId);

        Assert(Header(request, "User-Agent") == "aux-agent",
            "auxiliary openai-chat applies the configured User-Agent");
        Assert(Header(request, "OpenAI-Organization") == "org-123",
            "auxiliary openai-chat forwards organization");
        Assert(Header(request, "OpenAI-Project") == "proj-456",
            "auxiliary openai-chat forwards project");
    }

    private static void AssertOpenAiChatAppliesHeaderOverrides()
    {
        var provider = JsonSerializer.SerializeToElement(new Dictionary<string, object?>
        {
            ["userAgent"] = "aux-agent",
            ["sessionId"] = "session-abc",
            ["model"] = "glm-5.3",
            ["requestOverrides"] = new Dictionary<string, object?>
            {
                ["headers"] = new Dictionary<string, string>
                {
                    ["x-custom"] = "custom-value",
                    ["x-session"] = "{{sessionId}}",
                    ["x-model"] = "{{ model }}"
                }
            }
        });

        using var request = NewRequest("/v1/chat/completions");
        ProviderHttpHeaders.ApplyOpenAiChat(request, provider, ProviderHttpHeaders.AuxiliarySessionId);

        Assert(Header(request, "x-custom") == "custom-value",
            "auxiliary openai-chat applies custom request override headers");
        Assert(Header(request, "x-session") == "session-abc",
            "auxiliary openai-chat resolves the {{sessionId}} template");
        Assert(Header(request, "x-model") == "glm-5.3",
            "auxiliary openai-chat resolves the {{ model }} template");
    }

    private static void AssertOpenAiChatGatesOpenCodeSession()
    {
        AssertOpenCodeSession("opencode-go", ProviderHttpHeaders.AuxiliarySessionId,
            "exact opencode-go builtin id");
        AssertOpenCodeSession(null, null, "missing builtin id");
        AssertOpenCodeSession("opencode", null, "opencode Zen");
        AssertOpenCodeSession("anthropic", null, "anthropic");
        AssertOpenCodeSession("OpenCode-Go", null, "case variant");
    }

    private static void AssertOpenCodeSession(string? builtinId, string? expected, string message)
    {
        var payload = new Dictionary<string, object?> { ["userAgent"] = "aux-agent" };
        if (builtinId is not null)
        {
            payload["providerBuiltinId"] = builtinId;
        }

        using var request = NewRequest("/v1/chat/completions");
        ProviderHttpHeaders.ApplyOpenAiChat(
            request, JsonSerializer.SerializeToElement(payload), ProviderHttpHeaders.AuxiliarySessionId);

        var actual = Header(request, "x-opencode-session");
        if (expected is null)
        {
            Assert(actual is null,
                $"auxiliary openai-chat does not inject x-opencode-session for {message}");
        }
        else
        {
            Assert(actual == expected,
                $"auxiliary openai-chat injects the fixed session header for {message}");
        }
    }

    private static void AssertAnthropicCarriesConfiguredHeaders()
    {
        var provider = JsonSerializer.SerializeToElement(new Dictionary<string, object?>
        {
            ["userAgent"] = "aux-agent",
            ["providerBuiltinId"] = "opencode-go",
            ["requestOverrides"] = new Dictionary<string, object?>
            {
                ["headers"] = new Dictionary<string, string> { ["x-custom"] = "custom-value" }
            }
        });

        using var request = NewRequest("/v1/messages");
        ProviderHttpHeaders.ApplyAnthropic(request, provider);

        Assert(Header(request, "User-Agent") == "aux-agent",
            "auxiliary anthropic applies the configured User-Agent");
        Assert(Header(request, "x-custom") == "custom-value",
            "auxiliary anthropic applies custom request override headers");
        Assert(Header(request, "x-opencode-session") is null,
            "auxiliary anthropic never sends the opencode session header");
    }

    private static void AssertEmptyProviderFallsBackToDefaults()
    {
        using var request = NewRequest("/v1/chat/completions");
        ProviderHttpHeaders.ApplyOpenAiChat(request, EmptyProvider(), ProviderHttpHeaders.AuxiliarySessionId);

        Assert(Header(request, "User-Agent") == "WishfulClaw",
            "auxiliary call without a provider payload falls back to the app User-Agent");
        Assert(Header(request, "x-opencode-session") is null,
            "auxiliary call without a provider payload sends no session header");
    }

    private static HttpRequestMessage NewRequest(string path) =>
        new(HttpMethod.Post, "https://example.test" + path);

    private static JsonElement EmptyProvider()
    {
        using var document = JsonDocument.Parse("{}");
        return document.RootElement.Clone();
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

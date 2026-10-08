using System.Net.Http;
using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Provider request-header chain for the auxiliary (single-shot) channel — the
/// one-shot calls that never enter AgentLoop (prompt optimizer, persona
/// generation).
///
/// Mirrors the streaming providers' header handling so an auxiliary call
/// reaches the same upstream configuration as a normal chat turn: the
/// per-provider User-Agent, `requestOverrides` headers, the OpenAI
/// `organization` / `project` pair, and the opencode-go routing header. Before
/// this existed the auxiliary channel sent nothing but `Authorization`, so
/// configuring any of those in Settings changed nothing for prompt
/// optimization.
///
/// Auth headers stay with the caller: they differ per protocol and per builtin
/// (Bearer vs `x-api-key`), and the caller already owns them.
///
/// Debug variants are deliberately absent — the auxiliary channel emits no
/// `request_debug` event. The streaming providers carry their own; when they
/// converge on this class (S-172) they bring theirs along.
/// </summary>
internal static class ProviderHttpHeaders
{
    /// <summary>
    /// Session id sent as `x-opencode-session` for auxiliary calls. Auxiliary
    /// work is not a conversation, so there is no session to forward; upstream
    /// only requires a stable non-empty value. Mirrors
    /// <see cref="ProviderTestService.ConnectionTestSessionId"/>.
    /// </summary>
    internal const string AuxiliarySessionId = "wishful-claw-auxiliary";

    internal static void ApplyOpenAiChat(HttpRequestMessage request, JsonElement provider, string? sessionId)
    {
        ApiUserAgent.Apply(request, provider);

        if (JsonHelpers.GetString(provider, "organization") is { Length: > 0 } organization)
        {
            request.Headers.TryAddWithoutValidation("OpenAI-Organization", organization);
        }
        if (JsonHelpers.GetString(provider, "project") is { Length: > 0 } project)
        {
            request.Headers.TryAddWithoutValidation("OpenAI-Project", project);
        }

        ProviderRequestOverrides.ApplyHttpHeaderOverrides(request, provider);
        ApplyOpenCodeSession(request, provider, sessionId);
        ApiUserAgent.Ensure(request, provider);
    }

    internal static void ApplyAnthropic(HttpRequestMessage request, JsonElement provider)
    {
        ApiUserAgent.Apply(request, provider);
        ProviderRequestOverrides.ApplyHttpHeaderOverrides(request, provider);
        ApiUserAgent.Ensure(request, provider);
    }

    private static void ApplyOpenCodeSession(HttpRequestMessage request, JsonElement provider, string? sessionId)
    {
        if (!IsOpenCodeGo(provider) ||
            string.IsNullOrWhiteSpace(sessionId) ||
            request.Headers.Contains("x-opencode-session"))
        {
            return;
        }

        request.Headers.TryAddWithoutValidation("x-opencode-session", sessionId);
    }

    private static bool IsOpenCodeGo(JsonElement provider)
    {
        return string.Equals(
            JsonHelpers.GetString(provider, "providerBuiltinId"),
            "opencode-go",
            StringComparison.Ordinal);
    }
}

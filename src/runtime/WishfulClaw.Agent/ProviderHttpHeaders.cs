using System.Net.Http;
using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// The single definition point for the provider header chain: the streaming
/// providers (chat / responses / anthropic), the context-compression
/// summarizer, and the auxiliary (single-shot) channel all apply their headers
/// here. Before this they each hand-copied the chain and trimmed it to what the
/// author thought that path needed, so one provider configuration could take
/// effect on a chat turn and be silently dropped on a summary call.
///
/// Two families, because the protocols do not consume the same configuration:
/// <list type="bullet">
///   <item><see cref="ApplyOpenAiChat"/> — OpenAI family (chat, responses, and
///   the OpenAI summary): per-provider User-Agent, the `OpenAI-Organization` /
///   `OpenAI-Project` pair, `requestOverrides` headers, and the opencode-go
///   routing header.</item>
///   <item><see cref="ApplyAnthropic"/> — Anthropic: User-Agent and
///   `requestOverrides` headers. The `OpenAI-*` pair is an OpenAI-branded
///   header, and the opencode-go routing header only ever exists on the
///   OpenAI-compatible builtin, so neither belongs to this family.</item>
/// </list>
///
/// Auth headers stay with the caller: they differ per protocol and per builtin
/// (Bearer vs `x-api-key`), and the caller already owns them.
///
/// The <c>...Debug</c> variants mirror each chain for the `request_debug`
/// event, so what the user is shown is the header set that was actually sent
/// (values redacted). The auxiliary channel emits no `request_debug` event
/// (S-171) and therefore never calls them.
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

    /// <summary>
    /// Debug mirror of <see cref="ApplyOpenAiChat"/> for the `request_debug`
    /// event: same header names, same order, values redacted.
    /// </summary>
    internal static void ApplyOpenAiChatDebug(
        Dictionary<string, string> headers,
        JsonElement provider,
        string? sessionId)
    {
        ApiUserAgent.ApplyDebug(headers, provider);

        if (JsonHelpers.GetString(provider, "organization") is { Length: > 0 } organization)
        {
            headers["OpenAI-Organization"] = organization;
        }
        if (JsonHelpers.GetString(provider, "project") is { Length: > 0 } project)
        {
            headers["OpenAI-Project"] = project;
        }

        ProviderRequestOverrides.ApplyDebugHeaderOverrides(headers, provider);
        ApplyOpenCodeSessionDebug(headers, provider, sessionId);
        ApiUserAgent.EnsureDebug(headers, provider);
    }

    /// <summary>
    /// Debug mirror of <see cref="ApplyAnthropic"/> for the `request_debug`
    /// event: same header names, same order, values redacted.
    /// </summary>
    internal static void ApplyAnthropicDebug(Dictionary<string, string> headers, JsonElement provider)
    {
        ApiUserAgent.ApplyDebug(headers, provider);
        ProviderRequestOverrides.ApplyDebugHeaderOverrides(headers, provider);
        ApiUserAgent.EnsureDebug(headers, provider);
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

    private static void ApplyOpenCodeSessionDebug(
        Dictionary<string, string> headers,
        JsonElement provider,
        string? sessionId)
    {
        if (!IsOpenCodeGo(provider) ||
            string.IsNullOrWhiteSpace(sessionId) ||
            headers.ContainsKey("x-opencode-session"))
        {
            return;
        }

        headers["x-opencode-session"] = sessionId;
    }

    private static bool IsOpenCodeGo(JsonElement provider)
    {
        return string.Equals(
            JsonHelpers.GetString(provider, "providerBuiltinId"),
            "opencode-go",
            StringComparison.Ordinal);
    }
}

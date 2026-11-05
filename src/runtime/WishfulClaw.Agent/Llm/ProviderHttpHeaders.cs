using System.Net.Http;
using System.Text.Json;
using WishfulClaw.Agent.Protocol;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent.Llm;

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

        // S-316: the builtin presets now declare these two through
        // `requestOverrides.headers`, which runs below and replaces whatever is
        // already on the request. Keeping this fallback means an existing
        // provider record (taken as a snapshot of the preset it was created
        // from, so it does not carry the new entries) still sends the header it
        // used to send. A value the user typed wins over the account field.
        if (JsonHelpers.GetString(provider, "organization") is { Length: > 0 } organization &&
            !request.Headers.Contains("OpenAI-Organization"))
        {
            request.Headers.TryAddWithoutValidation("OpenAI-Organization", organization);
        }
        if (JsonHelpers.GetString(provider, "project") is { Length: > 0 } project &&
            !request.Headers.Contains("OpenAI-Project"))
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

        if (JsonHelpers.GetString(provider, "organization") is { Length: > 0 } organization &&
            !HasHeaderKey(headers, "OpenAI-Organization"))
        {
            headers["OpenAI-Organization"] = organization;
        }
        if (JsonHelpers.GetString(provider, "project") is { Length: > 0 } project &&
            !HasHeaderKey(headers, "OpenAI-Project"))
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

    /// <summary>
    /// Case-insensitive lookup for the debug mirror. <see cref="HttpRequestHeaders.Contains(string)"/>
    /// is case-insensitive too, but <see cref="Dictionary{TKey,TValue}"/> is not — without
    /// this the debug view would list a user's `x-opencode-session` and the built-in
    /// `X-Opencode-Session` as two separate headers while the wire carried only one.
    /// </summary>
    private static bool HasHeaderKey(Dictionary<string, string> headers, string name)
    {
        foreach (var key in headers.Keys)
        {
            if (string.Equals(key, name, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        return false;
    }

    /// <summary>
    /// Routing header for the opencode-go builtin. The preset now declares it as
    /// `requestOverrides.headers: { 'x-opencode-session': '{{sessionId}}' }`
    /// (S-316), so for a provider created after that change this method is a
    /// no-op. It stays because provider records are a snapshot of the preset
    /// they were created from: an existing record has no such entry and would
    /// otherwise stop sending the header.
    /// </summary>
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
            HasHeaderKey(headers, "x-opencode-session"))
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

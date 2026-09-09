using System.Net.Http;
using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// OpenAI-compatible chat provider — HTTP header configuration.
/// </summary>
internal static partial class OpenAIChatProvider
{
    internal static void ApplyHeaders(HttpRequestMessage request, JsonElement provider, string apiKey, string? sessionId)
    {
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);
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
        if (string.Equals(JsonHelpers.GetString(provider, "providerBuiltinId"), "opencode-go", StringComparison.Ordinal) &&
            !string.IsNullOrWhiteSpace(sessionId) &&
            !request.Headers.Contains("x-opencode-session"))
        {
            request.Headers.TryAddWithoutValidation("x-opencode-session", sessionId);
        }
        ApiUserAgent.Ensure(request, provider);
    }

    internal static IReadOnlyDictionary<string, string> BuildDebugHeaders(JsonElement provider, string? sessionId)
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Content-Type"] = "application/json",
            ["Authorization"] = "Bearer ***"
        };
        ApiUserAgent.ApplyDebug(headers, provider);
        ProviderRequestOverrides.ApplyDebugHeaderOverrides(headers, provider);
        if (string.Equals(JsonHelpers.GetString(provider, "providerBuiltinId"), "opencode-go", StringComparison.Ordinal) &&
            !string.IsNullOrWhiteSpace(sessionId) &&
            !headers.ContainsKey("x-opencode-session"))
        {
            headers["x-opencode-session"] = sessionId;
        }
        ApiUserAgent.EnsureDebug(headers, provider);
        return headers;
    }
}

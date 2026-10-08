using System.Net.Http;
using System.Text.Json;

namespace WishfulClaw.Agent;

/// <summary>
/// OpenAI-compatible chat provider — HTTP header configuration.
/// </summary>
internal static partial class OpenAIChatProvider
{
    internal static void ApplyHeaders(HttpRequestMessage request, JsonElement provider, string apiKey, string? sessionId)
    {
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);
        ProviderHttpHeaders.ApplyOpenAiChat(request, provider, sessionId);
    }

    internal static IReadOnlyDictionary<string, string> BuildDebugHeaders(JsonElement provider, string? sessionId)
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Content-Type"] = "application/json",
            ["Authorization"] = "Bearer ***"
        };
        ProviderHttpHeaders.ApplyOpenAiChatDebug(headers, provider, sessionId);
        return headers;
    }
}

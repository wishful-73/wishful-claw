using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Provider connectivity test and model list fetching.
/// Sends minimal HTTP requests to the provider's API endpoint.
/// </summary>
public static class ProviderTestService
{
    private static readonly HttpClient HttpClient = WishfulClaw.Infrastructure.Http.WorkerHttpClientFactory.Create(
        timeout: TimeSpan.FromSeconds(30));

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    // ── Test connectivity ──

    public static async Task<WorkerResponse> TestAsync(JsonElement parameters)
    {
        var provider = ExtractProviderConfig(parameters);
        if (provider is null)
        {
            return WorkerResponse.Json(new ProviderTestResult(false, Error: "Invalid provider parameters"), AgentRuntimeJsonContext.Default.ProviderTestResult);
        }

        try
        {
            var (url, request) = BuildTestRequest(provider);
            using var response = await HttpClient.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();

            if (response.IsSuccessStatusCode)
            {
                return WorkerResponse.Json(new ProviderTestResult(true, StatusCode: (int)response.StatusCode), AgentRuntimeJsonContext.Default.ProviderTestResult);
            }

            var error = response.StatusCode switch
            {
                System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden
                    => "Invalid API key or unauthorized",
                _ => $"HTTP {(int)response.StatusCode}: {Truncate(body, 200)}"
            };

            return WorkerResponse.Json(new ProviderTestResult(false, StatusCode: (int)response.StatusCode, Error: error), AgentRuntimeJsonContext.Default.ProviderTestResult);
        }
        catch (TaskCanceledException)
        {
            return WorkerResponse.Json(new ProviderTestResult(false, Error: "Request timed out (30s)"), AgentRuntimeJsonContext.Default.ProviderTestResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(new ProviderTestResult(false, Error: $"{ex.GetType().Name}: {ex.Message}"), AgentRuntimeJsonContext.Default.ProviderTestResult);
        }
    }

    // ── Fetch models ──

    public static async Task<WorkerResponse> FetchModelsAsync(JsonElement parameters)
    {
        var provider = ExtractProviderConfig(parameters);
        if (provider is null)
        {
            return WorkerResponse.Json(new ProviderTestResult(false, Error: "Invalid provider parameters"), AgentRuntimeJsonContext.Default.ProviderTestResult);
        }

        try
        {
            var (url, request) = BuildFetchModelsRequest(provider);
            using var response = await HttpClient.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                return WorkerResponse.Json(new ProviderTestResult(false, StatusCode: (int)response.StatusCode, Error: $"HTTP {(int)response.StatusCode}: {Truncate(body, 200)}"), AgentRuntimeJsonContext.Default.ProviderTestResult);
            }

            var models = ParseModelsResponse(body, provider.Type);
            return WorkerResponse.Json(new ProviderTestModelsResult(true, Models: models), AgentRuntimeJsonContext.Default.ProviderTestModelsResult);
        }
        catch (TaskCanceledException)
        {
            return WorkerResponse.Json(new ProviderTestResult(false, Error: "Request timed out (30s)"), AgentRuntimeJsonContext.Default.ProviderTestResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(new ProviderTestResult(false, Error: $"{ex.GetType().Name}: {ex.Message}"), AgentRuntimeJsonContext.Default.ProviderTestResult);
        }
    }

    // ── Helpers ──

    private sealed record ProviderConfig(
        string Type,
        string BaseUrl,
        string ApiKey,
        string? BuiltinId,
        string? ModelId);

    private static ProviderConfig? ExtractProviderConfig(JsonElement parameters)
    {
        var type = JsonHelpers.GetString(parameters, "type");
        var baseUrl = JsonHelpers.GetString(parameters, "baseUrl");
        var apiKey = JsonHelpers.GetString(parameters, "apiKey") ?? "";
        var builtinId = JsonHelpers.GetString(parameters, "builtinId");

        if (string.IsNullOrEmpty(type) || string.IsNullOrEmpty(baseUrl))
        {
            // Check if params is a nested provider object
            if (parameters.TryGetProperty("provider", out var providerNode) &&
                providerNode.ValueKind == JsonValueKind.Object)
            {
                type = JsonHelpers.GetString(providerNode, "type");
                baseUrl = JsonHelpers.GetString(providerNode, "baseUrl");
                apiKey = JsonHelpers.GetString(providerNode, "apiKey") ?? "";
                builtinId = JsonHelpers.GetString(providerNode, "builtinId");
            }
        }

        if (string.IsNullOrEmpty(type) || string.IsNullOrEmpty(baseUrl))
        {
            return null;
        }

        var modelId = JsonHelpers.GetString(parameters, "modelId");
        return new ProviderConfig(type!, baseUrl!, apiKey, builtinId, modelId);
    }

    private static (string url, HttpRequestMessage request) BuildTestRequest(ProviderConfig provider)
    {
        var baseUrl = provider.BaseUrl.TrimEnd('/');

        if (provider.Type == "anthropic")
        {
            var url = $"{baseUrl}/v1/messages";
            var request = new HttpRequestMessage(HttpMethod.Post, url);
            request.Headers.Add("x-api-key", provider.ApiKey);
            request.Headers.Add("anthropic-version", "2023-06-01");
            request.Content = new StringContent(
                WorkerJsonHelper.BuildJsonString(w =>
                {
                    w.WriteStartObject();
                    w.WriteString("model", provider.ModelId ?? "claude-3-5-haiku-20241022");
                    w.WriteNumber("max_tokens", 1);
                    w.WritePropertyName("messages");
                    w.WriteStartArray();
                    w.WriteStartObject();
                    w.WriteString("role", "user");
                    w.WriteString("content", "Hi");
                    w.WriteEndObject();
                    w.WriteEndArray();
                    w.WriteEndObject();
                }),
                Encoding.UTF8,
                "application/json");
            return (url, request);
        }

        if (provider.Type == "openai-responses")
        {
            var url = $"{baseUrl}/responses";
            var request = new HttpRequestMessage(HttpMethod.Post, url);
            if (!string.IsNullOrEmpty(provider.ApiKey))
            {
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", provider.ApiKey);
            }
            request.Content = new StringContent(
                WorkerJsonHelper.BuildJsonString(w =>
                {
                    w.WriteStartObject();
                    w.WriteString("model", provider.ModelId ?? "gpt-5.6-sol");
                    w.WriteBoolean("stream", false);
                    w.WriteNumber("max_output_tokens", 1);
                    w.WritePropertyName("input");
                    w.WriteStartArray();
                    w.WriteStartObject();
                    w.WriteString("type", "message");
                    w.WriteString("role", "user");
                    w.WriteString("content", "Hi");
                    w.WriteEndObject();
                    w.WriteEndArray();
                    w.WriteEndObject();
                }),
                Encoding.UTF8,
                "application/json");
            return (url, request);
        }

        // Default: OpenAI-compatible
        var chatUrl = $"{baseUrl}/chat/completions";
        var req = new HttpRequestMessage(HttpMethod.Post, chatUrl);
        if (!string.IsNullOrEmpty(provider.ApiKey))
        {
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", provider.ApiKey);
        }
        req.Content = new StringContent(
            WorkerJsonHelper.BuildJsonString(w =>
            {
                w.WriteStartObject();
                w.WriteString("model", provider.ModelId ?? "gpt-4o-mini");
                w.WriteNumber("max_tokens", 1);
                w.WritePropertyName("messages");
                w.WriteStartArray();
                w.WriteStartObject();
                w.WriteString("role", "user");
                w.WriteString("content", "Hi");
                w.WriteEndObject();
                w.WriteEndArray();
                w.WriteEndObject();
            }),
            Encoding.UTF8,
            "application/json");
        return (chatUrl, req);
    }

    private static (string url, HttpRequestMessage request) BuildFetchModelsRequest(ProviderConfig provider)
    {
        var baseUrl = provider.BaseUrl.TrimEnd('/');

        if (provider.Type == "anthropic")
        {
            var url = $"{baseUrl}/v1/models";
            var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Add("x-api-key", provider.ApiKey);
            request.Headers.Add("anthropic-version", "2023-06-01");
            return (url, request);
        }

        // Default: OpenAI-compatible — GET /models or /v1/models
        // Some providers use /v1/models, others /models. Normalize:
        // If baseUrl already ends with /v1, use /models; otherwise use /v1/models
        var modelsUrl = baseUrl.EndsWith("/v1", StringComparison.OrdinalIgnoreCase)
            ? $"{baseUrl}/models"
            : $"{baseUrl}/v1/models";

        var req = new HttpRequestMessage(HttpMethod.Get, modelsUrl);
        if (!string.IsNullOrEmpty(provider.ApiKey))
        {
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", provider.ApiKey);
        }
        return (modelsUrl, req);
    }

    private static List<ProviderModelInfo> ParseModelsResponse(string body, string type)
    {
        var models = new List<ProviderModelInfo>();
        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;

        // OpenAI format: { "data": [{ "id": "gpt-4o", ... }, ...] }
        if (root.TryGetProperty("data", out var dataElement) &&
            dataElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in dataElement.EnumerateArray())
            {
                var id = JsonHelpers.GetString(item, "id");
                if (string.IsNullOrEmpty(id)) continue;

                // Skip non-chat models (embeddings, tts, etc.)
                var ownedBy = JsonHelpers.GetString(item, "owned_by") ?? "";
                if (id.Contains("embedding", StringComparison.OrdinalIgnoreCase) ||
                    id.Contains("tts", StringComparison.OrdinalIgnoreCase) ||
                    id.Contains("whisper", StringComparison.OrdinalIgnoreCase) ||
                    id.Contains("dall-e", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var displayName = JsonHelpers.GetString(item, "display_name")
                    ?? JsonHelpers.GetString(item, "displayName")
                    ?? JsonHelpers.GetString(item, "name")
                    ?? id;

                models.Add(new ProviderModelInfo(id, displayName, true));
            }
        }

        return models;
    }

    private static string Truncate(string? text, int maxLength)
    {
        if (string.IsNullOrEmpty(text)) return string.Empty;
        return text.Length <= maxLength ? text : text[..maxLength];
    }
}

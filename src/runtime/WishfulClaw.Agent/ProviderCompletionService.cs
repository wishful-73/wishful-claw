using System.Net.Http;
using System.Text;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Single-shot provider completion for auxiliary flows (prompt optimizer, etc.).
/// Deliberately simple: one HTTP request with native tool calling, no agent
/// loop, no session conversation, no streaming. Mirrors ProviderTestService —
/// a direct provider call that never touches AgentLoop.
/// Retries rate-limit (429) and transient server errors with exponential
/// backoff — current provider ecosystems 429 frequently enough that a single
/// attempt is not viable.
/// </summary>
public static class ProviderCompletionService
{
    private const int MaxAttempts = 10;
    private static readonly HttpClient HttpClient = WishfulClaw.Infrastructure.Http.WorkerHttpClientFactory.Create(
        timeout: TimeSpan.FromSeconds(180));

    public static async Task<WorkerResponse> CompleteAsync(JsonElement parameters)
    {
        var provider = ExtractProviderConfig(parameters);
        if (provider is null)
        {
            return Fail("Invalid provider parameters");
        }

        var systemPrompt = JsonHelpers.GetString(parameters, "systemPrompt");
        var userMessage = JsonHelpers.GetString(parameters, "message");
        if (string.IsNullOrWhiteSpace(userMessage))
        {
            return Fail("message is required");
        }

        var (url, baseRequest) = BuildRequest(provider, systemPrompt, userMessage, parameters);

        // Exponential backoff: ~1s → ~2s → ~4s … capped at 30s per wait.
        var delayMs = 1000;
        string? lastError = null;

        for (var attempt = 1; attempt <= MaxAttempts; attempt++)
        {
            using var request = await CloneRequestAsync(baseRequest);
            try
            {
                using var response = await HttpClient.SendAsync(request);
                var body = await response.Content.ReadAsStringAsync();

                if (response.IsSuccessStatusCode)
                {
                    return ParseResponse(body, provider.Type);
                }

                var statusCode = (int)response.StatusCode;
                lastError = $"HTTP {statusCode}: {Truncate(body, 300)}";

                // Retry only rate-limit and transient server errors; client
                // errors (401/403/400…) are deterministic — fail immediately.
                var retryable = statusCode is 429 or 408 or >= 500;
                if (!retryable)
                {
                    return Fail(lastError);
                }

                // Honor Retry-After when the provider supplies it.
                if (response.Headers.RetryAfter?.Delta is { } retryAfter)
                {
                    delayMs = Math.Max(delayMs, (int)retryAfter.TotalMilliseconds);
                }
            }
            catch (TaskCanceledException)
            {
                return Fail("Request timed out (180s)");
            }
            catch (HttpRequestException ex)
            {
                // Transient network errors are also worth retrying.
                lastError = $"{ex.GetType().Name}: {ex.Message}";
            }

            if (attempt < MaxAttempts)
            {
                WorkerLog.Warn(
                    $"provider complete retryable failure attempt={attempt}/{MaxAttempts} " +
                    $"url={url} waiting={delayMs}ms error={lastError}");
                await Task.Delay(delayMs);
                delayMs = Math.Min(delayMs * 2, 30_000);
            }
        }

        return Fail($"Failed after {MaxAttempts} attempts. Last error: {lastError}");
    }

    /// <summary>The base request's content can only be read once — rebuild per attempt.</summary>
    private static async Task<HttpRequestMessage> CloneRequestAsync(HttpRequestMessage source)
    {
        var clone = new HttpRequestMessage(source.Method, source.RequestUri);
        foreach (var header in source.Headers)
        {
            clone.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }
        if (source.Content is not null)
        {
            var raw = await source.Content.ReadAsStringAsync();
            clone.Content = new StringContent(raw, Encoding.UTF8, "application/json");
        }
        return clone;
    }

    private static WorkerResponse Fail(string error) =>
        WorkerResponse.Json(new ProviderCompletionResult(false, Error: error),
            AgentRuntimeJsonContext.Default.ProviderCompletionResult);

    private sealed record ProviderConfig(string Type, string BaseUrl, string ApiKey);

    private static ProviderConfig? ExtractProviderConfig(JsonElement parameters)
    {
        JsonElement providerNode;
        if (parameters.TryGetProperty("provider", out providerNode) &&
            providerNode.ValueKind == JsonValueKind.Object)
        {
            // nested provider object
        }
        else
        {
            providerNode = parameters;
        }

        var type = JsonHelpers.GetString(providerNode, "type");
        var baseUrl = JsonHelpers.GetString(providerNode, "baseUrl");
        if (string.IsNullOrEmpty(type) || string.IsNullOrEmpty(baseUrl))
        {
            return null;
        }
        return new ProviderConfig(type!, baseUrl!, JsonHelpers.GetString(providerNode, "apiKey") ?? "");
    }

    private static (string Url, HttpRequestMessage Request) BuildRequest(
        ProviderConfig provider, string? systemPrompt, string userMessage, JsonElement parameters)
    {
        var baseUrl = provider.BaseUrl.TrimEnd('/');
        HttpRequestMessage request;

        if (provider.Type == "anthropic")
        {
            var url = $"{baseUrl}/v1/messages";
            request = new HttpRequestMessage(HttpMethod.Post, url);
            request.Headers.Add("x-api-key", provider.ApiKey);
            request.Headers.Add("anthropic-version", "2023-06-01");
            request.Content = new StringContent(
                WorkerJsonHelper.BuildJsonString(w => WriteAnthropicBody(w, provider, systemPrompt, userMessage, parameters)),
                Encoding.UTF8, "application/json");
            return (url, request);
        }

        // Default: OpenAI-compatible chat completions
        var chatUrl = $"{baseUrl}/chat/completions";
        request = new HttpRequestMessage(HttpMethod.Post, chatUrl);
        if (!string.IsNullOrEmpty(provider.ApiKey))
        {
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", provider.ApiKey);
        }
        request.Content = new StringContent(
            WorkerJsonHelper.BuildJsonString(w => WriteOpenAIChatBody(w, provider, systemPrompt, userMessage, parameters)),
            Encoding.UTF8, "application/json");
        return (chatUrl, request);
    }

    private static void WriteOpenAIChatBody(
        Utf8JsonWriter w, ProviderConfig provider, string? systemPrompt, string userMessage, JsonElement parameters)
    {
        w.WriteStartObject();
        w.WriteString("model", JsonHelpers.GetString(parameters, "model") ?? string.Empty);
        w.WriteBoolean("stream", false);
        if (!string.IsNullOrWhiteSpace(systemPrompt))
        {
            w.WritePropertyName("messages");
            w.WriteStartArray();
            w.WriteStartObject();
            w.WriteString("role", "system");
            w.WriteString("content", systemPrompt);
            w.WriteEndObject();
            WriteUserMessage(w, userMessage);
            w.WriteEndArray();
        }
        else
        {
            w.WritePropertyName("messages");
            w.WriteStartArray();
            WriteUserMessage(w, userMessage);
            w.WriteEndArray();
        }
        WriteToolsOpenAi(w, parameters);
        w.WriteEndObject();
    }

    private static void WriteUserMessage(Utf8JsonWriter w, string content)
    {
        w.WriteStartObject();
        w.WriteString("role", "user");
        w.WriteString("content", content);
        w.WriteEndObject();
    }

    private static void WriteToolsOpenAi(Utf8JsonWriter w, JsonElement parameters)
    {
        if (!parameters.TryGetProperty("tools", out var tools) ||
            tools.ValueKind != JsonValueKind.Array ||
            tools.GetArrayLength() == 0)
        {
            return;
        }
        w.WritePropertyName("tools");
        w.WriteStartArray();
        foreach (var tool in tools.EnumerateArray())
        {
            var name = JsonHelpers.GetString(tool, "name");
            if (string.IsNullOrWhiteSpace(name)) continue;
            w.WriteStartObject();
            w.WriteString("type", "function");
            w.WritePropertyName("function");
            w.WriteStartObject();
            w.WriteString("name", name);
            w.WriteString("description", JsonHelpers.GetString(tool, "description") ?? string.Empty);
            w.WritePropertyName("parameters");
            if (tool.TryGetProperty("inputSchema", out var schema))
            {
                schema.WriteTo(w);
            }
            else
            {
                w.WriteStartObject();
                w.WriteEndObject();
            }
            w.WriteEndObject(); // function
            w.WriteEndObject(); // tool
        }
        w.WriteEndArray();
    }

    private static void WriteAnthropicBody(
        Utf8JsonWriter w, ProviderConfig provider, string? systemPrompt, string userMessage, JsonElement parameters)
    {
        w.WriteStartObject();
        w.WriteString("model", JsonHelpers.GetString(parameters, "model") ?? string.Empty);
        w.WriteNumber("max_tokens", 4096);
        if (!string.IsNullOrWhiteSpace(systemPrompt))
        {
            w.WriteString("system", systemPrompt);
        }
        w.WritePropertyName("messages");
        w.WriteStartArray();
        WriteUserMessage(w, userMessage);
        w.WriteEndArray();
        WriteToolsAnthropic(w, parameters);
        w.WriteEndObject();
    }

    private static void WriteToolsAnthropic(Utf8JsonWriter w, JsonElement parameters)
    {
        if (!parameters.TryGetProperty("tools", out var tools) ||
            tools.ValueKind != JsonValueKind.Array ||
            tools.GetArrayLength() == 0)
        {
            return;
        }
        w.WritePropertyName("tools");
        w.WriteStartArray();
        foreach (var tool in tools.EnumerateArray())
        {
            var name = JsonHelpers.GetString(tool, "name");
            if (string.IsNullOrWhiteSpace(name)) continue;
            w.WriteStartObject();
            w.WriteString("name", name);
            w.WriteString("description", JsonHelpers.GetString(tool, "description") ?? string.Empty);
            w.WritePropertyName("input_schema");
            if (tool.TryGetProperty("inputSchema", out var schema))
            {
                schema.WriteTo(w);
            }
            else
            {
                w.WriteStartObject();
                w.WriteEndObject();
            }
            w.WriteEndObject();
        }
        w.WriteEndArray();
    }

    private static WorkerResponse ParseResponse(string body, string providerType)
    {
        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;

        if (providerType == "anthropic")
        {
            return ParseAnthropic(root);
        }
        return ParseOpenAiChat(root);
    }

    private static WorkerResponse ParseOpenAiChat(JsonElement root)
    {
        if (!root.TryGetProperty("choices", out var choices) ||
            choices.ValueKind != JsonValueKind.Array ||
            choices.GetArrayLength() == 0)
        {
            return Fail("Provider response has no choices");
        }
        var message = choices[0].TryGetProperty("message", out var msg) ? msg : default;
        var text = message.ValueKind == JsonValueKind.Object
            ? JsonHelpers.GetString(message, "content")
            : null;

        var toolCalls = new List<ProviderCompletionToolCall>();
        if (message.ValueKind == JsonValueKind.Object &&
            message.TryGetProperty("tool_calls", out var tc) &&
            tc.ValueKind == JsonValueKind.Array)
        {
            foreach (var call in tc.EnumerateArray())
            {
                var id = JsonHelpers.GetString(call, "id") ?? Guid.NewGuid().ToString("N");
                var fn = call.TryGetProperty("function", out var f) ? f : default;
                var name = fn.ValueKind == JsonValueKind.Object ? JsonHelpers.GetString(fn, "name") : null;
                var args = fn.ValueKind == JsonValueKind.Object
                    ? JsonHelpers.GetString(fn, "arguments") ?? "{}"
                    : "{}";
                if (!string.IsNullOrWhiteSpace(name))
                {
                    toolCalls.Add(new ProviderCompletionToolCall(id, name!, args));
                }
            }
        }
        return Ok(text, toolCalls);
    }

    private static WorkerResponse ParseAnthropic(JsonElement root)
    {
        var text = string.Empty;
        var toolCalls = new List<ProviderCompletionToolCall>();
        if (root.TryGetProperty("content", out var content) &&
            content.ValueKind == JsonValueKind.Array)
        {
            foreach (var block in content.EnumerateArray())
            {
                var blockType = JsonHelpers.GetString(block, "type");
                if (blockType == "text" && JsonHelpers.GetString(block, "text") is { } t)
                {
                    text += t;
                }
                else if (blockType == "tool_use")
                {
                    var id = JsonHelpers.GetString(block, "id") ?? Guid.NewGuid().ToString("N");
                    var name = JsonHelpers.GetString(block, "name") ?? string.Empty;
                    var input = block.TryGetProperty("input", out var inp) ? inp.GetRawText() : "{}";
                    if (!string.IsNullOrWhiteSpace(name))
                    {
                        toolCalls.Add(new ProviderCompletionToolCall(id, name, input));
                    }
                }
            }
        }
        return Ok(string.IsNullOrWhiteSpace(text) ? null : text, toolCalls);
    }

    private static WorkerResponse Ok(string? text, List<ProviderCompletionToolCall> toolCalls) =>
        WorkerResponse.Json(new ProviderCompletionResult(true, Text: text, ToolCalls: toolCalls),
            AgentRuntimeJsonContext.Default.ProviderCompletionResult);

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max] + "…";
}

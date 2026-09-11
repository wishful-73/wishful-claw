using System.Net.Http;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Persona;

/// <summary>
/// AI-assisted persona creation.
/// Takes a user prompt + optional reference persona, calls the LLM (single turn,
/// non-streaming), and returns a draft PersonaConfig with 4 markdown files.
///
/// Design based on KodaClaw's BootstrapDraftService, simplified to a one-shot
/// generation (no conversation loop).
/// </summary>
public static class PersonaGenerator
{
    private static readonly HttpClient Http = WishfulClaw.Infrastructure.Http.WorkerHttpClientFactory.Create(
        timeout: TimeSpan.FromMinutes(2));

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    /// <summary>
    /// Generates a persona draft from a user prompt.
    /// </summary>
    public static async Task<JsonObject> GenerateAsync(
        JsonElement provider,
        string prompt,
        string? referencePersonaId,
        string? workingFolder,
        CancellationToken cancellationToken = default,
        JsonElement? routingParameters = null)
    {
        var startedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var request = new JsonObject
        {
            ["provider"] = JsonNode.Parse(provider.GetRawText()),
            ["model"] = JsonHelpers.GetString(provider, "model"),
            ["requestKind"] = "persona"
        };
        if (routingParameters is { } routing)
        {
            if (routing.TryGetProperty("globalActiveModel", out var globalActive))
            {
                request["globalActiveModel"] = JsonNode.Parse(globalActive.GetRawText());
            }
            if (JsonHelpers.GetString(routing, "providerRole") is { } providerRole)
            {
                request["providerRole"] = providerRole;
            }
        }
        using var requestDocument = JsonDocument.Parse(request.ToJsonString());
        var (resolved, resolutionError) = ProviderCompletionResolver.Resolve(requestDocument.RootElement, "persona");
        if (resolved is null)
        {
            throw new InvalidOperationException(resolutionError ?? "No provider model is configured for persona generation");
        }

        // Persona still owns its response-specific JSON parsing, but model
        // selection now follows the same Worker resolver as provider/complete.
        var providerType = resolved.Type;
        if (providerType is not "anthropic" and not "openai" and not "openai-chat")
        {
            WorkerLog.Warn($"persona generation uses OpenAI-compatible protocol for provider type '{providerType}'; native protocol support remains pending");
        }
        var systemPrompt = PersonaGenerationPrompt.Build(referencePersonaId, workingFolder);

        string responseBody;
        try
        {
            responseBody = providerType == "anthropic"
                ? await CallAnthropicAsync(resolved, systemPrompt, prompt, cancellationToken)
                : await CallOpenAIAsync(resolved, systemPrompt, prompt, cancellationToken);
        }
        catch (Exception ex)
        {
            AuxiliaryUsageLog.Record(resolved, "personaGenerator", false, startedAt, ex.GetBaseException().Message);
            throw;
        }

        var draft = ParseDraftResponse(responseBody);
        AuxiliaryUsageLog.Record(
            resolved, "personaGenerator", true, startedAt,
            usage: AuxiliaryUsageLog.ReadUsage(responseBody, providerType));
        return draft;
    }

    // ── LLM API calls (non-streaming) ──

    private static async Task<string> CallOpenAIAsync(
        ResolvedProviderConfig provider, string systemPrompt, string userPrompt, CancellationToken cancellationToken)
    {
        var baseUrl = provider.BaseUrl.Trim().TrimEnd('/');
        var apiKey = provider.ApiKey;
        var url = $"{baseUrl}/chat/completions";

        var body = BuildOpenAIBody(provider.Model, systemPrompt, userPrompt);
        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        if (!string.IsNullOrEmpty(apiKey))
        {
            request.Headers.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);
        }

        using var response = await Http.SendAsync(request, cancellationToken);
        var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Persona generation failed HTTP {(int)response.StatusCode}: {Truncate(responseBody, 300)}");
        }

        return responseBody;
    }

    private static async Task<string> CallAnthropicAsync(
        ResolvedProviderConfig provider, string systemPrompt, string userPrompt, CancellationToken cancellationToken)
    {
        var baseUrl = provider.BaseUrl.Trim().TrimEnd('/');
        var url = $"{baseUrl}/v1/messages";

        var body = BuildAnthropicBody(provider.Model, systemPrompt, userPrompt);
        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Add("x-api-key", provider.ApiKey);
        request.Headers.Add("anthropic-version", "2023-06-01");
        request.Content = new StringContent(body, Encoding.UTF8, "application/json");

        using var response = await Http.SendAsync(request, cancellationToken);
        var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Persona generation failed HTTP {(int)response.StatusCode}: {Truncate(responseBody, 300)}");
        }

        return responseBody;
    }

    // ── Request body builders ──

    private static string BuildOpenAIBody(string model, string systemPrompt, string userPrompt)
    {
        using var stream = new MemoryStream();
        using var writer = new Utf8JsonWriter(stream, WriterOptions);
        writer.WriteStartObject();
        writer.WriteString("model", model);
        writer.WriteNumber("max_tokens", 4096);
        writer.WriteNumber("temperature", 0.8);
        writer.WriteStartArray("messages");

        writer.WriteStartObject();
        writer.WriteString("role", "system");
        writer.WriteString("content", systemPrompt);
        writer.WriteEndObject();

        writer.WriteStartObject();
        writer.WriteString("role", "user");
        writer.WriteString("content", userPrompt);
        writer.WriteEndObject();

        writer.WriteEndArray();
        writer.WriteEndObject();
        writer.Flush();
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static string BuildAnthropicBody(string model, string systemPrompt, string userPrompt)
    {
        using var stream = new MemoryStream();
        using var writer = new Utf8JsonWriter(stream, WriterOptions);
        writer.WriteStartObject();
        writer.WriteString("model", model);
        writer.WriteNumber("max_tokens", 4096);
        writer.WriteString("system", systemPrompt);
        writer.WriteStartArray("messages");

        writer.WriteStartObject();
        writer.WriteString("role", "user");
        writer.WriteString("content", userPrompt);
        writer.WriteEndObject();

        writer.WriteEndArray();
        writer.WriteEndObject();
        writer.Flush();
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    // ── Response parsing ──

    private static JsonObject ParseDraftResponse(string responseBody)
    {
        using var document = JsonDocument.Parse(responseBody);
        var root = document.RootElement;

        // Extract text content from OpenAI or Anthropic response
        var text = ExtractText(root);
        if (string.IsNullOrWhiteSpace(text))
        {
            throw new InvalidOperationException("LLM returned empty response for persona generation");
        }

        // The model should return a JSON block. Try to extract it.
        var json = ExtractJsonFromText(text);
        using var draftDoc = JsonDocument.Parse(json);
        var draft = draftDoc.RootElement;

        return new JsonObject
        {
            ["name"] = JsonHelpers.GetString(draft, "name") ?? "New Persona",
            ["tagline"] = JsonHelpers.GetString(draft, "tagline") ?? string.Empty,
            ["description"] = JsonHelpers.GetString(draft, "description") ?? string.Empty,
            ["identityMarkdown"] = JsonHelpers.GetString(draft, "identity") ?? string.Empty,
            ["soulMarkdown"] = JsonHelpers.GetString(draft, "soul") ?? string.Empty,
            ["ontologyMarkdown"] = JsonHelpers.GetString(draft, "ontology") ?? string.Empty,
            ["agentsMarkdown"] = JsonHelpers.GetString(draft, "agents") ?? string.Empty,
            ["isDraft"] = true
        };
    }

    private static string ExtractText(JsonElement root)
    {
        // OpenAI format: choices[0].message.content
        if (root.TryGetProperty("choices", out var choices) &&
            choices.ValueKind == JsonValueKind.Array &&
            choices.GetArrayLength() > 0)
        {
            var choice = choices[0];
            if (choice.TryGetProperty("message", out var message) &&
                message.TryGetProperty("content", out var content) &&
                content.ValueKind == JsonValueKind.String)
            {
                return content.GetString() ?? string.Empty;
            }
        }

        // Anthropic format: content[0].text
        if (root.TryGetProperty("content", out var contentArray) &&
            contentArray.ValueKind == JsonValueKind.Array &&
            contentArray.GetArrayLength() > 0)
        {
            var firstBlock = contentArray[0];
            if (firstBlock.TryGetProperty("text", out var textProp) &&
                textProp.ValueKind == JsonValueKind.String)
            {
                return textProp.GetString() ?? string.Empty;
            }
        }

        return string.Empty;
    }

    private static string ExtractJsonFromText(string text)
    {
        // Try to find a JSON object in the text (may be wrapped in ```json ... ```)
        var trimmed = text.Trim();

        // Strip markdown code fences
        if (trimmed.StartsWith("```"))
        {
            var firstNewline = trimmed.IndexOf('\n');
            if (firstNewline >= 0)
            {
                trimmed = trimmed[(firstNewline + 1)..];
            }
            var lastFence = trimmed.LastIndexOf("```");
            if (lastFence >= 0)
            {
                trimmed = trimmed[..lastFence];
            }
            trimmed = trimmed.Trim();
        }

        // Find the outermost { ... }
        var start = trimmed.IndexOf('{');
        var end = trimmed.LastIndexOf('}');
        if (start >= 0 && end > start)
        {
            return trimmed[start..(end + 1)];
        }

        return trimmed;
    }

    // ── Helpers ──

    private static string Truncate(string? text, int maxLength)
    {
        if (string.IsNullOrEmpty(text)) return string.Empty;
        return text.Length <= maxLength ? text : text[..maxLength];
    }
}

using System.Net.Http;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using WishfulClaw.Core.Protocol;

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
        CancellationToken cancellationToken = default)
    {
        var providerType = JsonHelpers.GetString(provider, "type") ?? "openai-chat";
        var systemPrompt = PersonaGenerationPrompt.Build(referencePersonaId, workingFolder);

        var responseBody = providerType switch
        {
            "anthropic" => await CallAnthropicAsync(provider, systemPrompt, prompt, cancellationToken),
            _ => await CallOpenAIAsync(provider, systemPrompt, prompt, cancellationToken)
        };

        return ParseDraftResponse(responseBody);
    }

    // ── LLM API calls (non-streaming) ──

    private static async Task<string> CallOpenAIAsync(
        JsonElement provider, string systemPrompt, string userPrompt, CancellationToken cancellationToken)
    {
        var model = JsonHelpers.GetString(provider, "model") ?? "gpt-4o-mini";
        var baseUrl = (JsonHelpers.GetString(provider, "baseUrl") ?? "https://api.openai.com/v1")
            .Trim().TrimEnd('/');
        var apiKey = JsonHelpers.GetString(provider, "apiKey") ?? string.Empty;
        var url = $"{baseUrl}/chat/completions";

        var body = BuildOpenAIBody(model, systemPrompt, userPrompt);
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
        JsonElement provider, string systemPrompt, string userPrompt, CancellationToken cancellationToken)
    {
        var model = JsonHelpers.GetString(provider, "model") ?? "claude-3-5-haiku-20241022";
        var baseUrl = (JsonHelpers.GetString(provider, "baseUrl") ?? "https://api.anthropic.com")
            .Trim().TrimEnd('/');
        var apiKey = JsonHelpers.GetString(provider, "apiKey") ?? string.Empty;
        var url = $"{baseUrl}/v1/messages";

        var body = BuildAnthropicBody(model, systemPrompt, userPrompt);
        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Add("x-api-key", apiKey);
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

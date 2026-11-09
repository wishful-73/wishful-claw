using System.Net.Http;
using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent.Llm;

/// <summary>
/// HTTP header and body override utilities for provider requests.
/// Reads from provider.requestOverrides configuration.
/// </summary>
public static class ProviderRequestOverrides
{
    // ── Body overrides ──

    public static HashSet<string> GetOmittedBodyKeys(JsonElement provider)
    {
        var result = new HashSet<string>(StringComparer.Ordinal);
        if (!provider.TryGetProperty("requestOverrides", out var overrides) ||
            overrides.ValueKind != JsonValueKind.Object ||
            !overrides.TryGetProperty("omitBodyKeys", out var keys) ||
            keys.ValueKind != JsonValueKind.Array)
        {
            return result;
        }

        foreach (var key in keys.EnumerateArray())
        {
            if (key.ValueKind == JsonValueKind.String && key.GetString() is { Length: > 0 } value)
            {
                result.Add(value);
            }
        }
        return result;
    }

    public static void WriteBodyOverrides(
        Utf8JsonWriter writer,
        JsonElement provider,
        HashSet<string>? omitted = null)
    {
        if (!provider.TryGetProperty("requestOverrides", out var overrides) ||
            overrides.ValueKind != JsonValueKind.Object ||
            !overrides.TryGetProperty("body", out var body) ||
            body.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        foreach (var property in body.EnumerateObject())
        {
            if (omitted?.Contains(property.Name) == true)
            {
                continue;
            }
            property.WriteTo(writer);
        }
    }

    // ── Header overrides ──

    public static void ApplyHttpHeaderOverrides(
        HttpRequestMessage request,
        JsonElement provider,
        Func<string, bool>? shouldSkip = null)
    {
        if (!provider.TryGetProperty("requestOverrides", out var overrides) ||
            overrides.ValueKind != JsonValueKind.Object ||
            !overrides.TryGetProperty("headers", out var headers) ||
            headers.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        foreach (var property in headers.EnumerateObject())
        {
            if (property.Value.ValueKind != JsonValueKind.String ||
                shouldSkip?.Invoke(property.Name) == true)
            {
                continue;
            }

            var value = ResolveHeaderTemplate(property.Value.GetString() ?? string.Empty, provider);
            if (value.Length == 0)
            {
                continue;
            }
            request.Headers.Remove(property.Name);
            request.Headers.TryAddWithoutValidation(property.Name, value);
        }
    }

    public static void ApplyDebugHeaderOverrides(
        Dictionary<string, string> headers,
        JsonElement provider,
        Func<string, bool>? shouldSkip = null)
    {
        if (!provider.TryGetProperty("requestOverrides", out var overrides) ||
            overrides.ValueKind != JsonValueKind.Object ||
            !overrides.TryGetProperty("headers", out var overrideHeaders) ||
            overrideHeaders.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        foreach (var property in overrideHeaders.EnumerateObject())
        {
            if (property.Value.ValueKind != JsonValueKind.String ||
                shouldSkip?.Invoke(property.Name) == true)
            {
                continue;
            }

            var value = ResolveHeaderTemplate(property.Value.GetString() ?? string.Empty, provider);
            if (value.Length == 0)
            {
                continue;
            }
            headers[property.Name] = IsSensitiveHeader(property.Name) ? "***" : value;
        }
    }

    /// <summary>
    /// Expands the placeholders a header value may contain. Every placeholder
    /// resolves against a scalar field of the provider payload, so the set is
    /// extensible without threading another parameter through the call chain
    /// (S-316: <c>organization</c> / <c>project</c> were added this way).
    ///
    /// An unknown or empty field expands to an empty string, which makes the
    /// caller's <c>Length == 0</c> check drop the header entirely — a preset can
    /// therefore declare <c>OpenAI-Organization: {{organization}}</c>
    /// unconditionally and pay nothing when the user never set one.
    /// </summary>
    public static string ResolveHeaderTemplate(string value, JsonElement provider)
    {
        if (!value.Contains("{{", StringComparison.Ordinal))
        {
            return value.Trim();
        }

        foreach (var field in TemplateFields)
        {
            var resolved = JsonHelpers.GetString(provider, field) ?? string.Empty;
            value = value
                .Replace($"{{{{{field}}}}}", resolved, StringComparison.Ordinal)
                .Replace($"{{{{ {field} }}}}", resolved, StringComparison.Ordinal);
        }

        return value.Trim();
    }

    /// <summary>Provider fields a header value may reference as <c>{{name}}</c>.</summary>
    private static readonly string[] TemplateFields = ["sessionId", "model", "organization", "project"];

    public static bool IsSensitiveHeader(string name)
    {
        return name.Contains("authorization", StringComparison.OrdinalIgnoreCase) ||
            name.Contains("api-key", StringComparison.OrdinalIgnoreCase) ||
            name.Contains("apikey", StringComparison.OrdinalIgnoreCase) ||
            name.Contains("token", StringComparison.OrdinalIgnoreCase);
    }
}

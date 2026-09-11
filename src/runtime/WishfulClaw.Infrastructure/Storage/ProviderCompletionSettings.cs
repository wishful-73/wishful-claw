using System.Text.Json;
using System.Text.Json.Nodes;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Storage;

/// <summary>
/// Worker-owned routing settings for auxiliary provider completions.
/// Empty provider/model pairs mean "not configured" and are deliberately kept
/// separate from the global active model fallback.
/// </summary>
public sealed record ProviderCompletionSettings(
    string? FallbackProviderId = null,
    string? FallbackModelId = null,
    string? PromptOptimizerProviderId = null,
    string? PromptOptimizerModelId = null,
    string? PersonaProviderId = null,
    string? PersonaModelId = null);

public static class ProviderCompletionSettingsStore
{
    private const string ConfigKey = "providerCompletion";

    public static ProviderCompletionSettings Read()
    {
        var node = ConfigStore.GetValueNode(ConfigKey);
        if (node is not JsonObject obj)
        {
            return new();
        }

        return new ProviderCompletionSettings(
            ReadString(obj, "fallbackProviderId"),
            ReadString(obj, "fallbackModelId"),
            ReadString(obj, "promptOptimizerProviderId"),
            ReadString(obj, "promptOptimizerModelId"),
            ReadString(obj, "personaProviderId"),
            ReadString(obj, "personaModelId"));
    }

    public static void Write(ProviderCompletionSettings settings)
    {
        var node = new JsonObject
        {
            ["fallbackProviderId"] = settings.FallbackProviderId,
            ["fallbackModelId"] = settings.FallbackModelId,
            ["promptOptimizerProviderId"] = settings.PromptOptimizerProviderId,
            ["promptOptimizerModelId"] = settings.PromptOptimizerModelId,
            ["personaProviderId"] = settings.PersonaProviderId,
            ["personaModelId"] = settings.PersonaModelId
        };
        ConfigStore.SetValue(ConfigKey, node);
    }

    private static string? ReadString(JsonObject obj, string key)
    {
        return obj.TryGetPropertyValue(key, out var value) &&
               value is JsonValue jsonValue &&
               jsonValue.TryGetValue<string>(out var text) &&
               !string.IsNullOrWhiteSpace(text)
            ? text.Trim()
            : null;
    }
}

public sealed record ResolvedProviderConfig(
    string ProviderId,
    string Type,
    string BaseUrl,
    string ApiKey,
    string Model,
    string Source);

public static class ProviderCompletionResolver
{
    /// <summary>
    /// Resolves one auxiliary request using explicit request data, the
    /// Worker-owned route settings, and finally the caller's global active model.
    /// Provider files and model arrays are checked before a persisted id is used.
    /// </summary>
    public static (ResolvedProviderConfig? Config, string? Error) Resolve(
        JsonElement parameters,
        string requestKind)
    {
        if (TryResolveExplicit(parameters, out var explicitConfig, out var explicitError))
        {
            return (explicitConfig, null);
        }

        if (explicitError is not null)
        {
            WorkerLog.Warn($"auxiliary provider explicit config invalid: {explicitError}");
        }

        var settings = ProviderCompletionSettingsStore.Read();
        var configured = requestKind switch
        {
            "promptOptimizer" => (settings.PromptOptimizerProviderId, settings.PromptOptimizerModelId),
            "persona" => (settings.PersonaProviderId, settings.PersonaModelId),
            _ => (null, null)
        };

        var configuredResult = TryResolveStored(configured.Item1, configured.Item2, "configured", out var configuredError);
        if (configuredResult is not null)
        {
            return (configuredResult, null);
        }
        if (configured.Item1 is not null || configured.Item2 is not null)
        {
            WorkerLog.Warn($"auxiliary provider configured route unavailable kind={requestKind} error={configuredError}");
        }

        var fallbackResult = TryResolveStored(
            settings.FallbackProviderId,
            settings.FallbackModelId,
            "fallback",
            out var fallbackError);
        if (fallbackResult is not null)
        {
            return (fallbackResult, null);
        }
        if (settings.FallbackProviderId is not null || settings.FallbackModelId is not null)
        {
            WorkerLog.Warn($"auxiliary provider fallback unavailable error={fallbackError}");
        }

        if (parameters.TryGetProperty("globalActiveModel", out var global) &&
            global.ValueKind == JsonValueKind.Object)
        {
            var providerId = JsonHelpers.GetString(global, "providerId");
            var modelId = JsonHelpers.GetString(global, "modelId") ?? JsonHelpers.GetString(global, "model");
            var globalResult = TryResolveStored(providerId, modelId, "global", out var globalError);
            if (globalResult is not null)
            {
                return (globalResult, null);
            }

            WorkerLog.Warn($"auxiliary provider global active model unavailable provider={providerId ?? "<none>"} model={modelId ?? "<none>"} error={globalError}");
            return (null, globalError ?? "Global active model is not configured or no longer exists");
        }

        return (null, "No auxiliary provider model is configured");
    }

    private static bool TryResolveExplicit(
        JsonElement parameters,
        out ResolvedProviderConfig? config,
        out string? error)
    {
        config = null;
        error = null;
        if (string.Equals(JsonHelpers.GetString(parameters, "providerRole"), "global", StringComparison.Ordinal))
        {
            return false;
        }
        if (!parameters.TryGetProperty("provider", out var provider) ||
            provider.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        var providerId = JsonHelpers.GetString(provider, "providerId") ?? JsonHelpers.GetString(provider, "id");
        var model = JsonHelpers.GetString(parameters, "model") ?? JsonHelpers.GetString(provider, "model");
        var type = JsonHelpers.GetString(provider, "type");
        var baseUrl = JsonHelpers.GetString(provider, "baseUrl");
        var apiKey = JsonHelpers.GetString(provider, "apiKey") ?? string.Empty;

        if (!string.IsNullOrWhiteSpace(providerId))
        {
            var stored = ProviderStore.GetProviderJson(providerId!);
            if (stored is null)
            {
                error = $"Provider '{providerId}' no longer exists";
                return false;
            }
            type ??= JsonHelpers.GetString(stored.Value, "type");
            baseUrl ??= JsonHelpers.GetString(stored.Value, "baseUrl");
            if (string.IsNullOrEmpty(apiKey)) apiKey = JsonHelpers.GetString(stored.Value, "apiKey") ?? string.Empty;
        }

        if (string.IsNullOrWhiteSpace(providerId) || string.IsNullOrWhiteSpace(model) ||
            string.IsNullOrWhiteSpace(type) || string.IsNullOrWhiteSpace(baseUrl))
        {
            error = "Explicit provider requires providerId, model, type, and baseUrl";
            return false;
        }

        config = new ResolvedProviderConfig(providerId!, type!, baseUrl!, apiKey, model!, "explicit");
        return true;
    }

    private static ResolvedProviderConfig? TryResolveStored(
        string? providerId,
        string? modelId,
        string source,
        out string? error)
    {
        error = null;
        if (string.IsNullOrWhiteSpace(providerId) || string.IsNullOrWhiteSpace(modelId))
        {
            error = "providerId and modelId are required";
            return null;
        }

        var provider = ProviderStore.GetProviderJson(providerId);
        if (provider is null)
        {
            error = $"Provider '{providerId}' no longer exists";
            return null;
        }

        if (!HasModel(provider.Value, modelId))
        {
            error = $"Model '{modelId}' no longer exists in provider '{providerId}'";
            return null;
        }

        var type = JsonHelpers.GetString(provider.Value, "type");
        var baseUrl = JsonHelpers.GetString(provider.Value, "baseUrl");
        if (string.IsNullOrWhiteSpace(type) || string.IsNullOrWhiteSpace(baseUrl))
        {
            error = $"Provider '{providerId}' is incomplete";
            return null;
        }

        return new ResolvedProviderConfig(
            providerId,
            type,
            baseUrl,
            JsonHelpers.GetString(provider.Value, "apiKey") ?? string.Empty,
            modelId,
            source);
    }

    private static bool HasModel(JsonElement provider, string modelId)
    {
        if (!provider.TryGetProperty("models", out var models) || models.ValueKind != JsonValueKind.Array)
        {
            return false;
        }
        foreach (var model in models.EnumerateArray())
        {
            if (string.Equals(JsonHelpers.GetString(model, "id"), modelId, StringComparison.Ordinal))
            {
                return true;
            }
        }
        return false;
    }
}

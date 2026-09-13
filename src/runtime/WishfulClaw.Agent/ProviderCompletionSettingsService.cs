using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Agent;

public static class ProviderCompletionSettingsService
{
    public static WorkerResponse Read(JsonElement parameters)
    {
        return WorkerResponse.Json(
            ProviderCompletionSettingsStore.Read(),
            AgentRuntimeJsonContext.Default.ProviderCompletionSettings);
    }

    public static WorkerResponse Write(JsonElement parameters)
    {
        try
        {
            var settings = JsonSerializer.Deserialize(
                parameters.GetRawText(),
                AgentRuntimeJsonContext.Default.ProviderCompletionSettings);
            if (settings is null)
            {
                return Fail("Invalid provider completion settings");
            }

            if (!IsPair(settings.FallbackProviderId, settings.FallbackModelId) ||
                !IsPair(settings.PromptOptimizerProviderId, settings.PromptOptimizerModelId) ||
                !IsPair(settings.PersonaProviderId, settings.PersonaModelId))
            {
                return Fail("Provider and model must be configured together");
            }

            ProviderCompletionSettingsStore.Write(settings);
            return WorkerResponse.Json(settings, AgentRuntimeJsonContext.Default.ProviderCompletionSettings);
        }
        catch (JsonException)
        {
            return Fail("Invalid provider completion settings");
        }
    }

    private static bool IsPair(string? providerId, string? modelId) =>
        string.IsNullOrWhiteSpace(providerId) == string.IsNullOrWhiteSpace(modelId);

    private static WorkerResponse Fail(string error) =>
        WorkerResponse.Json(
            new ProviderCompletionSettingsResult(false, error),
            AgentRuntimeJsonContext.Default.ProviderCompletionSettingsResult);
}

public sealed record ProviderCompletionSettingsResult(bool Success, string? Error = null);

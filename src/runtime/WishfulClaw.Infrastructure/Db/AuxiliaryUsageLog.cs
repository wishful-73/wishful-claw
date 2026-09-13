using System.Text.Json;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>Token counts read back from a non-streaming auxiliary completion response.</summary>
public readonly record struct AuxiliaryRequestUsage(
    long InputTokens,
    long OutputTokens,
    long CacheReadTokens,
    long CacheCreationTokens,
    long ReasoningTokens);

/// <summary>
/// Minimal request-level accounting for auxiliary chains that do not use the
/// AgentLoop retry policy. The source is stored in RuntimeRole so the usage UI
/// can distinguish prompt optimization, persona generation, and automation.
/// </summary>
public static class AuxiliaryUsageLog
{
    /// <param name="totalAttempts">
    /// HTTP attempts the chain actually made for this one logical request. The
    /// auxiliary chains write a single terminal row instead of one per attempt, so
    /// this is the only place their internal retries stay visible.
    /// </param>
    public static void Record(
        ResolvedProviderConfig provider,
        string source,
        bool success,
        long startedAt,
        string? error = null,
        AuxiliaryRequestUsage? usage = null,
        int totalAttempts = 1)
    {
        try
        {
            var row = new RequestUsageLogEntity
            {
                Id = Guid.NewGuid().ToString("N"),
                RuntimeRole = source,
                // No session owns an auxiliary single-shot request, so it has neither a
                // project/global scope nor a chat/cowork mode. Recording "chat" here would
                // mislabel an optimizer call made from inside a cowork session.
                Scope = "unknown",
                CollaborationMode = "unknown",
                ProviderId = provider.ProviderId,
                ProviderType = provider.Type,
                ModelId = provider.Model,
                Status = success ? "success" : "error",
                ErrorKind = success ? null : "auxiliary",
                ErrorMessage = success ? null : error,
                AttemptIndex = 1,
                TotalAttempts = Math.Max(1, totalAttempts),
                StartedAt = startedAt,
                CompletedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };
            row.DurationMs = Math.Max(0, row.CompletedAt.Value - startedAt);
            if (usage is { } tokens)
            {
                row.InputTokens = tokens.InputTokens;
                row.OutputTokens = tokens.OutputTokens;
                row.CacheReadTokens = tokens.CacheReadTokens;
                row.CacheCreationTokens = tokens.CacheCreationTokens;
                row.ReasoningTokens = tokens.ReasoningTokens;
                row.BillableInputTokens = DbUsageLogTools.ComputeBillableInput(
                    tokens.InputTokens, tokens.CacheReadTokens, tokens.CacheCreationTokens);
            }

            var configuredProvider = ProviderStore.GetProviderJson(provider.ProviderId);
            if (configuredProvider is { } config)
            {
                DbUsageLogTools.ApplyCosts(row, config, provider.Model);
            }
            DbUsageLogTools.Insert(row);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"auxiliary usage logging failed source={source}: {ex.Message}");
        }
    }

    /// <summary>
    /// Read the usage block of a single-shot completion response. Both protocol
    /// shapes are covered; a body without usage (or a malformed one) yields null so
    /// the row keeps zero tokens instead of inventing any.
    /// </summary>
    public static AuxiliaryRequestUsage? ReadUsage(string body, string providerType)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            if (!document.RootElement.TryGetProperty("usage", out var usage) ||
                usage.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            return providerType == "anthropic"
                ? new AuxiliaryRequestUsage(
                    JsonHelpers.GetInt(usage, "input_tokens", 0),
                    JsonHelpers.GetInt(usage, "output_tokens", 0),
                    JsonHelpers.GetInt(usage, "cache_read_input_tokens", 0),
                    JsonHelpers.GetInt(usage, "cache_creation_input_tokens", 0),
                    0)
                : ReadOpenAiUsage(usage);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"auxiliary usage parse failed: {ex.Message}");
            return null;
        }
    }

    private static AuxiliaryRequestUsage ReadOpenAiUsage(JsonElement usage)
    {
        var cacheRead = 0;
        if (usage.TryGetProperty("prompt_tokens_details", out var promptDetails) &&
            promptDetails.ValueKind == JsonValueKind.Object)
        {
            cacheRead = JsonHelpers.GetInt(promptDetails, "cached_tokens", 0);
        }

        var reasoning = 0;
        if (usage.TryGetProperty("completion_tokens_details", out var completionDetails) &&
            completionDetails.ValueKind == JsonValueKind.Object)
        {
            reasoning = JsonHelpers.GetInt(completionDetails, "reasoning_tokens", 0);
        }

        return new AuxiliaryRequestUsage(
            JsonHelpers.GetInt(usage, "prompt_tokens", 0),
            JsonHelpers.GetInt(usage, "completion_tokens", 0),
            cacheRead,
            0,
            reasoning);
    }
}

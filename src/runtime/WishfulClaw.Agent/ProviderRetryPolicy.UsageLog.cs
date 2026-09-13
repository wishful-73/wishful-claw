using System.Text.Json;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Agent;

/// <summary>
/// Request-level usage logging hook (#1, iteration 28).
///
/// The AgentLoop retry path records one row per attempt. Auxiliary paths record
/// one logical request row through <see cref="AuxiliaryUsageLog"/> with a distinct
/// RuntimeRole source, so invisible requests remain observable without pretending
/// they use the AgentLoop retry policy.
///
/// This is a NEW, self-contained statistic. It reads nothing from, and writes
/// nothing to, the existing turn-level session statistics
/// (messages.usage / db/messages-usage-stats) — those are untouched.
/// </summary>
public static partial class ProviderRetryPolicy
{
    /// <summary>
    /// Record one HTTP attempt. Started at the top of each retry iteration; the
    /// terminal call passes the outcome. Never throws.
    /// </summary>
    internal static void LogRequestAttempt(
        AgentRuntimeRunState state,
        JsonElement? provider,
        RequestUsageLogEntity row,
        bool success,
        ProviderHttpException? error,
        AgentRuntimeProviderTurnResult? turn,
        Exception? unexpected)
    {
        try
        {
            row.CompletedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            row.DurationMs = Math.Max(0, row.CompletedAt.Value - row.StartedAt);

            if (success && turn is not null)
            {
                var usage = turn.Usage;
                row.Status = "success";
                if (usage is not null)
                {
                    row.InputTokens = usage.InputTokens;
                    row.OutputTokens = usage.OutputTokens;
                    row.CacheReadTokens = usage.CacheReadTokens ?? 0;
                    row.CacheCreationTokens = usage.CacheCreationTokens ?? 0;
                    row.ReasoningTokens = usage.ReasoningTokens ?? 0;
                    // Authoritative repo-wide definition (see DbUsageLogTools.ComputeBillableInput):
                    // never the provider-side fallback that omits cache-creation tokens.
                    row.BillableInputTokens = DbUsageLogTools.ComputeBillableInput(
                        row.InputTokens, row.CacheReadTokens, row.CacheCreationTokens);
                }
            }
            else
            {
                row.Status = "error";
                if (error is not null)
                {
                    row.HttpStatusCode = error.StatusCode;
                    row.ErrorKind = ClassifyError(error.StatusCode);
                    row.ErrorMessage = Truncate(error.Message, 500);
                }
                else if (unexpected is not null)
                {
                    row.ErrorKind = unexpected is TimeoutException ? "timeout" : "exception";
                    row.ErrorMessage = Truncate(unexpected.GetBaseException().Message, 500);
                }
            }

            // The sidecar request payload carries providerId but not the persisted
            // model catalog. Load the provider config in the worker so prices come
            // from the user's configured model, not an incomplete IPC payload.
            if (!string.IsNullOrWhiteSpace(row.ProviderId))
            {
                var configuredProvider = ProviderStore.GetProviderJson(row.ProviderId);
                if (configuredProvider is { } config)
                {
                    DbUsageLogTools.ApplyCosts(row, config, row.ModelId);
                }
            }

            DbUsageLogTools.Insert(row);
        }
        catch (Exception ex)
        {
            // Logging must never break the agent turn.
            WorkerLog.Warn($"ProviderRetryPolicy: usage logging failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Build the invariant part of a request-log row from the run context. Token,
    /// status and timing fields are filled later by <see cref="LogRequestAttempt"/>.
    /// </summary>
    internal static RequestUsageLogEntity CreateRequestLogRow(
        AgentRuntimeRunState state,
        JsonElement? provider,
        int attemptIndex)
    {
        var row = new RequestUsageLogEntity
        {
            Id = Guid.NewGuid().ToString("N"),
            SessionId = string.IsNullOrEmpty(state.SessionId) ? null : state.SessionId,
            AttemptIndex = attemptIndex,
            StartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };

        try
        {
            var parameters = state.Parameters;
            var ctx = AgentRunContextPolicy.Resolve(parameters);
            row.Scope = ctx.Scope;
            row.CollaborationMode = ctx.CollaborationMode;
            row.RuntimeRole = JsonHelpers.GetString(parameters, "usageSource") ?? ctx.RuntimeRole;
        }
        catch (Exception ex)
        {
            // Resolve() throws for scope=project without projectId; do not let that
            // cost us the row — the request itself is still worth logging.
            WorkerLog.Warn($"ProviderRetryPolicy: could not resolve run context for usage log: {ex.Message}");
        }

        if (provider is { } p)
        {
            row.ProviderId = JsonHelpers.GetString(p, "providerId") ?? JsonHelpers.GetString(p, "id");
            row.ProviderType = JsonHelpers.GetString(p, "type");
            row.ModelId = JsonHelpers.GetString(p, "model");
        }

        return row;
    }

    /// <summary>Coarse, groupable failure kind derived from the HTTP status.</summary>
    private static string ClassifyError(int statusCode) => statusCode switch
    {
        400 => "http_400",
        401 => "http_401",
        403 => "http_403",
        404 => "http_404",
        408 => "http_408",
        413 => "http_413",
        429 => "http_429",
        >= 500 => "http_5xx",
        _ => $"http_{statusCode}"
    };

    private static string Truncate(string value, int max)
        => value.Length <= max ? value : value[..max];
}

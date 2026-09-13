using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Write access for the request-level usage log (#1, iteration 28).
///
/// Called from the Agent layer (ProviderRetryPolicy) once per HTTP request attempt.
/// The Agent layer is permitted to call down into Infrastructure, so the hook needs
/// no new abstraction — it reads provider prices here, computes cost here, and
/// writes here, keeping the Agent side free of pricing knowledge.
///
/// Cost policy (usage-analytics-requirement.md section 6.4): multiply by the prices
/// explicitly configured on the model. A missing price yields a NULL cost column —
/// never 0, never an extrapolated value, and no fallback multipliers.
/// </summary>
public static partial class DbUsageLogTools
{
    /// <summary>
    /// Persist one request attempt. Never throws: a logging failure must not break
    /// the agent turn, so all exceptions are swallowed into a warning.
    /// </summary>
    public static void Insert(RequestUsageLogEntity row)
    {
        try
        {
            var db = DbClient.GetClient();
            if (db is null) return;

            const string sql = @"INSERT OR REPLACE INTO request_usage_logs (
                id, session_id, runtime_role, scope, collaboration_mode,
                provider_id, provider_type, model_id,
                status, error_kind, error_message, http_status_code,
                attempt_index, total_attempts,
                input_tokens, billable_input_tokens, output_tokens,
                cache_read_tokens, cache_creation_tokens, reasoning_tokens,
                input_cost, output_cost, cache_creation_cost, cache_hit_cost, total_cost_usd,
                started_at, completed_at, duration_ms, ttft_ms, tps,
                switched_from_provider_id
            ) VALUES (
                $id, $sessionId, $runtimeRole, $scope, $collaborationMode,
                $providerId, $providerType, $modelId,
                $status, $errorKind, $errorMessage, $httpStatusCode,
                $attemptIndex, $totalAttempts,
                $inputTokens, $billableInputTokens, $outputTokens,
                $cacheReadTokens, $cacheCreationTokens, $reasoningTokens,
                $inputCost, $outputCost, $cacheCreationCost, $cacheHitCost, $totalCostUsd,
                $startedAt, $completedAt, $durationMs, $ttftMs, $tps,
                $switchedFromProviderId
            );";

            db.Execute(
                sql,
                new SqliteParameter("$id", row.Id),
                new SqliteParameter("$sessionId", (object?)row.SessionId ?? DBNull.Value),
                new SqliteParameter("$runtimeRole", (object?)row.RuntimeRole ?? DBNull.Value),
                new SqliteParameter("$scope", (object?)row.Scope ?? DBNull.Value),
                new SqliteParameter("$collaborationMode", (object?)row.CollaborationMode ?? DBNull.Value),
                new SqliteParameter("$providerId", (object?)row.ProviderId ?? DBNull.Value),
                new SqliteParameter("$providerType", (object?)row.ProviderType ?? DBNull.Value),
                new SqliteParameter("$modelId", (object?)row.ModelId ?? DBNull.Value),
                new SqliteParameter("$status", row.Status),
                new SqliteParameter("$errorKind", (object?)row.ErrorKind ?? DBNull.Value),
                new SqliteParameter("$errorMessage", (object?)row.ErrorMessage ?? DBNull.Value),
                new SqliteParameter("$httpStatusCode", (object?)row.HttpStatusCode ?? DBNull.Value),
                new SqliteParameter("$attemptIndex", row.AttemptIndex),
                new SqliteParameter("$totalAttempts", (object?)row.TotalAttempts ?? DBNull.Value),
                new SqliteParameter("$inputTokens", row.InputTokens),
                new SqliteParameter("$billableInputTokens", row.BillableInputTokens),
                new SqliteParameter("$outputTokens", row.OutputTokens),
                new SqliteParameter("$cacheReadTokens", row.CacheReadTokens),
                new SqliteParameter("$cacheCreationTokens", row.CacheCreationTokens),
                new SqliteParameter("$reasoningTokens", row.ReasoningTokens),
                new SqliteParameter("$inputCost", (object?)row.InputCost ?? DBNull.Value),
                new SqliteParameter("$outputCost", (object?)row.OutputCost ?? DBNull.Value),
                new SqliteParameter("$cacheCreationCost", (object?)row.CacheCreationCost ?? DBNull.Value),
                new SqliteParameter("$cacheHitCost", (object?)row.CacheHitCost ?? DBNull.Value),
                new SqliteParameter("$totalCostUsd", (object?)row.TotalCostUsd ?? DBNull.Value),
                new SqliteParameter("$startedAt", row.StartedAt),
                new SqliteParameter("$completedAt", (object?)row.CompletedAt ?? DBNull.Value),
                new SqliteParameter("$durationMs", row.DurationMs),
                new SqliteParameter("$ttftMs", (object?)row.TtftMs ?? DBNull.Value),
                new SqliteParameter("$tps", (object?)row.Tps ?? DBNull.Value),
                new SqliteParameter("$switchedFromProviderId", (object?)row.SwitchedFromProviderId ?? DBNull.Value));
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"DbUsageLogTools.Insert failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Billable input tokens — the authoritative repo-wide definition, matching
    /// DbMessageCompactTools.cs:186 and format-tokens.ts:46-51. Deliberately NOT the
    /// provider-side fallback (input − cacheRead only), which under-counts by the
    /// cache-creation tokens. Keep this in one place so the panel and the existing
    /// session statistics cannot diverge.
    /// </summary>
    public static long ComputeBillableInput(long input, long cacheRead, long cacheCreation)
        => Math.Max(0, input - Math.Max(0, cacheRead) - Math.Max(0, cacheCreation));

    /// <summary>
    /// Fill the four cost columns from the model's explicitly configured prices.
    /// Mirrors the token shape: input / output / cache-creation / cache-hit. Any
    /// component whose price is absent stays NULL; the total is the sum of whatever
    /// components are non-null, and NULL itself when none are.
    /// </summary>
    public static void ApplyCosts(RequestUsageLogEntity row, JsonElement? provider, string? modelId)
    {
        if (provider is not { } p || string.IsNullOrEmpty(modelId)) return;

        var pricing = FindModelPricing(p, modelId);
        if (pricing is not { } price) return;

        // Prices are per 1M tokens in provider config.
        row.InputCost = Compute(price.InputPrice, row.BillableInputTokens);
        row.OutputCost = Compute(price.OutputPrice, row.OutputTokens);
        row.CacheCreationCost = Compute(price.CacheCreationPrice, row.CacheCreationTokens);
        row.CacheHitCost = Compute(price.CacheHitPrice, row.CacheReadTokens);

        var parts = new[] { row.InputCost, row.OutputCost, row.CacheCreationCost, row.CacheHitCost }
            .Where(v => v.HasValue)
            .Select(v => v!.Value)
            .ToList();
        row.TotalCostUsd = parts.Count > 0 ? parts.Sum() : null;
    }

    private static double? Compute(double? pricePerMillion, long tokens)
        => pricePerMillion is { } price ? price * tokens / 1_000_000d : null;

    private sealed record ModelPricing(
        double? InputPrice,
        double? OutputPrice,
        double? CacheHitPrice,
        double? CacheCreationPrice);

    /// <summary>
    /// Locate a model's pricing inside the provider payload. Provider config uses
    /// JsonNode/JsonElement (never strong types), so this parses defensively and
    /// returns null when the model or its prices are absent.
    /// </summary>
    private static ModelPricing? FindModelPricing(JsonElement provider, string modelId)
    {
        if (!provider.TryGetProperty("models", out var models) || models.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var model in models.EnumerateArray())
        {
            if (model.ValueKind != JsonValueKind.Object) continue;
            var id = JsonHelpers.GetString(model, "id") ?? JsonHelpers.GetString(model, "name");
            if (!string.Equals(id, modelId, StringComparison.Ordinal)) continue;

            return new ModelPricing(
                GetDouble(model, "inputPrice"),
                GetDouble(model, "outputPrice"),
                GetDouble(model, "cacheHitPrice"),
                GetDouble(model, "cacheCreationPrice"));
        }

        return null;
    }

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var el)) return null;
        if (el.ValueKind == JsonValueKind.Number) return el.GetDouble();
        if (el.ValueKind == JsonValueKind.String &&
            double.TryParse(el.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed;
        }
        return null;
    }

    /// <summary>Serialize an entity for IPC responses.</summary>
    public static string ToJson(RequestUsageLogEntity e)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("id", e.Id);
            WriteNullable(writer, "sessionId", e.SessionId);
            WriteNullable(writer, "runtimeRole", e.RuntimeRole);
            WriteNullable(writer, "scope", e.Scope);
            WriteNullable(writer, "collaborationMode", e.CollaborationMode);
            WriteNullable(writer, "providerId", e.ProviderId);
            WriteNullable(writer, "providerType", e.ProviderType);
            WriteNullable(writer, "modelId", e.ModelId);
            writer.WriteString("status", e.Status);
            WriteNullable(writer, "errorKind", e.ErrorKind);
            WriteNullable(writer, "errorMessage", e.ErrorMessage);
            if (e.HttpStatusCode is { } code) writer.WriteNumber("httpStatusCode", code); else writer.WriteNull("httpStatusCode");
            writer.WriteNumber("attemptIndex", e.AttemptIndex);
            if (e.TotalAttempts is { } ta) writer.WriteNumber("totalAttempts", ta); else writer.WriteNull("totalAttempts");
            writer.WriteNumber("inputTokens", e.InputTokens);
            writer.WriteNumber("billableInputTokens", e.BillableInputTokens);
            writer.WriteNumber("outputTokens", e.OutputTokens);
            writer.WriteNumber("cacheReadTokens", e.CacheReadTokens);
            writer.WriteNumber("cacheCreationTokens", e.CacheCreationTokens);
            writer.WriteNumber("reasoningTokens", e.ReasoningTokens);
            WriteNullableNumber(writer, "inputCost", e.InputCost);
            WriteNullableNumber(writer, "outputCost", e.OutputCost);
            WriteNullableNumber(writer, "cacheCreationCost", e.CacheCreationCost);
            WriteNullableNumber(writer, "cacheHitCost", e.CacheHitCost);
            WriteNullableNumber(writer, "totalCostUsd", e.TotalCostUsd);
            writer.WriteNumber("startedAt", e.StartedAt);
            if (e.CompletedAt is { } ca) writer.WriteNumber("completedAt", ca); else writer.WriteNull("completedAt");
            writer.WriteNumber("durationMs", e.DurationMs);
            if (e.TtftMs is { } ttft) writer.WriteNumber("ttftMs", ttft); else writer.WriteNull("ttftMs");
            WriteNullableNumber(writer, "tps", e.Tps);
            WriteNullable(writer, "switchedFromProviderId", e.SwitchedFromProviderId);
            writer.WriteEndObject();
        }
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    private static void WriteNullable(Utf8JsonWriter writer, string name, string? value)
    {
        if (value is null) writer.WriteNull(name); else writer.WriteString(name, value);
    }

    private static void WriteNullableNumber(Utf8JsonWriter writer, string name, double? value)
    {
        if (value is null) writer.WriteNull(name); else writer.WriteNumber(name, value.Value);
    }
}

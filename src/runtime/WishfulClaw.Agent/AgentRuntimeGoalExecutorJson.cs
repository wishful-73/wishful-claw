/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

public static partial class AgentRuntimeGoalExecutor
{
    public static string? BuildGoalModelConfigJson(JsonElement modelConfig)
    {
        if (modelConfig.ValueKind != JsonValueKind.Object)
            return null;

        var providerId = JsonHelpers.GetString(modelConfig, "providerId")?.Trim();
        var providerType = JsonHelpers.GetString(modelConfig, "providerType")?.Trim();
        var model = JsonHelpers.GetString(modelConfig, "model")?.Trim();
        if (string.IsNullOrEmpty(providerId) || string.IsNullOrEmpty(providerType) || string.IsNullOrEmpty(model))
            return null;

        return WorkerJsonHelper.BuildJsonString(w =>
        {
            w.WriteStartObject();
            w.WriteString("providerId", providerId);
            w.WriteString("providerType", providerType);
            w.WriteString("model", model);
            CopyString(w, modelConfig, "baseUrl");
            CopyNumberOrNull(w, modelConfig, "temperature");
            CopyNumberOrNull(w, modelConfig, "maxTokens");
            CopyBoolean(w, modelConfig, "thinkingEnabled");
            CopyObject(w, modelConfig, "thinkingConfig");
            CopyString(w, modelConfig, "reasoningEffort");
            CopyNumberOrNull(w, modelConfig, "requestTimeoutSeconds");
            CopyNumberOrNull(w, modelConfig, "requestMaxRetries");
            w.WriteEndObject();
        });
    }

    private static void CopyBoolean(Utf8JsonWriter writer, JsonElement source, string name)
    {
        if (source.ValueKind == JsonValueKind.Object
            && source.TryGetProperty(name, out var value)
            && (value.ValueKind == JsonValueKind.True || value.ValueKind == JsonValueKind.False))
        {
            writer.WriteBoolean(name, value.GetBoolean());
        }
    }

    private static void CopyNumberOrNull(Utf8JsonWriter writer, JsonElement source, string name)
    {
        if (source.ValueKind == JsonValueKind.Object && source.TryGetProperty(name, out var value)
            && (value.ValueKind == JsonValueKind.Number || value.ValueKind == JsonValueKind.Null))
        {
            writer.WritePropertyName(name);
            value.WriteTo(writer);
        }
    }

    private static void CopyObject(Utf8JsonWriter writer, JsonElement source, string name)
    {
        if (source.ValueKind == JsonValueKind.Object && source.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.Object)
        {
            writer.WritePropertyName(name);
            value.WriteTo(writer);
        }
    }

    private static JsonElement BuildCreateParameters(
        string sessionId,
        string goalId,
        string objective,
        string? workingFolder,
        string status)
        => WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("sessionId", sessionId);
            w.WriteString("goalId", goalId);
            w.WriteString("objective", objective);
            w.WriteString("status", status);
            if (!string.IsNullOrEmpty(workingFolder))
                w.WriteString("workingFolder", workingFolder);
            w.WriteEndObject();
        });

    private static JsonElement BuildUpdateParameters(
        JsonElement parameters,
        string sessionId,
        string goalId,
        string? objective,
        string? status)
        => WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("sessionId", sessionId);
            w.WriteString("goalId", goalId);
            if (parameters.ValueKind == JsonValueKind.Object
                && parameters.TryGetProperty("dbPath", out var dbPath)
                && dbPath.ValueKind == JsonValueKind.String)
            {
                w.WriteString("dbPath", dbPath.GetString());
            }
            w.WriteStartObject("patch");
            if (!string.IsNullOrEmpty(objective))
                w.WriteString("objective", objective);
            if (!string.IsNullOrEmpty(status))
                w.WriteString("status", status);
            w.WriteEndObject();
            w.WriteEndObject();
        });

    private static JsonElement BuildGoalPageParameters(
        JsonElement input,
        JsonElement parameters,
        string sessionId)
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            CopyDbPath(writer, parameters);
            writer.WriteString("sessionId", sessionId);
            CopyNumber(writer, input, "limit");
            CopyNumber(writer, input, "cursorCurrentRank");
            CopyNumber(writer, input, "cursorUpdatedAt");
            CopyString(writer, input, "cursorGoalId");
            writer.WriteEndObject();
        });

    private static JsonElement BuildGoalHistoryParameters(
        JsonElement input,
        JsonElement parameters,
        string sessionId,
        string goalId)
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            CopyDbPath(writer, parameters);
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("goalId", goalId);
            CopyNumber(writer, input, "limit");
            CopyNumber(writer, input, "cursorCreatedAt");
            CopyNumber(writer, input, "cursorEventId");
            writer.WriteEndObject();
        });

    private static JsonElement BuildReopenParameters(
        JsonElement input,
        JsonElement parameters,
        string sessionId,
        string goalId)
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            CopyDbPath(writer, parameters);
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("goalId", goalId);
            CopyString(writer, input, "objective");
            writer.WriteEndObject();
        });

    private static void CopyDbPath(Utf8JsonWriter writer, JsonElement parameters)
        => CopyString(writer, parameters, "dbPath");

    private static void CopyString(Utf8JsonWriter writer, JsonElement source, string name)
    {
        if (source.ValueKind == JsonValueKind.Object
            && source.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.String)
        {
            writer.WriteString(name, value.GetString());
        }
    }

    private static void CopyNumber(Utf8JsonWriter writer, JsonElement source, string name)
    {
        if (source.ValueKind == JsonValueKind.Object
            && source.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.Number)
        {
            writer.WritePropertyName(name);
            value.WriteTo(writer);
        }
    }

    private static string EncodeResult(GoalToolResult result)
        => JsonSerializer.Serialize(
            result,
            AgentRuntimeJsonContext.Default.GoalToolResult);

    private static string EncodeGoalPage(GoalToolPageResult result)
        => JsonSerializer.Serialize(
            result,
            AgentRuntimeJsonContext.Default.GoalToolPageResult);

    private static string EncodeGoalHistory(GoalToolHistoryResult result)
        => JsonSerializer.Serialize(
            result,
            AgentRuntimeJsonContext.Default.GoalToolHistoryResult);

    private static string EncodeError(string message)
        => EncodeResult(new GoalToolResult(Error: message));
}

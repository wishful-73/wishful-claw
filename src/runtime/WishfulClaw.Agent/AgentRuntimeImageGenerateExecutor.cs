/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Agent;

/// <summary>
/// ImageGenerate tool executor — AI image generation via reverse-request to Main process.
/// Simplified port from WishfulClaw (actual generation delegated to Main/renderer).
/// </summary>
public static class AgentRuntimeImageGenerateExecutor
{
    private const string ToolName = "ImageGenerate";

    public static bool IsImageGenerateTool(string toolName)
    {
        return string.Equals(toolName, ToolName, StringComparison.Ordinal);
    }

    public static async Task<string> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        JsonElement parameters,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var prompt = JsonHelpers.GetString(call.Input, "prompt")?.Trim() ?? string.Empty;
        if (prompt.Length == 0)
        {
            return EncodeError("ImageGenerate requires a non-empty prompt.");
        }

        try
        {
            var payload = BuildPayload(call, parameters);
            var result = await AgentRuntimeReverseRequests.RequestAsync(
                context,
                "image:generate",
                payload,
                cancellationToken);

            if (JsonHelpers.GetBool(result, "success", false))
            {
                return result.ValueKind == JsonValueKind.Object &&
                    result.TryGetProperty("result", out var r)
                    ? r.GetRawText()
                    : result.GetRawText();
            }

            return EncodeError(JsonHelpers.GetString(result, "error") ?? "Image generation failed.");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return EncodeError(ex.Message);
        }
    }

    /// <summary>
    /// Builds the `image:generate` reverse request. The explicit image route (the
    /// fourth slot in Settings → 模型管理) rides along as two ids; Main resolves and
    /// validates them, so this side only reads the config and never falls back
    /// (S-173).
    /// </summary>
    private static JsonElement BuildPayload(AgentRuntimeNativeToolCall call, JsonElement parameters)
    {
        var settings = ProviderCompletionSettingsStore.Read();
        var buffer = new System.Buffers.ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("prompt", JsonHelpers.GetString(call.Input, "prompt"));
            writer.WriteNumber("count", JsonHelpers.GetInt(call.Input, "count", 1));
            var size = JsonHelpers.GetString(call.Input, "size");
            if (!string.IsNullOrEmpty(size)) writer.WriteString("size", size);
            var quality = JsonHelpers.GetString(call.Input, "quality");
            if (!string.IsNullOrEmpty(quality)) writer.WriteString("quality", quality);
            if (!string.IsNullOrEmpty(settings.ImageProviderId))
            {
                writer.WriteString("imageProviderId", settings.ImageProviderId);
            }
            if (!string.IsNullOrEmpty(settings.ImageModelId))
            {
                writer.WriteString("imageModelId", settings.ImageModelId);
            }
            writer.WritePropertyName("input");
            call.Input.WriteTo(writer);
            writer.WritePropertyName("parameters");
            parameters.WriteTo(writer);
            writer.WriteEndObject();
        }
        using var doc = JsonDocument.Parse(buffer.WrittenMemory);
        return doc.RootElement.Clone();
    }

    private static string EncodeError(string message)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("error", message);
            writer.WriteEndObject();
        }
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }
}

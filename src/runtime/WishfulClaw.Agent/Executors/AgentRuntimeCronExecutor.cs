/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Buffers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent.Executors;

/// <summary>
/// Cron tool executor — CronAdd/Create/Update/Remove/Delete/List.
/// Routes via reverse-request to Main process for cron schedule management.
/// Ported from WishfulClaw AgentRuntimeCronExecutor.
/// </summary>
public static class AgentRuntimeCronExecutor
{
    private static readonly HashSet<string> CronToolNames = new(StringComparer.Ordinal)
    {
        "CronAdd", "CronCreate", "CronUpdate", "CronRemove", "CronDelete", "CronList"
    };

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static bool IsCronTool(string toolName) => CronToolNames.Contains(toolName);

    public static bool RequiresApproval(string toolName) =>
        toolName is "CronAdd" or "CronCreate" or "CronUpdate";

    public static async Task<string> ExecuteAsync(
        AgentRuntimeNativeToolCall call, JsonElement parameters,
        IWorkerRequestContext context, CancellationToken cancellationToken)
    {
        var method = call.Name switch
        {
            "CronAdd" or "CronCreate" => "cron:add",
            "CronUpdate" => "cron:update",
            "CronRemove" or "CronDelete" => "cron:delete",
            "CronList" => "cron:list",
            _ => null
        };

        if (method is null)
            return EncodeError($"Unsupported cron tool: {call.Name}");

        var payload = CreateJsonObject(w =>
        {
            w.WriteString("toolName", call.Name);
            w.WritePropertyName("input");
            call.Input.WriteTo(writer: w);
            if (parameters.ValueKind == JsonValueKind.Object)
            {
                w.WritePropertyName("parameters");
                parameters.WriteTo(w);
            }
        });

        try
        {
            var response = await AgentRuntimeReverseRequests.RequestAsync(context, method, payload, cancellationToken);
            var error = JsonHelpers.GetString(response, "error") ?? string.Empty;
            return error.Length > 0 ? EncodeError(error) : response.GetRawText();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return EncodeError(ex.Message);
        }
    }

    private static JsonElement CreateJsonObject(Action<Utf8JsonWriter> writeProperties)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        { writer.WriteStartObject(); writeProperties(writer); writer.WriteEndObject(); }
        using var doc = JsonDocument.Parse(buffer.WrittenMemory);
        return doc.RootElement.Clone();
    }

    private static string EncodeError(string message) =>
        EncodeJsonObject(w => w.WriteString("error", message));

    private static string EncodeJsonObject(Action<Utf8JsonWriter> writeProperties)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        { writer.WriteStartObject(); writeProperties(writer); writer.WriteEndObject(); }
        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }
}

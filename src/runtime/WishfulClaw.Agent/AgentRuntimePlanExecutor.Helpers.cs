/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Buffers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// JSON encoding + utility helpers for plan mode executor.
/// </summary>
public static partial class AgentRuntimePlanExecutor
{
    private static string GetPlanFilePath(string workingFolder, string planId)
    {
        return Path.Combine(workingFolder, WishfulClawPaths.DataDirName, "plans", $"{planId}.md");
    }

    private static string GetStateFilePath(string planFilePath)
    {
        // Replace .md with .state.json
        var dir = Path.GetDirectoryName(planFilePath) ?? string.Empty;
        var name = Path.GetFileNameWithoutExtension(planFilePath);
        return Path.Combine(dir, $"{name}.state.json");
    }

    private static bool IsDraftPlanStatus(string status)
    {
        return status is "drafting" or "rejected";
    }

    private static string InferTitleFromContent(string content)
    {
        foreach (var rawLine in content.Split('\n'))
        {
            var line = rawLine.Trim();
            if (line.Length == 0) continue;
            var title = System.Text.RegularExpressions.Regex
                .Replace(line, @"^#+\s*", string.Empty).Trim();
            title = System.Text.RegularExpressions.Regex
                .Replace(title, @"^plan:\s*", string.Empty, System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();
            return title.Length > 80 ? title[..80] : title.Length > 0 ? title : "Plan";
        }
        return "Plan";
    }

    private static long Now()
    {
        return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    private static string CreatePlanId()
    {
        Span<byte> bytes = stackalloc byte[12];
        RandomNumberGenerator.Fill(bytes);
        Span<char> chars = stackalloc char[12];
        for (var i = 0; i < bytes.Length; i++)
        {
            chars[i] = IdAlphabet[bytes[i] % IdAlphabet.Length];
        }
        return new string(chars);
    }

    private static JsonElement CreateJsonElement(Action<Utf8JsonWriter> writeProperties)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            writeProperties(writer);
            writer.WriteEndObject();
        }
        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    private static string EncodeError(string message)
    {
        return EncodeJsonObject(writer => writer.WriteString("error", message));
    }

    private static string EncodeJsonObject(Action<Utf8JsonWriter> writeProperties)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, WriterOptions))
        {
            writer.WriteStartObject();
            writeProperties(writer);
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static void WritePlanSnapshot(Utf8JsonWriter writer, PlanEntity plan, string? content)
    {
        writer.WriteStartObject();
        writer.WriteString("id", plan.Id);
        writer.WriteString("sessionId", plan.SessionId);
        writer.WriteString("title", plan.Title);
        writer.WriteString("status", plan.Status);
        WriteNullableString(writer, "filePath", plan.FilePath);
        WriteNullableString(writer, "content", content ?? plan.Content);
        WriteNullableString(writer, "specJson", plan.SpecJson);
        writer.WriteNumber("createdAt", plan.CreatedAt);
        writer.WriteNumber("updatedAt", plan.UpdatedAt);
        writer.WriteEndObject();
    }

    private static void WriteNullableString(Utf8JsonWriter writer, string name, string? value)
    {
        if (!string.IsNullOrEmpty(value))
        {
            writer.WriteString(name, value);
        }
    }
}

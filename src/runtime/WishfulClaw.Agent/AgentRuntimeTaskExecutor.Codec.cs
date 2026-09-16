/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace WishfulClaw.Agent;

/// <summary>
/// JSON result encoding and input parsing helpers for the session task tools.
/// Output shapes match the renderer TodoCard snapshot contract (task_id / task / tasks).
/// </summary>
public static partial class AgentRuntimeTaskExecutor
{
    private const string IdAlphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    private const string TitleTerminalPunctuation = ":\uFF1A;\uFF1B,.\uFF0C\u3002!?\uFF01\uFF1F";

    // ─── Result encoding ───

    private static string EncodeTaskCreateResult(TaskWorkingRow task, List<TaskWorkingRow> tasks)
    {
        return EncodeJsonObject(writer =>
        {
            writer.WriteBoolean("success", true);
            writer.WriteString("task_id", task.Id);
            writer.WriteString("title", task.Subject);
            writer.WriteString("subject", task.Subject);
            writer.WritePropertyName("task");
            WriteTaskSnapshot(writer, task);
            WriteStandaloneSummary(writer, tasks);
        });
    }

    private static string EncodeTaskGetResult(TaskWorkingRow task)
    {
        return EncodeJsonObject(writer =>
        {
            writer.WriteString("id", task.Id);
            writer.WriteString("title", task.Subject);
            writer.WriteString("subject", task.Subject);
            writer.WriteString("status", task.Status);
            WriteNullableString(writer, "owner", task.Owner);
            WriteNullableString(writer, "activeForm", task.ActiveForm);
            WriteStringArray(writer, "blocks", task.Blocks);
            WriteStringArray(writer, "blockedBy", task.BlockedBy);
            if (!string.IsNullOrWhiteSpace(task.MetadataJson))
            {
                writer.WritePropertyName("metadata");
                writer.WriteRawValue(task.MetadataJson, skipInputValidation: true);
            }
        });
    }

    private static string EncodeTaskUpdateResult(
        TaskWorkingRow task, List<TaskWorkingRow> tasks, List<string> changedFields)
    {
        return EncodeJsonObject(writer =>
        {
            writer.WriteBoolean("success", true);
            writer.WriteString("task_id", task.Id);
            writer.WritePropertyName("updated");
            writer.WriteStartObject();
            foreach (var field in changedFields.Distinct(StringComparer.Ordinal))
            {
                WriteUpdatedField(writer, field, task);
            }
            writer.WriteEndObject();
            writer.WritePropertyName("task");
            WriteTaskSnapshot(writer, task);
            WriteStandaloneSummary(writer, tasks);
        });
    }

    private static string EncodeTaskListResult(List<TaskWorkingRow> tasks)
    {
        return EncodeJsonObject(writer =>
        {
            var statusById = tasks.ToDictionary(static task => task.Id, static task => task.Status, StringComparer.Ordinal);
            writer.WriteString("mode", "standalone");
            writer.WriteNumber("total", tasks.Count);
            writer.WritePropertyName("tasks");
            writer.WriteStartArray();
            foreach (var task in tasks)
            {
                writer.WriteStartObject();
                writer.WriteString("id", task.Id);
                writer.WriteString("title", task.Subject);
                writer.WriteString("subject", task.Subject);
                writer.WriteString("status", task.Status);
                WriteNullableString(writer, "owner", task.Owner);
                WriteStringArray(
                    writer,
                    "blockedBy",
                    task.BlockedBy
                        .Where(id => !statusById.TryGetValue(id, out var status) || status != "completed")
                        .ToArray());
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
        });
    }

    private static void WriteStandaloneSummary(Utf8JsonWriter writer, List<TaskWorkingRow> tasks)
    {
        writer.WriteNumber("total", tasks.Count);
        writer.WriteNumber("completed", tasks.Count(static task => task.Status == "completed"));
        // iter-30：状态计数是「事实」，不是「嘱咐」。放在返回值里 = 最新鲜的位置，模型自己就能
        // 看出哪一步还挂在 in_progress、有没有开了新任务却没收尾的旧任务。
        // 刻意不加 "记得标 in_progress" 这类文案：那类句子每轮都要付 token，而且不解决
        // 「看不见当前状态」这个真正的缺口 —— 它只把"开场忘"换成"每轮都可能忘"。
        writer.WriteString("progress", BuildProgressSummary(tasks));
        writer.WritePropertyName("tasks");
        writer.WriteStartArray();
        foreach (var task in tasks)
        {
            WriteTaskSnapshot(writer, task);
        }
        writer.WriteEndArray();
    }

    /// <summary>
    /// 渲染一行状态计数，例如 "1/3 completed, 1 in_progress, 1 pending"。
    /// 零值状态不列，保持短小；全部为 0 时只给 completed 项。
    /// </summary>
    private static string BuildProgressSummary(List<TaskWorkingRow> tasks)
    {
        if (tasks.Count == 0) return "no tasks";

        var completed = tasks.Count(static task => task.Status == "completed");
        var parts = new List<string>(5) { $"{completed}/{tasks.Count} completed" };

        AppendStatusCount(parts, tasks, "in_progress");
        AppendStatusCount(parts, tasks, "pending");
        AppendStatusCount(parts, tasks, "blocked");
        AppendStatusCount(parts, tasks, "in_review");
        return string.Join(", ", parts);
    }

    private static void AppendStatusCount(List<string> parts, List<TaskWorkingRow> tasks, string status)
    {
        var count = tasks.Count(task => task.Status == status);
        if (count > 0) parts.Add($"{count} {status}");
    }

    private static void WriteTaskSnapshot(Utf8JsonWriter writer, TaskWorkingRow task)
    {
        writer.WriteStartObject();
        writer.WriteString("id", task.Id);
        writer.WriteString("title", task.Subject);
        writer.WriteString("subject", task.Subject);
        WriteNullableString(writer, "activeForm", task.ActiveForm);
        writer.WriteString("status", task.Status);
        WriteNullableString(writer, "owner", task.Owner);
        writer.WriteEndObject();
    }

    private static void WriteUpdatedField(Utf8JsonWriter writer, string field, TaskWorkingRow task)
    {
        switch (field)
        {
            case "subject":
                writer.WriteString("subject", task.Subject);
                break;
            case "activeForm":
                WriteNullableString(writer, "activeForm", task.ActiveForm);
                break;
            case "status":
                writer.WriteString("status", task.Status);
                break;
            case "owner":
                WriteNullableString(writer, "owner", task.Owner);
                break;
            case "blocks":
                WriteStringArray(writer, "blocks", task.Blocks);
                break;
            case "blockedBy":
                WriteStringArray(writer, "blockedBy", task.BlockedBy);
                break;
            case "metadata":
                writer.WritePropertyName("metadata");
                if (string.IsNullOrWhiteSpace(task.MetadataJson))
                {
                    writer.WriteNullValue();
                }
                else
                {
                    writer.WriteRawValue(task.MetadataJson, skipInputValidation: true);
                }
                break;
        }
    }

    private static void WriteNullableString(Utf8JsonWriter writer, string name, string? value)
    {
        if (value is null)
        {
            writer.WriteNull(name);
            return;
        }
        writer.WriteString(name, value);
    }

    private static void WriteStringArray(Utf8JsonWriter writer, string name, IReadOnlyList<string> values)
    {
        writer.WritePropertyName(name);
        writer.WriteStartArray();
        foreach (var value in values)
        {
            writer.WriteStringValue(value);
        }
        writer.WriteEndArray();
    }

    private static string EncodeJsonObject(Action<Utf8JsonWriter> writeProperties)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writeProperties(writer);
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static string EncodeError(string message)
    {
        return EncodeJsonObject(writer => writer.WriteString("error", message));
    }

    // ─── Input parsing ───

    private static string ResolveTaskTitle(JsonElement input, string fallbackTitle = "")
    {
        var title = NormalizeTaskTitlePart(GetOptionalInputString(input, "title") ?? GetOptionalInputString(input, "subject"));
        var description = NormalizeTaskTitlePart(GetOptionalInputString(input, "description"));
        if (title.Length > 0)
        {
            return MergeTaskTitle(title, description);
        }
        return description.Length > 0 ? description : NormalizeTaskTitlePart(fallbackTitle);
    }

    private static string NormalizeTaskTitlePart(string? value)
    {
        return string.IsNullOrWhiteSpace(value)
            ? string.Empty
            : Regex.Replace(value, "\\s+", " ").Trim();
    }

    private static string MergeTaskTitle(string title, string description)
    {
        if (title.Length == 0)
        {
            return description;
        }
        if (description.Length == 0 || title == description || title.Contains(description, StringComparison.Ordinal))
        {
            return title;
        }
        if (description.Contains(title, StringComparison.Ordinal))
        {
            return description;
        }

        var last = title[^1];
        return TitleTerminalPunctuation.Contains(last, StringComparison.Ordinal)
            ? $"{title} {description}"
            : $"{title}\uFF1A{description}";
    }

    private static bool HasAnyProperty(JsonElement input, params string[] names)
    {
        if (input.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        foreach (var name in names)
        {
            if (input.TryGetProperty(name, out _))
            {
                return true;
            }
        }
        return false;
    }

    private static string? GetOptionalInputString(JsonElement input, string propertyName)
    {
        if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty(propertyName, out var value))
        {
            return null;
        }
        return value.ValueKind == JsonValueKind.Null ? null : value.ToString();
    }

    private static string GetTaskId(JsonElement input)
    {
        return (GetOptionalInputString(input, "taskId") ?? GetOptionalInputString(input, "task_id") ?? string.Empty).Trim();
    }

    private static string[] GetStringArray(JsonElement input, string propertyName)
    {
        if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty(propertyName, out var value))
        {
            return [];
        }
        if (value.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return value.EnumerateArray()
            .Select(static item => item.ValueKind == JsonValueKind.String ? item.GetString() : item.ToString())
            .Where(static item => !string.IsNullOrWhiteSpace(item))
            .Select(static item => item!.Trim())
            .Distinct(StringComparer.Ordinal)
            .ToArray();
    }

    private static string[] ParseStringArray(string? rawJson)
    {
        if (string.IsNullOrWhiteSpace(rawJson))
        {
            return [];
        }
        try
        {
            using var document = JsonDocument.Parse(rawJson);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                return [];
            }
            return document.RootElement.EnumerateArray()
                .Select(static item => item.ValueKind == JsonValueKind.String ? item.GetString() : item.ToString())
                .Where(static item => !string.IsNullOrWhiteSpace(item))
                .Select(static item => item!.Trim())
                .Distinct(StringComparer.Ordinal)
                .ToArray();
        }
        catch
        {
            return [];
        }
    }

    private static string SerializeStringArray(IReadOnlyList<string> values)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartArray();
            foreach (var value in values)
            {
                writer.WriteStringValue(value);
            }
            writer.WriteEndArray();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static string[] Union(IReadOnlyList<string> existing, IReadOnlyList<string> additions)
    {
        return existing.Concat(additions)
            .Where(static value => !string.IsNullOrWhiteSpace(value))
            .Select(static value => value.Trim())
            .Distinct(StringComparer.Ordinal)
            .ToArray();
    }

    private static string[] RemoveTaskId(IReadOnlyList<string> existing, string taskId)
    {
        return existing
            .Where(value => value != taskId)
            .ToArray();
    }

    private static string? GetObjectRawJson(JsonElement input, string propertyName)
    {
        return input.ValueKind == JsonValueKind.Object &&
            input.TryGetProperty(propertyName, out var value) &&
            value.ValueKind == JsonValueKind.Object
                ? value.GetRawText()
                : null;
    }

    private static string? MergeMetadataJson(string? existingJson, JsonElement patch)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!string.IsNullOrWhiteSpace(existingJson))
        {
            try
            {
                using var existing = JsonDocument.Parse(existingJson);
                if (existing.RootElement.ValueKind == JsonValueKind.Object)
                {
                    foreach (var property in existing.RootElement.EnumerateObject())
                    {
                        values[property.Name] = property.Value.GetRawText();
                    }
                }
            }
            catch
            {
                values.Clear();
            }
        }

        foreach (var property in patch.EnumerateObject())
        {
            if (property.Value.ValueKind == JsonValueKind.Null)
            {
                values.Remove(property.Name);
            }
            else
            {
                values[property.Name] = property.Value.GetRawText();
            }
        }

        if (values.Count == 0)
        {
            return null;
        }

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            foreach (var item in values)
            {
                writer.WritePropertyName(item.Key);
                writer.WriteRawValue(item.Value, skipInputValidation: true);
            }
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static string NormalizeStatus(string status)
    {
        return status is "pending" or "in_progress" or "blocked" or "in_review" or "completed"
            ? status
            : "pending";
    }

    private static string CreateTaskId()
    {
        Span<char> chars = stackalloc char[8];
        for (var index = 0; index < chars.Length; index++)
        {
            chars[index] = IdAlphabet[RandomNumberGenerator.GetInt32(IdAlphabet.Length)];
        }
        return new string(chars);
    }
}

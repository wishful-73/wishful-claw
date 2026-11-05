using System.Buffers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent.Executors;

/// <summary>
/// Answer handling, result building, and utility methods for AskUserQuestion.
/// Extracted from AskUserCoercion for maintainability.
/// </summary>
internal static partial class AgentRuntimeAskUserExecutor
{
    // ── Reverse request to renderer ──

    private static async Task<JsonElement> RequestUserAnswersAsync(
        string toolUseId,
        IReadOnlyList<AskUserQuestion> questions,
        JsonElement parameters,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var request = CreateJsonElement(writer =>
        {
            writer.WriteString("toolUseId", toolUseId);
            WriteNullableString(writer, "runId", JsonHelpers.GetString(parameters, "runId"));
            WriteNullableString(writer, "sessionId", JsonHelpers.GetString(parameters, "sessionId"));
            writer.WritePropertyName("questions");
            WriteQuestions(writer, questions);
        });

        return await AgentRuntimeReverseRequests.RequestAsync(
            context,
            "ask-user/request",
            request,
            cancellationToken);
    }

    // ── Response parsing ──

    private static bool TryReadAnswers(JsonElement response, out JsonElement answers)
    {
        answers = default;
        if (response.ValueKind == JsonValueKind.Object &&
            response.TryGetProperty("answers", out var value) &&
            value.ValueKind == JsonValueKind.Object &&
            value.EnumerateObject().Any())
        {
            answers = value.Clone();
            return true;
        }
        return false;
    }

    private static JsonElement? ReadAnnotations(JsonElement response)
    {
        if (response.ValueKind == JsonValueKind.Object &&
            response.TryGetProperty("annotations", out var value) &&
            value.ValueKind == JsonValueKind.Object)
        {
            return value.Clone();
        }
        return null;
    }

    // ── Result building ──

    private static string BuildStructuredResult(
        IReadOnlyList<AskUserQuestion> questions,
        JsonElement answers,
        JsonElement? annotations,
        string? source)
    {
        return EncodeJsonObject(writer =>
        {
            writer.WritePropertyName("questions");
            WriteQuestions(writer, questions);

            writer.WritePropertyName("answers");
            writer.WriteStartObject();
            var summaryParts = new List<string>();
            for (var index = 0; index < questions.Count; index++)
            {
                var key = index.ToString(System.Globalization.CultureInfo.InvariantCulture);
                if (!answers.TryGetProperty(key, out var answer))
                {
                    continue;
                }

                var answerText = SerializeAnswer(answer);
                if (answerText.Length == 0)
                {
                    continue;
                }

                writer.WriteString(questions[index].Question, answerText);
                summaryParts.Add(BuildSummaryPart(questions[index].Question, answerText, annotations, key));
            }
            writer.WriteEndObject();

            if (annotations.HasValue && annotations.Value.EnumerateObject().Any())
            {
                writer.WritePropertyName("annotations");
                writer.WriteStartObject();
                for (var index = 0; index < questions.Count; index++)
                {
                    var key = index.ToString(System.Globalization.CultureInfo.InvariantCulture);
                    if (!annotations.Value.TryGetProperty(key, out var annotation) ||
                        annotation.ValueKind != JsonValueKind.Object)
                    {
                        continue;
                    }

                    var preview = JsonHelpers.GetString(annotation, "preview");
                    var notes = JsonHelpers.GetString(annotation, "notes")?.Trim();
                    if (string.IsNullOrEmpty(preview) && string.IsNullOrEmpty(notes))
                    {
                        continue;
                    }

                    writer.WritePropertyName(questions[index].Question);
                    writer.WriteStartObject();
                    WriteNullableString(writer, "preview", preview);
                    WriteNullableString(writer, "notes", notes);
                    writer.WriteEndObject();
                }
                writer.WriteEndObject();
            }

            writer.WriteString(
                "summary",
                summaryParts.Count > 0
                    ? $"User has answered your questions: {string.Join(", ", summaryParts)}. You can now continue with the user's answers in mind."
                    : "User has answered your questions.");
            WriteNullableString(writer, "source", source);
        });
    }

    private static string BuildSummaryPart(
        string questionText,
        string answerText,
        JsonElement? annotations,
        string key)
    {
        if (!annotations.HasValue ||
            !annotations.Value.TryGetProperty(key, out var annotation) ||
            annotation.ValueKind != JsonValueKind.Object)
        {
            return $"\"{questionText}\"=\"{answerText}\"";
        }

        var extras = new List<string>();
        if (!string.IsNullOrEmpty(JsonHelpers.GetString(annotation, "preview")))
        {
            extras.Add("selected preview attached");
        }

        var notes = JsonHelpers.GetString(annotation, "notes")?.Trim();
        if (!string.IsNullOrEmpty(notes))
        {
            extras.Add($"notes: {notes}");
        }

        return extras.Count > 0
            ? $"\"{questionText}\"=\"{answerText}\" ({string.Join("; ", extras)})"
            : $"\"{questionText}\"=\"{answerText}\"";
    }

    private static string SerializeAnswer(JsonElement answer)
    {
        if (answer.ValueKind == JsonValueKind.Array)
        {
            var values = new List<string>();
            foreach (var item in answer.EnumerateArray())
            {
                var text = ElementToString(item);
                if (text.Length > 0)
                {
                    values.Add(text);
                }
            }
            return string.Join(", ", values);
        }
        return ElementToString(answer);
    }

    private static string ElementToString(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.String => element.GetString() ?? string.Empty,
            JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False => element.GetRawText(),
            _ => string.Empty
        };
    }

    // ── Helpers ──

    private static string? ReadMetadataSource(JsonElement input)
    {
        if (input.ValueKind == JsonValueKind.Object &&
            input.TryGetProperty("metadata", out var metadata) &&
            metadata.ValueKind == JsonValueKind.Object)
        {
            return JsonHelpers.GetString(metadata, "source")?.Trim();
        }
        return null;
    }

    private static string DeriveHeader(string question, int index)
    {
        var compact = question
            .Replace("?", string.Empty, StringComparison.Ordinal)
            .Replace("\uFF1F", string.Empty, StringComparison.Ordinal)
            .Trim();
        compact = Regex.Replace(compact, @"\s+", " ");
        if (compact.Length == 0)
        {
            return $"Q{index + 1}";
        }

        var chars = compact.EnumerateRunes().Take(MaxHeaderChars).ToArray();
        return string.Concat(chars);
    }

    private static int HeaderLength(string header)
    {
        return header.EnumerateRunes().Count();
    }

    private static string? ValidatePreview(string? preview)
    {
        if (string.IsNullOrEmpty(preview) ||
            !Regex.IsMatch(preview, @"<\s*[a-z!][^>]*>", RegexOptions.IgnoreCase))
        {
            return null;
        }

        if (Regex.IsMatch(preview, @"<\s*(html|body|!doctype)\b", RegexOptions.IgnoreCase))
        {
            return "preview must be an HTML fragment, not a full document";
        }

        if (Regex.IsMatch(preview, @"<\s*(script|style)\b", RegexOptions.IgnoreCase))
        {
            return "preview must not contain <script> or <style> tags";
        }

        return null;
    }

    private static JsonElement? GetFirstProperty(JsonElement value, params string[] names)
    {
        foreach (var name in names)
        {
            if (value.ValueKind == JsonValueKind.Object &&
                value.TryGetProperty(name, out var property))
            {
                return property.Clone();
            }
        }
        return null;
    }

    private static string? CoerceStringField(JsonElement value, params string[] keys)
    {
        if (value.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var key in keys)
        {
            if (value.TryGetProperty(key, out var property) &&
                property.ValueKind == JsonValueKind.String)
            {
                var text = property.GetString()?.Trim();
                if (!string.IsNullOrEmpty(text))
                {
                    return text;
                }
            }
        }
        return null;
    }

    private static bool CoerceBooleanField(JsonElement value, params string[] keys)
    {
        if (value.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        foreach (var key in keys)
        {
            if (!value.TryGetProperty(key, out var property))
            {
                continue;
            }

            if (property.ValueKind == JsonValueKind.True)
            {
                return true;
            }

            if (property.ValueKind == JsonValueKind.False)
            {
                return false;
            }

            if (property.ValueKind == JsonValueKind.String)
            {
                var normalized = property.GetString()?.Trim().ToLowerInvariant();
                if (normalized == "true") return true;
                if (normalized == "false") return false;
            }
        }
        return false;
    }

    private static bool TryParseJsonElement(string value, out JsonElement element)
    {
        try
        {
            using var document = JsonDocument.Parse(value);
            element = document.RootElement.Clone();
            return true;
        }
        catch (JsonException)
        {
            element = default;
            return false;
        }
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

    private static JsonElement CreateStringElement(string value)
    {
        using var document = JsonDocument.Parse($"\"{value.Replace("\\", "\\\\").Replace("\"", "\\\"")}\"");
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

    private static void WriteQuestions(Utf8JsonWriter writer, IReadOnlyList<AskUserQuestion> questions)
    {
        writer.WriteStartArray();
        foreach (var question in questions)
        {
            writer.WriteStartObject();
            writer.WriteString("question", question.Question);
            WriteNullableString(writer, "header", question.Header);
            writer.WriteBoolean("multiSelect", question.MultiSelect);
            if (question.Options is { Count: > 0 })
            {
                writer.WritePropertyName("options");
                writer.WriteStartArray();
                foreach (var option in question.Options)
                {
                    writer.WriteStartObject();
                    writer.WriteString("label", option.Label);
                    WriteNullableString(writer, "description", option.Description);
                    WriteNullableString(writer, "preview", option.Preview);
                    writer.WriteEndObject();
                }
                writer.WriteEndArray();
            }
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    private static void WriteNullableString(Utf8JsonWriter writer, string name, string? value)
    {
        if (!string.IsNullOrEmpty(value))
        {
            writer.WriteString(name, value);
        }
    }

    private sealed record AskUserQuestion(
        string Question,
        string? Header,
        List<AskUserOption>? Options,
        bool MultiSelect);

    private sealed record AskUserOption(string Label, string? Description, string? Preview);
}

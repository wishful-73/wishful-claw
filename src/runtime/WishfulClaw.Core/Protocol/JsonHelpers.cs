using System.Text.Json;

namespace WishfulClaw.Core.Protocol;

public static class JsonHelpers
{
    public static string? GetString(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var property)
            ? AsString(property)
            : null;

    /// <summary>把已取出的属性值当字符串读。非字符串返回 null。</summary>
    public static string? AsString(JsonElement value) =>
        value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    public static bool GetBool(JsonElement element, string name, bool fallback) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var property)
            ? AsBool(property, fallback)
            : fallback;

    /// <summary>把已取出的属性值当布尔读（容忍 "true" / " FALSE " 这类文本）。</summary>
    public static bool AsBool(JsonElement value, bool fallback) =>
        value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String => ParseBoolText(value.GetString(), fallback),
            _ => fallback
        };

    /// <summary>
    /// Parses a boolean from its textual form, tolerating surrounding whitespace and casing
    /// ("true" / " TRUE " / "False"). Only these two literals are accepted; anything else
    /// (including null or an all-whitespace string) falls back.
    /// </summary>
    private static bool ParseBoolText(string? value, bool fallback)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return fallback;
        }
        return value.Trim().ToLowerInvariant() switch
        {
            "true" => true,
            "false" => false,
            _ => fallback
        };
    }

    public static int GetInt(JsonElement element, string name, int fallback)
    {
        return GetIntNullable(element, name) ?? fallback;
    }

    public static int? GetIntNullable(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var property)
            ? AsIntNullable(property)
            : null;

    /// <summary>把已取出的属性值当整数读（数字或数字文本）。</summary>
    public static int? AsIntNullable(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number))
        {
            return number;
        }
        if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out number))
        {
            return number;
        }
        return null;
    }

    public static long GetLong(JsonElement element, string name, long fallback)
    {
        return GetLongNullable(element, name) ?? fallback;
    }

    public static long? GetLongNullable(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var property))
        {
            return null;
        }
        if (property.ValueKind == JsonValueKind.Number && property.TryGetInt64(out var value))
        {
            return value;
        }
        if (property.ValueKind == JsonValueKind.String && long.TryParse(property.GetString(), out value))
        {
            return value;
        }
        return null;
    }

    public static double? GetDoubleNullable(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var property))
        {
            return null;
        }
        if (property.ValueKind == JsonValueKind.Number && property.TryGetDouble(out var value))
        {
            return value;
        }
        if (property.ValueKind == JsonValueKind.String && double.TryParse(property.GetString(), out value))
        {
            return value;
        }
        return null;
    }

    public static string[] GetStringArray(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var property)
            ? AsStringArray(property)
            : Array.Empty<string>();

    /// <summary>把已取出的属性值当字符串数组读（JSON 数组，或 "a,b" 这类逗号分隔文本；空串元素丢弃）。</summary>
    public static string[] AsStringArray(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.String)
        {
            var text = value.GetString();
            return string.IsNullOrWhiteSpace(text)
                ? Array.Empty<string>()
                : text.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        }

        if (value.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var values = new List<string>();
        foreach (var item in value.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && item.GetString() is { Length: > 0 } text)
            {
                values.Add(text);
            }
        }
        return values.ToArray();
    }

    /// <summary>
    /// Resolves "ultra" pseudo reasoning tier to the top real level.
    /// </summary>
    public static string? ResolveEffectiveReasoningEffort(string? selected, JsonElement thinkingConfig)
    {
        if (string.IsNullOrWhiteSpace(selected) || selected != "ultra")
        {
            return selected;
        }
        if (thinkingConfig.ValueKind == JsonValueKind.Object &&
            thinkingConfig.TryGetProperty("reasoningEffortLevels", out var levels) &&
            levels.ValueKind == JsonValueKind.Array)
        {
            string? top = null;
            foreach (var item in levels.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String &&
                    item.GetString() is { Length: > 0 } level &&
                    level != "ultra")
                {
                    top = level;
                }
            }
            return top;
        }
        return null;
    }
}

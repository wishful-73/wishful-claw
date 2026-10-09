using System.Text.Json;

namespace WishfulClaw.Core.Protocol;

public static class JsonHelpers
{
    public static string? GetString(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var property))
        {
            return null;
        }
        return property.ValueKind == JsonValueKind.String ? property.GetString() : null;
    }

    public static bool GetBool(JsonElement element, string name, bool fallback)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var property))
        {
            return fallback;
        }
        return property.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String => ParseBoolText(property.GetString(), fallback),
            _ => fallback
        };
    }

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

    public static int? GetIntNullable(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var property))
        {
            return null;
        }
        if (property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var value))
        {
            return value;
        }
        if (property.ValueKind == JsonValueKind.String && int.TryParse(property.GetString(), out value))
        {
            return value;
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

    public static string[] GetStringArray(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var property))
        {
            return Array.Empty<string>();
        }

        if (property.ValueKind == JsonValueKind.String)
        {
            var value = property.GetString();
            return string.IsNullOrWhiteSpace(value)
                ? Array.Empty<string>()
                : value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        }

        if (property.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var values = new List<string>();
        foreach (var item in property.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && item.GetString() is { Length: > 0 } value)
            {
                values.Add(value);
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

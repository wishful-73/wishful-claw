using System.Text.Json.Nodes;

namespace WishfulClaw.Infrastructure.Storage;

/// <summary>
/// Channel-wide settings. Feature and permission switches used to live on every
/// channel instance; they are now global-only, so this record is the single source
/// of both the values and their defaults.
/// </summary>
public sealed record GlobalChannelSettings(
    bool AutoReply,
    bool StreamingReply,
    bool AutoStart,
    bool ShellRequiresApproval,
    bool AllowReadHome,
    string[] ReadablePathPrefixes,
    bool AllowWriteOutside,
    bool AllowSubAgents)
{
    /// <summary>
    /// AutoStart defaults on because <c>enabled</c> is the real per-channel gate:
    /// a channel the user switched on should reconnect by itself.
    /// </summary>
    public static GlobalChannelSettings Defaults { get; } = new(
        AutoReply: true,
        StreamingReply: true,
        AutoStart: true,
        ShellRequiresApproval: true,
        AllowReadHome: false,
        ReadablePathPrefixes: [],
        AllowWriteOutside: false,
        AllowSubAgents: false);
}

public static class GlobalChannelSettingsStore
{
    private const string ConfigKey = "channelSettings";

    public static GlobalChannelSettings Read()
    {
        if (ConfigStore.GetValueNode(ConfigKey) is not JsonObject obj)
        {
            return GlobalChannelSettings.Defaults;
        }

        return new GlobalChannelSettings(
            ReadBool(obj, "autoReply", GlobalChannelSettings.Defaults.AutoReply),
            ReadBool(obj, "streamingReply", GlobalChannelSettings.Defaults.StreamingReply),
            ReadBool(obj, "autoStart", GlobalChannelSettings.Defaults.AutoStart),
            ReadShellRequiresApproval(obj),
            ReadBool(obj, "allowReadHome", false),
            ReadPrefixes(obj),
            ReadBool(obj, "allowWriteOutside", false),
            ReadBool(obj, "allowSubAgents", false));
    }

    public static void Write(GlobalChannelSettings settings)
    {
        var prefixes = new JsonArray();
        foreach (var prefix in settings.ReadablePathPrefixes)
        {
            prefixes.Add((JsonNode?)prefix);
        }

        ConfigStore.SetValue(ConfigKey, new JsonObject
        {
            ["autoReply"] = settings.AutoReply,
            ["streamingReply"] = settings.StreamingReply,
            ["autoStart"] = settings.AutoStart,
            ["shellRequiresApproval"] = settings.ShellRequiresApproval,
            ["allowReadHome"] = settings.AllowReadHome,
            ["readablePathPrefixes"] = prefixes,
            ["allowWriteOutside"] = settings.AllowWriteOutside,
            ["allowSubAgents"] = settings.AllowSubAgents
        });
    }

    /// <summary>
    /// Falls back to the inverted retired <c>allowShell</c> when the new key is absent:
    /// "not allowed to run" and "requires approval" both meant the safe side, so a
    /// stored <c>allowShell: false</c> carries over without silently loosening anything.
    /// </summary>
    private static bool ReadShellRequiresApproval(JsonObject obj)
    {
        if (TryReadBool(obj, "shellRequiresApproval", out var requiresApproval))
        {
            return requiresApproval;
        }
        return TryReadBool(obj, "allowShell", out var allowShell) ? !allowShell : true;
    }

    private static string[] ReadPrefixes(JsonObject obj)
    {
        if (obj["readablePathPrefixes"]?.AsArray() is not { } array)
        {
            return [];
        }

        var prefixes = new List<string>(array.Count);
        foreach (var item in array)
        {
            if (item is JsonValue value && value.TryGetValue<string>(out var text) &&
                !string.IsNullOrWhiteSpace(text))
            {
                prefixes.Add(text);
            }
        }
        return prefixes.Count > 0 ? prefixes.ToArray() : [];
    }

    private static bool TryReadBool(JsonObject obj, string key, out bool value)
    {
        value = false;
        if (obj[key] is not JsonNode node || node is not JsonValue jsonValue)
        {
            return false;
        }
        return jsonValue.TryGetValue(out value);
    }

    private static bool ReadBool(JsonObject obj, string key, bool fallback) =>
        TryReadBool(obj, key, out var value) ? value : fallback;
}

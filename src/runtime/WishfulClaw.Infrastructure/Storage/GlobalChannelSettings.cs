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

    private const string KeyAutoReply = "autoReply";
    private const string KeyStreamingReply = "streamingReply";
    private const string KeyAutoStart = "autoStart";
    private const string KeyShellRequiresApproval = "shellRequiresApproval";
    private const string KeyAllowReadHome = "allowReadHome";
    private const string KeyReadablePathPrefixes = "readablePathPrefixes";
    private const string KeyAllowWriteOutside = "allowWriteOutside";
    private const string KeyAllowSubAgents = "allowSubAgents";

    /// <summary>The exact shape <see cref="Write"/> produces; also the whole-object write contract.</summary>
    private static readonly string[] RecordKeys =
    [
        KeyAutoReply, KeyStreamingReply, KeyAutoStart, KeyShellRequiresApproval,
        KeyAllowReadHome, KeyReadablePathPrefixes, KeyAllowWriteOutside, KeyAllowSubAgents
    ];

    /// <summary>
    /// A whole-object write must carry every key and nothing else. Missing members would
    /// deserialize into <c>default(false)</c>, and for <c>shellRequiresApproval</c> that means
    /// "run shell without asking", so a partial payload is refused instead of merged.
    /// </summary>
    public static bool IsFullRecord(JsonObject obj)
    {
        foreach (var key in RecordKeys)
        {
            if (!obj.ContainsKey(key))
            {
                return false;
            }
        }

        foreach (var pair in obj)
        {
            if (Array.IndexOf(RecordKeys, pair.Key) < 0)
            {
                return false;
            }
        }

        return true;
    }

    public static GlobalChannelSettings Read()
    {
        if (ConfigStore.GetValueNode(ConfigKey) is not JsonObject obj)
        {
            return GlobalChannelSettings.Defaults;
        }

        return new GlobalChannelSettings(
            ReadBool(obj, KeyAutoReply, GlobalChannelSettings.Defaults.AutoReply),
            ReadBool(obj, KeyStreamingReply, GlobalChannelSettings.Defaults.StreamingReply),
            ReadBool(obj, KeyAutoStart, GlobalChannelSettings.Defaults.AutoStart),
            ReadShellRequiresApproval(obj),
            ReadBool(obj, KeyAllowReadHome, GlobalChannelSettings.Defaults.AllowReadHome),
            ReadPrefixes(obj),
            ReadBool(obj, KeyAllowWriteOutside, GlobalChannelSettings.Defaults.AllowWriteOutside),
            ReadBool(obj, KeyAllowSubAgents, GlobalChannelSettings.Defaults.AllowSubAgents));
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
            [KeyAutoReply] = settings.AutoReply,
            [KeyStreamingReply] = settings.StreamingReply,
            [KeyAutoStart] = settings.AutoStart,
            [KeyShellRequiresApproval] = settings.ShellRequiresApproval,
            [KeyAllowReadHome] = settings.AllowReadHome,
            [KeyReadablePathPrefixes] = prefixes,
            [KeyAllowWriteOutside] = settings.AllowWriteOutside,
            [KeyAllowSubAgents] = settings.AllowSubAgents
        });
    }

    /// <summary>
    /// Falls back to the inverted retired <c>allowShell</c> when the new key is absent:
    /// "not allowed to run" and "requires approval" both meant the safe side, so a
    /// stored <c>allowShell: false</c> carries over without silently loosening anything.
    /// </summary>
    private static bool ReadShellRequiresApproval(JsonObject obj)
    {
        if (TryReadBool(obj, KeyShellRequiresApproval, out var requiresApproval))
        {
            return requiresApproval;
        }
        return TryReadBool(obj, "allowShell", out var allowShell)
            ? !allowShell
            : GlobalChannelSettings.Defaults.ShellRequiresApproval;
    }

    private static string[] ReadPrefixes(JsonObject obj)
    {
        if (obj[KeyReadablePathPrefixes] is not JsonArray array)
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

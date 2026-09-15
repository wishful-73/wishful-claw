using System.Text.Json.Nodes;

namespace WishfulClaw.Infrastructure.Storage;

/// <summary>
/// Channel-wide settings. Auto-reply is not a switch — a configured channel exists to reply,
/// and the per-channel enable flag is the real gate. The retired <c>allowReadHome</c> /
/// <c>readablePathPrefixes</c> / <c>allowWriteOutside</c> / <c>allowSubAgents</c> and
/// <c>streamingReply</c> were display-only: they stored and rendered a value that no code path
/// ever read. Two settings remain, and both are enforced.
/// </summary>
public sealed record GlobalChannelSettings(
    bool AutoStart,
    bool ShellRequiresApproval)
{
    /// <summary>
    /// AutoStart defaults on because <c>enabled</c> is the real per-channel gate:
    /// a channel the user switched on should reconnect by itself.
    /// </summary>
    public static GlobalChannelSettings Defaults { get; } = new(
        AutoStart: true,
        ShellRequiresApproval: true);
}

public static class GlobalChannelSettingsStore
{
    private const string ConfigKey = "channelSettings";

    private const string KeyAutoStart = "autoStart";
    private const string KeyShellRequiresApproval = "shellRequiresApproval";

    /// <summary>The exact shape <see cref="Write"/> produces; also the whole-object write contract.</summary>
    private static readonly string[] RecordKeys = [KeyAutoStart, KeyShellRequiresApproval];

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
            ReadBool(obj, KeyAutoStart, GlobalChannelSettings.Defaults.AutoStart),
            ReadShellRequiresApproval(obj));
    }

    public static void Write(GlobalChannelSettings settings)
    {
        ConfigStore.SetValue(ConfigKey, new JsonObject
        {
            [KeyAutoStart] = settings.AutoStart,
            [KeyShellRequiresApproval] = settings.ShellRequiresApproval
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

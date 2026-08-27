using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Agent.Modules.Extensions;

/// <summary>
/// Partial of ExtensionManifestStore — state management, list/builtins, state/config helpers
/// </summary>
public static partial class ExtensionManifestStore
{
    // ── State management (JsonNode-based) ──

    private static ExtensionState ReadState(string extensionId)
    {
        var states = ReadJsonObject(ExtensionsStatePath());
        if (states is null ||
            !states.RootElement.TryGetProperty(extensionId, out var state) ||
            state.ValueKind != JsonValueKind.Object)
        {
            return new ExtensionState(false, new Dictionary<string, string>(StringComparer.Ordinal));
        }

        return new ExtensionState(
            ReadBool(state, "enabled", false),
            ReadStringMap(state, "config"));
    }

    private static Dictionary<string, string> MergeRuntimeConfig(
        string extensionId,
        NativeExtensionManifest manifest,
        IReadOnlyDictionary<string, string> stateConfig)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        var secretKeys = new HashSet<string>(
            manifest.ConfigSchema
                .Where(static field => field.Type == "secret")
                .Select(static field => field.Key),
            StringComparer.Ordinal);

        foreach (var field in manifest.ConfigSchema)
        {
            result[field.Key] = field.DefaultValue ?? string.Empty;
        }

        foreach (var item in stateConfig)
        {
            if (!secretKeys.Contains(item.Key))
            {
                result[item.Key] = item.Value;
            }
        }

        foreach (var key in secretKeys)
        {
            result[key] = ConfigStore.GetStringValue(SecretConfigKey(extensionId, key));
        }

        return result;
    }

    // ── List / Ensure builtins (JsonNode-based) ──

    private static JsonArray ListExtensionsCore()
    {
        var state = ReadStateRoot();
        var changed = false;
        var instances = new JsonArray();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        Directory.CreateDirectory(ExtensionsDirectory());

        foreach (var directory in Directory.EnumerateDirectories(ExtensionsDirectory()))
        {
            var id = Path.GetFileName(directory);
            if (!File.Exists(Path.Combine(directory, ExtensionManifestFileName)))
            {
                continue;
            }

            try
            {
                var manifest = ReadNormalizedManifestNode(directory);
                if (!string.Equals(ReadNodeString(manifest, "id"), id, StringComparison.Ordinal))
                {
                    WorkerLog.Warn($"extension skipped id mismatch directory={id}");
                    continue;
                }

                seen.Add(id);
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var extensionState = GetOrCreateState(state, id, manifest, enabled: false, now);
                if (!state.ContainsKey(id))
                {
                    changed = true;
                }

                instances.Add((JsonNode?)new JsonObject
                {
                    ["id"] = id,
                    ["enabled"] = ReadNodeBool(extensionState, "enabled", false),
                    ["installedAt"] = ReadNodeLong(extensionState, "installedAt", now),
                    ["updatedAt"] = ReadNodeLong(extensionState, "updatedAt", now),
                    ["config"] = BuildRuntimeConfigNode(id, manifest, GetStateConfig(extensionState)),
                    ["manifest"] = manifest.DeepClone()
                });
            }
            catch (Exception ex)
            {
                WorkerLog.Warn($"extension load failed id={id} error={ex.GetType().Name}: {ex.Message}");
            }
        }

        foreach (var property in state.ToArray())
        {
            if (!seen.Contains(property.Key))
            {
                state.Remove(property.Key);
                changed = true;
            }
        }

        if (changed)
        {
            WriteJsonNode(ExtensionsStatePath(), state);
        }

        return instances;
    }

    private static void EnsureBuiltinExtensions(JsonElement parameters)
    {
        if (builtinsInitialized)
        {
            return;
        }
        builtinsInitialized = true;

        var bundledDir = ResolveBundledExtensionsDirectory(parameters);
        if (bundledDir is null || !Directory.Exists(bundledDir))
        {
            return;
        }

        Directory.CreateDirectory(ExtensionsDirectory());
        var state = ReadStateRoot();
        var stateChanged = false;

        foreach (var sourceDir in Directory.EnumerateDirectories(bundledDir))
        {
            var directoryName = Path.GetFileName(sourceDir);
            if (!File.Exists(Path.Combine(sourceDir, ExtensionManifestFileName)))
            {
                continue;
            }

            try
            {
                var sourceManifest = ReadNormalizedManifestNode(sourceDir);
                var id = ReadNodeString(sourceManifest, "id");
                if (!string.Equals(id, directoryName, StringComparison.Ordinal))
                {
                    WorkerLog.Warn($"extension bundled skipped id mismatch directory={directoryName}");
                    continue;
                }

                var targetDir = ResolveExtensionPath(id);
                var shouldUpdate = ShouldUpdateExtension(sourceManifest, sourceDir, targetDir);
                if (shouldUpdate)
                {
                    ReplaceDirectory(sourceDir, targetDir);
                }

                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (state[id] is not JsonObject current)
                {
                    state[id] = CreateState(sourceManifest, enabled: true, now);
                    stateChanged = true;
                    continue;
                }

                var nextConfig = BuildStateConfigWithDefaults(sourceManifest, GetStateConfig(current));
                if (shouldUpdate || !JsonEquals(current["config"], nextConfig))
                {
                    current["config"] = nextConfig;
                    if (shouldUpdate)
                    {
                        current["updatedAt"] = now;
                    }
                    stateChanged = true;
                }
            }
            catch (Exception ex)
            {
                WorkerLog.Warn(
                    $"extension bundled init failed directory={directoryName} error={ex.GetType().Name}: {ex.Message}");
            }
        }

        if (stateChanged)
        {
            WriteJsonNode(ExtensionsStatePath(), state);
        }
    }

    private static string? ResolveBundledExtensionsDirectory(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("bundledDirCandidates", out var candidates) ||
            candidates.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        string? first = null;
        foreach (var candidate in candidates.EnumerateArray())
        {
            if (candidate.ValueKind != JsonValueKind.String)
            {
                continue;
            }

            var path = candidate.GetString();
            if (string.IsNullOrWhiteSpace(path))
            {
                continue;
            }

            var fullPath = Path.GetFullPath(path);
            first ??= fullPath;
            if (Directory.Exists(fullPath))
            {
                return fullPath;
            }
        }

        return first;
    }

    // ── State / Config helpers (JsonNode-based) ──

    private static JsonObject ReadStateRoot()
    {
        return ReadJsonNodeObject(ExtensionsStatePath());
    }

    private static JsonObject ReadStorageRoot()
    {
        return ReadJsonNodeObject(ExtensionsStoragePath());
    }

    private static JsonObject ReadJsonNodeObject(string filePath)
    {
        try
        {
            if (!File.Exists(filePath))
            {
                return [];
            }
            return JsonNode.Parse(File.ReadAllText(filePath)) as JsonObject ?? [];
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"extension json read failed path={filePath} error={ex.GetType().Name}: {ex.Message}");
            return [];
        }
    }

    private static void WriteJsonNode(string filePath, JsonNode node)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
        var tempPath = $"{filePath}.{Guid.NewGuid():N}.tmp";
        File.WriteAllText(tempPath, node.ToJsonString(WorkerJsonHelper.IndentedJsonOptions));
        File.Move(tempPath, filePath, true);
    }

    private static JsonObject GetOrCreateState(
        JsonObject stateRoot,
        string id,
        JsonObject manifest,
        bool enabled,
        long now)
    {
        if (stateRoot[id] is JsonObject state)
        {
            return state;
        }

        state = CreateState(manifest, enabled, now);
        stateRoot[id] = state;
        return state;
    }

    private static JsonObject CreateState(JsonObject manifest, bool enabled, long now)
    {
        return new JsonObject
        {
            ["enabled"] = enabled,
            ["installedAt"] = now,
            ["updatedAt"] = now,
            ["config"] = BuildStateConfigWithDefaults(manifest, new Dictionary<string, string>(StringComparer.Ordinal))
        };
    }

    private static Dictionary<string, string> GetStateConfig(JsonObject state)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        if (state["config"] is not JsonObject config)
        {
            return result;
        }

        foreach (var property in config)
        {
            if (property.Value is JsonValue jsonValue &&
                jsonValue.TryGetValue<string>(out var text))
            {
                result[property.Key] = text;
            }
        }
        return result;
    }

    private static Dictionary<string, string> BuildRuntimeConfig(
        string extensionId,
        JsonObject manifest,
        IReadOnlyDictionary<string, string> stateConfig)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        var secretKeys = GetSecretKeys(manifest).ToHashSet(StringComparer.Ordinal);

        if (manifest["configSchema"] is JsonArray schema)
        {
            foreach (var item in schema.OfType<JsonObject>())
            {
                var key = ReadNodeString(item, "key");
                if (key.Length > 0)
                {
                    result[key] = ReadNodeString(item, "defaultValue");
                }
            }
        }

        foreach (var item in stateConfig)
        {
            if (!secretKeys.Contains(item.Key))
            {
                result[item.Key] = item.Value;
            }
        }

        foreach (var key in secretKeys)
        {
            result[key] = ConfigStore.GetStringValue(SecretConfigKey(extensionId, key));
        }

        return result;
    }

    private static JsonObject BuildRuntimeConfigNode(
        string extensionId,
        JsonObject manifest,
        IReadOnlyDictionary<string, string> stateConfig)
    {
        var runtime = BuildRuntimeConfig(extensionId, manifest, stateConfig);
        var result = new JsonObject();
        foreach (var item in runtime)
        {
            result[item.Key] = item.Value;
        }
        return result;
    }

    private static JsonObject BuildStateConfigWithDefaults(
        JsonObject manifest,
        IReadOnlyDictionary<string, string> currentConfig)
    {
        var result = new JsonObject();
        if (manifest["configSchema"] is JsonArray schema)
        {
            foreach (var item in schema.OfType<JsonObject>())
            {
                var key = ReadNodeString(item, "key");
                if (key.Length > 0)
                {
                    result[key] = ReadNodeString(item, "defaultValue");
                }
            }
        }

        foreach (var item in currentConfig)
        {
            result[item.Key] = item.Value;
        }
        return result;
    }

    private static JsonObject SplitAndPersistConfig(
        string extensionId,
        JsonObject manifest,
        IReadOnlyDictionary<string, string> nextConfig)
    {
        var secretKeys = GetSecretKeys(manifest).ToHashSet(StringComparer.Ordinal);
        var stateConfig = new JsonObject();
        foreach (var item in nextConfig)
        {
            if (secretKeys.Contains(item.Key))
            {
                ConfigStore.SetValue(SecretConfigKey(extensionId, item.Key), JsonValue.Create(item.Value));
            }
            else
            {
                stateConfig[item.Key] = item.Value;
            }
        }
        return stateConfig;
    }

    private static IEnumerable<string> GetSecretKeys(JsonObject manifest)
    {
        if (manifest["configSchema"] is not JsonArray schema)
        {
            yield break;
        }

        foreach (var item in schema.OfType<JsonObject>())
        {
            if (ReadNodeString(item, "type") == "secret")
            {
                var key = ReadNodeString(item, "key");
                if (key.Length > 0)
                {
                    yield return key;
                }
            }
        }
    }

}

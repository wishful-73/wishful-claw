/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Agent.Modules.Extensions;

/// <summary>
/// Partial of ExtensionManifestStore — IPC handlers, Storage CRUD, FindExtensionOrThrow
/// </summary>
public static partial class ExtensionManifestStore
{
    private const string DataDirectoryName = ".wishful-claw";
    private const string ExtensionsDirectoryName = "extensions";
    private const string ExtensionsStateFileName = "extensions.json";
    private const string ExtensionsStorageFileName = "extensions-storage.json";
    private const string ConfigFileName = "config.json";
    private const string ExtensionManifestFileName = "extension.json";

    private static readonly object ManagementSync = new();
    private static bool builtinsInitialized;

    // ── Public IPC handlers ──

    public static WorkerResponse List(JsonElement parameters)
    {
        lock (ManagementSync)
        {
            EnsureBuiltinExtensions(parameters);
            return ToResponse(ListExtensionsCore());
        }
    }

    public static WorkerResponse InstallFromFolder(JsonElement parameters)
    {
        try
        {
            var sourcePath = JsonHelpers.GetString(parameters, "sourcePath")?.Trim();
            if (string.IsNullOrWhiteSpace(sourcePath))
            {
                return ToResponse(Mutation(false, "Missing extension source path"));
            }

            sourcePath = Path.GetFullPath(sourcePath);
            if (!Directory.Exists(sourcePath))
            {
                return ToResponse(Mutation(false, $"Extension source folder not found: {sourcePath}"));
            }

            lock (ManagementSync)
            {
                var manifest = ReadNormalizedManifestNode(sourcePath);
                var id = ReadNodeString(manifest, "id");
                var targetPath = ResolveExtensionPath(id);
                if (Directory.Exists(targetPath))
                {
                    return ToResponse(Mutation(false, $"Extension \"{id}\" already exists"));
                }

                Directory.CreateDirectory(ExtensionsDirectory());
                CopyDirectory(sourcePath, targetPath);

                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var state = ReadStateRoot();
                state[id] = CreateState(manifest, enabled: false, now);
                WriteJsonNode(ExtensionsStatePath(), state);
                WorkerLog.Debug($"extension install id={id}");
            }

            return ToResponse(Mutation(true, null));
        }
        catch (Exception ex)
        {
            return ToResponse(Mutation(false, ex.Message));
        }
    }

    public static WorkerResponse Update(JsonElement parameters)
    {
        try
        {
            var id = NormalizeId(JsonHelpers.GetString(parameters, "id"));
            if (!IsValidExtensionId(id) ||
                parameters.ValueKind != JsonValueKind.Object ||
                !parameters.TryGetProperty("patch", out var patchElement) ||
                patchElement.ValueKind != JsonValueKind.Object)
            {
                return ToResponse(Mutation(false, "Invalid extension update"));
            }

            lock (ManagementSync)
            {
                var manifest = ReadNormalizedManifestNode(ResolveExtensionPath(id));
                var stateRoot = ReadStateRoot();
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var state = GetOrCreateState(stateRoot, id, manifest, enabled: false, now);

                if (patchElement.TryGetProperty("enabled", out var enabledElement) &&
                    enabledElement.ValueKind is JsonValueKind.True or JsonValueKind.False)
                {
                    state["enabled"] = enabledElement.GetBoolean();
                }

                if (patchElement.TryGetProperty("config", out var configElement) &&
                    configElement.ValueKind == JsonValueKind.Object)
                {
                    var currentRuntimeConfig = BuildRuntimeConfig(id, manifest, GetStateConfig(state));
                    foreach (var property in configElement.EnumerateObject())
                    {
                        if (property.Value.ValueKind == JsonValueKind.String)
                        {
                            currentRuntimeConfig[property.Name] = property.Value.GetString() ?? string.Empty;
                        }
                    }
                    state["config"] = SplitAndPersistConfig(id, manifest, currentRuntimeConfig);
                }

                state["updatedAt"] = now;
                WriteJsonNode(ExtensionsStatePath(), stateRoot);
                WorkerLog.Debug($"extension update id={id}");
            }

            return ToResponse(Mutation(true, null));
        }
        catch (Exception ex)
        {
            return ToResponse(Mutation(false, ex.Message));
        }
    }

    public static WorkerResponse Remove(JsonElement parameters)
    {
        try
        {
            var id = NormalizeId(parameters.ValueKind == JsonValueKind.String
                ? parameters.GetString()
                : JsonHelpers.GetString(parameters, "id"));
            if (!IsValidExtensionId(id))
            {
                return ToResponse(Mutation(false, "Invalid extension id"));
            }

            lock (ManagementSync)
            {
                JsonObject? manifest = null;
                var extensionPath = ResolveExtensionPath(id);
                if (File.Exists(Path.Combine(extensionPath, ExtensionManifestFileName)))
                {
                    manifest = ReadNormalizedManifestNode(extensionPath);
                }

                if (Directory.Exists(extensionPath))
                {
                    Directory.Delete(extensionPath, recursive: true);
                }

                var state = ReadStateRoot();
                state.Remove(id);
                WriteJsonNode(ExtensionsStatePath(), state);

                var storage = ReadStorageRoot();
                storage.Remove(id);
                WriteJsonNode(ExtensionsStoragePath(), storage);

                if (manifest is not null)
                {
                    foreach (var key in GetSecretKeys(manifest))
                    {
                        ConfigStore.DeleteKey(SecretConfigKey(id, key));
                    }
                }

                WorkerLog.Debug($"extension remove id={id}");
            }

            return ToResponse(Mutation(true, null));
        }
        catch (Exception ex)
        {
            return ToResponse(Mutation(false, ex.Message));
        }
    }

    public static WorkerResponse ResolvePath(JsonElement parameters)
    {
        try
        {
            var id = NormalizeId(parameters.ValueKind == JsonValueKind.String
                ? parameters.GetString()
                : JsonHelpers.GetString(parameters, "id"));
            if (!IsValidExtensionId(id))
            {
                return ToResponse(Mutation(false, "Invalid extension id"));
            }

            var path = ResolveExtensionPath(id);
            return ToResponse(new JsonObject
            {
                ["success"] = true,
                ["path"] = path
            });
        }
        catch (Exception ex)
        {
            return ToResponse(Mutation(false, ex.Message));
        }
    }

    public static WorkerResponse ReadAsset(JsonElement parameters)
    {
        try
        {
            var id = NormalizeId(JsonHelpers.GetString(parameters, "id"));
            var relativePath = JsonHelpers.GetString(parameters, "path") ?? string.Empty;
            if (!IsValidExtensionId(id))
            {
                return ToResponse(new JsonObject { ["error"] = "Invalid extension id" });
            }

            lock (ManagementSync)
            {
                _ = ReadNormalizedManifestNode(ResolveExtensionPath(id));
                var assetPath = ResolveExtensionAssetPath(id, relativePath);
                if (!File.Exists(assetPath))
                {
                    return ToResponse(new JsonObject { ["error"] = $"Asset not found: {relativePath}" });
                }

                return ToResponse(new JsonObject { ["content"] = File.ReadAllText(assetPath) });
            }
        }
        catch (Exception ex)
        {
            return ToResponse(new JsonObject { ["error"] = ex.Message });
        }
    }

    // ── Storage CRUD ──

    public static WorkerResponse StorageGet(JsonElement parameters)
    {
        try
        {
            var extensionId = NormalizeId(JsonHelpers.GetString(parameters, "extensionId"));
            var key = NormalizeStorageKey(JsonHelpers.GetString(parameters, "key"));
            lock (ManagementSync)
            {
                _ = ReadNormalizedManifestNode(ResolveExtensionPath(extensionId));
                var storage = ReadStorageRoot();
                return storage.TryGetPropertyValue(extensionId, out var extensionStorage) &&
                    extensionStorage is JsonObject extensionObject &&
                    extensionObject.TryGetPropertyValue(key, out var value) &&
                    value is not null
                        ? ToResponse(value.DeepClone())
                        : WorkerResponse.RawJson("null");
            }
        }
        catch (Exception ex)
        {
            return ToResponse(new JsonObject { ["error"] = ex.Message });
        }
    }

    public static WorkerResponse StorageSet(JsonElement parameters)
    {
        try
        {
            var extensionId = NormalizeId(JsonHelpers.GetString(parameters, "extensionId"));
            var key = NormalizeStorageKey(JsonHelpers.GetString(parameters, "key"));
            lock (ManagementSync)
            {
                _ = ReadNormalizedManifestNode(ResolveExtensionPath(extensionId));
                var storage = ReadStorageRoot();
                if (storage[extensionId] is not JsonObject extensionStorage)
                {
                    extensionStorage = [];
                    storage[extensionId] = extensionStorage;
                }

                extensionStorage[key] = parameters.TryGetProperty("value", out var valueElement)
                    ? CloneElement(valueElement)
                    : null;
                WriteJsonNode(ExtensionsStoragePath(), storage);
            }

            return ToResponse(Mutation(true, null));
        }
        catch (Exception ex)
        {
            return ToResponse(Mutation(false, ex.Message));
        }
    }

    public static WorkerResponse StorageDelete(JsonElement parameters)
    {
        try
        {
            var extensionId = NormalizeId(JsonHelpers.GetString(parameters, "extensionId"));
            var key = NormalizeStorageKey(JsonHelpers.GetString(parameters, "key"));
            lock (ManagementSync)
            {
                _ = ReadNormalizedManifestNode(ResolveExtensionPath(extensionId));
                var storage = ReadStorageRoot();
                if (storage[extensionId] is JsonObject extensionStorage)
                {
                    extensionStorage.Remove(key);
                    WriteJsonNode(ExtensionsStoragePath(), storage);
                }
            }

            return ToResponse(Mutation(true, null));
        }
        catch (Exception ex)
        {
            return ToResponse(Mutation(false, ex.Message));
        }
    }

    // ── FindExtensionOrThrow (used by HttpToolExecutor) ──

    public static NativeExtensionInstance FindExtensionOrThrow(string extensionId)
    {
        var normalizedId = NormalizeId(extensionId);
        if (!IsValidExtensionId(normalizedId))
        {
            throw new InvalidOperationException("Invalid extension id");
        }

        var extensionPath = ResolveExtensionPath(normalizedId);
        if (!File.Exists(Path.Combine(extensionPath, ExtensionManifestFileName)))
        {
            throw new InvalidOperationException($"Extension \"{normalizedId}\" not found");
        }

        var manifest = ReadManifest(extensionPath);
        if (!string.Equals(manifest.Id, normalizedId, StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"Extension \"{normalizedId}\" manifest id mismatch");
        }

        var state = ReadState(normalizedId);
        var runtimeConfig = MergeRuntimeConfig(normalizedId, manifest, state.Config);
        return new NativeExtensionInstance(
            normalizedId,
            state.Enabled,
            runtimeConfig,
            manifest);
    }

}

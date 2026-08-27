/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Storage;

/// <summary>
/// Generic JSON key-value config store backed by ~/.wishful-claw/config.json.
/// Provides CRUD endpoints for the config module.
/// </summary>
public static class ConfigStore
{
    private const string DataDirectoryName = ".wishful-claw";
    private const string ConfigFileName = "config.json";
    private static readonly object Sync = new();
    private static readonly JsonFileNodeCache<JsonObject> Cache = new();
    private static readonly JsonSerializerOptions WriteOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = true
    };

    public static WorkerResponse Read(JsonElement parameters)
    {
        lock (Sync)
        {
            return ToResponse(ReadRoot());
        }
    }

    public static WorkerResponse Write(JsonElement parameters)
    {
        if (CloneElement(parameters) is not JsonObject root)
        {
            return ToResponse(Mutation(false, "Invalid config root"));
        }

        lock (Sync)
        {
            WriteRoot(root);
        }

        WorkerLog.Debug("config write root");
        return ToResponse(Mutation(true, null));
    }

    public static WorkerResponse Get(JsonElement parameters)
    {
        var key = ReadKey(parameters);
        lock (Sync)
        {
            var root = ReadRoot();
            if (string.IsNullOrWhiteSpace(key))
            {
                return ToResponse(root);
            }

            return root.TryGetPropertyValue(key, out var value) && value is not null
                ? ToResponse(value.DeepClone())
                : WorkerResponse.FromWriter(static writer => writer.WriteNullValue());
        }
    }

    public static WorkerResponse Set(JsonElement parameters)
    {
        var key = JsonHelpers.GetString(parameters, "key");
        if (string.IsNullOrWhiteSpace(key))
        {
            return ToResponse(Mutation(false, "Missing config key"));
        }

        lock (Sync)
        {
            var root = ReadRoot();
            if (!parameters.TryGetProperty("value", out var valueElement) ||
                valueElement.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            {
                root.Remove(key);
                WorkerLog.Debug($"config delete key={key}");
            }
            else
            {
                root[key] = CloneElement(valueElement);
                WorkerLog.Debug($"config set key={key}");
            }
            WriteRoot(root);
        }

        return ToResponse(Mutation(true, null));
    }

    public static WorkerResponse Delete(JsonElement parameters)
    {
        var key = ReadKey(parameters);
        if (string.IsNullOrWhiteSpace(key))
        {
            return ToResponse(Mutation(false, "Missing config key"));
        }

        lock (Sync)
        {
            var root = ReadRoot();
            root.Remove(key);
            WriteRoot(root);
        }

        WorkerLog.Debug($"config delete key={key}");
        return ToResponse(Mutation(true, null));
    }

    /// <summary>Sets a value by key (internal use by other modules).</summary>
    public static void SetValue(string key, JsonNode? value)
    {
        lock (Sync)
        {
            var root = ReadRoot();
            if (value is null || value.GetValueKind() is JsonValueKind.Null or JsonValueKind.Undefined)
            {
                root.Remove(key);
            }
            else
            {
                root[key] = value.DeepClone();
            }
            WriteRoot(root);
        }
    }

    /// <summary>Deletes a key (internal use by other modules).</summary>
    public static void DeleteKey(string key)
    {
        lock (Sync)
        {
            var root = ReadRoot();
            root.Remove(key);
            WriteRoot(root);
        }
    }

    /// <summary>Reads a string value by key (internal use by other modules).</summary>
    public static string GetStringValue(string key)
    {
        lock (Sync)
        {
            var root = ReadRoot();
            return root.TryGetPropertyValue(key, out var value) &&
                value is JsonValue jsonValue &&
                jsonValue.TryGetValue<string>(out var text)
                    ? text
                    : string.Empty;
        }
    }

    private static JsonObject ReadRoot()
    {
        var filePath = GetConfigPath();
        return Cache.Read(
            filePath,
            JsonValueKind.Object,
            static element => CloneElement(element) as JsonObject,
            "config file") ?? [];
    }

    private static void WriteRoot(JsonObject root)
    {
        var filePath = GetConfigPath();
        Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);

        var tempPath = $"{filePath}.{Guid.NewGuid():N}.tmp";
        File.WriteAllText(tempPath, root.ToJsonString(WriteOptions));
        File.Move(tempPath, filePath, overwrite: true);
        Cache.Store(filePath, root);
    }

    private static string GetConfigPath()
    {
        var dataDirectory = Environment.GetEnvironmentVariable("WISHFULCLAW_DATA_DIR");
        if (!string.IsNullOrWhiteSpace(dataDirectory))
        {
            return Path.Combine(Path.GetFullPath(dataDirectory), ConfigFileName);
        }

        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            DataDirectoryName,
            ConfigFileName);
    }

    private static JsonNode? CloneElement(JsonElement element)
    {
        return JsonNode.Parse(element.GetRawText());
    }

    private static string? ReadKey(JsonElement parameters)
    {
        return parameters.ValueKind == JsonValueKind.String
            ? parameters.GetString()
            : JsonHelpers.GetString(parameters, "key");
    }

    private static JsonObject Mutation(bool success, string? error)
    {
        var result = new JsonObject { ["success"] = success };
        if (!string.IsNullOrWhiteSpace(error))
        {
            result["error"] = error;
        }
        return result;
    }

    private static WorkerResponse ToResponse(JsonNode node)
    {
        return WorkerResponse.FromWriter(writer => node.WriteTo(writer));
    }
}

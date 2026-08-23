using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Storage;

/// <summary>
/// Provider configuration store backed by JSON files.
/// Layout: ~/.wishful-claw/ai-provider/index.json + provider-{id}.json
/// </summary>
public static class ProviderStore
{
    private const string DataDirectoryName = ".wishful-claw";
    private const string ProviderDirectoryName = "ai-provider";
    private const string IndexFileName = "index.json";
    private const string ProviderFilePrefix = "provider-";
    private const string ProviderFileSuffix = ".json";

    private static readonly object Sync = new();
    private static readonly JsonFileNodeCache<JsonObject> IndexCache = new();
    private static readonly JsonSerializerOptions WriteOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = true
    };

    // ── Public API ──

    public static WorkerResponse List(JsonElement parameters)
    {
        lock (Sync)
        {
            var index = ReadIndex();
            var providerIds = GetProviderIds(index);
            var providers = new JsonArray();

            foreach (var id in providerIds)
            {
                var provider = ReadProviderFile(id);
                if (provider is not null)
                {
                    providers.Add(provider as JsonNode);
                }
            }

            return ToResponse(providers);
        }
    }

    /// <summary>
    /// Reads one provider for runtime use. The caller must not expose the returned
    /// JSON to renderer or persist it in Goal data because it may contain secrets.
    /// </summary>
    public static JsonElement? GetProviderJson(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) return null;
        lock (Sync)
        {
            var provider = ReadProviderFile(id);
            return provider is null ? null : JsonDocument.Parse(provider.ToJsonString()).RootElement.Clone();
        }
    }

    public static WorkerResponse Get(JsonElement parameters)
    {
        var id = JsonHelpers.GetString(parameters, "id");
        if (string.IsNullOrWhiteSpace(id))
        {
            return ToResponse(Mutation(false, "Missing provider id"));
        }

        lock (Sync)
        {
            var provider = ReadProviderFile(id);
            if (provider is null)
            {
                return ToResponse(Mutation(false, "Provider not found"));
            }
            return ToResponse(provider);
        }
    }

    public static WorkerResponse Save(JsonElement parameters)
    {
        if (CloneElement(parameters) is not JsonObject provider)
        {
            return ToResponse(Mutation(false, "Invalid provider object"));
        }

        // Ensure provider has an id
        string id;
        if (provider.TryGetPropertyValue("id", out var idNode) &&
            idNode is JsonValue idValue &&
            idValue.TryGetValue<string>(out var existingId) &&
            !string.IsNullOrWhiteSpace(existingId))
        {
            id = existingId;
        }
        else
        {
            id = Guid.NewGuid().ToString("N");
            provider["id"] = id;
        }

        // Ensure createdAt
        if (!provider.ContainsKey("createdAt"))
        {
            provider["createdAt"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        lock (Sync)
        {
            // Write provider file
            WriteProviderFile(id, provider);

            // Update index
            var index = ReadIndex();
            var ids = GetProviderIds(index);
            if (!ids.Contains(id))
            {
                ids.Add(id);
                SetProviderIds(index, ids);
                WriteIndex(index);
            }
        }

        WorkerLog.Debug($"provider saved id={id}");
        return ToResponse(provider);
    }

    public static WorkerResponse Delete(JsonElement parameters)
    {
        var id = JsonHelpers.GetString(parameters, "id");
        if (string.IsNullOrWhiteSpace(id))
        {
            return ToResponse(Mutation(false, "Missing provider id"));
        }

        lock (Sync)
        {
            // Remove from index
            var index = ReadIndex();
            var ids = GetProviderIds(index);
            if (!ids.Remove(id))
            {
                return ToResponse(Mutation(false, "Provider not found"));
            }
            SetProviderIds(index, ids);
            WriteIndex(index);

            // Delete provider file
            var filePath = GetProviderFilePath(id);
            if (File.Exists(filePath))
            {
                File.Delete(filePath);
            }
        }

        WorkerLog.Debug($"provider deleted id={id}");
        return ToResponse(Mutation(true, null));
    }

    // ── Internal helpers ──

    public static string GetDataDirectory()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            DataDirectoryName,
            ProviderDirectoryName);
    }

    // ── Private helpers ──

    private static JsonObject ReadIndex()
    {
        var filePath = GetIndexPath();
        return IndexCache.Read(
            filePath,
            JsonValueKind.Object,
            static element => CloneElement(element) as JsonObject,
            "provider index") ?? new JsonObject();
    }

    private static void WriteIndex(JsonObject index)
    {
        var filePath = GetIndexPath();
        Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);

        var tempPath = $"{filePath}.{Guid.NewGuid():N}.tmp";
        File.WriteAllText(tempPath, index.ToJsonString(WriteOptions));
        File.Move(tempPath, filePath, overwrite: true);
        IndexCache.Store(filePath, index);
    }

    private static JsonObject? ReadProviderFile(string id)
    {
        var filePath = GetProviderFilePath(id);
        if (!File.Exists(filePath)) return null;

        try
        {
            using var document = JsonDocument.Parse(File.ReadAllBytes(filePath));
            return CloneElement(document.RootElement) as JsonObject;
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"provider file read failed id={id} error={ex.Message}");
            return null;
        }
    }

    private static void WriteProviderFile(string id, JsonObject provider)
    {
        var filePath = GetProviderFilePath(id);
        Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);

        var tempPath = $"{filePath}.{Guid.NewGuid():N}.tmp";
        File.WriteAllText(tempPath, provider.ToJsonString(WriteOptions));
        File.Move(tempPath, filePath, overwrite: true);
    }

    private static string GetIndexPath()
    {
        return Path.Combine(GetDataDirectory(), IndexFileName);
    }

    private static string GetProviderFilePath(string id)
    {
        // Sanitize id to prevent path traversal
        var safeId = string.Concat(id.Where(c => char.IsLetterOrDigit(c) || c == '-'));
        if (string.IsNullOrEmpty(safeId)) safeId = Guid.NewGuid().ToString("N");
        return Path.Combine(GetDataDirectory(), $"{ProviderFilePrefix}{safeId}{ProviderFileSuffix}");
    }

    private static List<string> GetProviderIds(JsonObject index)
    {
        var result = new List<string>();
        if (index.TryGetPropertyValue("providerIds", out var idsNode) &&
            idsNode is JsonArray idsArray)
        {
            foreach (var item in idsArray)
            {
                if (item is JsonValue val && val.TryGetValue<string>(out var s) && !string.IsNullOrWhiteSpace(s))
                {
                    result.Add(s);
                }
            }
        }
        return result;
    }

    private static void SetProviderIds(JsonObject index, List<string> ids)
    {
        index["providerIds"] = new JsonArray(ids.Select(id => (JsonNode)JsonValue.Create(id)).ToArray());
    }

    private static JsonNode? CloneElement(JsonElement element)
    {
        return JsonNode.Parse(element.GetRawText());
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

using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent.Modules.Extensions;

/// <summary>
/// Partial of ExtensionManifestStore — path, JSON, response, regex, directory, fingerprint helpers
/// </summary>
public static partial class ExtensionManifestStore
{
    // ── Extension update / fingerprint ──

    private static bool ShouldUpdateExtension(JsonObject sourceManifest, string sourceDir, string targetDir)
    {
        if (!File.Exists(Path.Combine(targetDir, ExtensionManifestFileName)))
        {
            return true;
        }

        try
        {
            var targetManifest = ReadNormalizedManifestNode(targetDir);
            if (ReadNodeString(targetManifest, "version") != ReadNodeString(sourceManifest, "version"))
            {
                return true;
            }

            return !string.Equals(
                ComputeDirectoryFingerprint(sourceDir),
                ComputeDirectoryFingerprint(targetDir),
                StringComparison.Ordinal);
        }
        catch
        {
            return true;
        }
    }

    private static string ComputeDirectoryFingerprint(string rootDir)
    {
        using var hash = System.Security.Cryptography.IncrementalHash.CreateHash(System.Security.Cryptography.HashAlgorithmName.SHA256);
        var buffer = new byte[81920];

        foreach (var file in Directory.EnumerateFiles(rootDir, "*", SearchOption.AllDirectories)
                     .OrderBy(path => Path.GetRelativePath(rootDir, path), StringComparer.Ordinal))
        {
            var relativePath = Path.GetRelativePath(rootDir, file).Replace('\\', '/');
            var pathBytes = System.Text.Encoding.UTF8.GetBytes(relativePath);
            hash.AppendData(pathBytes);
            hash.AppendData(new byte[] { 0 });

            using var stream = File.OpenRead(file);
            int read;
            while ((read = stream.Read(buffer, 0, buffer.Length)) > 0)
            {
                hash.AppendData(buffer, 0, read);
            }

            hash.AppendData(new byte[] { 0xff });
        }

        return Convert.ToHexString(hash.GetHashAndReset());
    }

    // ── Directory helpers ──

    private static void CopyDirectory(string sourceDir, string targetDir)
    {
        Directory.CreateDirectory(targetDir);
        foreach (var directory in Directory.EnumerateDirectories(sourceDir, "*", SearchOption.AllDirectories))
        {
            Directory.CreateDirectory(Path.Combine(targetDir, Path.GetRelativePath(sourceDir, directory)));
        }
        foreach (var file in Directory.EnumerateFiles(sourceDir, "*", SearchOption.AllDirectories))
        {
            var targetFile = Path.Combine(targetDir, Path.GetRelativePath(sourceDir, file));
            Directory.CreateDirectory(Path.GetDirectoryName(targetFile)!);
            File.Copy(file, targetFile, overwrite: true);
        }
    }

    private static void ReplaceDirectory(string sourceDir, string targetDir)
    {
        if (Directory.Exists(targetDir))
        {
            Directory.Delete(targetDir, recursive: true);
        }
        CopyDirectory(sourceDir, targetDir);
    }

    // ── Path helpers ──

    private static string ResolveExtensionPath(string extensionId)
    {
        var root = Path.GetFullPath(Path.Combine(ExtensionsDirectory(), extensionId));
        var extensionsRoot = Path.GetFullPath(ExtensionsDirectory());
        if (root != extensionsRoot && !root.StartsWith(extensionsRoot + Path.DirectorySeparatorChar, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Path escapes extension directory");
        }
        return root;
    }

    private static string ResolveExtensionAssetPath(string extensionId, string relativePath)
    {
        var root = Path.GetFullPath(ResolveExtensionPath(extensionId));
        var target = Path.GetFullPath(Path.Combine(root, relativePath));
        if (target != root && !target.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Path escapes extension directory");
        }
        if (Directory.Exists(target))
        {
            throw new InvalidOperationException($"Asset not found: {relativePath}");
        }
        return target;
    }

    private static string NormalizeStorageKey(string? value)
    {
        var key = (value ?? string.Empty).Trim();
        if (key.Length == 0 || key.Length > 256)
        {
            throw new InvalidOperationException("Extension storage key must be 1-256 characters");
        }
        return key;
    }

    private static string DataDirectory()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            DataDirectoryName);
    }

    private static string ExtensionsDirectory()
    {
        return Path.Combine(DataDirectory(), ExtensionsDirectoryName);
    }

    private static string ExtensionsStatePath()
    {
        return Path.Combine(DataDirectory(), ExtensionsStateFileName);
    }

    private static string ExtensionsStoragePath()
    {
        return Path.Combine(DataDirectory(), ExtensionsStorageFileName);
    }

    private static string SecretConfigKey(string extensionId, string key)
    {
        return $"extension:{extensionId}:secret:{key}";
    }

    // ── JSON helpers (JsonElement) ──

    private static string NormalizeId(string? value)
    {
        return (value ?? string.Empty).Trim().ToLowerInvariant();
    }

    private static bool IsValidExtensionId(string value)
    {
        return ExtensionIdRegex().IsMatch(value);
    }

    private static string ReadString(JsonElement element, string name)
    {
        return element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(name, out var value) &&
            value.ValueKind == JsonValueKind.String
                ? value.GetString() ?? string.Empty
                : string.Empty;
    }

    private static int ReadInt(JsonElement element, string name, int fallback)
    {
        return element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(name, out var value) &&
            value.ValueKind == JsonValueKind.Number &&
            value.TryGetInt32(out var result)
                ? result
                : fallback;
    }

    private static bool ReadBool(JsonElement element, string name, bool fallback)
    {
        return element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(name, out var value) &&
            value.ValueKind is JsonValueKind.True or JsonValueKind.False
                ? value.GetBoolean()
                : fallback;
    }

    private static Dictionary<string, string> ReadStringMap(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var element) || element.ValueKind != JsonValueKind.Object)
        {
            return new Dictionary<string, string>(StringComparer.Ordinal);
        }

        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            if (property.Value.ValueKind == JsonValueKind.String)
            {
                result[property.Name] = property.Value.GetString() ?? string.Empty;
            }
        }
        return result;
    }

    private static JsonDocument? ReadJsonObject(string filePath)
    {
        try
        {
            if (!File.Exists(filePath))
            {
                return null;
            }

            var document = JsonDocument.Parse(File.ReadAllBytes(filePath));
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                document.Dispose();
                return null;
            }
            return document;
        }
        catch
        {
            return null;
        }
    }

    // ── JSON helpers (JsonNode) ──

    private static JsonNode? CloneElement(JsonElement element)
    {
        return JsonNode.Parse(element.GetRawText());
    }

    private static string? ReadOptionalString(JsonElement element, string name)
    {
        var value = ReadString(element, name).Trim();
        return value.Length == 0 ? null : value;
    }

    private static void AddOptionalString(JsonObject target, JsonElement element, string name)
    {
        if (ReadOptionalString(element, name) is { Length: > 0 } value)
        {
            target[name] = value;
        }
    }

    private static string ReadNodeString(JsonObject obj, string name)
    {
        return obj.TryGetPropertyValue(name, out var value) &&
            value is JsonValue jsonValue &&
            jsonValue.TryGetValue<string>(out var text)
                ? text
                : string.Empty;
    }

    private static bool ReadNodeBool(JsonObject obj, string name, bool fallback)
    {
        return obj.TryGetPropertyValue(name, out var value) &&
            value is JsonValue jsonValue &&
            jsonValue.TryGetValue<bool>(out var result)
                ? result
                : fallback;
    }

    private static long ReadNodeLong(JsonObject obj, string name, long fallback)
    {
        return obj.TryGetPropertyValue(name, out var value) &&
            value is JsonValue jsonValue &&
            jsonValue.TryGetValue<long>(out var result)
                ? result
                : fallback;
    }

    private static bool JsonEquals(JsonNode? left, JsonNode? right)
    {
        return (left?.ToJsonString(WorkerJsonHelper.IndentedJsonOptions) ?? "null") ==
            (right?.ToJsonString(WorkerJsonHelper.IndentedJsonOptions) ?? "null");
    }

    // ── Response helpers ──

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

    // ── Regex ──

    [GeneratedRegex("^[a-z0-9][a-z0-9_-]{1,63}$", RegexOptions.CultureInvariant)]
    private static partial Regex ExtensionIdRegex();

    [GeneratedRegex("^[A-Za-z][A-Za-z0-9_-]{0,63}$", RegexOptions.CultureInvariant)]
    private static partial Regex ToolNameRegex();

    private readonly record struct ExtensionState(
        bool Enabled,
        IReadOnlyDictionary<string, string> Config);
}

using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent.Modules.Extensions;

/// <summary>
/// Partial of ExtensionManifestStore — typed manifest reading
/// </summary>
public static partial class ExtensionManifestStore
{
    // ── Manifest reading (typed) ──

    private static NativeExtensionManifest ReadManifest(string extensionPath)
    {
        var manifestPath = Path.Combine(extensionPath, ExtensionManifestFileName);
        using var document = JsonDocument.Parse(File.ReadAllBytes(manifestPath));
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException("extension.json must contain an object");
        }

        var schemaVersion = ReadInt(root, "schemaVersion", 0);
        if (schemaVersion != 1)
        {
            throw new InvalidOperationException("extension schemaVersion must be 1");
        }

        var id = NormalizeId(ReadString(root, "id"));
        if (!IsValidExtensionId(id))
        {
            throw new InvalidOperationException("extension id must be 2-64 chars using lowercase letters, numbers, _ or -");
        }

        var name = ReadString(root, "name").Trim();
        var version = ReadString(root, "version").Trim();
        if (name.Length == 0)
        {
            throw new InvalidOperationException("extension name is required");
        }
        if (version.Length == 0)
        {
            throw new InvalidOperationException("extension version is required");
        }

        var configSchema = ReadConfigSchema(root);
        var networkPermissions = ReadNetworkPermissions(root);
        var tools = ReadTools(root);
        var views = ReadViews(root, extensionPath);
        // S-240：插件可以「只声明视图、不声明任何工具」（纯 UI 插件），所以不再要求 tools 非空，
        // 但两者至少要有一项 —— 否则这个插件装进来什么也做不了。
        if (tools.Count == 0 && views.Count == 0)
        {
            throw new InvalidOperationException("extension must define at least one tool or view");
        }
        var assets = ReadAssets(root);
        if (tools.Any(static tool => tool.Kind == "js") &&
            ReadString(root, "entry").Trim().Length == 0)
        {
            throw new InvalidOperationException("extension entry is required for js tools");
        }

        return new NativeExtensionManifest(
            schemaVersion,
            id,
            name,
            version,
            configSchema,
            networkPermissions,
            tools,
            views,
            assets);
    }

    /// <summary>
    /// 校验插件内的相对路径（视图 / 渲染器 / 组件的 entry）。防「读到自己目录外」。
    /// 这里只做路径合法性，不要求文件存在 —— 声明阶段允许先写清单后放文件。
    /// </summary>
    private static string ValidateManifestEntry(string extensionDir, string entry, string context)
    {
        var normalized = entry.Trim().Replace('\\', '/');
        if (normalized.Length == 0)
        {
            throw new InvalidOperationException($"{context} entry is required");
        }
        if (Path.IsPathRooted(normalized) || normalized.StartsWith('/') || normalized.Contains(':'))
        {
            throw new InvalidOperationException($"{context} entry must be a relative path");
        }

        var rootFull = Path.GetFullPath(extensionDir);
        var rootPrefix = rootFull.EndsWith(Path.DirectorySeparatorChar)
            ? rootFull
            : rootFull + Path.DirectorySeparatorChar;
        var targetFull = Path.GetFullPath(Path.Combine(rootFull, normalized));
        if (!targetFull.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"{context} entry must stay inside the extension directory");
        }

        return normalized;
    }

    /// <summary>解析 `views[]`（S-240）。`id` 在插件内唯一，`navOrder` 缺省 100。</summary>
    private static List<NativeExtensionViewDefinition> ReadViews(JsonElement root, string extensionDir)
    {
        var views = new List<NativeExtensionViewDefinition>();
        if (!root.TryGetProperty("views", out var viewsElement) || viewsElement.ValueKind != JsonValueKind.Array)
        {
            return views;
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in viewsElement.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var id = ReadString(item, "id").Trim();
            if (!ViewIdRegex().IsMatch(id))
            {
                throw new InvalidOperationException("invalid extension view id");
            }
            if (!seen.Add(id))
            {
                throw new InvalidOperationException($"duplicate view id: {id}");
            }

            var title = ReadString(item, "title").Trim();
            if (title.Length == 0)
            {
                title = id;
            }

            var entry = ValidateManifestEntry(extensionDir, ReadString(item, "entry"), $"view \"{id}\"");
            var navOrder = 100;
            if (item.TryGetProperty("nav", out var nav) && nav.ValueKind == JsonValueKind.Object)
            {
                navOrder = ReadInt(nav, "order", 100);
            }

            views.Add(new NativeExtensionViewDefinition(id, title, entry, navOrder));
        }

        return views;
    }

    /// <summary>解析 `assets[]`（S-240）。只有 id 与 optional，URL 归主程序内置表。</summary>
    private static List<NativeExtensionAssetDefinition> ReadAssets(JsonElement root)
    {
        var assets = new List<NativeExtensionAssetDefinition>();
        if (!root.TryGetProperty("assets", out var assetsElement) || assetsElement.ValueKind != JsonValueKind.Array)
        {
            return assets;
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in assetsElement.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var id = ReadString(item, "id").Trim();
            if (id.Length == 0)
            {
                throw new InvalidOperationException("extension asset id is required");
            }
            if (!seen.Add(id))
            {
                throw new InvalidOperationException($"duplicate asset id: {id}");
            }

            assets.Add(new NativeExtensionAssetDefinition(id, ReadBool(item, "optional", false)));
        }

        return assets;
    }

    private static List<NativeExtensionConfigField> ReadConfigSchema(JsonElement root)
    {
        if (!root.TryGetProperty("configSchema", out var schema) || schema.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var fields = new List<NativeExtensionConfigField>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in schema.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var key = ReadString(item, "key").Trim();
            if (key.Length == 0)
            {
                continue;
            }
            if (!seen.Add(key))
            {
                throw new InvalidOperationException($"duplicate config key: {key}");
            }

            var type = ReadString(item, "type") == "secret" ? "secret" : "text";
            var defaultValue = item.TryGetProperty("defaultValue", out var defaultElement) &&
                defaultElement.ValueKind == JsonValueKind.String
                    ? defaultElement.GetString()
                    : null;
            fields.Add(new NativeExtensionConfigField(key, type, defaultValue));
        }

        return fields;
    }

    private static List<string> ReadNetworkPermissions(JsonElement root)
    {
        if (!root.TryGetProperty("permissions", out var permissions) ||
            permissions.ValueKind != JsonValueKind.Object ||
            !permissions.TryGetProperty("network", out var network) ||
            network.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var values = new List<string>();
        foreach (var item in network.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String &&
                item.GetString() is { } value &&
                value.Trim().Length > 0)
            {
                values.Add(value.Trim());
            }
        }
        return values;
    }

    private static List<NativeExtensionToolDefinition> ReadTools(JsonElement root)
    {
        // S-240：tools 可以整体省略（纯 UI 插件）。「至少一项」的校验上移到 ReadManifest，
        // 那里能同时看到 views，不会把只有视图的插件误杀。
        if (!root.TryGetProperty("tools", out var toolsElement) || toolsElement.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var tools = new List<NativeExtensionToolDefinition>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in toolsElement.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var name = ReadString(item, "name").Trim();
            if (!ToolNameRegex().IsMatch(name))
            {
                throw new InvalidOperationException("invalid extension tool name");
            }
            if (!seen.Add(name))
            {
                throw new InvalidOperationException($"duplicate tool name: {name}");
            }

            var kind = ReadString(item, "kind").Trim();
            if (kind == "js")
            {
                var handler = ReadString(item, "handler").Trim();
                if (handler.Length == 0)
                {
                    throw new InvalidOperationException($"js tool \"{name}\" requires handler");
                }
                tools.Add(new NativeExtensionToolDefinition(name, kind, null, handler));
                continue;
            }
            if (kind != "http")
            {
                throw new InvalidOperationException($"tool \"{name}\" kind must be \"http\" or \"js\"");
            }

            var http = ReadHttpDefinition(name, item);
            tools.Add(new NativeExtensionToolDefinition(name, kind, http, null));
        }

        return tools;
    }

    private static NativeExtensionHttpDefinition ReadHttpDefinition(string toolName, JsonElement tool)
    {
        if (!tool.TryGetProperty("http", out var http) || http.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException($"http tool \"{toolName}\" requires http.method and http.url");
        }

        var method = ReadString(http, "method").Trim().ToUpperInvariant();
        if (method.Length == 0)
        {
            method = "GET";
        }

        var url = ReadString(http, "url").Trim();
        if (url.Length == 0)
        {
            throw new InvalidOperationException($"http tool \"{toolName}\" requires http.method and http.url");
        }

        var headers = new Dictionary<string, string>(StringComparer.Ordinal);
        if (http.TryGetProperty("headers", out var headersElement) &&
            headersElement.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in headersElement.EnumerateObject())
            {
                if (property.Value.ValueKind == JsonValueKind.String)
                {
                    headers[property.Name] = property.Value.GetString() ?? string.Empty;
                }
            }
        }

        JsonElement? body = null;
        if (http.TryGetProperty("body", out var bodyElement))
        {
            body = bodyElement.Clone();
        }

        return new NativeExtensionHttpDefinition(method, url, headers, body);
    }

}

using System.Globalization;
using System.Text.Json;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

internal static partial class AgentRuntimeUseCapabilityExecutor
{
    private const int DefaultPageSize = 20;
    private const int MaxPageSize = 100;

    private sealed record CapabilityListOptions(
        string Type,
        string Query,
        string Category,
        int Offset,
        int PageSize,
        string? Error);

    private sealed record CapabilitySummary(
        string CapabilityId,
        string Type,
        string Category,
        string Name,
        string Description,
        string? Status);

    private static CapabilityListOptions ParseListOptions(JsonElement input)
    {
        var nested = input.ValueKind == JsonValueKind.Object
            && input.TryGetProperty("arguments", out var arguments)
            && arguments.ValueKind == JsonValueKind.Object
                ? arguments
                : default;
        var type = ReadListString(input, nested, "capability_type", "type").ToLowerInvariant();
        var query = ReadListString(input, nested, "query");
        var category = ReadListString(input, nested, "category").ToLowerInvariant();
        var pageSize = Math.Clamp(ReadListInt(input, nested, "page_size", DefaultPageSize), 1, MaxPageSize);
        var cursor = ReadListString(input, nested, "cursor");
        var offset = 0;

        if (cursor.Length > 0
            && (!int.TryParse(cursor, NumberStyles.None, CultureInfo.InvariantCulture, out offset) || offset < 0))
        {
            return new CapabilityListOptions(type, query, category, 0, pageSize,
                "Invalid cursor. Use the next_cursor value returned by the previous page.");
        }

        return new CapabilityListOptions(type, query, category, offset, pageSize, null);
    }

    private static string ReadListString(
        JsonElement input,
        JsonElement nested,
        params string[] names)
    {
        foreach (var name in names)
        {
            var value = JsonHelpers.GetString(input, name);
            if (!string.IsNullOrWhiteSpace(value))
                return value.Trim();
        }
        if (nested.ValueKind == JsonValueKind.Object)
        {
            foreach (var name in names)
            {
                var value = JsonHelpers.GetString(nested, name);
                if (!string.IsNullOrWhiteSpace(value))
                    return value.Trim();
            }
        }
        return string.Empty;
    }

    private static int ReadListInt(
        JsonElement input,
        JsonElement nested,
        string name,
        int fallback)
    {
        var value = JsonHelpers.GetIntNullable(input, name);
        if (value.HasValue)
            return value.Value;
        return nested.ValueKind == JsonValueKind.Object
            ? JsonHelpers.GetInt(nested, name, fallback)
            : fallback;
    }

    private static bool IsProxiedBuiltinTool(string toolName, string category)
        => ProxiedCategories.Contains(category) || ProxiedBuiltinTools.Contains(toolName);

    private static List<CapabilitySummary> BuildCapabilitySummaries(
        JsonElement listResult,
        ToolRegistry? registry,
        AgentRunContext runContext,
        string? sessionMode)
    {
        var result = new List<CapabilitySummary>();

        if (listResult.ValueKind == JsonValueKind.Object
            && listResult.TryGetProperty("servers", out var servers)
            && servers.ValueKind == JsonValueKind.Array)
        {
            foreach (var server in servers.EnumerateArray())
            {
                if (server.ValueKind != JsonValueKind.Object) continue;
                var id = JsonHelpers.GetString(server, "id") ?? string.Empty;
                var name = JsonHelpers.GetString(server, "name") ?? id;
                var status = JsonHelpers.GetString(server, "status") ?? "configured";
                result.Add(new CapabilitySummary(
                    $"mcp-server:{id}", "mcp-server", "mcp", name,
                    $"MCP server {name} ({status}). Inspect it for its tool directory.", status));

                if (!server.TryGetProperty("tools", out var tools) || tools.ValueKind != JsonValueKind.Array)
                    continue;

                foreach (var tool in tools.EnumerateArray())
                {
                    if (tool.ValueKind != JsonValueKind.Object) continue;
                    var toolName = JsonHelpers.GetString(tool, "name") ?? string.Empty;
                    var description = JsonHelpers.GetString(tool, "description") ?? toolName;
                    result.Add(new CapabilitySummary(
                        $"mcp-tool:{id}/{toolName}", "mcp-tool", "mcp", toolName, description, status));
                }
            }
        }

        if (listResult.ValueKind == JsonValueKind.Object
            && listResult.TryGetProperty("skills", out var skills)
            && skills.ValueKind == JsonValueKind.Array)
        {
            foreach (var skill in skills.EnumerateArray())
            {
                if (skill.ValueKind != JsonValueKind.Object) continue;
                var name = JsonHelpers.GetString(skill, "name") ?? string.Empty;
                var description = JsonHelpers.GetString(skill, "description") ?? name;
                result.Add(new CapabilitySummary(
                    $"skill:{name}", "skill", "skill", name, description, "ready"));
            }
        }

        if (registry is not null)
        {
            foreach (var name in registry.GetToolNames())
            {
                var category = registry.GetCategory(name);
                if (category is null
                    || !IsProxiedBuiltinTool(name, category)
                    || !registry.IsAvailableInMode(name, sessionMode)
                    || !AgentRunContextPolicy.IsToolAllowed(runContext, name, category)
                    || !registry.TryGetExecutor(name, out var executor)
                    || executor is null)
                {
                    continue;
                }

                result.Add(new CapabilitySummary(
                    $"builtin:{name}", "builtin", category.ToLowerInvariant(), name,
                    executor.Description, "ready"));
            }
        }

        result.Sort((left, right) =>
            string.Compare(left.CapabilityId, right.CapabilityId, StringComparison.Ordinal));
        return result;
    }

    private static bool MatchesListOptions(CapabilitySummary capability, CapabilityListOptions options)
    {
        if (options.Type.Length > 0
            && !string.Equals(capability.Type, options.Type, StringComparison.OrdinalIgnoreCase)
            && !(string.Equals(options.Type, "mcp", StringComparison.OrdinalIgnoreCase)
                 && string.Equals(capability.Category, "mcp", StringComparison.OrdinalIgnoreCase)))
            return false;
        if (options.Category.Length > 0
            && !string.Equals(capability.Category, options.Category, StringComparison.OrdinalIgnoreCase))
            return false;
        if (options.Query.Length == 0)
            return true;

        return capability.CapabilityId.Contains(options.Query, StringComparison.OrdinalIgnoreCase)
            || capability.Name.Contains(options.Query, StringComparison.OrdinalIgnoreCase)
            || capability.Description.Contains(options.Query, StringComparison.OrdinalIgnoreCase);
    }

    private static string EncodeListResponse(
        JsonElement listResult,
        ToolRegistry? registry,
        AgentRunContext runContext,
        string? sessionMode,
        CapabilityListOptions options)
    {
        if (options.Error is not null)
            return EncodeError(options.Error);

        var filtered = BuildCapabilitySummaries(listResult, registry, runContext, sessionMode)
            .Where(capability => MatchesListOptions(capability, options))
            .ToList();
        var total = filtered.Count;
        var offset = Math.Min(options.Offset, total);
        var page = filtered.Skip(offset).Take(options.PageSize).ToList();
        var nextOffset = offset + page.Count;
        var hasMore = nextOffset < total;
        var categories = filtered
            .GroupBy(capability => capability.Category, StringComparer.OrdinalIgnoreCase)
            .Select(group => (Name: group.Key, Count: group.Count()))
            .OrderBy(group => group.Name, StringComparer.Ordinal)
            .ToList();

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteNumber("total", total);
            writer.WriteBoolean("has_more", hasMore);
            if (hasMore)
                writer.WriteString("next_cursor", nextOffset.ToString(CultureInfo.InvariantCulture));
            else
                writer.WriteNull("next_cursor");

            writer.WritePropertyName("categories");
            writer.WriteStartArray();
            foreach (var category in categories)
            {
                writer.WriteStartObject();
                writer.WriteString("category", category.Name);
                writer.WriteNumber("total", category.Count);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();

            writer.WritePropertyName("capabilities");
            writer.WriteStartArray();
            foreach (var capability in page)
            {
                writer.WriteStartObject();
                writer.WriteString("capability_id", capability.CapabilityId);
                writer.WriteString("type", capability.Type);
                writer.WriteString("category", capability.Category);
                writer.WriteString("name", capability.Name);
                writer.WriteString("description", capability.Description);
                if (capability.Status is not null)
                    writer.WriteString("status", capability.Status);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            writer.WriteEndObject();
        }

        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }
}

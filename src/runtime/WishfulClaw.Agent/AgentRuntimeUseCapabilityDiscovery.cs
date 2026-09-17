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

    /// <summary>
    /// The category vocabulary shown to an agent is derived from the catalog, not maintained as a
    /// second list of display strings. The core set is the authority for which categories are
    /// injected directly; everything the catalog knows beyond it is proxy-reachable, and
    /// ToolCategoryCatalog supplies stable ordering.
    /// </summary>
    internal static IReadOnlyList<string> GetProxiedCategoryNames()
        => ToolCategoryCatalog.All
            .Where(category => !ToolCategoryCatalog.Core.Contains(category.Name, StringComparer.OrdinalIgnoreCase))
            .Select(category => category.Name)
            .ToArray();

    /// <summary>
    /// Shared visibility predicate for list, inspect and call. The registry/mode checks are kept
    /// beside the policy check so a new action cannot expose a tool through only one path.
    /// Category membership no longer gates the proxy: a built-in belongs to the proxy when its
    /// executor is not core (iter-28). Run-level feature switches are enforced inside
    /// <c>AgentRunContextPolicy.IsToolAllowed</c>, which every surface reads — keeping the gate in
    /// one place is what stops a disabled feature from leaking through whichever path is checked
    /// less often.
    /// </summary>
    internal static bool IsProxyBuiltinVisible(
        ToolRegistry? registry,
        AgentRunContext runContext,
        string? sessionMode,
        bool channelSession,
        string toolName)
        => registry is not null
            && registry.IsRegistered(toolName)
            && registry.IsAvailableInMode(toolName, sessionMode)
            && AgentRunContextPolicy.IsToolAllowed(
                runContext,
                toolName,
                registry,
                channelSession);

    /// <summary>
    /// Return only proxy categories that have at least one registered, mode-available and visible
    /// built-in tool in this run. This is the common source for the use_capability description and
    /// action=list; callers must not build a separate role/mode filter.
    /// </summary>
    internal static IReadOnlyList<string> GetVisibleProxiedCategoryNames(
        ToolRegistry? registry,
        AgentRunContext runContext,
        string? sessionMode,
        bool channelSession)
    {
        if (registry is null)
            return [];

        var visibleCategories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var name in registry.GetToolNames())
        {
            var category = registry.GetCategory(name);
            if (category is not null
                && IsProxyBuiltinVisible(registry, runContext, sessionMode, channelSession, name)
                && registry.TryGetExecutor(name, out var executor)
                && executor is not null
                && !executor.IsCore)
            {
                visibleCategories.Add(category);
            }
        }

        return ToolCategoryCatalog.All
            .Where(category => visibleCategories.Contains(category.Name))
            .Select(category => category.Name)
            .ToArray();
    }

    /// <summary>
    /// Render the category directory embedded in the use_capability description. MCP and Skill
    /// entries are discovered from their own registries; this list covers categorized built-in
    /// proxy tools. Both registration and per-run rewriting use this source inside Agent, so Persona
    /// does not need a reverse dependency on Agent.
    /// </summary>
    internal static string BuildCapabilityDescription()
        => BuildCapabilityDescription(
            registry: null,
            new AgentRunContext("project", "chat", ToolVisibilityPolicy.SessionAgentRole),
            sessionMode: null,
            channelSession: false);

    internal static string BuildCapabilityDescription(
        ToolRegistry? registry,
        AgentRunContext runContext,
        string? sessionMode,
        bool channelSession)
    {
        var categories = registry is null
            ? GetProxiedCategoryNames()
            : GetVisibleProxiedCategoryNames(registry, runContext, sessionMode, channelSession);
        var categoryList = categories.Count == 0
            ? "(none registered for this session)"
            : string.Join(", ", categories);

        return "Stable capability proxy for MCP tools, Skills, and proxied built-in tools. "
            + $"Available built-in categories in this session: {categoryList}. "
            + "MCP servers/tools and Skills are listed when configured. "
            + "action=\"list\" returns paged summaries (filters: type, category, query, cursor, page_size); "
            + "action=\"inspect\" returns one capability's full input schema; action=\"call\" executes it. "
            + "capability_id format: \"mcp-tool:server/tool\", \"skill:name\", or \"builtin:toolName\".";
    }

    internal static IReadOnlyList<ToolDefinition> ApplyCapabilityDescription(
        IReadOnlyList<ToolDefinition> definitions,
        ToolRegistry? registry,
        AgentRunContext runContext,
        string? sessionMode,
        bool channelSession)
    {
        var description = BuildCapabilityDescription(registry, runContext, sessionMode, channelSession);
        var rewritten = new List<ToolDefinition>(definitions.Count);
        foreach (var definition in definitions)
        {
            rewritten.Add(string.Equals(definition.Name, ToolName, StringComparison.Ordinal)
                ? definition with { Description = description }
                : definition);
        }
        return rewritten;
    }

    private static List<CapabilitySummary> BuildCapabilitySummaries(
        JsonElement listResult,
        ToolRegistry? registry,
        AgentRunContext runContext,
        string? sessionMode,
        bool channelSession)
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
                    || !IsProxyBuiltinVisible(registry, runContext, sessionMode, channelSession, name)
                    || !registry.TryGetExecutor(name, out var executor)
                    || executor is null
                    || executor.IsCore)
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
        bool channelSession,
        CapabilityListOptions options)
    {
        if (options.Error is not null)
            return EncodeError(options.Error);

        var filtered = BuildCapabilitySummaries(listResult, registry, runContext, sessionMode, channelSession)
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

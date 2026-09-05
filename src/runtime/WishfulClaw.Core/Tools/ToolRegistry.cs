using System;
using System.Collections.Generic;
using System.Text.Json;

namespace WishfulClaw.Core.Tools;

/// <summary>
/// Tool registry — registers tools, provides lookup and listing.
/// Incorporates schema canonicalization and stable ordering for prefix-cache friendliness.
/// </summary>
public sealed class ToolRegistry
{
    private readonly Dictionary<string, IToolExecutor> _tools = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _toolCategories = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string[]?> _toolModes = new(StringComparer.Ordinal);

    // Current category context — set by PushCategory when a Provider registers tools.
    private string? _currentCategory;

    // Cached canonical definitions — computed once after all tools are registered.
    private List<ToolDefinition>? _cachedDefinitions;

    /// <summary>
    /// Set the current category context. All subsequent Register() calls will
    /// associate the tool with this category until PopCategory is called.
    /// Used by ToolProviderDiscovery to automatically tag tools with their provider's category.
    /// </summary>
    public void PushCategory(string category)
    {
        _currentCategory = category;
    }

    /// <summary>
    /// Clear the current category context.
    /// </summary>
    public void PopCategory()
    {
        _currentCategory = null;
    }

    /// <summary>
    /// Register a tool executor.
    /// </summary>
    public void Register(IToolExecutor executor, string? category = null)
    {
        _tools[executor.Name] = executor;
        var cat = category ?? _currentCategory;
        if (cat != null)
            _toolCategories[executor.Name] = cat;
        if (executor.AvailableModes != null)
            _toolModes[executor.Name] = executor.AvailableModes;
        _cachedDefinitions = null; // Invalidate cache
    }

    /// <summary>
    /// Try to get a tool executor by name.
    /// </summary>
    public bool TryGetExecutor(string name, out IToolExecutor? executor)
    {
        return _tools.TryGetValue(name, out executor);
    }

    /// <summary>
    /// Check if a tool is registered.
    /// </summary>
    public bool IsRegistered(string name)
    {
        return _tools.ContainsKey(name);
    }

    /// <summary>
    /// Get all registered tool names.
    /// </summary>
    public IReadOnlyCollection<string> GetToolNames()
    {
        return _tools.Keys;
    }

    /// <summary>
    /// Get the category for a tool, or null if not categorized.
    /// </summary>
    public string? GetCategory(string toolName)
    {
        return _toolCategories.TryGetValue(toolName, out var cat) ? cat : null;
    }

    public bool IsAvailableInMode(string toolName, string? sessionMode)
    {
        if (!_tools.ContainsKey(toolName))
            return false;
        if (!_toolModes.TryGetValue(toolName, out var modes) || modes == null || modes.Length == 0)
            return true;
        if (string.IsNullOrWhiteSpace(sessionMode))
            return false;

        return Array.Exists(modes,
            mode => string.Equals(mode, sessionMode, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Get all registered tool definitions (for sending to LLM provider).
    /// Definitions are canonicalized once and cached. The returned list is sorted
    /// alphabetically by tool name to ensure stable prefix across requests,
    /// maximizing LLM provider prefix-cache hit rates.
    /// </summary>
    public IReadOnlyList<ToolDefinition> GetToolDefinitions()
    {
        if (_cachedDefinitions != null)
            return _cachedDefinitions;

        var list = new List<ToolDefinition>(_tools.Count);
        foreach (var executor in _tools.Values)
        {
            ToolDefinition def;

            // Read InputSchema once — the property may re-parse on every access,
            // so caching avoids double-throw if the schema JSON is malformed.
            JsonElement rawSchema;
            try
            {
                rawSchema = executor.InputSchema;
            }
            catch (Exception ex)
            {
                System.Console.Error.WriteLine(
                    $"[ToolRegistry] InputSchema parse failed for tool '{executor.Name}': {ex.Message}");
                // Skip this tool entirely — a malformed schema would break the entire tool/list response.
                continue;
            }

            try
            {
                var canonSchema = CanonicalizeSchema(rawSchema);
                var category = _toolCategories.TryGetValue(executor.Name, out var registeredCategory)
                    ? registeredCategory
                    : null;
                def = new ToolDefinition(
                    executor.Name,
                    executor.Description,
                    canonSchema,
                    executor.AvailableModes,
                    category,
                    ToolCategoryCatalog.GetPriority(category));
            }
            catch (Exception ex)
            {
                System.Console.Error.WriteLine(
                    $"[ToolRegistry] CanonicalizeSchema failed for tool '{executor.Name}': {ex.Message}");
                // Fallback: use the raw schema without canonicalization
                var category = _toolCategories.TryGetValue(executor.Name, out var registeredCategory)
                    ? registeredCategory
                    : null;
                def = new ToolDefinition(
                    executor.Name,
                    executor.Description,
                    rawSchema,
                    executor.AvailableModes,
                    category,
                    ToolCategoryCatalog.GetPriority(category));
            }

            list.Add(def);
        }

        // Sort by workflow category first, then name for deterministic prefix bytes.
        list.Sort((a, b) =>
        {
            var byPriority = a.Priority.CompareTo(b.Priority);
            return byPriority != 0
                ? byPriority
                : string.Compare(a.Name, b.Name, StringComparison.Ordinal);
        });

        _cachedDefinitions = list;
        return list;
    }

    /// <summary>
    /// Get tool definitions filtered by a predicate (for preset-based filtering).
    /// The underlying definitions are still canonicalized and sorted.
    /// </summary>
    public IReadOnlyList<ToolDefinition> GetToolDefinitions(Predicate<string> toolNameFilter)
    {
        var all = GetToolDefinitions();
        var filtered = new List<ToolDefinition>();
        foreach (var def in all)
        {
            if (toolNameFilter(def.Name))
                filtered.Add(def);
        }
        return filtered;
    }

    /// <summary>
    /// Get tool definitions filtered by a ToolPreset.
    /// Tools are included/excluded based on their category and name.
    /// </summary>
    public IReadOnlyList<ToolDefinition> GetToolDefinitions(ToolPreset preset)
    {
        var all = GetToolDefinitions();
        var filtered = new List<ToolDefinition>();
        foreach (var def in all)
        {
            var category = _toolCategories.TryGetValue(def.Name, out var cat) ? cat : null;
            if (preset.Includes(def.Name, category))
                filtered.Add(def);
        }
        return filtered;
    }

    /// <summary>
    /// Get tool definitions filtered by a ToolPreset AND session mode.
    /// Tools are filtered by category (preset) and then by available modes.
    /// </summary>
    public IReadOnlyList<ToolDefinition> GetToolDefinitions(ToolPreset preset, string? sessionMode)
    {
        var all = GetToolDefinitions(preset);
        if (string.IsNullOrWhiteSpace(sessionMode))
            return all;

        var filtered = new List<ToolDefinition>();
        foreach (var def in all)
        {
            var modes = _toolModes.TryGetValue(def.Name, out var m) ? m : null;
            // null/empty modes = available in all modes
            if (modes == null || modes.Length == 0)
            {
                filtered.Add(def);
            }
            else if (Array.IndexOf(modes, sessionMode) >= 0)
            {
                filtered.Add(def);
            }
        }
        return filtered;
    }

    /// <summary>
    /// Canonicalize a JSON schema into a stable byte representation:
    /// recursively sort object properties alphabetically and sort required arrays.
    /// This maximizes prefix-cache hit rates across LLM requests.
    /// </summary>
    private static JsonElement CanonicalizeSchema(JsonElement schema)
    {
        // AOT-safe: use Utf8JsonWriter to serialize the canonicalized structure directly.
        // No JsonSerializer.Serialize — avoids reflection-based serialization entirely.
        var buffer = new System.Buffers.ArrayBufferWriter<byte>();
        using (var writer = new System.Text.Json.Utf8JsonWriter(buffer))
        {
            WriteCanonicalElement(writer, schema);
        }
        using var doc = JsonDocument.Parse(buffer.WrittenMemory);
        return doc.RootElement.Clone();
    }

    private static void WriteCanonicalElement(System.Text.Json.Utf8JsonWriter writer, JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                var props = new List<(string Name, JsonElement Value)>(8);
                foreach (var prop in element.EnumerateObject())
                    props.Add((prop.Name, prop.Value));
                props.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.Ordinal));
                foreach (var (name, value) in props)
                {
                    writer.WritePropertyName(name);
                    if (name == "required" && value.ValueKind == JsonValueKind.Array)
                    {
                        var items = new List<string>();
                        foreach (var item in value.EnumerateArray())
                            items.Add(item.GetString() ?? "");
                        items.Sort(StringComparer.Ordinal);
                        writer.WriteStartArray();
                        foreach (var item in items)
                            writer.WriteStringValue(item);
                        writer.WriteEndArray();
                    }
                    else
                    {
                        WriteCanonicalElement(writer, value);
                    }
                }
                writer.WriteEndObject();
                break;

            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in element.EnumerateArray())
                    WriteCanonicalElement(writer, item);
                writer.WriteEndArray();
                break;

            case JsonValueKind.String:
                writer.WriteStringValue(element.GetString());
                break;

            case JsonValueKind.Number:
                if (element.TryGetInt64(out var intVal))
                    writer.WriteNumberValue(intVal);
                else if (element.TryGetDouble(out var dblVal))
                    writer.WriteNumberValue(dblVal);
                else
                    writer.WriteRawValue(element.GetRawText());
                break;

            case JsonValueKind.True:
                writer.WriteBooleanValue(true);
                break;

            case JsonValueKind.False:
                writer.WriteBooleanValue(false);
                break;

            case JsonValueKind.Null:
            default:
                writer.WriteNullValue();
                break;
        }
    }
}
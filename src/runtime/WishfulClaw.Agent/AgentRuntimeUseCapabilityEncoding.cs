using WishfulClaw.Contracts;
using System.Text.Json;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// JSON encoding and helper methods for AgentRuntimeUseCapabilityExecutor.
/// Split from the main file for maintainability (AGENTS.md: 200~500 lines per file).
/// </summary>
internal static partial class AgentRuntimeUseCapabilityExecutor
{
    // ── helpers ──

    private static (string? ServerId, string ToolName) ParseMcpToolId(string capabilityId)
    {
        // mcp-tool:serverName/toolName
        var rest = capabilityId["mcp-tool:".Length..];
        var slashIdx = rest.IndexOf('/');
        if (slashIdx <= 0 || slashIdx + 1 >= rest.Length)
        {
            return (null, string.Empty);
        }
        return (rest[..slashIdx], rest[(slashIdx + 1)..]);
    }

    private static JsonElement CreateEmptyObject()
    {
        using var doc = JsonDocument.Parse("{}");
        return doc.RootElement.Clone();
    }

    private static JsonElement CreateInspectRequest(string serverId, string toolName)
    {
        return WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("serverId", serverId);
            w.WriteString("toolName", toolName);
            w.WriteEndObject();
        });
    }

    private static JsonElement CreateSkillInput(string skillName)
    {
        return WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("skillName", skillName);
            w.WriteEndObject();
        });
    }

    private static JsonElement? FindServer(JsonElement listResult, string serverName)
    {
        if (listResult.ValueKind != JsonValueKind.Object) return null;
        if (!listResult.TryGetProperty("servers", out var servers) || servers.ValueKind != JsonValueKind.Array) return null;
        foreach (var server in servers.EnumerateArray())
        {
            if (server.ValueKind == JsonValueKind.Object &&
                server.TryGetProperty("id", out var id) &&
                string.Equals(id.GetString(), serverName, StringComparison.OrdinalIgnoreCase))
            {
                return server;
            }
        }
        return null;
    }

    private static bool IsJsonError(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty("error", out _);
        }
        catch
        {
            return false;
        }
    }

    // ── encoding ──

    private static string EncodeInspectResponse(string capabilityId, JsonElement detail)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("capability_id", capabilityId);
            writer.WritePropertyName("detail");
            detail.WriteTo(writer);
            writer.WriteEndObject();
        }
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    private static string EncodeSkillInspectResponse(string skillName)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("capability_id", $"skill:{skillName}");
            writer.WriteString("type", "skill");
            writer.WriteString("name", skillName);
            writer.WriteString("description", $"Skill: {skillName}. Use action=call to load the full SKILL.md content.");
            writer.WriteEndObject();
        }
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    private static string EncodeBuiltinInspectResponse(
        ToolRegistry? registry,
        AgentRunContext runContext,
        string? sessionMode,
        string toolName)
    {
        if (registry is null || !registry.TryGetExecutor(toolName, out var executor) || executor is null)
        {
            return EncodeError($"Built-in tool not found: {toolName}");
        }

        var category = registry.GetCategory(toolName);
        if (category is null || !IsProxiedBuiltinTool(toolName, category)
            || !registry.IsAvailableInMode(toolName, sessionMode)
            || !AgentRunContextPolicy.IsToolAllowed(runContext, toolName, category))
        {
            return EncodeError($"Tool '{toolName}' is not available through the capability proxy in this session mode.");
        }

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("capability_id", $"builtin:{toolName}");
            writer.WriteString("type", "builtin");
            writer.WriteString("name", toolName);
            writer.WriteString("category", category);
            writer.WriteString("description", executor.Description);
            writer.WritePropertyName("input_schema");
            executor.InputSchema.WriteTo(writer);
            writer.WriteEndObject();
        }
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    private static string EncodeError(string message)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("error", message);
            writer.WriteEndObject();
        }
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }
}

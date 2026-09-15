using System.Text.Json;
using System.Text.Json.Nodes;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Agent.Modules.Channels;

/// <summary>
/// Worker-side read/write of the global channel settings, exposed so the main
/// process and the renderer both go through the same store the Agent loop reads
/// when it decides whether a channel run may execute shell without asking.
/// </summary>
public static class GlobalChannelSettingsService
{
    public static WorkerResponse Read(JsonElement parameters) =>
        WorkerResponse.Json(
            GlobalChannelSettingsStore.Read(),
            AgentRuntimeJsonContext.Default.GlobalChannelSettings);

    /// <summary>
    /// Whole-object write: the settings are a single unit and callers read-modify-write,
    /// so a partial payload is rejected rather than merged into a half-updated record.
    /// </summary>
    public static WorkerResponse Write(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object)
        {
            return Fail("Global channel settings must be an object");
        }

        if (JsonNode.Parse(parameters.GetRawText()) is not JsonObject payload ||
            !GlobalChannelSettingsStore.IsFullRecord(payload))
        {
            return Fail("Global channel settings write requires the complete settings object");
        }

        try
        {
            var settings = JsonSerializer.Deserialize(
                payload.ToJsonString(),
                AgentRuntimeJsonContext.Default.GlobalChannelSettings);
            if (settings is null)
            {
                return Fail("Invalid global channel settings");
            }

            GlobalChannelSettingsStore.Write(settings);
            return WorkerResponse.Json(
                new GlobalChannelSettingsResult(true),
                AgentRuntimeJsonContext.Default.GlobalChannelSettingsResult);
        }
        catch (JsonException ex)
        {
            return Fail($"Invalid global channel settings: {ex.Message}");
        }
    }

    private static WorkerResponse Fail(string error) =>
        WorkerResponse.Json(
            new GlobalChannelSettingsResult(false, error),
            AgentRuntimeJsonContext.Default.GlobalChannelSettingsResult);
}

public sealed record GlobalChannelSettingsResult(bool Success, string? Error = null);

/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Collections.Concurrent;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent.Executors;

/// <summary>
/// Team tool executor — TeamCreate/Status/Delete/SendMessage.
/// Simplified port: in-memory storage (no TeamRuntimeStore). Ported from WishfulClaw AgentRuntimeTeamExecutor.
/// </summary>
public static class AgentRuntimeTeamExecutor
{
    private static readonly ConcurrentDictionary<string, TeamRecord> Teams = new(StringComparer.Ordinal);

    public static bool IsTeamTool(string toolName) =>
        toolName is "TeamCreate" or "TeamStatus" or "TeamDelete" or "SendMessage";

    public static bool RequiresApproval(string toolName) => toolName == "TeamDelete";

    public static async Task<string> ExecuteAsync(
        AgentRuntimeNativeToolCall call, JsonElement parameters,
        IWorkerRequestContext context, CancellationToken cancellationToken)
    {
        return call.Name switch
        {
            "TeamCreate" => CreateTeam(call.Input),
            "TeamStatus" => TeamStatus(call.Input),
            "TeamDelete" => DeleteTeam(call.Input),
            "SendMessage" => await SendMessageAsync(call, parameters, context, cancellationToken),
            _ => EncodeError($"Unsupported team tool: {call.Name}")
        };
    }

    private static string CreateTeam(JsonElement input)
    {
        var name = JsonHelpers.GetString(input, "name")?.Trim() ?? string.Empty;
        if (name.Length == 0)
            return EncodeError("TeamCreate requires a non-empty name.");

        var id = $"team-{Guid.NewGuid():N}"[..16];
        var team = new TeamRecord(id, name, "active", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        Teams[id] = team;
        return EncodeTeam(team);
    }

    private static string TeamStatus(JsonElement input)
    {
        var id = JsonHelpers.GetString(input, "team_id")?.Trim() ?? string.Empty;
        if (!Teams.TryGetValue(id, out var team))
            return EncodeError($"Team not found: {id}");
        return EncodeTeam(team);
    }

    private static string DeleteTeam(JsonElement input)
    {
        var id = JsonHelpers.GetString(input, "team_id")?.Trim() ?? string.Empty;
        if (!Teams.TryRemove(id, out _))
            return EncodeError($"Team not found: {id}");
        return "{\"success\":true}";
    }

    private static async Task<string> SendMessageAsync(
        AgentRuntimeNativeToolCall call, JsonElement parameters,
        IWorkerRequestContext context, CancellationToken cancellationToken)
    {
        var teamId = JsonHelpers.GetString(call.Input, "team_id")?.Trim() ?? string.Empty;
        var message = JsonHelpers.GetString(call.Input, "message")?.Trim() ?? string.Empty;
        if (teamId.Length == 0 || message.Length == 0)
            return EncodeError("team_id and message are required");

        var request = CreateJsonObject(w =>
        {
            w.WriteString("teamId", teamId);
            w.WriteString("message", message);
        });

        try
        {
            var response = await AgentRuntimeReverseRequests.RequestAsync(context, "team:send-message", request, cancellationToken);
            return response.GetRawText();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return EncodeError(ex.Message);
        }
    }

    private static string EncodeTeam(TeamRecord team)
    {
        using var stream = new MemoryStream();
        using (var w = new Utf8JsonWriter(stream))
        {
            w.WriteStartObject();
            w.WriteStartObject("team");
            w.WriteString("id", team.Id);
            w.WriteString("name", team.Name);
            w.WriteString("status", team.Status);
            w.WriteNumber("createdAt", team.CreatedAt);
            w.WriteEndObject();
            w.WriteEndObject();
        }
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    private static JsonElement CreateJsonObject(Action<Utf8JsonWriter> writeProperties)
    {
        using var stream = new MemoryStream();
        using (var w = new Utf8JsonWriter(stream))
        { w.WriteStartObject(); writeProperties(w); w.WriteEndObject(); }
        using var doc = JsonDocument.Parse(stream.ToArray());
        return doc.RootElement.Clone();
    }

    private static string EncodeError(string message)
    {
        using var stream = new MemoryStream();
        using (var w = new Utf8JsonWriter(stream))
        { w.WriteStartObject(); w.WriteString("error", message); w.WriteEndObject(); }
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    private sealed record TeamRecord(string Id, string Name, string Status, long CreatedAt);
}

/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json.Serialization;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Infrastructure.Db;

public sealed class PluginProjectRow
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("working_folder")]
    public string? WorkingFolder { get; set; }

    [JsonPropertyName("ssh_connection_id")]
    public string? SshConnectionId { get; set; }

    [JsonPropertyName("plugin_id")]
    public string? PluginId { get; set; }

    [JsonPropertyName("pinned")]
    public int Pinned { get; set; }

    [JsonPropertyName("created_at")]
    public long CreatedAt { get; set; }

    [JsonPropertyName("updated_at")]
    public long UpdatedAt { get; set; }
}

public sealed class PluginSessionRow
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("icon")]
    public string? Icon { get; set; }

    [JsonPropertyName("mode")]
    public string Mode { get; set; } = string.Empty;

    [JsonPropertyName("created_at")]
    public long CreatedAt { get; set; }

    [JsonPropertyName("updated_at")]
    public long UpdatedAt { get; set; }

    [JsonPropertyName("project_id")]
    public string? ProjectId { get; set; }

    [JsonPropertyName("working_folder")]
    public string? WorkingFolder { get; set; }

    [JsonPropertyName("ssh_connection_id")]
    public string? SshConnectionId { get; set; }

    [JsonPropertyName("plan_id")]
    public string? PlanId { get; set; }

    [JsonPropertyName("pinned")]
    public int Pinned { get; set; }

    [JsonPropertyName("plugin_id")]
    public string? PluginId { get; set; }

    [JsonPropertyName("plugin_type")]
    public string? PluginType { get; set; }

    [JsonPropertyName("channel_route_key")]
    public string? ChannelRouteKey { get; set; }

    [JsonPropertyName("external_chat_id")]
    public string? ExternalChatId { get; set; }

    [JsonPropertyName("external_chat_type")]
    public string? ExternalChatType { get; set; }

    [JsonPropertyName("provider_id")]
    public string? ProviderId { get; set; }

    [JsonPropertyName("model_id")]
    public string? ModelId { get; set; }

    [JsonPropertyName("model_selection_mode")]
    public string? ModelSelectionMode { get; set; }

    [JsonPropertyName("message_count")]
    public int MessageCount { get; set; }
}

public sealed class PluginSessionMessageRow
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("role")]
    public string Role { get; set; } = string.Empty;

    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;

    [JsonPropertyName("created_at")]
    public long CreatedAt { get; set; }
}

public sealed record PluginSessionMutationResult(
    bool Success,
    int Changed,
    int Deleted,
    string? Error);

public sealed record PluginSessionFindResult(
    bool Success,
    PluginSessionRow? Session,
    string? Error);

public sealed record PluginRouteSessionResult(
    bool Success,
    string? SessionId,
    string? SessionTitle,
    string? ProjectId,
    string? WorkingFolder,
    string? SshConnectionId,
    string? Error);

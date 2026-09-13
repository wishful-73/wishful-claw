using System;
using System.Collections.Generic;

namespace WishfulClaw.Core.Tools;

/// <summary>
/// Defines which tool categories are available for a given usage scenario.
/// Inspired by OpenClaw.net's ToolPresetResolver — different surfaces get different tools.
/// </summary>
public sealed class ToolPreset
{
    public string Id { get; init; } = "";
    public string Description { get; init; } = "";

    /// <summary>
    /// Tool categories to include. If null, all categories are included.
    /// </summary>
    public HashSet<string>? AllowedCategories { get; init; }

    /// <summary>
    /// Individual tool names to include (in addition to allowed categories).
    /// </summary>
    public HashSet<string>? AllowedTools { get; init; }

    /// <summary>
    /// Tool categories to exclude (applied after includes).
    /// </summary>
    public HashSet<string>? DeniedCategories { get; init; }

    /// <summary>
    /// Individual tool names to exclude.
    /// </summary>
    public HashSet<string>? DeniedTools { get; init; }

    /// <summary>
    /// Built-in presets keyed by preset ID.
    /// </summary>
    public static readonly Dictionary<string, ToolPreset> BuiltIn = new(StringComparer.OrdinalIgnoreCase)
    {
        ["full"] = new ToolPreset
        {
            Id = "full",
            Description = "All tools available.",
            // No denies: direct injection is gated by the IsCore flag (AgentRunContextPolicy.
            // ResolveDirectInjection), so proxy-only categories like browser/task need no
            // preset-level patch. This layer shapes which tools a preset may inject at all —
            // everything registered and scope-visible stays reachable through use_capability.
        },

        ["chat"] = new ToolPreset
        {
            Id = "chat",
            Description = "Everyday chat — file ops, search, shell, web, memory, ask-user, plan, goal.",
            AllowedCategories = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "file", "search", "shell", "code-compatible", "web", "memory", "ask-user",
                "plan", "goal", "notify", "capability", "project", "codegraph"
            },
        },

        ["coding"] = new ToolPreset
        {
            Id = "coding",
            Description = "Coding session — file ops, search, shell, git, memory, web.",
            AllowedCategories = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "file", "search", "shell", "web", "memory", "ask-user",
                "plan", "goal", "notify", "capability", "project", "codegraph"
            },
            AllowedTools = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "Bash", "PowerShell", "Monitor"
            },
        },

        ["channel"] = new ToolPreset
        {
            Id = "channel",
            Description = "Channel session — global chat capabilities plus channel-safe messaging.",
            AllowedCategories = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "channel-plugin", "plugin", "file", "search", "web", "memory",
                "ask-user", "notify", "capability", "project", "codegraph"
            },
        },

        ["automation"] = new ToolPreset
        {
            Id = "automation",
            Description = "Automation — cron, tasks, desktop control.",
            AllowedCategories = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "cron", "task", "desktop", "notify", "memory", "capability"
            },
        },

        ["minimal"] = new ToolPreset
        {
            Id = "minimal",
            Description = "Minimal — only file read and search.",
            AllowedCategories = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "file", "search", "capability"
            },
            DeniedTools = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "Write", "Edit", "Bash", "Shell"
            },
        },
        ["skill-installer"] = new ToolPreset
        {
            Id = "skill-installer",
            Description = "Skill installer assistant — skill management tools plus basic file/search.",
            AllowedCategories = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "file", "search", "skill-management", "capability"
            },
        },
    };

    /// <summary>
    /// Check if a tool should be included given its name and category.
    /// </summary>
    public bool Includes(string toolName, string? category)
    {
        // Check explicit denies first
        if (DeniedTools != null && DeniedTools.Contains(toolName))
            return false;
        if (DeniedCategories != null && category != null && DeniedCategories.Contains(category))
            return false;

        // If no allowed categories specified, all are allowed (subject to denies).
        // With AllowedTools but no AllowedCategories, the tool list IS the whitelist.
        if (AllowedCategories == null || AllowedCategories.Count == 0)
        {
            if (AllowedTools != null && AllowedTools.Count > 0)
                return AllowedTools.Contains(toolName);
            return true;
        }

        // Check category
        if (category != null && AllowedCategories.Contains(category))
            return true;

        // Check explicit tool allow
        if (AllowedTools != null && AllowedTools.Contains(toolName))
            return true;

        return false;
    }
}

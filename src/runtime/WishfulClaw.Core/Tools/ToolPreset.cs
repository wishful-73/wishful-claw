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
        },

        ["chat"] = new ToolPreset
        {
            Id = "chat",
            Description = "Everyday chat — file ops, search, shell, web, memory, ask-user, plan, goal.",
            AllowedCategories = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "file", "search", "shell", "code-compatible", "web", "memory", "ask-user",
                "plan", "goal", "notify", "capability", "browser", "project", "codegraph"
            },
            AllowedTools = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "Task", "SubAgentStatus", "SubAgentDetail"
            },
        },

        ["coding"] = new ToolPreset
        {
            Id = "coding",
            Description = "Coding session — file ops, search, shell, git, memory, web.",
            AllowedCategories = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "file", "search", "shell", "web", "memory", "ask-user",
                "plan", "goal", "notify", "capability", "browser", "project", "codegraph"
            },
            AllowedTools = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "Bash", "PowerShell", "Monitor", "Task", "SubAgentStatus", "SubAgentDetail"
            },
        },

        ["channel"] = new ToolPreset
        {
            Id = "channel",
            Description = "Channel messaging — plugins, messaging, memory, sessions.",
            AllowedCategories = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "channel-plugin", "plugin", "memory", "ask-user", "notify"
            },
        },

        ["automation"] = new ToolPreset
        {
            Id = "automation",
            Description = "Automation — cron, tasks, desktop control.",
            AllowedCategories = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "cron", "task", "desktop", "notify", "memory"
            },
        },

        ["minimal"] = new ToolPreset
        {
            Id = "minimal",
            Description = "Minimal — only file read and search.",
            AllowedCategories = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "file", "search"
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

        // If no allowed categories specified, all are allowed (subject to denies)
        if (AllowedCategories == null || AllowedCategories.Count == 0)
        {
            // Still check explicit allows
            if (AllowedTools != null && AllowedTools.Contains(toolName))
                return true;
            // If allowed categories is empty but allowed tools has items, only those tools
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

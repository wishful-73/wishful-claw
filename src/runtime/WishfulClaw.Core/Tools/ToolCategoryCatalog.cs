using System;
using System.Collections.Generic;

namespace WishfulClaw.Core.Tools;

/// <summary>
/// One catalog entry: where a tool category sits in the presentation order and how the
/// system prompt describes it.
/// </summary>
/// <param name="Name">Category string as returned by <see cref="IToolProvider.Category"/>.</param>
/// <param name="Priority">Lower sorts first. Unknown categories use <see cref="ToolCategoryCatalog.UnknownPriority"/>.</param>
/// <param name="Description">One short line rendered into the prompt's &lt;tool_calling&gt; block.</param>
public sealed record ToolCategory(string Name, int Priority, string Description);

/// <summary>
/// Single source of truth for tool category metadata.
///
/// <see cref="ToolRegistry"/> stamps each definition with <see cref="GetPriority"/> and sorts by it;
/// PromptBuilder renders <see cref="All"/> in the same order. Splitting the two tables is how the
/// prompt's category list drifts away from the order tools actually arrive in, so both read this.
/// </summary>
public static class ToolCategoryCatalog
{
    /// <summary>
    /// Priority for categories this catalog does not list. Deliberately far above every known
    /// entry so provider-specific or future categories stay available but sort last.
    /// </summary>
    public const int UnknownPriority = 900;

    /// <summary>Every known category, already in presentation order.</summary>
    public static IReadOnlyList<ToolCategory> All { get; } =
    [
        // Core coding workflow — the order an agent normally reaches for them.
        new("file", 10, "read, write, edit and list files"),
        new("search", 20, "find files by glob pattern and search contents by regex"),
        new("shell", 30, "run shell commands and stream their output"),
        new("task", 40, "track session todos and delegate work to sub-agents"),
        new("memory", 50, "read and write persistent memory across sessions"),
        new("plan", 60, "draft, submit and revise implementation plans"),
        new("capability", 70, "list, inspect and call MCP servers, skills and plugins through one proxy"),

        // Code and project understanding.
        new("codegraph", 80, "query the indexed code graph for symbols, references and impact"),
        new("project", 90, "inspect projects and drive their sessions"),

        // Information from outside the workspace.
        new("web", 100, "search the web and fetch page content"),
        new("browser", 110, "drive a real browser to navigate, click, type and capture"),

        // Remote execution.
        new("ssh", 120, "list bound SSH connections for remote work"),

        // Extensions.
        new("skill", 130, "invoke an installed skill"),
        new("skill-management", 140, "list and manage installed skills"),
        new("plugin", 150, "send and reply to messages through app plugins"),
        new("notebook", 160, "edit Jupyter notebook cells"),
        new("code-compatible", 170, "aliases matching other agents' tool names"),

        // Talking to the user and producing artifacts.
        new("ask-user", 180, "ask the user a structured question and wait for the answer"),
        new("widget", 190, "render charts, tables, HTML and images as UI widgets"),
        new("image-generate", 200, "generate images from a prompt"),
        new("desktop", 210, "screenshot and click on the local desktop"),

        // Session orchestration and automation.
        new("team", 220, "create and inspect teams of named agents"),
        new("global-task", 230, "create, list and update workspace-wide tasks"),
        new("global-dispatch-reply", 240, "report back to a global dispatch that started this run"),
        new("goal", 250, "create, pause, resume and inspect long-running goals"),
        new("cron", 260, "schedule, list and remove recurring automations"),
        new("channel-plugin", 270, "send images and files to external chat channels"),
    ];

    // OrdinalIgnoreCase is kept on purpose: every category in the repo is lowercase kebab today,
    // so this is tolerance for a future provider, not a fix for a present mismatch.
    private static readonly Dictionary<string, int> Priorities = BuildPriorities();

    /// <summary>
    /// Presentation priority for a category, or <see cref="UnknownPriority"/> when unlisted.
    /// </summary>
    public static int GetPriority(string? category)
    {
        return category is not null && Priorities.TryGetValue(category, out var priority)
            ? priority
            : UnknownPriority;
    }

    private static Dictionary<string, int> BuildPriorities()
    {
        var map = new Dictionary<string, int>(All.Count, StringComparer.OrdinalIgnoreCase);
        foreach (var entry in All)
        {
            map[entry.Name] = entry.Priority;
        }
        return map;
    }
}

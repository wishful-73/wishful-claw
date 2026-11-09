using System.Text.Json;

using WishfulClaw.Core.Tools;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.Workspace.Memory;

namespace WishfulClaw.Agent.Tools.MemoryTools;

using static WishfulClaw.Agent.Tools.ToolHelpers;

/// <summary>
/// Append a new memory entry to SQLite.
/// </summary>
public sealed class MemoryAppendTool : IToolExecutor
{
    public string Name => "memory_append";

    public string Description =>
        "Append a new memory entry to the database and return its id. " +
        "Record facts, decisions, or insights worth remembering across sessions. " +
        "Priority: permanent (core identity), lasting (important decisions), standard (default), ephemeral (transient). " +
        "When the user shares something worth remembering, call this tool — verbal acknowledgment alone saves nothing.";

    public string[]? VisibleScopes => ToolVisibilityScopes.GlobalSideAndWorkRuns;

    public bool IsCore => true;

    public JsonElement InputSchema { get; } = ParseSchema(
        """{"type":"object","properties":{"content":{"type":"string","description":"The memory entry to append. Markdown text describing a fact, decision, or insight worth remembering."},"title":{"type":"string","description":"Short title for the memory entry. Auto-generated from content if omitted."},"priority":{"type":"string","enum":["permanent","lasting","standard","ephemeral"],"default":"standard","description":"Memory priority level"}},"required":["content"]}""");

    public Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)
    {
        var content = GetString(input, "content");
        if (string.IsNullOrWhiteSpace(content))
            return Task.FromResult(new ToolResult("memory_append requires a non-empty 'content' parameter", true));

        var title = GetString(input, "title") ?? GenerateTitle(content!);
        var priorityStr = GetString(input, "priority") ?? "standard";
        var priority = MemoryToolHelpers.NormalizePriority(priorityStr);
        var scope = MemoryToolHelpers.ResolveScope(context);

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var entry = new MemoryEntryEntity
        {
            Scope = scope,
            Title = title,
            Content = content!,
            Priority = priority.ToString().ToLowerInvariant(),
            Status = "active",
            CreatedAt = now,
            UpdatedAt = now
        };

        // 走 DbMemoryTools：Worker 的 memory/append 端点写的是同一张表，
        // 两边各写一份 INSERT 时改表结构要改两处，漏一处是运行时静默失效（S-326）。
        var id = DbMemoryTools.Insert(entry);

        MemoryUpdateQueue.Enqueue(context.SessionId ?? "",
            $"Memory entry #{id} appended (priority={priorityStr}, scope={scope}): {title}");

        return Task.FromResult(new ToolResult(
            $"Memory entry #{id} appended successfully (priority={priority.ToString().ToLowerInvariant()}, scope={scope})."));
    }

    private static string GenerateTitle(string content)
    {
        var firstLine = content.Split('\n')[0].Trim();
        return firstLine.Length > 80 ? firstLine[..80] + "\u2026" : firstLine;
    }
}

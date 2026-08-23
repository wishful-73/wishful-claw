using System.Text.Json;

using WishfulClaw.Core.Tools;

using Microsoft.Data.Sqlite;
using WishfulClaw.Infrastructure.Db;

using WishfulClaw.Workspace.Memory;



using WishfulClaw.Agent;

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



        var db = DbClient.GetClient();

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

        var id = db.ExecuteReturnIdentity(
            "INSERT INTO memory_entries (scope, title, content, priority, status, created_at, updated_at) " +
            "VALUES (@scope, @title, @content, @priority, @status, @ca, @ua)",
            new SqliteParameter("@scope", entry.Scope),
            new SqliteParameter("@title", (object?)entry.Title ?? DBNull.Value),
            new SqliteParameter("@content", entry.Content),
            new SqliteParameter("@priority", entry.Priority),
            new SqliteParameter("@status", entry.Status),
            new SqliteParameter("@ca", entry.CreatedAt),
            new SqliteParameter("@ua", entry.UpdatedAt));



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


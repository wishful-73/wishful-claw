using System.Text.Json;

using WishfulClaw.Core.Tools;

using WishfulClaw.Core.Protocol;

using Microsoft.Data.Sqlite;
using WishfulClaw.Infrastructure.Db;



using WishfulClaw.Agent;

namespace WishfulClaw.Agent.Tools.MemoryTools;



using static WishfulClaw.Agent.Tools.ToolHelpers;



/// <summary>

/// Update a memory entry in SQLite by id. Can update content, priority, or mark as deprecated.

/// </summary>

public sealed class MemoryUpdateTool : IToolExecutor

{

    public string Name => "memory_update";



    public string Description =>

        "Update a memory entry in the database by its id. " +

        "Can update content, priority, or mark as deprecated (status='deprecated'). " +

        "Use this to correct or deprecate memories that are wrong or outdated.";



    public string[]? VisibleScopes => ToolVisibilityScopes.GlobalSideAndWorkRuns;

    public bool IsCore => true;

    public JsonElement InputSchema { get; } = ParseSchema(

        """{"type":"object","properties":{"id":{"type":"integer","description":"The memory entry id (from memory_search results)"},"content":{"type":"string","description":"New content for the memory entry. Omit to keep existing content."},"priority":{"type":"string","enum":["permanent","lasting","standard","ephemeral"],"description":"New priority level. Omit to keep existing."},"status":{"type":"string","enum":["active","deprecated"],"description":"New status. Use 'deprecated' to mark as outdated/wrong. Omit to keep existing."}},"required":["id"]}""");



    public Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)

    {

        try

        {

            var id = GetLong(input, "id");

            if (id <= 0)

                return Task.FromResult(new ToolResult("memory_update requires a positive 'id' parameter", true));



            var db = DbClient.GetClient();

            var entry = db.QueryFirstOrDefault(
                "SELECT * FROM memory_entries WHERE id = @id",
                EntityMappers.MapMemoryEntry, new SqliteParameter("@id", id));

            if (entry is null)

                return Task.FromResult(new ToolResult($"Memory entry with id={id} not found.", true));



            var changed = false;

            var content = GetString(input, "content");

            if (content is not null)

            {

                entry.Content = content;

                changed = true;

            }



            var priority = GetString(input, "priority");

            if (priority is not null)

            {

                entry.Priority = priority.ToLowerInvariant();

                changed = true;

            }



            var status = GetString(input, "status");

            if (status is not null)

            {

                entry.Status = status.ToLowerInvariant();

                changed = true;

            }



            if (!changed)

                return Task.FromResult(new ToolResult("No fields to update. Provide content, priority, or status.", true));



            entry.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

            // Use WhereColumns to update by primary key, only SET changed columns

            db.Execute(
                "UPDATE memory_entries SET title = @title, content = @content, priority = @priority, " +
                "status = @status, updated_at = @ua WHERE id = @id",
                new SqliteParameter("@title", (object?)entry.Title ?? DBNull.Value),
                new SqliteParameter("@content", entry.Content),
                new SqliteParameter("@priority", entry.Priority),
                new SqliteParameter("@status", entry.Status),
                new SqliteParameter("@ua", entry.UpdatedAt),
                new SqliteParameter("@id", id));



            MemoryUpdateQueue.Enqueue(context.SessionId ?? "",
                $"Memory entry #{id} updated (fields changed: {(content is not null ? "content " : "")}{(priority is not null ? "priority " : "")}{(status is not null ? "status" : "")}).");

            return Task.FromResult(new ToolResult($"Memory entry #{id} updated successfully."));

        }

        catch (Exception ex)

        {

            WorkerLog.Error($"MemoryUpdateTool failed: {ex.GetType().Name}: {ex.Message} | StackTrace: {ex.StackTrace}");

            return Task.FromResult(new ToolResult($"Memory update failed: {ex.Message}", true));

        }

    }

}


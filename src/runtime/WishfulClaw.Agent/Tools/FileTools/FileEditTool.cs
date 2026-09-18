using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using WishfulClaw.Core.Tools;
using WishfulClaw.Agent.Tools.AgentChanges;

namespace WishfulClaw.Agent.Tools.FileTools;

using static WishfulClaw.Agent.Tools.ToolHelpers;

/// <summary>
/// Edit a file by finding and replacing text.
/// Adapted from WishfulClaw AgentRuntimeNativeToolExecutor.EditAsync.
/// </summary>
public sealed class FileEditTool : IToolExecutor
{
    public string Name => "Edit";

    public string Description => "Edit a file by performing exact string replacement. Supports replacing all occurrences with replace_all=true.";

    public string[]? VisibleScopes => ToolVisibilityScopes.WorkRunsOnly;

    public bool IsCore => true;

    public JsonElement InputSchema => FileReadTool.EditSchema;

    public async Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)
    {
        var path = ResolveFilePath(input, context);
        var oldString = GetString(input, "old_string") ?? string.Empty;
        var newString = GetString(input, "new_string") ?? string.Empty;
        var replaceAll = GetBool(input, "replace_all", false);

        if (string.IsNullOrWhiteSpace(path))
        {
            return new ToolResult("Edit requires a non-empty file_path", true);
        }
        if (oldString.Length == 0)
        {
            return new ToolResult("old_string must be non-empty", true);
        }
        if (oldString == newString)
        {
            return new ToolResult("new_string must be different from old_string", true);
        }
        if (!File.Exists(path))
        {
            return new ToolResult($"File not found: {path}", true);
        }

        try
        {
            var originalContent = await File.ReadAllTextAsync(path, Encoding.UTF8, context.CancellationToken);
            var content = originalContent;

            // Normalize line endings for matching
            var normalizedOld = oldString.Replace("\r\n", "\n").Replace('\r', '\n');
            var normalizedContent = content.Replace("\r\n", "\n").Replace('\r', '\n');

            var occurrences = CountOccurrences(normalizedContent, normalizedOld);
            if (occurrences == 0)
            {
                return new ToolResult($"String to replace not found in file.\nString: {oldString}", true);
            }
            if (!replaceAll && occurrences > 1)
            {
                return new ToolResult(
                    $"Found {occurrences} matches of the string to replace, but replace_all is false. " +
                    $"To replace all occurrences, set replace_all to true. To replace only one occurrence, provide more surrounding context.\nString: {oldString}",
                    true);
            }

            var updated = replaceAll
                ? normalizedContent.Replace(normalizedOld, newString, StringComparison.Ordinal)
                : ReplaceFirst(normalizedContent, normalizedOld, newString);

            // Preserve original line ending style
            if (content.Contains("\r\n"))
            {
                updated = updated.Replace("\n", "\r\n");
            }

            await WriteAndFlushAsync(path, updated, context.CancellationToken);

            // Record change for tracking/rollback
            if (!string.IsNullOrEmpty(context.RunId))
            {
                AgentChangeTools.RecordChange(
                    context.RunId,
                    context.SessionId,
                    path,
                    beforeExists: true,
                    beforeText: originalContent,
                    afterText: updated);
            }

            return new ToolResult($"{{\"success\":true,\"path\":\"{EscapeJson(path)}\",\"replaceAll\":{replaceAll.ToString().ToLowerInvariant()}}}");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return new ToolResult($"Failed to edit file: {ex.Message}", true, ex.Message);
        }
    }

    private static int CountOccurrences(string haystack, string needle)
    {
        var count = 0;
        var index = 0;
        while ((index = haystack.IndexOf(needle, index, StringComparison.Ordinal)) != -1)
        {
            count++;
            index += needle.Length;
        }
        return count;
    }

    private static string ReplaceFirst(string text, string search, string replace)
    {
        var index = text.IndexOf(search, StringComparison.Ordinal);
        return index < 0 ? text : text.Remove(index, search.Length).Insert(index, replace);
    }

    private static string EscapeJson(string s)
    {
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }
}

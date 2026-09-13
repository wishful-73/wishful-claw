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
/// Write content to a file. Creates the file if it doesn't exist, overwrites if it does.
/// Adapted from WishfulClaw AgentRuntimeNativeToolExecutor.WriteAsync.
/// Records file changes for AgentChanges tracking.
/// </summary>
public sealed class FileWriteTool : IToolExecutor
{
    public string Name => "Write";

    public string Description => "Write content to a file. Creates parent directories if needed. Overwrites existing content.";

    public string[]? VisibleScopes => ToolVisibilityScopes.WorkRunsOnly;

    public bool IsCore => true;

    public JsonElement InputSchema => FileReadTool.WriteSchema;

    public async Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)
    {
        var path = ResolveFilePath(input, context.WorkingFolder);
        var content = GetString(input, "content");

        if (string.IsNullOrWhiteSpace(path))
        {
            return new ToolResult("Write requires a non-empty file_path", true);
        }
        if (content is null)
        {
            return new ToolResult("Write requires a content string", true);
        }

        try
        {
            var directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            // Capture before state for change tracking
            var existed = File.Exists(path);
            string? beforeText = null;
            if (existed)
            {
                try { beforeText = await File.ReadAllTextAsync(path, Encoding.UTF8, context.CancellationToken); }
                catch { /* file may be locked or binary */ }
            }

            await WriteAndFlushAsync(path, content, context.CancellationToken);

            // Record change for tracking/rollback
            if (!string.IsNullOrEmpty(context.RunId))
            {
                AgentChangeTools.RecordChange(
                    context.RunId,
                    context.SessionId,
                    path,
                    existed,
                    beforeText,
                    content);
            }

            return new ToolResult($"{{\"success\":true,\"path\":\"{EscapeJson(path)}\",\"op\":\"{(existed ? "modify" : "create")}\"}}");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return new ToolResult($"Failed to write file: {ex.Message}", true, ex.Message);
        }
    }

    private static string EscapeJson(string s)
    {
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }
}

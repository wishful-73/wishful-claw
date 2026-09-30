using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.FileTools;

using static WishfulClaw.Agent.Tools.ToolHelpers;

/// <summary>
/// Copy an image that already exists on disk into the workspace (iter-37 S-162).
///
/// The gap this closes: an agent that just generated a picture — or was handed a
/// screenshot — has the file in front of it but no way to *place* it. <c>Write</c>
/// only writes text, so handing it base64 produces a file no viewer opens.
///
/// Deliberately narrow:
/// <list type="bullet">
/// <item>No format conversion. The bytes go across as they are.</item>
/// <item>No <c>AgentChanges</c> record. A copy is not an edit of the user's own
/// work, and rolling it back would delete a file the user asked for.</item>
/// <item>No overwrite unless asked. A <c>file_path</c> that already exists is far
/// more likely a mistake than an intent.</item>
/// </list>
/// </summary>
public sealed class FileSaveImageTool : IToolExecutor
{
    public string Name => "SaveImage";

    public string Description =>
        "Copy an image that exists on disk to a path in the workspace — use it to place a generated image or a screenshot where the user wants it. Bytes are copied as-is, with no format conversion. Fails if the target already exists unless overwrite is true.";

    public string[]? VisibleScopes => ToolVisibilityScopes.WorkRunsOnly;

    public bool IsCore => true;

    public JsonElement InputSchema => FileReadTool.SaveImageSchema;

    public async Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)
    {
        var sourcePath = ResolveSourcePath(input, context);
        if (sourcePath is null)
        {
            return new ToolResult("SaveImage requires a non-empty source_path", true);
        }

        var targetPath = ResolveFilePath(input, context);
        if (string.IsNullOrWhiteSpace(targetPath))
        {
            return new ToolResult("SaveImage requires a non-empty file_path", true);
        }

        if (!File.Exists(sourcePath))
        {
            return new ToolResult($"SaveImage: source image not found: {sourcePath}", true);
        }

        var existed = File.Exists(targetPath);
        if (existed && !GetBool(input, "overwrite", false))
        {
            return new ToolResult(
                $"SaveImage: {targetPath} already exists. Pass overwrite: true to replace it.",
                true);
        }

        try
        {
            var directory = Path.GetDirectoryName(targetPath);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            await CopyAsync(sourcePath, targetPath, context.CancellationToken);

            var length = new FileInfo(targetPath).Length;
            return new ToolResult(
                $"{{\"success\":true,\"path\":\"{EscapeJson(targetPath)}\",\"bytes\":{length},\"op\":\"{(existed ? "overwrite" : "create")}\"}}");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return new ToolResult($"Failed to save image: {ex.Message}", true, ex.Message);
        }
    }

    /// <summary>
    /// The source is read, not written, so it takes the same path rules as the
    /// other file tools — a relative path hangs off the working folder and the
    /// result still has to be inside the sandbox.
    /// </summary>
    private static string? ResolveSourcePath(JsonElement input, ToolExecutionContext context)
    {
        var raw = GetString(input, "source_path")?.Trim();
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        if (!Path.IsPathRooted(raw) && !string.IsNullOrWhiteSpace(context.WorkingFolder))
        {
            raw = Path.Combine(context.WorkingFolder, raw);
        }

        var resolved = Path.GetFullPath(raw);
        EnsureInsideSandbox(resolved, context);
        return resolved;
    }

    private static async Task CopyAsync(string sourcePath, string targetPath, CancellationToken cancellationToken)
    {
        await using var source = new FileStream(
            sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read, bufferSize: 81920, useAsync: true);
        await using var target = new FileStream(
            targetPath, FileMode.Create, FileAccess.Write, FileShare.None, bufferSize: 81920, useAsync: true);
        await source.CopyToAsync(target, cancellationToken);
    }
}

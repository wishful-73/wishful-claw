using System;

using System.Collections.Generic;

using System.IO;

using System.Text;

using System.Text.Json;

using System.Threading.Tasks;

using WishfulClaw.Core.Tools;



namespace WishfulClaw.Agent.Tools.FileTools;



using static WishfulClaw.Agent.Tools.ToolHelpers;



/// <summary>

/// List directory contents (LS).

/// Adapted from WishfulClaw AgentRuntimeNativeToolExecutor.ExecuteLsAsync.

/// </summary>

public sealed class FileListTool : IToolExecutor

{

    private const int MaxItems = 100;



    public string Name => "LS";



    public string Description => "List the contents of a directory. Shows files and subdirectories. Defaults to the working folder if no path is given.";



    public string[]? VisibleScopes => ToolVisibilityScopes.Everywhere;

    public bool IsCore => true;

    public JsonElement InputSchema { get; } = ParseSchema(

        """{"type":"object","properties":{"path":{"type":"string","description":"Directory path to list. Defaults to working folder."},"hidden":{"type":"boolean","description":"Include hidden files. Default: true","default":true}},"required":[]}""");



    public Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)

    {

        var rawPath = GetString(input, "path")?.Trim() ?? string.Empty;



        if ((rawPath.Length == 0 || rawPath == ".") && string.IsNullOrWhiteSpace(context.WorkingFolder))

        {

            return Task.FromResult(new ToolResult("LS requires an active working folder when path is omitted or set to '.'", true));

        }



        var root = ResolveSearchPath(input, context);

        if (!Directory.Exists(root))

        {

            return Task.FromResult(new ToolResult($"Directory not found: {root}", true));

        }



        try

        {

            var entries = new List<(string Name, string Type)>();

            var hasMore = false;



            foreach (var entry in Directory.EnumerateFileSystemEntries(root))

            {

                FileAttributes attributes;

                try

                {

                    attributes = File.GetAttributes(entry);

                }

                catch

                {

                    continue;

                }



                var isDirectory = attributes.HasFlag(FileAttributes.Directory);

                var name = Path.GetFileName(entry);



                // Skip hidden files by default

                if (name.StartsWith('.') && !GetBool(input, "hidden", true))

                {

                    continue;

                }



                if (entries.Count >= MaxItems)

                {

                    hasMore = true;

                    break;

                }



                entries.Add((name, isDirectory ? "directory" : "file"));

            }



            entries.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase));



            var builder = new StringBuilder();

            foreach (var (name, type) in entries)

            {

                if (builder.Length > 0)

                {

                    builder.Append('\n');

                }

                builder.Append(type == "directory" ? $"[DIR]  {name}/" : $"       {name}");

            }



            if (hasMore)

            {

                builder.Append($"\n... and more (showing first {MaxItems} entries)");

            }



            return Task.FromResult(new ToolResult(builder.ToString()));

        }

        catch (Exception ex) when (ex is not OperationCanceledException)

        {

            return Task.FromResult(new ToolResult($"Failed to list directory: {ex.Message}", true, ex.Message));

        }

    }

}


using System;

using System.Globalization;

using System.IO;

using System.Text;

using System.Text.Json;

using System.Threading.Tasks;

using WishfulClaw.Core.Tools;



namespace WishfulClaw.Agent.Tools.FileTools;



using static WishfulClaw.Agent.Tools.ToolHelpers;



/// <summary>

/// Read file contents with optional line range.

/// Adapted from WishfulClaw AgentRuntimeNativeToolExecutor.ReadAsync.

/// </summary>

public sealed class FileReadTool : IToolExecutor

{

    private const int DefaultLimit = 2_000;



    public string Name => "Read";



    public string Description => "Read the contents of a file. Supports line range via offset and limit parameters. Returns content with line numbers.";



    public JsonElement InputSchema { get; } = ParseSchema(

        """{"type":"object","properties":{"file_path":{"type":"string","description":"The path to the file to read"},"offset":{"type":"integer","description":"Line number to start reading from (1-based)","default":1},"limit":{"type":"integer","description":"Maximum number of lines to read","default":2000}},"required":["file_path"]}""");



    public async Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)

    {

        var path = ResolveFilePath(input, context.WorkingFolder);

        if (string.IsNullOrWhiteSpace(path))

        {

            return new ToolResult("Read requires a non-empty file_path", true);

        }



        if (Directory.Exists(path))

        {

            return new ToolResult($"Read expected a file but found a directory. Use LS for: {path}", true);

        }



        if (!File.Exists(path))

        {

            return new ToolResult($"File not found: {path}", true);

        }



        try

        {

            var offset = Math.Max(1, GetInt(input, "offset", 1));

            var limit = Math.Max(1, Math.Min(GetInt(input, "limit", DefaultLimit), DefaultLimit));

            // TL-4: stream the file line-by-line instead of ReadAllText so a
            // huge file doesn't get fully loaded into memory — only the
            // requested [offset, offset+limit) window is retained.
            var builder = new StringBuilder();

            var width = Math.Max(6, (offset + limit - 1).ToString(CultureInfo.InvariantCulture).Length);

            using (var reader = new StreamReader(path, Encoding.UTF8))
            {
                string? line;
                var lineNumber = 0;

                while ((line = reader.ReadLine()) is not null)
                {
                    lineNumber++;

                    if (lineNumber < offset)
                    {
                        continue;
                    }

                    if (lineNumber >= offset + limit)
                    {
                        break;
                    }

                    if (builder.Length > 0)
                    {
                        builder.Append('\n');
                    }

                    builder.Append(lineNumber.ToString(CultureInfo.InvariantCulture).PadLeft(width));
                    builder.Append('\t');
                    builder.Append(line);
                }
            }

            return new ToolResult(builder.ToString());

        }

        catch (Exception ex) when (ex is not OperationCanceledException)

        {

            return new ToolResult($"Failed to read file: {ex.Message}", true, ex.Message);

        }

    }



    public static JsonElement WriteSchema { get; } = ParseSchema(

        """{"type":"object","properties":{"file_path":{"type":"string","description":"The path to the file to write"},"content":{"type":"string","description":"The content to write to the file"}},"required":["file_path","content"]}""");



    public static JsonElement EditSchema { get; } = ParseSchema(

        """{"type":"object","properties":{"file_path":{"type":"string","description":"The path to the file to edit"},"old_string":{"type":"string","description":"The exact text to find and replace"},"new_string":{"type":"string","description":"The replacement text"},"replace_all":{"type":"boolean","description":"Replace all occurrences. Default: false","default":false}},"required":["file_path","old_string","new_string"]}""");

}


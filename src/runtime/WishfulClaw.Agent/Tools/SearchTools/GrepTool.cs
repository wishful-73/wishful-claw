using System;

using System.Collections.Generic;

using System.Diagnostics;

using System.IO;

using System.Text;

using System.Text.Json;

using System.Text.RegularExpressions;

using System.Threading.Tasks;

using WishfulClaw.Core.Tools;



namespace WishfulClaw.Agent.Tools.SearchTools;



using static WishfulClaw.Agent.Tools.ToolHelpers;



/// <summary>

/// Search file contents with regex patterns.

/// Adapted from WishfulClaw AgentRuntimeNativeToolExecutor.GrepAsync.

/// </summary>

public sealed class GrepTool : IToolExecutor

{

    private const int MaxResultChars = 64 * 1024;

    private const int MaxMatches = 500;

    private const int DefaultContextLines = 0;



    public string Name => "Grep";



    public string Description => "Search file contents using a regular expression pattern. Supports context lines, file pattern filtering, and case-insensitive search.";



    public JsonElement InputSchema { get; } = ParseSchema(

        """{"type":"object","properties":{"pattern":{"type":"string","description":"Regular expression pattern to search for"},"path":{"type":"string","description":"Root directory to search from. Defaults to working folder."},"file_pattern":{"type":"string","description":"File name pattern to filter (e.g. *.cs). Default: *","default":"*"},"case_insensitive":{"type":"boolean","description":"Case-insensitive search. Default: false","default":false},"context_lines":{"type":"integer","description":"Number of context lines before and after match. Default: 0","default":0},"limit":{"type":"integer","description":"Maximum number of matches. Default: 500","default":500},"exclude_dirs":{"type":"array","items":{"type":"string"},"description":"Directory names to exclude from the search (e.g. [\"release\", \"docs\"]). Common dependency/build dirs are always excluded."}},"required":["pattern"]}""");



    public async Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)

    {

        var pattern = GetString(input, "pattern");

        if (string.IsNullOrWhiteSpace(pattern))

        {

            return new ToolResult("Grep requires a pattern", true);

        }



        var root = ResolveSearchPath(input, context.WorkingFolder);

        if (!Directory.Exists(root))

        {

            return new ToolResult($"Directory not found: {root}", true);

        }



        var caseInsensitive = GetBool(input, "case_insensitive", false);

        var filePattern = GetString(input, "file_pattern") ?? "*";

        var contextLines = GetInt(input, "context_lines", DefaultContextLines);

        var maxResults = GetInt(input, "limit", MaxMatches);

        var excludeDirs = SearchFilter.ParseExcludeDirs(input);



        var regexOptions = RegexOptions.Compiled | RegexOptions.Multiline;

        if (caseInsensitive)

        {

            regexOptions |= RegexOptions.IgnoreCase;

        }



        Regex regex;

        try

        {

            regex = new Regex(pattern, regexOptions, TimeSpan.FromSeconds(10));

        }

        catch (ArgumentException ex)

        {

            return new ToolResult($"Invalid regex pattern: {ex.Message}", true);

        }



        try

        {

            var results = new List<GrepMatch>();

            var totalChars = 0;



            foreach (var file in EnumerateSearchableFiles(root, filePattern, excludeDirs))

            {

                if (results.Count >= maxResults)

                {

                    break;

                }



                string[] lines;

                try

                {

                    var content = await File.ReadAllTextAsync(file, context.CancellationToken);

                    lines = content.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');

                }

                catch

                {

                    continue;

                }



                var relativePath = Path.GetRelativePath(root, file).Replace('\\', '/');



                for (var i = 0; i < lines.Length; i++)

                {

                    if (results.Count >= maxResults)

                    {

                        break;

                    }



                    var match = regex.Match(lines[i]);

                    if (!match.Success)

                    {

                        continue;

                    }



                    var contextStart = Math.Max(0, i - contextLines);

                    var contextEnd = Math.Min(lines.Length - 1, i + contextLines);

                    var contextBuilder = new StringBuilder();



                    for (var j = contextStart; j <= contextEnd; j++)

                    {

                        if (contextBuilder.Length > 0)

                        {

                            contextBuilder.Append('\n');

                        }

                        contextBuilder.Append($"{relativePath}:{j + 1}: {lines[j]}");

                    }



                    var contextStr = contextBuilder.ToString();

                    if (totalChars + contextStr.Length > MaxResultChars)

                    {

                        break;

                    }



                    results.Add(new GrepMatch(relativePath, i + 1, lines[i], contextStr));

                    totalChars += contextStr.Length + 1;

                }

            }



            if (results.Count == 0)

            {

                return new ToolResult("No matches found.");

            }



            var builder = new StringBuilder();

            foreach (var match in results)

            {

                if (builder.Length > 0)

                {

                    builder.Append('\n');

                }



                if (contextLines > 0)

                {

                    builder.Append(match.Context);

                }

                else

                {

                    builder.Append($"{match.File}:{match.Line}: {match.Content}");

                }

            }



            if (results.Count >= maxResults)

            {

                builder.Append($"\n... (showing first {results.Count} matches)");

            }



            return new ToolResult(builder.ToString());

        }

        catch (OperationCanceledException)

        {

            throw;

        }

        catch (Exception ex)

        {

            return new ToolResult($"Failed to grep: {ex.Message}", true, ex.Message);

        }

    }



    private static IEnumerable<string> EnumerateSearchableFiles(string root, string filePattern, IReadOnlyList<string> excludeDirs)

    {

        foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))

        {

            // TL-1: skip default dependency/build dirs and caller excludes

            if (SearchFilter.IsExcluded(file, root, excludeDirs))

            {

                continue;

            }



            var fileName = Path.GetFileName(file);

            if (!MatchesFileName(fileName, filePattern))

            {

                continue;

            }



            // Skip binary-looking files

            var ext = Path.GetExtension(file).ToLowerInvariant();

            if (ext is ".exe" or ".dll" or ".pdb" or ".so" or ".dylib" or ".bin" or ".png" or ".jpg" or ".jpeg" or ".gif" or ".bmp" or ".ico" or ".zip" or ".gz" or ".tar" or ".7z" or ".rar" or ".pdf")

            {

                continue;

            }



            yield return file;

        }

    }



    private static bool MatchesFileName(string fileName, string pattern)

    {

        if (pattern == "*" || string.IsNullOrEmpty(pattern))

        {

            return true;

        }



        if (pattern.StartsWith("*."))

        {

            var ext = pattern[1..]; // ".cs"

            return fileName.EndsWith(ext, StringComparison.OrdinalIgnoreCase);

        }



        return fileName.Equals(pattern, StringComparison.OrdinalIgnoreCase);

    }



    private sealed record GrepMatch(string File, int Line, string Content, string Context);

}


using System;

using System.Collections.Generic;

using System.IO;

using System.Text;

using System.Text.Json;

using System.Threading.Tasks;

using WishfulClaw.Core.Tools;



namespace WishfulClaw.Agent.Tools.SearchTools;



using static WishfulClaw.Agent.Tools.ToolHelpers;



/// <summary>

/// Find files matching a glob pattern.

/// Adapted from WishfulClaw AgentRuntimeNativeToolExecutor.ExecuteGlobAsync.

/// </summary>

public sealed class GlobTool : IToolExecutor

{

    private const int DefaultLimit = 100;

    private const int MaxResultChars = 64 * 1024;



    public string Name => "Glob";



    public string Description => "Find files matching a glob pattern (e.g. **/*.cs, src/**/*.tsx). Searches recursively from the working folder or specified path.";



    public JsonElement InputSchema { get; } = ParseSchema(

        """{"type":"object","properties":{"pattern":{"type":"string","description":"Glob pattern (e.g. **/*.cs, src/**/*.tsx)"},"path":{"type":"string","description":"Root directory to search from. Defaults to working folder."},"limit":{"type":"integer","description":"Maximum number of results. Default: 100","default":100},"exclude_dirs":{"type":"array","items":{"type":"string"},"description":"Directory names to exclude from the search (e.g. [\"release\", \"docs\"]). Common dependency/build dirs are always excluded."}},"required":["pattern"]}""");



    public Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)

    {

        var pattern = GetString(input, "pattern");

        if (string.IsNullOrWhiteSpace(pattern))

        {

            return Task.FromResult(new ToolResult("Glob requires a pattern", true));

        }



        var root = ResolveSearchPath(input, context.WorkingFolder);

        if (!Directory.Exists(root))

        {

            return Task.FromResult(new ToolResult($"Directory not found: {root}", true));

        }



        try

        {

            var results = new List<string>();

            var limit = GetInt(input, "limit", DefaultLimit);

            var excludeDirs = SearchFilter.ParseExcludeDirs(input);

            var totalChars = 0;



            foreach (var file in EnumerateFiles(root, pattern, excludeDirs))

            {

                if (results.Count >= limit)

                {

                    break;

                }



                var relativePath = Path.GetRelativePath(root, file);

                if (totalChars + relativePath.Length > MaxResultChars)

                {

                    break;

                }



                results.Add(relativePath);

                totalChars += relativePath.Length + 1;

            }



            if (results.Count == 0)

            {

                return Task.FromResult(new ToolResult("No files found matching the pattern."));

            }



            var builder = new StringBuilder();

            foreach (var path in results)

            {

                if (builder.Length > 0)

                {

                    builder.Append('\n');

                }

                builder.Append(path);

            }



            return Task.FromResult(new ToolResult(builder.ToString()));

        }

        catch (Exception ex) when (ex is not OperationCanceledException)

        {

            return Task.FromResult(new ToolResult($"Failed to glob: {ex.Message}", true, ex.Message));

        }

    }



    /// <summary>

    /// Simple recursive glob matching. Supports ** and * wildcards.

    /// </summary>

    private static IEnumerable<string> EnumerateFiles(string root, string pattern, IReadOnlyList<string> excludeDirs)

    {

        // Normalize pattern

        var normalizedPattern = pattern.Replace('\\', '/');



        foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))

        {

            // TL-1: skip default dependency/build dirs and caller excludes

            if (SearchFilter.IsExcluded(file, root, excludeDirs))

            {

                continue;

            }



            var relativePath = Path.GetRelativePath(root, file).Replace('\\', '/');

            if (MatchesGlob(relativePath, normalizedPattern))

            {

                yield return file;

            }

        }

    }



    private static bool MatchesGlob(string path, string pattern)

    {

        // Simple glob: ** matches any number of directories, * matches within a segment

        if (pattern.Contains("**"))

        {

            // Convert to regex-like matching

            var parts = pattern.Split("**");

            if (parts.Length == 2)

            {

                var prefix = parts[0].TrimStart('/');

                var suffix = parts[1].TrimStart('/');



                if (!string.IsNullOrEmpty(prefix) && !path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))

                {

                    return false;

                }



                if (!string.IsNullOrEmpty(suffix) && !path.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))

                {

                    return false;

                }



                return true;

            }

        }



        // Simple * matching within filename

        if (pattern.Contains("*"))

        {

            return SimpleWildcardMatch(path, pattern);

        }



        return path.Equals(pattern, StringComparison.OrdinalIgnoreCase);

    }



    private static bool SimpleWildcardMatch(string text, string pattern)

    {

        var ti = 0;

        var pi = 0;

        var starTi = -1;

        var starPi = 0;



        while (ti < text.Length)

        {

            if (pi < pattern.Length && (pattern[pi] == '?' || char.ToLowerInvariant(pattern[pi]) == char.ToLowerInvariant(text[ti])))

            {

                ti++;

                pi++;

            }

            else if (pi < pattern.Length && pattern[pi] == '*')

            {

                starPi = pi;

                starTi = ti;

                pi++;

            }

            else if (starTi != -1)

            {

                pi = starPi + 1;

                starTi++;

                ti = starTi;

            }

            else

            {

                return false;

            }

        }



        while (pi < pattern.Length && pattern[pi] == '*')

        {

            pi++;

        }



        return pi == pattern.Length;

    }

}


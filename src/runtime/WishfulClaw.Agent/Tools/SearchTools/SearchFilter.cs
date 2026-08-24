using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace WishfulClaw.Agent.Tools.SearchTools;

/// <summary>
/// TL-1: shared directory exclusion for Grep/Glob recursive enumeration.
/// Skips dependency/build output directories by default (node_modules,
/// .git, dist, obj, bin, ...) plus any caller-supplied exclude patterns
/// matched against path segments.
/// </summary>
public static class SearchFilter
{
    /// <summary>
    /// Directory names always skipped during recursive search.
    /// Matched case-insensitively against each path segment.
    /// </summary>
    private static readonly HashSet<string> DefaultExcludedDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        "node_modules", ".git", ".svn", ".hg",
        "dist", "build", "out", "output",
        "obj", "bin", "release", "debug",
        "vendor", "bower_components",
        "__pycache__", ".venv", "venv",
        ".next", ".nuxt", ".turbo", ".cache",
        "coverage", "target"
    };

    /// <summary>
    /// Parses the optional exclude_dirs input array into a normalized list.
    /// Entries may be bare names ("release") or simple wildcards ("*.bak").
    /// </summary>
    public static List<string> ParseExcludeDirs(System.Text.Json.JsonElement input)
    {
        var result = new List<string>();
        if (input.ValueKind != System.Text.Json.JsonValueKind.Object ||
            !input.TryGetProperty("exclude_dirs", out var arr) ||
            arr.ValueKind != System.Text.Json.JsonValueKind.Array)
        {
            return result;
        }

        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == System.Text.Json.JsonValueKind.String)
            {
                var value = item.GetString();
                if (!string.IsNullOrWhiteSpace(value))
                {
                    result.Add(value.Trim().Replace('\\', '/').TrimEnd('/'));
                }
            }
        }
        return result;
    }

    /// <summary>
    /// Returns true when the file should be skipped because any segment of its
    /// path relative to <paramref name="root"/> is excluded — either a default
    /// excluded directory or matched by one of the extra exclude patterns.
    /// </summary>
    public static bool IsExcluded(string file, string root, IReadOnlyList<string> extraExcludes)
    {
        string relative;
        try
        {
            relative = Path.GetRelativePath(root, file).Replace('\\', '/');
        }
        catch
        {
            return false;
        }

        foreach (var segment in relative.Split('/'))
        {
            // Skip the final filename itself — exclusions apply to directories.
            if (segment == Path.GetFileName(file) && !relative.EndsWith('/' + segment, StringComparison.Ordinal))
            {
                continue;
            }

            if (DefaultExcludedDirs.Contains(segment))
            {
                return true;
            }

            foreach (var pattern in extraExcludes)
            {
                if (MatchesSegment(segment, pattern))
                {
                    return true;
                }
            }
        }
        return false;
    }

    /// <summary>
    /// Pattern match supporting a leading/trailing "*" wildcard; otherwise an
    /// exact case-insensitive segment comparison.
    /// </summary>
    private static bool MatchesSegment(string segment, string pattern)
    {
        if (pattern.Equals(segment, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
        if (pattern.StartsWith("*") && segment.EndsWith(pattern[1..], StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
        if (pattern.EndsWith("*") && segment.StartsWith(pattern[..^1], StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
        return false;
    }
}

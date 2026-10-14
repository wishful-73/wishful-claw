using System.Text.Json;
using System.Text.RegularExpressions;

namespace WishfulClaw.Agent.Modules.Git;

/// <summary>
/// Parses git status --porcelain=v1 -b output into structured data.
/// </summary>
public static class GitStatusTools
{
    private const string StatusSeparator = "\u0001";

    public static async Task<GitStatusDetailedResult> StatusDetailedAsync(string cwd)
    {
        var result = await GitExecutor.ExecAsync(
            new[] { "status", "--porcelain=v1", "-b", "--untracked-files=all" }, cwd);

        if (!result.Success)
        {
            return GitStatusDetailedResult.Fail(result, "Failed to get detailed status");
        }

        return new GitStatusDetailedResult(
            true, ParseStatusDetailed(result.Stdout), null, null, null, null, null);
    }

    private static GitStatusDetailed ParseStatusDetailed(string output)
    {
        var rawLines = output.Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.TrimEnd('\r'))
            .ToArray();

        var header = rawLines.Length > 0 && rawLines[0].StartsWith("## ", StringComparison.Ordinal)
            ? ParseAheadBehind(rawLines[0])
            : ParseAheadBehind("## HEAD");

        var body = rawLines.Length > 0 && rawLines[0].StartsWith("## ", StringComparison.Ordinal)
            ? rawLines.Skip(1)
            : rawLines;

        var staged = new List<GitStatusFile>();
        var unstaged = new List<GitStatusFile>();
        var untracked = new List<GitStatusFile>();
        var conflicted = new List<GitStatusFile>();

        foreach (var line in body)
        {
            if (line.Length < 3) continue;

            var stagedStatus = line[0].ToString();
            var unstagedStatus = line[1].ToString();
            var rawPath = line[3..];
            var renameParts = rawPath.Split(" -> ");
            var filePath = renameParts[^1];
            var originalPath = renameParts.Length > 1 ? renameParts[0] : null;
            var item = new GitStatusFile(filePath, stagedStatus, unstagedStatus, originalPath);

            if (stagedStatus == "?" && unstagedStatus == "?")
            {
                untracked.Add(item);
                continue;
            }

            if ("UADRC".Contains(stagedStatus) && "UADRC".Contains(unstagedStatus) &&
                (stagedStatus == "U" || unstagedStatus == "U"))
            {
                conflicted.Add(item);
                continue;
            }

            if (stagedStatus != " ") staged.Add(item);
            if (unstagedStatus != " ") unstaged.Add(item);
        }

        return new GitStatusDetailed(
            header.Branch, header.Upstream, header.Ahead, header.Behind,
            staged, unstaged, untracked, conflicted);
    }

    private static (string Branch, string? Upstream, int Ahead, int Behind) ParseAheadBehind(string header)
    {
        var match = Regex.Match(
            header, @"^##\s+([^.]+?)(?:\.\.\.([^\s]+))?(?:\s+\[(.+)\])?$");
        var branch = match.Success ? match.Groups[1].Value : "HEAD";
        var upstream = match.Success && match.Groups[2].Success ? match.Groups[2].Value : null;
        var details = match.Success && match.Groups[3].Success ? match.Groups[3].Value : string.Empty;
        var ahead = 0;
        var behind = 0;

        foreach (var part in details.Split(','))
        {
            var value = part.Trim();
            var aheadMatch = Regex.Match(value, @"^ahead\s+(\d+)$");
            var behindMatch = Regex.Match(value, @"^behind\s+(\d+)$");
            if (aheadMatch.Success)
                ahead = int.Parse(aheadMatch.Groups[1].Value);
            if (behindMatch.Success)
                behind = int.Parse(behindMatch.Groups[1].Value);
        }

        return (branch, upstream, ahead, behind);
    }
}

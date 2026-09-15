using System.Text.Json;

namespace WishfulClaw.Agent.Modules.Git;

/// <summary>
/// Handles git/query IPC — 12 query operations (head, range, status, diff, history, branches, etc.).
/// Ported from WishfulClaw GitTools.cs, SSH paths removed.
/// </summary>
public static class GitQueryTools
{
    private const int DefaultLargeGitOutputChars = 2 * 1024 * 1024;
    private const int DefaultHistoryLimit = 50;
    private const int MaxHistoryLimit = 500;
    private const int DefaultGraphLimit = 50;
    private const int MaxGraphLimit = 200;
    private const int DefaultMaxPatchChars = 96_000;
    private const int MaxPatchChars = 512_000;
    private const string HistorySeparator = "\u0001";
    private const string PatchTruncatedSuffix =
        "\n\n[... patch truncated for size; more changes exist in index ...]";

    public static async Task<GitQueryResult> QueryAsync(JsonElement parameters, string cwd)
    {
        var operation = GitExecutor.GetString(parameters, "operation") ?? string.Empty;

        return operation switch
        {
            "get-head" => await GetHeadAsync(cwd),
            "get-range-commits" => await GetRangeCommitsAsync(cwd, parameters),
            "get-changed-files" => await GetChangedFilesAsync(cwd, parameters),
            "get-status" => await GetStatusAsync(cwd),
            "get-line-summary" => await GetLineSummaryAsync(cwd),
            "get-file-diff" => await GetFileDiffAsync(cwd, parameters),
            "get-file-diff-at-commit" => await GetFileDiffAtCommitAsync(cwd, parameters),
            "get-file-content-at-ref" => await GetFileContentAtRefAsync(cwd, parameters),
            "get-staged-diff-bundle" => await GetStagedDiffBundleAsync(cwd, parameters),
            "get-commit-history" => await GetCommitHistoryAsync(cwd, parameters),
            "get-commit-graph" => await GetCommitGraphAsync(cwd, parameters),
            "list-branches" => await ListBranchesAsync(cwd),
            "get-file-history" => await GetFileHistoryAsync(cwd, parameters),
            _ => GitQueryResult.Failure($"Unsupported git query operation: {operation}")
        };
    }

    private static async Task<GitQueryResult> GetHeadAsync(string cwd)
    {
        var result = await GitExecutor.ExecAsync(new[] { "rev-parse", "HEAD" }, cwd);
        return result.Success
            ? new GitQueryResult { Success = true, CommitId = result.Stdout.Trim() }
            : GitQueryResult.Failure(result, "Failed to get HEAD");
    }

    private static async Task<GitQueryResult> GetRangeCommitsAsync(string cwd, JsonElement parameters)
    {
        var range = BuildRange(parameters);
        if (range.Error is not null) return GitQueryResult.Failure(range.Error);

        var result = await GitExecutor.ExecAsync(
            new[] { "log", "--format=%H", range.Value }, cwd,
            maxStdoutChars: DefaultLargeGitOutputChars);
        return result.Success
            ? new GitQueryResult { Success = true, Commits = GitExecutor.NormalizeLines(result.Stdout) }
            : GitQueryResult.Failure(result, "Failed to get commit range");
    }

    private static async Task<GitQueryResult> GetChangedFilesAsync(string cwd, JsonElement parameters)
    {
        var range = BuildRange(parameters);
        if (range.Error is not null) return GitQueryResult.Failure(range.Error);

        var result = await GitExecutor.ExecAsync(
            new[] { "diff", "--name-only", range.Value }, cwd,
            maxStdoutChars: DefaultLargeGitOutputChars);
        return result.Success
            ? new GitQueryResult { Success = true, Files = GitExecutor.NormalizeLines(result.Stdout) }
            : GitQueryResult.Failure(result, "Failed to get changed files");
    }

    private static async Task<GitQueryResult> GetStatusAsync(string cwd)
    {
        var result = await GitExecutor.ExecAsync(
            new[] { "status", "--short" }, cwd,
            maxStdoutChars: DefaultLargeGitOutputChars);
        if (!result.Success) return GitQueryResult.Failure(result, "Failed to get git status");

        var files = GitExecutor.NormalizeLines(result.Stdout);
        return new GitQueryResult { Success = true, Files = files, Dirty = files.Count > 0 };
    }

    private static async Task<GitQueryResult> GetFileDiffAsync(string cwd, JsonElement parameters)
    {
        var filePath = GitExecutor.GetString(parameters, "filePath");
        if (string.IsNullOrWhiteSpace(filePath))
            return GitQueryResult.Failure("filePath is required");

        var staged = GitExecutor.GetBool(parameters, "staged", false);
        var args = staged
            ? new[] { "diff", "--cached", "--no-color", "--", filePath }
            : new[] { "diff", "--no-color", "--", filePath };
        var result = await GitExecutor.ExecAsync(args, cwd, maxStdoutChars: DefaultLargeGitOutputChars);
        return result.Success
            ? new GitQueryResult
            {
                Success = true,
                Diff = result.Stdout,
                IsBinary = result.Stdout.Contains("Binary files", StringComparison.Ordinal)
            }
            : GitQueryResult.Failure(result, "Failed to get file diff");
    }

    private static async Task<GitQueryResult> GetLineSummaryAsync(string cwd)
    {
        var unstagedTask = GitExecutor.ExecAsync(
            new[] { "diff", "--numstat", "--no-color" }, cwd,
            maxStdoutChars: DefaultLargeGitOutputChars);
        var stagedTask = GitExecutor.ExecAsync(
            new[] { "diff", "--cached", "--numstat", "--no-color" }, cwd,
            maxStdoutChars: DefaultLargeGitOutputChars);

        await Task.WhenAll(unstagedTask, stagedTask);
        var unstaged = await unstagedTask;
        var staged = await stagedTask;
        if (!unstaged.Success) return GitQueryResult.Failure(unstaged, "Failed to get git line summary");
        if (!staged.Success) return GitQueryResult.Failure(staged, "Failed to get git line summary");

        var unstagedSummary = ParseNumstatSummary(unstaged.Stdout);
        var stagedSummary = ParseNumstatSummary(staged.Stdout);
        return new GitQueryResult
        {
            Success = true,
            Added = unstagedSummary.Added + stagedSummary.Added,
            Deleted = unstagedSummary.Deleted + stagedSummary.Deleted,
            Binary = unstagedSummary.Binary + stagedSummary.Binary
        };
    }

    private static async Task<GitQueryResult> GetFileDiffAtCommitAsync(string cwd, JsonElement parameters)
    {
        var filePath = GitExecutor.GetString(parameters, "filePath");
        if (string.IsNullOrWhiteSpace(filePath))
            return GitQueryResult.Failure("filePath is required");

        var hash = GitExecutor.GetString(parameters, "commitHash")?.Trim();
        if (string.IsNullOrWhiteSpace(hash))
            return GitQueryResult.Failure("commitHash is required");

        var result = await GitExecutor.ExecAsync(
            new[] { "show", "--no-color", "--pretty=format:", "--no-notes", hash, "--", filePath },
            cwd, maxStdoutChars: DefaultLargeGitOutputChars);
        return result.Success
            ? new GitQueryResult
            {
                Success = true,
                Diff = result.Stdout,
                IsBinary = result.Stdout.Contains("Binary files", StringComparison.Ordinal)
            }
            : GitQueryResult.Failure(result, "Failed to get file diff at commit");
    }

    private static async Task<GitQueryResult> GetFileContentAtRefAsync(string cwd, JsonElement parameters)
    {
        var filePath = GitExecutor.GetString(parameters, "filePath");
        if (string.IsNullOrWhiteSpace(filePath))
            return GitQueryResult.Failure("filePath is required");

        var gitRef = GitExecutor.GetString(parameters, "ref")?.Trim() ?? string.Empty;
        var objectExpr = $"{gitRef}:{filePath}";
        var result = await GitExecutor.ExecAsync(
            new[] { "show", objectExpr }, cwd,
            maxStdoutChars: DefaultLargeGitOutputChars);
        if (!result.Success)
        {
            var stderr = result.Stderr.ToLowerInvariant();
            var missing = stderr.Contains("does not exist", StringComparison.Ordinal)
                || stderr.Contains("exists on disk, but not in", StringComparison.Ordinal)
                || stderr.Contains("invalid object name", StringComparison.Ordinal);
            return missing
                ? new GitQueryResult { Success = true, Content = string.Empty, Exists = false, IsBinary = false }
                : GitQueryResult.Failure(result, "Failed to read file content at ref");
        }

        return new GitQueryResult
        {
            Success = true,
            Content = result.Stdout,
            Exists = true,
            IsBinary = result.Stdout.IndexOf('\0', StringComparison.Ordinal) >= 0
        };
    }

    private static async Task<GitQueryResult> GetStagedDiffBundleAsync(string cwd, JsonElement parameters)
    {
        var maxPatchChars = Math.Clamp(
            GitExecutor.GetInt(parameters, "maxPatchChars", DefaultMaxPatchChars),
            1, MaxPatchChars);

        var statResult = await GitExecutor.ExecAsync(
            new[] { "diff", "--cached", "--stat" }, cwd, maxStdoutChars: 128 * 1024);
        if (!statResult.Success)
            return GitQueryResult.Failure(statResult, "Failed to read staged diff stat");

        var statText = statResult.Stdout.Trim();
        if (string.IsNullOrEmpty(statText))
            return new GitQueryResult { Success = true, Stat = string.Empty, Patch = string.Empty, Empty = true };

        var patchResult = await GitExecutor.ExecAsync(
            new[] { "diff", "--cached", "--no-color" }, cwd,
            maxStdoutChars: maxPatchChars + 1);
        if (!patchResult.Success)
            return GitQueryResult.Failure(patchResult, "Failed to read staged patch");

        var patch = patchResult.Stdout;
        if (patchResult.StdoutTruncated || patch.Length > maxPatchChars)
        {
            patch = patch[..Math.Min(maxPatchChars, patch.Length)] + PatchTruncatedSuffix;
        }

        return new GitQueryResult { Success = true, Stat = statText, Patch = patch, Empty = false };
    }

    private static async Task<GitQueryResult> GetCommitHistoryAsync(string cwd, JsonElement parameters)
    {
        var limit = ClampHistoryLimit(GitExecutor.GetInt(parameters, "limit", DefaultHistoryLimit));
        var skip = Math.Max(0, GitExecutor.GetInt(parameters, "skip", 0));
        var format = string.Join(HistorySeparator, "%H", "%h", "%an", "%ae", "%ad", "%s");
        var result = await GitExecutor.ExecAsync(
            new[] { "log", "--date=iso", $"--pretty=format:{format}", $"--max-count={limit}", $"--skip={skip}" },
            cwd, maxStdoutChars: DefaultLargeGitOutputChars);
        return result.Success
            ? new GitQueryResult { Success = true, History = ParseCommitHistory(result.Stdout) }
            : GitQueryResult.Failure(result, "Failed to get commit history");
    }

    /// <summary>
    /// Topology feed for the branch view. Walks every ref (branches / remotes / tags) so
    /// the renderer can draw diverging and merging lanes, not just the current branch's
    /// straight line. Parents are emitted in order — the first one is the lane the commit
    /// continues on.
    /// </summary>
    private static async Task<GitQueryResult> GetCommitGraphAsync(string cwd, JsonElement parameters)
    {
        var limit = Math.Clamp(
            GitExecutor.GetInt(parameters, "limit", DefaultGraphLimit), 1, MaxGraphLimit);
        var format = string.Join(HistorySeparator, "%H", "%h", "%P", "%an", "%ad", "%s", "%D");
        var result = await GitExecutor.ExecAsync(
            new[]
            {
                "log", "--all", "--date=iso", $"--pretty=format:{format}", $"--max-count={limit}"
            },
            cwd, maxStdoutChars: DefaultLargeGitOutputChars);
        return result.Success
            ? new GitQueryResult { Success = true, Graph = ParseCommitGraph(result.Stdout) }
            : GitQueryResult.Failure(result, "Failed to get commit graph");
    }

    private static async Task<GitQueryResult> GetFileHistoryAsync(string cwd, JsonElement parameters)
    {
        var filePath = GitExecutor.GetString(parameters, "filePath");
        if (string.IsNullOrWhiteSpace(filePath))
            return GitQueryResult.Failure("filePath is required");

        var limit = ClampHistoryLimit(GitExecutor.GetInt(parameters, "limit", DefaultHistoryLimit));
        var skip = Math.Max(0, GitExecutor.GetInt(parameters, "skip", 0));
        var format = string.Join(HistorySeparator, "%H", "%h", "%an", "%ae", "%ad", "%s");
        var result = await GitExecutor.ExecAsync(
            new[] { "log", "--date=iso", $"--pretty=format:{format}", $"--max-count={limit}", $"--skip={skip}", "--", filePath },
            cwd, maxStdoutChars: DefaultLargeGitOutputChars);
        return result.Success
            ? new GitQueryResult { Success = true, History = ParseCommitHistory(result.Stdout) }
            : GitQueryResult.Failure(result, "Failed to get file history");
    }

    private static async Task<GitQueryResult> ListBranchesAsync(string cwd)
    {
        var format = "%(refname)\u0001%(refname:short)\u0001%(HEAD)";
        var localTask = GitExecutor.ExecAsync(
            new[] { "for-each-ref", "--format", format, "refs/heads" }, cwd,
            maxStdoutChars: DefaultLargeGitOutputChars);
        var remoteTask = GitExecutor.ExecAsync(
            new[] { "for-each-ref", "--format", format, "refs/remotes" }, cwd,
            maxStdoutChars: DefaultLargeGitOutputChars);
        await Task.WhenAll(localTask, remoteTask);

        var localResult = await localTask;
        var remoteResult = await remoteTask;
        if (!localResult.Success)
            return GitQueryResult.Failure(localResult, "Failed to list local branches");
        if (!remoteResult.Success)
            return GitQueryResult.Failure(remoteResult, "Failed to list remote branches");

        var branches = new List<GitBranchItem>();
        branches.AddRange(ParseBranches(localResult.Stdout, "local"));
        branches.AddRange(ParseBranches(remoteResult.Stdout, "remote"));
        var current = branches.FirstOrDefault(b => b.IsCurrent)?.Name;
        return new GitQueryResult { Success = true, Branches = branches, Current = current };
    }

    // ── Helpers ──

    private static (string Value, string? Error) BuildRange(JsonElement parameters)
    {
        var gitBase = GitExecutor.GetString(parameters, "base")?.Trim();
        if (string.IsNullOrWhiteSpace(gitBase))
            return (string.Empty, "base is required");
        var head = GitExecutor.GetString(parameters, "head")?.Trim();
        if (string.IsNullOrWhiteSpace(head))
            head = "HEAD";
        return ($"{gitBase}..{head}", null);
    }

    private static (int Added, int Deleted, int Binary) ParseNumstatSummary(string output)
    {
        var added = 0;
        var deleted = 0;
        var binary = 0;

        foreach (var line in GitExecutor.NormalizeLines(output))
        {
            var parts = line.Split('\t', 3, StringSplitOptions.None);
            if (parts.Length < 2) continue;

            if (parts[0] == "-" || parts[1] == "-")
            {
                binary++;
                continue;
            }
            if (int.TryParse(parts[0], out var addedValue)) added += addedValue;
            if (int.TryParse(parts[1], out var deletedValue)) deleted += deletedValue;
        }

        return (added, deleted, binary);
    }

    private static int ClampHistoryLimit(int limit)
    {
        return Math.Clamp(limit, 1, MaxHistoryLimit);
    }

    private static List<GitCommitHistoryItem> ParseCommitHistory(string output)
    {
        var history = new List<GitCommitHistoryItem>();
        foreach (var line in GitExecutor.NormalizeLines(output))
        {
            var parts = line.Split(HistorySeparator, 6, StringSplitOptions.None);
            history.Add(new GitCommitHistoryItem(
                parts.Length > 0 ? parts[0] : string.Empty,
                parts.Length > 1 ? parts[1] : string.Empty,
                parts.Length > 2 ? parts[2] : string.Empty,
                parts.Length > 3 ? parts[3] : string.Empty,
                parts.Length > 4 ? parts[4] : string.Empty,
                parts.Length > 5 ? parts[5] : string.Empty));
        }
        return history;
    }

    private static List<GitCommitGraphItem> ParseCommitGraph(string output)
    {
        var graph = new List<GitCommitGraphItem>();
        foreach (var line in GitExecutor.NormalizeLines(output))
        {
            var parts = line.Split(HistorySeparator, 7, StringSplitOptions.None);
            graph.Add(new GitCommitGraphItem(
                parts.Length > 0 ? parts[0] : string.Empty,
                parts.Length > 1 ? parts[1] : string.Empty,
                SplitGraphList(parts.Length > 2 ? parts[2] : string.Empty, ' '),
                parts.Length > 3 ? parts[3] : string.Empty,
                parts.Length > 4 ? parts[4] : string.Empty,
                parts.Length > 5 ? parts[5] : string.Empty,
                SplitGraphList(parts.Length > 6 ? parts[6] : string.Empty, ',')));
        }
        return graph;
    }

    /// <summary>
    /// Splits a space-separated parent list or a comma-separated ref list. Both are safe:
    /// git refnames may not contain spaces, and <c>%D</c> separates entries with ", ".
    /// </summary>
    private static List<string> SplitGraphList(string value, char separator)
    {
        if (string.IsNullOrWhiteSpace(value)) return new List<string>();
        var items = new List<string>();
        foreach (var part in value.Split(separator))
        {
            var trimmed = part.Trim();
            if (trimmed.Length > 0) items.Add(trimmed);
        }
        return items;
    }

    private static List<GitBranchItem> ParseBranches(string output, string type)
    {
        var branches = new List<GitBranchItem>();
        foreach (var line in GitExecutor.NormalizeLines(output))
        {
            var parts = line.Split('\u0001', 3, StringSplitOptions.None);
            branches.Add(new GitBranchItem(
                parts.Length > 1 ? parts[1] : string.Empty,
                parts.Length > 0 ? parts[0] : string.Empty,
                type,
                parts.Length > 2 && parts[2] == "*"));
        }
        return branches;
    }
}

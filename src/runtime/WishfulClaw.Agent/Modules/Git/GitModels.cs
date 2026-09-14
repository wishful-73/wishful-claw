/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

namespace WishfulClaw.Agent.Modules.Git;

/// <summary>
/// Result of a local git command execution.
/// </summary>
public sealed record GitExecResult(
    bool Success,
    string Stdout,
    string Stderr,
    int ExitCode,
    string? ErrorType,
    bool StdoutTruncated,
    bool StderrTruncated);

/// <summary>
/// A file entry in git status output.
/// </summary>
public sealed record GitStatusFile(
    string Path,
    string StagedStatus,
    string UnstagedStatus,
    string? OriginalPath);

/// <summary>
/// Parsed detailed git status (porcelain v1 with branch header).
/// </summary>
public sealed record GitStatusDetailed(
    string Branch,
    string? Upstream,
    int Ahead,
    int Behind,
    List<GitStatusFile> Staged,
    List<GitStatusFile> Unstaged,
    List<GitStatusFile> Untracked,
    List<GitStatusFile> Conflicted);

/// <summary>
/// Result of the status-detailed IPC call.
/// </summary>
public sealed record GitStatusDetailedResult(
    bool Success,
    GitStatusDetailed? Status,
    string? Error,
    string? ErrorType,
    int? ExitCode,
    string? Stdout,
    string? Stderr)
{
    public static GitStatusDetailedResult Fail(GitExecResult result, string fallback)
    {
        return new GitStatusDetailedResult(
            false,
            null,
            string.IsNullOrWhiteSpace(result.Stderr) ? fallback : result.Stderr,
            result.ErrorType ?? "UNKNOWN",
            result.ExitCode,
            result.Stdout,
            result.Stderr);
    }
}

/// <summary>
/// Generic query result covering all git/query operations.
/// </summary>
public sealed class GitQueryResult
{
    public bool Success { get; init; }
    public string? CommitId { get; init; }
    public List<string>? Commits { get; init; }
    public List<string>? Files { get; init; }
    public bool? Dirty { get; init; }
    public string? Diff { get; init; }
    public bool? IsBinary { get; init; }
    public string? Content { get; init; }
    public bool? Exists { get; init; }
    public string? Stat { get; init; }
    public string? Patch { get; init; }
    public bool? Empty { get; init; }
    public List<GitCommitHistoryItem>? History { get; init; }
    public List<GitCommitGraphItem>? Graph { get; init; }
    public List<GitBranchItem>? Branches { get; init; }
    public string? Current { get; init; }
    public int? Added { get; init; }
    public int? Deleted { get; init; }
    public int? Binary { get; init; }
    public string? Error { get; init; }
    public string? ErrorType { get; init; }
    public int? ExitCode { get; init; }
    public string? Stdout { get; init; }
    public string? Stderr { get; init; }

    public static GitQueryResult Failure(string error, string errorType = "UNKNOWN")
    {
        return new GitQueryResult
        {
            Success = false,
            Error = error,
            ErrorType = errorType
        };
    }

    public static GitQueryResult Failure(GitExecResult result, string fallback)
    {
        return new GitQueryResult
        {
            Success = false,
            Error = string.IsNullOrWhiteSpace(result.Stderr) ? fallback : result.Stderr,
            ErrorType = result.ErrorType ?? "UNKNOWN",
            ExitCode = result.ExitCode,
            Stdout = result.Stdout,
            Stderr = result.Stderr
        };
    }
}

public sealed record GitCommitHistoryItem(
    string Hash,
    string ShortHash,
    string Author,
    string Email,
    string Date,
    string Subject);

public sealed record GitBranchItem(
    string Name,
    string FullName,
    string Type,
    bool IsCurrent);

/// <summary>
/// One node of the commit graph. <see cref="Parents"/> carries the full parent hashes
/// (first parent = the branch the commit was made on), which is what the renderer needs
/// to lay out lanes; <see cref="Refs"/> holds the short ref names pointing at this commit
/// (branch tips, <c>HEAD -></c> marker, <c>tag:</c> prefixes), already split.
/// </summary>
public sealed record GitCommitGraphItem(
    string Hash,
    string ShortHash,
    List<string> Parents,
    string Author,
    string Date,
    string Subject,
    List<string> Refs);

public sealed record GitRepositorySummary(
    string Name,
    string FullPath,
    string RelativePath,
    string Branch,
    bool IsRootRepo);

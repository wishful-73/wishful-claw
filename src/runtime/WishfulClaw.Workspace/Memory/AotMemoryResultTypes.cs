using WishfulClaw.Workspace.Memory;

namespace WishfulClaw.Workspace.Memory;

/// <summary>
/// Memory module result types for AOT-safe serialization.
/// </summary>
public sealed record MemoryReadResult(string Content);
public sealed record MemorySearchResponse(List<MemorySearchResult> Hits);
public sealed record MemoryMutationResult(bool Ok, long? Id = null, string? Error = null);

/// <summary>
/// A memory entry eligible for tier demotion (active → warm → cold).
/// </summary>
public sealed record MemoryDemotionCandidate(
    long Id,
    string Scope,
    string? Title,
    string Priority,
    string Status,
    long UpdatedAt,
    string TargetStatus);

public sealed record MemoryDemotionCandidatesResponse(List<MemoryDemotionCandidate> Candidates);

public sealed record MemoryBatchStatusResult(bool Ok, int Affected, string? Error = null);

/// <summary>
/// A memory entry row for status-based listing (tier browser / restore UI).
/// </summary>
public sealed record MemoryEntryRow(
    long Id,
    string Scope,
    string? Title,
    string Content,
    string Priority,
    string Status,
    long UpdatedAt);

public sealed record MemoryEntriesByStatusResponse(List<MemoryEntryRow> Entries);


namespace WishfulClaw.Infrastructure.Db;

// ─── Compaction Snapshot Entity ───
// Immutable context-compression snapshot revision.
// Contract: docs/plans/iter-v2-23/snapshot-contract.md

public class CompactionSnapshotEntity
{
    public string SnapshotId { get; set; } = string.Empty;

    public string SessionId { get; set; } = string.Empty;

    public int Version { get; set; }

    public string Trigger { get; set; } = string.Empty;

    /// <summary>Full compressed wire conversation (JSON array of wire messages).</summary>
    public string WireConversation { get; set; } = string.Empty;

    /// <summary>Compact boundary + summary display artifacts (JSON array).</summary>
    public string CompactArtifacts { get; set; } = string.Empty;

    /// <summary>Displayable summary message JSON; null when unavailable.</summary>
    public string? SummaryMessage { get; set; }

    /// <summary>Summary body without message wrapping; null when unavailable.</summary>
    public string? SummaryText { get; set; }

    /// <summary>Diagnostics only: created_at of the newest message covered at commit time.</summary>
    public long ThroughCreatedAt { get; set; }

    /// <summary>
    /// Diagnostics only: sort_order of the newest covered message. sort_order is a frontend
    /// transcript index, so it must never be compared to decide whether a row is covered.
    /// </summary>
    public int ThroughSortOrder { get; set; }

    public int OriginalCount { get; set; }

    public int NewCount { get; set; }

    public int MessagesSummarized { get; set; }

    public bool SummarizerFailed { get; set; }

    public long CreatedAt { get; set; }

    public long UpdatedAt { get; set; }
}

// ─── Compaction Snapshot DTO ───

public sealed class CompactionSnapshotRow
{
    public string SnapshotId { get; set; } = string.Empty;
    public string SessionId { get; set; } = string.Empty;
    public int Version { get; set; }
    public string Trigger { get; set; } = string.Empty;
    public string WireConversation { get; set; } = string.Empty;
    public string CompactArtifacts { get; set; } = string.Empty;
    public string? SummaryMessage { get; set; }
    public string? SummaryText { get; set; }
    public long ThroughCreatedAt { get; set; }
    public int ThroughSortOrder { get; set; }
    public int OriginalCount { get; set; }
    public int NewCount { get; set; }
    public int MessagesSummarized { get; set; }
    public bool SummarizerFailed { get; set; }
    public long CreatedAt { get; set; }
    public long UpdatedAt { get; set; }

    public static CompactionSnapshotRow FromEntity(CompactionSnapshotEntity e) => new()
    {
        SnapshotId = e.SnapshotId,
        SessionId = e.SessionId,
        Version = e.Version,
        Trigger = e.Trigger,
        WireConversation = e.WireConversation,
        CompactArtifacts = e.CompactArtifacts,
        SummaryMessage = e.SummaryMessage,
        SummaryText = e.SummaryText,
        ThroughCreatedAt = e.ThroughCreatedAt,
        ThroughSortOrder = e.ThroughSortOrder,
        OriginalCount = e.OriginalCount,
        NewCount = e.NewCount,
        MessagesSummarized = e.MessagesSummarized,
        SummarizerFailed = e.SummarizerFailed,
        CreatedAt = e.CreatedAt,
        UpdatedAt = e.UpdatedAt
    };
}

// ─── Compaction Snapshot Result Records ───

public sealed record CompactionSnapshotGetResult(bool Success, CompactionSnapshotRow? Snapshot, string? Reason, string? Error);
public sealed record CompactionSnapshotMutationResult(
    bool Success,
    int Changed,
    string? Error,
    string? SnapshotId = null,
    long? ContextRevision = null);
public sealed record CompactionSnapshotDeleteResult(bool Success, bool Deleted, string? Error);

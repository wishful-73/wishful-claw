namespace WishfulClaw.Workspace.Memory;

/// <summary>
/// Recall re-heat — promotes recalled warm/cold entries one tier up
/// (warm → active, cold → warm) and refreshes updated_at, so memories
/// that keep being recalled stay hot while unused ones demote.
/// </summary>
public interface IMemoryReheat
{
    /// <summary>
    /// Promote the given entries one tier up. Returns affected row count.
    /// </summary>
    Task<int> ReheatAsync(IReadOnlyList<long> ids, CancellationToken ct = default);
}

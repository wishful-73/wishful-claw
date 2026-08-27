namespace WishfulClaw.Agent;

/// <summary>
/// Session/Goal related result types for AOT-safe serialization.
/// </summary>
public sealed record SessionRestoreResponse(bool Restored, string SessionId, int MessageCount, bool? Skipped = null, bool? FromSnapshot = null);
public sealed record ClearSessionResult(bool Cleared, string SessionId);

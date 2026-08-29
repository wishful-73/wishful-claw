namespace WishfulClaw.Workspace.Memory;

/// <summary>
/// Memory recall service — automatically injects relevant memories
/// into the conversation before the Agent Loop starts.
/// </summary>
public interface IMemoryRecall
{
    /// <summary>
    /// Search for memories relevant to the user's message and return a
    /// structured outcome: the injected context block (or null) plus the
    /// reason, for recall visibility.
    ///
    /// The returned text is formatted as a User Message containing
    /// "[Relevant memory]" with "untrusted reference data" warning,
    /// following OpenClaw.net's prompt-injection-safe pattern.
    /// </summary>
    /// <param name="userMessage">The user's latest message.</param>
    /// <param name="scope">Current project scope ("project:{id}") or "global".</param>
    /// <param name="maxChars">Maximum characters for the injected context.</param>
    /// <param name="maxNotes">Maximum entries to inject (clamped 1..32).</param>
    /// <param name="minScore">Relevance threshold; 0 disables filtering.</param>
    /// <param name="globalFallback">Retry without scope prefix when a project scope yields nothing.</param>
    /// <param name="candidateFilter">Optional final filter for excluding entries already present in session context.</param>
    Task<MemoryRecallOutcome> TryInjectRecallAsync(
        string userMessage,
        string? scope = null,
        int maxChars = 4000,
        int maxNotes = 5,
        double minScore = 0,
        bool globalFallback = true,
        CancellationToken ct = default,
        Func<MemorySearchResult, bool>? candidateFilter = null);
}

/// <summary>
/// Context budget planner — limits the size of injected memory context
/// to avoid consuming too many tokens.
/// </summary>
public interface IContextBudgetPlanner
{
    /// <summary>
    /// Calculate the maximum character budget for memory injection.
    /// Takes the minimum of token-based and char-based limits.
    /// </summary>
    /// <param name="maxTokens">Token limit (each token ≈ 4 chars).</param>
    /// <param name="maxChars">Direct char limit.</param>
    int PlanBudget(int maxTokens, int maxChars);
}

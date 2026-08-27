using System.Collections.Concurrent;
using System.Text.Json;

namespace WishfulClaw.Agent;

/// <summary>
/// Per-session conversation state manager.
/// Holds the parsed conversation (<see cref="Conversation"/>) and the wire-format
/// messages (<see cref="WireConversation"/>) so that subsequent agent runs within
/// the same session can append incrementally instead of rebuilding from scratch.
///
/// This is the C# equivalent of Reasonix's <c>internal/agent/session.go</c> Session,
/// but stripped of persistence (the renderer DB handles that). The key benefit:
/// the prefix portion of the conversation stays byte-stable across turns, which
/// is essential for Anthropic prefix cache hits.
/// </summary>
public sealed class SessionConversation
{
    private readonly object _lock = new();
    private List<AgentRuntimeChatMessage> _conversation = [];
    private List<JsonElement> _wireConversation = [];
    private long _version;
    private int _compactionWatermark;

    /// <summary>
    /// Message count at the last completed/attempted compaction. Prevents the
    /// same oversized conversation from re-entering compaction on every loop
    /// iteration while still allowing a later turn to compact newly appended data.
    /// </summary>
    public int CompactionWatermark
    {
        get
        {
            lock (_lock)
            {
                return _compactionWatermark;
            }
        }
    }

    public void MarkCompactionWatermark(int messageCount)
    {
        lock (_lock)
        {
            _compactionWatermark = Math.Max(_compactionWatermark, messageCount);
        }
    }

    // Session-level cumulative cache counters (LA Reasonix's sessCacheHit/sessCacheMiss).
    // Atomic: the run loop accumulates them while the status bar reads them.
    // NOT reset on compaction -- the aggregate never craters when the prefix is summarized away.
    private long _sessCacheHit;
    private long _sessCacheMiss;

    /// <summary>
    /// Cumulative cache-hit prompt tokens across every API call this session.
    /// </summary>
    public long SessionCacheHit => Interlocked.Read(ref _sessCacheHit);

    /// <summary>
    /// Cumulative cache-miss prompt tokens across every API call this session.
    /// </summary>
    public long SessionCacheMiss => Interlocked.Read(ref _sessCacheMiss);

    /// <summary>
    /// Accumulate cache hit/miss tokens from a single API call.
    /// Thread-safe via Interlocked.
    /// </summary>
    public void AccumulateCacheTokens(int hit, int miss)
    {
        if (hit > 0) Interlocked.Add(ref _sessCacheHit, hit);
        if (miss > 0) Interlocked.Add(ref _sessCacheMiss, miss);
    }

    /// <summary>
    /// Reset cache counters -- called on Initialize (full session restore).
    /// </summary>
    public void ResetCacheTotals()
    {
        Interlocked.Exchange(ref _sessCacheHit, 0);
        Interlocked.Exchange(ref _sessCacheMiss, 0);
    }

    /// <summary>
    /// Number of wire messages currently stored.
    /// Safe to call from any thread.
    /// </summary>
    public int MessageCount
    {
        get
        {
            lock (_lock)
            {
                return _wireConversation.Count;
            }
        }
    }

    /// <summary>
    /// Monotonically increasing version, bumped on every mutation.
    /// Useful for detecting whether the conversation changed between two snapshots.
    /// </summary>
    public long Version
    {
        get
        {
            lock (_lock)
            {
                return _version;
            }
        }
    }

    /// <summary>
    /// Initializes the conversation from a full set of wire messages.
    /// This replaces any existing state — use on first turn, session restore,
    /// or when the frontend explicitly sends a full history.
    /// </summary>
    /// <param name="wireMessages">Full wire-format messages from the frontend.</param>
    /// <param name="conversation">Parsed conversation (caller provides to avoid double-parsing).</param>
    public void Initialize(IReadOnlyList<JsonElement> wireMessages, List<AgentRuntimeChatMessage> conversation)
    {
        lock (_lock)
        {
            _wireConversation = [.. wireMessages];
            _conversation = conversation;
            _compactionWatermark = 0;
            _version++;
        }
        // NOTE: Cache counters are NOT reset here. They accumulate across the
        // entire session lifetime and only reset on Clear() (session switch).
        // This matches Reasonix's design where sessCacheHit/sessCacheMiss
        // survive compaction and full re-init.
    }

    /// <summary>
    /// Initializes the conversation only when it is still empty, with the
    /// emptiness check and the replacement performed under the same lock.
    /// Returns false when messages already exist (a live run populated the
    /// session, or a concurrent restore won the race) so a late restore can
    /// never clobber in-flight conversation state.
    /// </summary>
    public bool InitializeIfEmpty(IReadOnlyList<JsonElement> wireMessages, List<AgentRuntimeChatMessage> conversation)
    {
        lock (_lock)
        {
            if (_wireConversation.Count > 0) return false;
            _wireConversation = [.. wireMessages];
            _conversation = conversation;
            _compactionWatermark = 0;
            _version++;
            return true;
        }
    }

    /// <summary>
    /// Appends incremental wire messages and their parsed equivalents.
    /// The existing prefix is untouched — this is the cache-friendly path.
    /// </summary>
    public void Append(IReadOnlyList<JsonElement> wireMessages, List<AgentRuntimeChatMessage> conversation)
    {
        lock (_lock)
        {
            _wireConversation.AddRange(wireMessages);
            _conversation.AddRange(conversation);
            // A new user turn makes the previous compaction watermark stale;
            // allow the next oversized request to compact the newly grown context.
            _compactionWatermark = 0;
            _version++;
        }
    }

    /// <summary>
    /// Appends a single assistant message (used during the agent loop to add
    /// the model's response and tool results without going through the wire format).
    /// </summary>
    public void AppendInLoop(AgentRuntimeChatMessage message, JsonElement wireMessage)
    {
        lock (_lock)
        {
            _conversation.Add(message);
            _wireConversation.Add(wireMessage);
            _version++;
        }
    }

    /// <summary>
    /// Replaces the entire conversation — used after context compression
    /// truncates the message history.
    /// </summary>
    public void Replace(List<AgentRuntimeChatMessage> conversation, List<JsonElement> wireConversation)
    {
        lock (_lock)
        {
            _conversation = conversation;
            _wireConversation = wireConversation;
            _version++;
        }
    }

    /// <summary>
    /// Clears all state — used on session switch or explicit reset.
    /// </summary>
    public void Clear()
    {
        lock (_lock)
        {
            _conversation = [];
            _wireConversation = [];
            _version++;
        }
        ResetCacheTotals();
    }

    /// <summary>
    /// Gets a reference to the managed conversation list.
    /// The caller (AgentLoop) mutates this list in place during the loop —
    /// additions are tracked via <see cref="AppendInLoop"/>.
    /// Returns the live reference, not a copy, for zero-alloc iteration.
    /// </summary>
    public List<AgentRuntimeChatMessage> GetConversation()
    {
        lock (_lock)
        {
            return _conversation;
        }
    }

    /// <summary>
    /// Gets a reference to the managed wire conversation list.
    /// Same live-reference semantics as <see cref="GetConversation"/>.
    /// </summary>
    public List<JsonElement> GetWireConversation()
    {
        lock (_lock)
        {
            return _wireConversation;
        }
    }
}

/// <summary>
/// Static registry mapping sessionId → <see cref="SessionConversation"/>.
/// Lives for the process lifetime; entries are removed on session switch or
/// explicit clear.
/// </summary>
public static class SessionConversationManager
{
    private static readonly ConcurrentDictionary<string, SessionConversation> _sessions = new(StringComparer.Ordinal);

    /// <summary>
    /// Gets or creates a SessionConversation for the given sessionId.
    /// </summary>
    public static SessionConversation GetOrCreate(string sessionId)
    {
        if (string.IsNullOrEmpty(sessionId))
        {
            // Fallback: use a synthetic key so empty-sessionId calls don't collide
            sessionId = "__default__";
        }

        return _sessions.GetOrAdd(sessionId, _ => new SessionConversation());
    }

    /// <summary>
    /// Tries to get an existing SessionConversation without creating one.
    /// Returns null if not found.
    /// </summary>
    public static SessionConversation? TryGet(string sessionId)
    {
        if (string.IsNullOrEmpty(sessionId))
        {
            sessionId = "__default__";
        }

        return _sessions.TryGetValue(sessionId, out var session) ? session : null;
    }

    /// <summary>
    /// Removes and returns the SessionConversation for the given sessionId.
    /// Used on session switch to clear stale state.
    /// </summary>
    public static void Remove(string sessionId)
    {
        if (string.IsNullOrEmpty(sessionId))
        {
            sessionId = "__default__";
        }

        _sessions.TryRemove(sessionId, out _);
    }

    /// <summary>
    /// Clears all sessions — used on app shutdown or full reset.
    /// </summary>
    public static void ClearAll()
    {
        _sessions.Clear();
    }
}

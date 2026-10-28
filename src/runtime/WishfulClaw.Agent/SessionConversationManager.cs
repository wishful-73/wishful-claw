using System.Collections.Concurrent;

namespace WishfulClaw.Agent;

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

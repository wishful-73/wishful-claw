using System.Collections.Concurrent;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent.Sessions;

/// <summary>
/// Static registry mapping sessionId → <see cref="SessionConversation"/>.
///
/// ## Why entries must be evicted (S-322)
///
/// A <see cref="SessionConversation"/> holds the whole wire conversation, and a wire
/// message holds the original <see cref="System.Text.Json.JsonElement"/> — so every
/// screenshot ever sent stays on the managed heap, byte for byte, for as long as the
/// entry lives. Compaction only shrinks **one** session; it can never make another
/// session leave. Before this had limits, entries lived until the process exited
/// (only 4 call sites ever removed one: explicit clear, subagent end, goal end), which
/// is why the worker managed heap sat at 1,060 MB after a dozen sessions and never fell.
///
/// Two gates, both cheap:
/// <list type="bullet">
/// <item><b>Idle</b> — untouched for <see cref="IdleTimeout"/> ⇒ dropped. Chosen so that
/// "switch back and keep talking" stays warm; the cost of tripping it is one DB restore.</item>
/// <item><b>Capacity</b> — at most <see cref="MaxResident"/> entries, oldest access first.
/// Idle time alone can't bound "a dozen sessions in one day".</item>
/// </list>
///
/// Eviction is safe: the next <see cref="GetOrCreate"/> for that session returns an empty
/// conversation, which is exactly the trigger the agent loop already uses to lazily restore
/// from the DB (<c>AgentLoop</c>: <c>MessageCount == 0</c> ⇒ restore).
///
/// The one behavioural note: <see cref="SessionConversation.SessionCacheHit"/> counters
/// restart at zero after eviction. That is a display metric, not a regression.
/// </summary>
public static class SessionConversationManager
{
    /// <summary>Idle threshold for eviction. Long enough for "I'll be right back", short enough to matter.</summary>
    internal static readonly TimeSpan IdleTimeout = TimeSpan.FromHours(2);

    /// <summary>
    /// Hard cap on resident conversations. Desktop agents keep one or two tasks in flight;
    /// eight covers switching back and forth without pinning a dozen screenshots on the heap.
    /// </summary>
    internal const int MaxResident = 8;

    private static readonly ConcurrentDictionary<string, SessionConversation> _sessions = new(StringComparer.Ordinal);

    /// <summary>Number of resident conversations. Exposed for diagnostics and tests.</summary>
    public static int Count => _sessions.Count;

    /// <summary>
    /// Gets or creates a SessionConversation for the given sessionId, and enforces
    /// both eviction gates (S-322).
    /// </summary>
    public static SessionConversation GetOrCreate(string sessionId)
    {
        var key = Normalize(sessionId);
        var session = _sessions.GetOrAdd(key, _ => new SessionConversation());
        session.Touch();
        EnforceLimits(key);
        return session;
    }

    /// <summary>
    /// Tries to get an existing SessionConversation without creating one.
    /// Returns null if not found (or if it was just evicted — the caller then restores from the DB).
    /// </summary>
    public static SessionConversation? TryGet(string sessionId)
    {
        if (!_sessions.TryGetValue(Normalize(sessionId), out var session))
        {
            return null;
        }

        // A lookup is an access: without this, a session that is used constantly but only
        // through TryGet would look idle and get dropped under the caller's feet.
        session.Touch();
        return session;
    }

    /// <summary>
    /// Removes the SessionConversation for the given sessionId.
    /// Used on explicit clear, subagent end and goal end.
    /// </summary>
    public static void Remove(string sessionId)
        => _sessions.TryRemove(Normalize(sessionId), out _);

    /// <summary>
    /// Clears all sessions — used on app shutdown or full reset.
    /// </summary>
    public static void ClearAll()
        => _sessions.Clear();

    private static string Normalize(string sessionId)
        // Fallback: a synthetic key so empty-sessionId calls don't collide.
        => string.IsNullOrEmpty(sessionId) ? "__default__" : sessionId;

    /// <summary>
    /// Applies both gates. <paramref name="keepKey"/> is the entry the current call just
    /// touched — it is never a victim, even if the capacity sweep were to run out of
    /// fresher candidates.
    /// </summary>
    private static void EnforceLimits(string keepKey)
    {
        EvictIdle();
        EvictOverCapacity(keepKey);
    }

    private static void EvictIdle()
    {
        var idleLimit = (long)IdleTimeout.TotalMilliseconds;

        foreach (var (key, session) in _sessions)
        {
            if (session.IdleMilliseconds < idleLimit)
            {
                continue;
            }

            if (_sessions.TryRemove(key, out _))
            {
                WorkerLog.Info(
                    $"session conversation evicted reason=idle idleMinutes={session.IdleMilliseconds / 60_000} " +
                    $"messages={session.MessageCount} resident={_sessions.Count} key={key}");
            }
        }
    }

    private static void EvictOverCapacity(string keepKey)
    {
        var excess = _sessions.Count - MaxResident;
        if (excess <= 0)
        {
            return;
        }

        // Oldest access first (largest idle time). Snapshot with ToList before removing so the
        // enumeration isn't racing our own writes.
        var victims = _sessions
            .Where(pair => !string.Equals(pair.Key, keepKey, StringComparison.Ordinal))
            .OrderByDescending(pair => pair.Value.IdleMilliseconds)
            .Take(excess)
            .Select(pair => pair.Key)
            .ToList();

        foreach (var key in victims)
        {
            if (_sessions.TryRemove(key, out var session))
            {
                WorkerLog.Info(
                    $"session conversation evicted reason=capacity idleMinutes={session.IdleMilliseconds / 60_000} " +
                    $"messages={session.MessageCount} resident={_sessions.Count} key={key}");
            }
        }
    }
}

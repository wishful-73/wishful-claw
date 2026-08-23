using System.Collections.Concurrent;
using System.Text.Json;

namespace WishfulClaw.Agent;

/// <summary>
/// Session-scoped buffer for background sub-agent completion notifications
/// whose parent agent loop has already finalized. Normally a completion is
/// injected into the parent run's message queue and consumed on its next
/// iteration; when the parent finished first, that queue is closed and the
/// notification would be silently dropped. This registry keeps those
/// notifications so the renderer can pick them up (and wake the main agent)
/// when it observes the sub_agent_end event.
/// </summary>
public static class BackgroundSubAgentNotifications
{
    private sealed record SessionBuffer(ConcurrentQueue<JsonElement> Messages);

    private static readonly ConcurrentDictionary<string, SessionBuffer> Buffers = new(StringComparer.Ordinal);

    /// <summary>
    /// Buffer a completion notification for a session whose main run already ended.
    /// </summary>
    public static void Add(string sessionId, JsonElement notificationMessage)
    {
        if (string.IsNullOrWhiteSpace(sessionId)) return;
        var buffer = Buffers.GetOrAdd(sessionId, static _ => new SessionBuffer(new()));
        buffer.Messages.Enqueue(notificationMessage.Clone());
    }

    /// <summary>
    /// Drain all buffered notifications for a session (used by the renderer
    /// before waking the main agent). Returns an empty list when none.
    /// </summary>
    public static List<JsonElement> Drain(string sessionId)
    {
        var messages = new List<JsonElement>();
        if (string.IsNullOrWhiteSpace(sessionId)) return messages;
        if (!Buffers.TryRemove(sessionId, out var buffer)) return messages;

        while (buffer.Messages.TryDequeue(out var message))
        {
            messages.Add(message);
        }
        return messages;
    }
}

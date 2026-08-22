using System.Collections.Concurrent;
using System.Text.Json;

namespace WishfulClaw.Agent;

/// <summary>
/// Per-run state: cancellation, message queue, seq counter.
/// Each agent run gets its own instance, disposed when the run finalizes.
/// </summary>
public sealed class AgentRuntimeRunState : IDisposable
{
    private readonly CancellationTokenSource _cancellation = new();
    private readonly ConcurrentQueue<JsonElement> _queuedMessages = new();
    private readonly object _messageQueueSync = new();
    private long _seq;
    private int _queuedMessageCount;
    private int _stopRequested;
    private bool _messageQueueClosed;

    public AgentRuntimeRunState(string runId, string sessionId)
    {
        RunId = runId;
        SessionId = sessionId;
        StartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    public string RunId { get; }
    public string SessionId { get; }
    public long StartedAt { get; }
    public JsonElement Parameters { get; private set; }
    public CancellationToken CancellationToken => _cancellation.Token;

    /// <summary>
    /// When true, events emitted via EmitAsync are NOT sent to the frontend.
    /// Used by sub-agents: the parent executor captures events via EventObserver
    /// and selectively forwards them to the parent's stream.
    /// </summary>
    public bool SuppressTransportEvents { get; set; }

    /// <summary>
    /// When set, this run is a Goal-orchestrated plan execution. Sub-agent
    /// events forwarded to the parent stream are additionally tagged with this
    /// context (emitted as "goal_activity") so the Goal panel can render a
    /// live activity feed for the executing plan.
    /// </summary>
    public GoalEventContext? GoalEventContext { get; set; }

    /// <summary>
    /// Host-side evidence sink for Goal-orchestrated sub-agent runs. The
    /// SubAgentExecutor appends each child tool call's observable facts
    /// (tool name, key argument, success) here so the orchestrator can hand
    /// the evaluator host-observed receipts alongside the model's own report —
    /// evaluation then checks claims against what actually ran (inspired by
    /// DeepSeek-Reasonix's evidence ledger).
    /// </summary>
    public GoalTaskEvidence? GoalEvidenceSink { get; set; }

    /// <summary>
    /// Identifies the source of usage events: "executor", "subagent", "compaction", etc.
    /// Default is "executor". Set by the caller before executing a provider turn.
    /// </summary>
    public string UsageSource { get; set; } = "executor";

    /// <summary>
    /// The session conversation for this run. Set by AgentLoop before executing
    /// provider turns so that providers can read session-level cache counters
    /// and attach them to message_end events.
    /// </summary>
    public SessionConversation? SessionConversation { get; set; }

    /// <summary>
    /// Memory-update notes drained at the start of this turn.
    /// Injected into the last user message by InjectTransientPrefix, becoming
    /// part of the permanent conversation history.
    /// </summary>
    public List<string> PendingMemoryNotes { get; set; } = [];

    /// <summary>
    /// Memory-recall block injected into the last user message before the
    /// timestamp prefix. Becomes part of the permanent conversation history.
    /// </summary>
    public string? PendingMemoryRecall { get; set; }

    /// <summary>
    /// Optional callback invoked for every event when SuppressTransportEvents is true.
    /// The SubAgentExecutor uses this to collect text/tool events from the child loop.
    /// </summary>
    public Func<AgentRuntimeStreamEvent, ValueTask>? EventObserver { get; set; }

    public int QueuedMessageCount => Volatile.Read(ref _queuedMessageCount);
    public bool IsCancellationRequested => _cancellation.IsCancellationRequested;
    public bool IsStopRequested => Volatile.Read(ref _stopRequested) != 0;
    public string? StopReason { get; private set; }

    public void ReplaceParameters(JsonElement parameters)
    {
        Parameters = parameters;
    }

    public long NextSeq()
    {
        return Interlocked.Increment(ref _seq);
    }

    public int EnqueueMessages(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("messages", out var messages) ||
            messages.ValueKind != JsonValueKind.Array)
        {
            return 0;
        }

        lock (_messageQueueSync)
        {
            if (_messageQueueClosed)
            {
                return 0;
            }

            var count = 0;
            foreach (var message in messages.EnumerateArray())
            {
                if (message.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }
                _queuedMessages.Enqueue(message.Clone());
                count++;
            }

            if (count > 0)
            {
                Interlocked.Add(ref _queuedMessageCount, count);
            }
            return count;
        }
    }

    public List<JsonElement> DrainQueuedMessages()
    {
        lock (_messageQueueSync)
        {
            var messages = new List<JsonElement>();
            while (_queuedMessages.TryDequeue(out var message))
            {
                messages.Add(message);
            }
            if (messages.Count > 0)
            {
                Interlocked.Add(ref _queuedMessageCount, -messages.Count);
            }
            return messages;
        }
    }

    public bool TryCloseMessageQueueIfEmpty()
    {
        lock (_messageQueueSync)
        {
            if (QueuedMessageCount > 0)
            {
                return false;
            }
            _messageQueueClosed = true;
            return true;
        }
    }

    public void Cancel(string reason)
    {
        _cancellation.Cancel();
    }

    public void RequestStop(string reason)
    {
        StopReason = string.IsNullOrWhiteSpace(reason) ? "completed" : reason;
        Interlocked.Exchange(ref _stopRequested, 1);
    }

    public void Dispose()
    {
        lock (_messageQueueSync)
        {
            _messageQueueClosed = true;
        }
        _cancellation.Dispose();
    }
}

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
    private string? _cancelReason;

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
    /// Appended to the tail of the last user message by InjectTransientPrefix (S-231).
    /// In-memory only — the wire conversation that gets persisted never carries
    /// injected blocks.
    /// </summary>
    public List<string> PendingMemoryNotes { get; set; } = [];

    /// <summary>
    /// Memory-recall block appended to the last user message, after the timestamp
    /// block (S-231). In-memory only, like the notes above.
    /// </summary>
    public string? PendingMemoryRecall { get; set; }

    /// <summary>
    /// S-209：待注入的「空回复催办」标记。上一轮只出思考、既没正文也没工具调用时由
    /// AgentLoop 置上，下一轮构造 provider 消息时以临时副本注入一次，随即消费掉。
    ///
    /// 为什么不追加真消息：提醒会落库、进 durable conversation，还会污染下一轮压缩的
    /// 摘要输入（摘要的身份判定靠消息形状），代价远大于收益。
    /// </summary>
    public bool PendingEmptyTurnNudge { get; set; }

    /// <summary>S-209：本 run 已经催办过几次（上限见 <c>AgentLoop.MaxEmptyTurnNudges</c>）。</summary>
    public int EmptyTurnNudgeCount { get; set; }

    /// <summary>
    /// S-207：系统提示词里写着的沙箱状态。
    ///
    /// 提示词在 run 开头构建、进了 cacheKey，不会再改；而用户批准「临时关闭」是一次
    /// run 进行中就能发生的事，于是模型读到的口径和 PathBoundary 的实时判定会打架
    /// —— 提示词说「在沙箱里」，实际放行；或反过来。每轮 provider 调用前比对一次，
    /// 变了就注入一条临时提示把口径拉平（<c>AgentLoop.SandboxTransition</c>）。
    /// </summary>
    public bool SandboxEnabledInPrompt { get; set; }

    /// <summary>
    /// S-209：申请一次催办。额度用尽返回 false —— 这时必须放它正常收尾，
    /// 绝不无限重试。
    /// </summary>
    public bool TryScheduleEmptyTurnNudge(int maxNudges)
    {
        if (EmptyTurnNudgeCount >= maxNudges) return false;
        EmptyTurnNudgeCount++;
        PendingEmptyTurnNudge = true;
        return true;
    }

    /// <summary>
    /// Optional callback invoked for every event when SuppressTransportEvents is true.
    /// The SubAgentExecutor uses this to collect text/tool events from the child loop.
    /// </summary>
    public Func<AgentRuntimeStreamEvent, ValueTask>? EventObserver { get; set; }

    public int QueuedMessageCount => Volatile.Read(ref _queuedMessageCount);
    public bool IsCancellationRequested => _cancellation.IsCancellationRequested;
    public bool IsStopRequested => Volatile.Read(ref _stopRequested) != 0;
    public string? StopReason { get; private set; }

    /// <summary>
    /// The reason of the first Cancel call (diagnostics only). Later cancels
    /// still propagate but do not overwrite the original reason.
    /// </summary>
    public string? CancelReason => Volatile.Read(ref _cancelReason);

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
        Interlocked.CompareExchange(
            ref _cancelReason,
            string.IsNullOrWhiteSpace(reason) ? "cancelled" : reason,
            null);
        try
        {
            _cancellation.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // Run state already disposed (e.g. a parent cancel callback fired
            // after the child run finalized); nothing left to cancel.
        }
    }

    public void RequestStop(string reason)
    {
        StopReason = string.IsNullOrWhiteSpace(reason) ? "completed" : reason;
        Interlocked.Exchange(ref _stopRequested, 1);
    }

    /// <summary>
    /// 记录本次 run 的结束原因，仅在尚未设置时写入（iter-31 S-53）。
    ///
    /// AgentLoop 的循环退出之后才算得出真实原因（正常跑完 / 撞轮次上限），此前它只把
    /// 这个原因喂给了 loop_end 事件、没有落到 state 上 —— 于是 SubAgentExecutor 上报的
    /// StopReason 永远是 null，UI 里「被掐断的 run」和「干完的 run」长得一模一样。
    /// </summary>
    internal void RecordStopReason(string reason)
    {
        StopReason ??= string.IsNullOrWhiteSpace(reason) ? "completed" : reason;
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

using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Process-wide FIFO limiter for sub-agent executions. Capacity is configured by
/// the worker run/configuration boundary; individual acquisitions only obtain a
/// lease and cannot rewrite the shared capacity.
/// </summary>
internal static class SubAgentConcurrencyLimiter
{
    private static readonly object Sync = new();
    private static FifoLimiter _limiter = new(1);

    public static void Configure(int maxConcurrentSubAgents)
    {
        var normalized = Math.Max(1, maxConcurrentSubAgents);
        lock (Sync)
        {
            _limiter.SetLimit(normalized);
        }
    }

    /// <summary>
    /// Acquires a concurrency lease. <paramref name="onQueued"/> is invoked exactly once
    /// — before the lease is handed out — when the caller has to wait in the FIFO queue,
    /// which is how a caller learns that its sub-agent is queued rather than running.
    /// <paramref name="onQueued"/> is an observation channel: if it throws, the failure is
    /// logged and swallowed so it can never leak the lease it was announced for.
    /// </summary>
    public static async ValueTask<IDisposable> AcquireAsync(
        CancellationToken cancellationToken,
        Func<Task>? onQueued = null)
    {
        ValueTask<IDisposable> pending;
        bool queued;
        lock (Sync)
        {
            (pending, queued) = _limiter.AcquireWithFlag(cancellationToken);
        }

        // Awaited OUTSIDE the lock (the callback writes to the event stream) and BEFORE the
        // lease is awaited: the "queued" notification must reach the UI ahead of the
        // "started" one that the caller emits once this call returns.
        //
        // A throwing callback must NOT escape: the waiter is already enqueued, so bailing out
        // here would leave `pending` unawaited while Pump() still hands its waiter a lease
        // that nobody disposes — the slot would be lost for the rest of the process. The
        // notification is an observation channel, so a failure is logged and swallowed.
        if (queued && onQueued is not null)
        {
            try
            {
                await onQueued();
            }
            catch (Exception ex)
            {
                WorkerLog.Warn(
                    $"sub-agent onQueued callback failed error={ex.GetType().Name}: {ex.Message}");
            }
        }

        return await pending;
    }

    private sealed class FifoLimiter
    {
        private readonly object _sync = new();
        private readonly Queue<Waiter> _queue = new();
        private int _max;
        private int _running;

        public FifoLimiter(int max)
        {
            _max = Math.Max(1, max);
        }

        public void SetLimit(int max)
        {
            lock (_sync)
            {
                _max = Math.Max(1, max);
            }
            Pump();
        }

        /// <summary>
        /// Same admission policy as before, but also reports whether the caller had to
        /// join the FIFO queue. "Is queued" and "is enqueued" are decided inside the same
        /// lock, so there is no window where a caller is told it is not queued and then
        /// ends up waiting anyway.
        /// </summary>
        public (ValueTask<IDisposable> Pending, bool Queued) AcquireWithFlag(
            CancellationToken cancellationToken)
        {
            lock (_sync)
            {
                if (cancellationToken.IsCancellationRequested)
                {
                    return (ValueTask.FromCanceled<IDisposable>(cancellationToken), false);
                }

                if (_running < _max && _queue.Count == 0)
                {
                    _running++;
                    return (ValueTask.FromResult<IDisposable>(new Releaser(this)), false);
                }

                var waiter = new Waiter(cancellationToken);
                _queue.Enqueue(waiter);
                waiter.Registration = cancellationToken.Register(
                    static state =>
                    {
                        var tuple = ((FifoLimiter Limiter, Waiter Waiter))state!;
                        tuple.Limiter.Cancel(tuple.Waiter);
                    },
                    (this, waiter));
                return (new ValueTask<IDisposable>(waiter.Completion.Task), true);
            }
        }

        private void Cancel(Waiter waiter)
        {
            lock (_sync)
            {
                if (waiter.Started || waiter.Completed)
                {
                    return;
                }

                waiter.Completed = true;
                Remove(waiter);
            }

            waiter.Completion.TrySetCanceled(waiter.CancellationToken);
            waiter.Registration.Dispose();
            Pump();
        }

        private void Release()
        {
            lock (_sync)
            {
                if (_running > 0)
                {
                    _running--;
                }
            }
            Pump();
        }

        private void Pump()
        {
            List<Waiter>? started = null;
            lock (_sync)
            {
                while (_running < _max && _queue.Count > 0)
                {
                    var waiter = _queue.Dequeue();
                    if (waiter.Completed)
                    {
                        continue;
                    }

                    waiter.Started = true;
                    waiter.Completed = true;
                    _running++;
                    started ??= [];
                    started.Add(waiter);
                }
            }

            if (started is null)
            {
                return;
            }

            foreach (var waiter in started)
            {
                waiter.Registration.Dispose();
                waiter.Completion.TrySetResult(new Releaser(this));
            }
        }

        private void Remove(Waiter target)
        {
            if (_queue.Count == 0)
            {
                return;
            }

            var retained = new Queue<Waiter>(_queue.Count);
            while (_queue.Count > 0)
            {
                var waiter = _queue.Dequeue();
                if (!ReferenceEquals(waiter, target))
                {
                    retained.Enqueue(waiter);
                }
            }

            while (retained.Count > 0)
            {
                _queue.Enqueue(retained.Dequeue());
            }
        }

        private sealed class Waiter(CancellationToken cancellationToken)
        {
            public CancellationToken CancellationToken { get; } = cancellationToken;
            public TaskCompletionSource<IDisposable> Completion { get; } =
                new(TaskCreationOptions.RunContinuationsAsynchronously);
            public CancellationTokenRegistration Registration { get; set; }
            public bool Started { get; set; }
            public bool Completed { get; set; }
        }

        private sealed class Releaser(FifoLimiter owner) : IDisposable
        {
            private FifoLimiter? _owner = owner;

            public void Dispose()
            {
                Interlocked.Exchange(ref _owner, null)?.Release();
            }
        }
    }
}

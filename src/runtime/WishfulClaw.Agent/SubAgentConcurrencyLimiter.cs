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

    public static ValueTask<IDisposable> AcquireAsync(CancellationToken cancellationToken)
    {
        lock (Sync)
        {
            return _limiter.AcquireAsync(cancellationToken);
        }
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

        public ValueTask<IDisposable> AcquireAsync(CancellationToken cancellationToken)
        {
            ValueTask<IDisposable> result;

            lock (_sync)
            {
                if (cancellationToken.IsCancellationRequested)
                {
                    result = ValueTask.FromCanceled<IDisposable>(cancellationToken);
                }
                else if (_running < _max && _queue.Count == 0)
                {
                    _running++;
                    result = ValueTask.FromResult<IDisposable>(new Releaser(this));
                }
                else
                {
                    var waiter = new Waiter(cancellationToken);
                    _queue.Enqueue(waiter);
                    waiter.Registration = cancellationToken.Register(
                        static state =>
                        {
                            var tuple = ((FifoLimiter Limiter, Waiter Waiter))state!;
                            tuple.Limiter.Cancel(tuple.Waiter);
                        },
                        (this, waiter));
                    result = new ValueTask<IDisposable>(waiter.Completion.Task);
                }
            }

            return result;
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

using WishfulClaw.Agent;

namespace WishfulClaw.GoalRegressionTests;

internal static partial class Program
{
    private static async Task RunSubAgentConcurrencySuiteAsync()
    {
        SubAgentConcurrencyLimiter.Configure(2);
        var queuedNotifications = new List<int>();
        var first = await AcquireSubAgentAsync(queuedNotifications: queuedNotifications);
        var second = await AcquireSubAgentAsync(queuedNotifications: queuedNotifications);
        Assert(queuedNotifications.Count == 0,
            "sub-agent limiter does not report queued while a slot is free");
        var queuedOrder = new List<int>();
        var gates = new[]
        {
            NewGate(),
            NewGate(),
            NewGate()
        };

        var waiters = new[]
        {
            QueueWaiterAsync(1, queuedOrder, gates[0].Task, queuedNotifications),
            QueueWaiterAsync(2, queuedOrder, gates[1].Task, queuedNotifications),
            QueueWaiterAsync(3, queuedOrder, gates[2].Task, queuedNotifications)
        };

        await Task.Delay(25);
        Assert(queuedOrder.Count == 0,
            "sub-agent limiter queues work after global capacity is full");
        AssertEqual(3, queuedNotifications.Count,
            "sub-agent limiter reports queued exactly once per queued waiter");

        SubAgentConcurrencyLimiter.Configure(1);
        first.Dispose();
        await Task.Delay(25);
        Assert(queuedOrder.Count == 0,
            "lowering global capacity does not preempt existing leases or over-admit queued work");

        second.Dispose();
        await WaitForCountAsync(queuedOrder, 1);
        AssertEqual(1, queuedOrder[0], "sub-agent limiter preserves FIFO order after capacity reduction");

        using var cancellation = new CancellationTokenSource();
        var cancelledNotifications = new List<int>();
        var cancelled = AcquireSubAgentAsync(cancellation.Token, cancelledNotifications);
        cancellation.Cancel();
        await AssertCanceledAsync(cancelled);
        AssertEqual(1, cancelledNotifications.Count,
            "a waiter that joined the queue reports queued before it is cancelled");

        SubAgentConcurrencyLimiter.Configure(2);
        await WaitForCountAsync(queuedOrder, 2);
        AssertEqual(2, queuedOrder[1], "raising global capacity pumps the next FIFO waiter");

        gates[0].SetResult(true);
        await WaitForCountAsync(queuedOrder, 3);
        AssertEqual(3, queuedOrder[2], "released lease admits the remaining FIFO waiter");

        gates[1].SetResult(true);
        gates[2].SetResult(true);
        await Task.WhenAll(waiters);
        AssertEqual(3, queuedOrder.Count, "sub-agent limiter releases every queued waiter");

        await AssertQueuedPrecedesLeaseAsync();
    }

    // S-178 ordering contract: the queued notification must complete BEFORE the lease is
    // delivered, because the executor only emits sub_agent_start once AcquireAsync returns.
    // If this ever flips, the queued card would be built after start and stay stuck queued.
    private static async Task AssertQueuedPrecedesLeaseAsync()
    {
        SubAgentConcurrencyLimiter.Configure(1);
        var holder = await AcquireSubAgentAsync();
        var order = new List<string>();

        var waiter = Task.Run(async () =>
        {
            using var lease = await SubAgentConcurrencyLimiter.AcquireAsync(
                CancellationToken.None,
                onQueued: () =>
                {
                    lock (order)
                    {
                        order.Add("queued");
                    }

                    return Task.CompletedTask;
                });
            lock (order)
            {
                order.Add("lease");
            }
        });

        await WaitForCountAsync(order, 1);
        AssertEqual("queued", order[0], "onQueued fires while the caller is still waiting for a slot");

        holder.Dispose();
        await waiter;
        AssertEqual(2, order.Count, "the lease is delivered only once the queue is drained");
        AssertEqual("lease", order[1], "lease delivery follows the queued notification");

        // A token that is already cancelled never joins the queue, so it reports nothing.
        using var preCancelled = new CancellationTokenSource();
        preCancelled.Cancel();
        var preNotifications = new List<int>();
        var preCancelledTask = AcquireSubAgentAsync(preCancelled.Token, preNotifications);
        await AssertCanceledAsync(preCancelledTask);
        Assert(preNotifications.Count == 0, "a pre-cancelled acquire never reports queued");

        SubAgentConcurrencyLimiter.Configure(2);
    }

    private static async Task<IDisposable> AcquireSubAgentAsync(
        CancellationToken cancellationToken = default,
        List<int>? queuedNotifications = null)
    {
        return await SubAgentConcurrencyLimiter.AcquireAsync(
            cancellationToken,
            onQueued: queuedNotifications is null
                ? null
                : () =>
                {
                    lock (queuedNotifications)
                    {
                        queuedNotifications.Add(1);
                    }

                    return Task.CompletedTask;
                });
    }

    private static async Task QueueWaiterAsync(
        int id,
        List<int> order,
        Task releaseSignal,
        List<int> queuedNotifications)
    {
        using var lease = await AcquireSubAgentAsync(queuedNotifications: queuedNotifications);
        lock (order)
        {
            order.Add(id);
        }
        await releaseSignal;
    }

    private static TaskCompletionSource<bool> NewGate()
        => new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static async Task WaitForCountAsync<T>(List<T> values, int count)
    {
        for (var attempt = 0; attempt < 100; attempt++)
        {
            lock (values)
            {
                if (values.Count >= count) return;
            }
            await Task.Delay(5);
        }
        throw new InvalidOperationException($"timed out waiting for {count} limiter waiter(s)");
    }

    private static async Task AssertCanceledAsync(Task<IDisposable> task)
    {
        try
        {
            await task;
        }
        catch (OperationCanceledException)
        {
            return;
        }

        throw new InvalidOperationException("expected cancelled sub-agent waiter");
    }
}

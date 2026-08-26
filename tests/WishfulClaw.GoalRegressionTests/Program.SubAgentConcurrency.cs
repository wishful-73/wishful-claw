using WishfulClaw.Agent;

namespace WishfulClaw.GoalRegressionTests;

internal static partial class Program
{
    private static async Task RunSubAgentConcurrencySuiteAsync()
    {
        SubAgentConcurrencyLimiter.Configure(2);
        var first = await AcquireSubAgentAsync();
        var second = await AcquireSubAgentAsync();
        var queuedOrder = new List<int>();
        var gates = new[]
        {
            NewGate(),
            NewGate(),
            NewGate()
        };

        var waiters = new[]
        {
            QueueWaiterAsync(1, queuedOrder, gates[0].Task),
            QueueWaiterAsync(2, queuedOrder, gates[1].Task),
            QueueWaiterAsync(3, queuedOrder, gates[2].Task)
        };

        await Task.Delay(25);
        Assert(queuedOrder.Count == 0,
            "sub-agent limiter queues work after global capacity is full");

        SubAgentConcurrencyLimiter.Configure(1);
        first.Dispose();
        await Task.Delay(25);
        Assert(queuedOrder.Count == 0,
            "lowering global capacity does not preempt existing leases or over-admit queued work");

        second.Dispose();
        await WaitForCountAsync(queuedOrder, 1);
        AssertEqual(1, queuedOrder[0], "sub-agent limiter preserves FIFO order after capacity reduction");

        using var cancellation = new CancellationTokenSource();
        var cancelled = AcquireSubAgentAsync(cancellation.Token);
        cancellation.Cancel();
        await AssertCanceledAsync(cancelled);
        Assert(true, "sub-agent limiter removes cancelled waiter");

        SubAgentConcurrencyLimiter.Configure(2);
        await WaitForCountAsync(queuedOrder, 2);
        AssertEqual(2, queuedOrder[1], "raising global capacity pumps the next FIFO waiter");

        gates[0].SetResult(true);
        await WaitForCountAsync(queuedOrder, 3);
        AssertEqual(3, queuedOrder[2], "released lease admits the remaining FIFO waiter");

        gates[1].SetResult(true);
        gates[2].SetResult(true);
        await Task.WhenAll(waiters);
        Assert(true, "sub-agent limiter releases every queued waiter");
    }

    private static async Task<IDisposable> AcquireSubAgentAsync(
        CancellationToken cancellationToken = default)
    {
        return await SubAgentConcurrencyLimiter.AcquireAsync(cancellationToken);
    }

    private static async Task QueueWaiterAsync(
        int id,
        List<int> order,
        Task releaseSignal)
    {
        using var lease = await AcquireSubAgentAsync();
        lock (order)
        {
            order.Add(id);
        }
        await releaseSignal;
    }

    private static TaskCompletionSource<bool> NewGate()
        => new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static async Task WaitForCountAsync(List<int> values, int count)
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

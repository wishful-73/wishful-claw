// =============================================================================
// CodeGraphIndexLock — the in-process write serializer for a project's engine
// (reference/04 §14; analysis/05 §6.3 + risk §5.7).
//
// A SemaphoreSlim(1,1) replaces CodeGraph's in-process async `Mutex`: it serializes
// indexAll / indexFiles / sync so two write passes never overlap WITHIN the worker.
// In the OpenCowork embedding the sidecar daemon is the SOLE writer of the graph DB
// (git hooks and a second CLI are dropped, analysis/05 §6.2/§8.2), so the
// cross-process PID FileLock is deferred — this semaphore is sufficient. Add the
// full FileLock only if external writers are ever confirmed.
//
// AcquireAsync/Acquire hand back an IDisposable whose Dispose releases exactly once
// (Interlocked-guarded), so `using` scopes are safe even on the exception path.
// =============================================================================
internal sealed class CodeGraphIndexLock : IDisposable
{
    private readonly SemaphoreSlim semaphore = new(1, 1);

    // Await the lock, honoring cancellation. The returned handle releases on Dispose.
    public async Task<IDisposable> AcquireAsync(CancellationToken cancellationToken = default)
    {
        await semaphore.WaitAsync(cancellationToken).ConfigureAwait(false);
        return new Releaser(semaphore);
    }

    // Block for the lock (the synchronous entry). The returned handle releases on
    // Dispose.
    public IDisposable Acquire()
    {
        semaphore.Wait();
        return new Releaser(semaphore);
    }

    // True while a write pass holds the lock — the `isIndexing()` signal.
    public bool IsHeld => semaphore.CurrentCount == 0;

    public void Dispose() => semaphore.Dispose();

    private sealed class Releaser : IDisposable
    {
        private SemaphoreSlim? semaphore;

        public Releaser(SemaphoreSlim semaphore) => this.semaphore = semaphore;

        public void Dispose()
        {
            // Release at most once even if the handle is disposed twice.
            var owned = Interlocked.Exchange(ref semaphore, null);
            owned?.Release();
        }
    }
}

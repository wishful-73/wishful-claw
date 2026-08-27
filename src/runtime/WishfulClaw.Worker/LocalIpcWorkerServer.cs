using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Pipes;
using System.Net.Sockets;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Worker;

/// <summary>
/// IPC server that accepts connections via named pipe (Windows) or Unix domain socket (macOS/Linux),
/// reads MessagePack frames, and dispatches them to the <see cref="WorkerDispatcher"/>.
/// </summary>
public sealed class LocalIpcWorkerServer
{
    private static readonly TimeSpan FirstClientAcceptTimeout = TimeSpan.FromMinutes(2);
    private static readonly int MaxConcurrentRequests = WorkerIpcHelpers.ReadLimit(
        "WISHFUL_CLAW_MAX_CONCURRENT_REQUESTS",
        defaultValue: Math.Clamp(Environment.ProcessorCount, 4, 12),
        minimum: 1,
        maximum: 64);
    private static readonly int MaxOutstandingRequests = WorkerIpcHelpers.ReadLimit(
        "WISHFUL_CLAW_MAX_OUTSTANDING_REQUESTS",
        defaultValue: 128,
        minimum: MaxConcurrentRequests,
        maximum: 4096);

    private readonly WorkerDispatcher _dispatcher;
    private readonly WorkerEndpoint _endpoint;

    public LocalIpcWorkerServer(WorkerDispatcher dispatcher, WorkerEndpoint endpoint)
    {
        _dispatcher = dispatcher;
        _endpoint = endpoint;
    }

    public Task RunAsync(CancellationToken cancellationToken = default)
    {
        return OperatingSystem.IsWindows()
            ? RunNamedPipeAsync(cancellationToken)
            : RunUnixSocketAsync(cancellationToken);
    }

    // ── Transport: Named Pipe (Windows) ──

    private async Task RunNamedPipeAsync(CancellationToken cancellationToken)
    {
        var pipeName = _endpoint.Address.StartsWith(@"\\.\pipe\", StringComparison.OrdinalIgnoreCase)
            ? _endpoint.Address[@"\\.\pipe\".Length..]
            : _endpoint.Address;

        WorkerLog.Info(
            $"server listening transport=named-pipe debug={WorkerLog.DebugEnabled} " +
            $"slowRequestMs={WorkerLog.SlowRequestMs}");

        while (true)
        {
            await using var pipe = new NamedPipeServerStream(
                pipeName,
                PipeDirection.InOut,
                maxNumberOfServerInstances: 1,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous);

            using var acceptCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            acceptCts.CancelAfter(FirstClientAcceptTimeout);
            try
            {
                await pipe.WaitForConnectionAsync(acceptCts.Token);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                WorkerLog.Warn("no client connected before the accept deadline; exiting");
                return;
            }

            WorkerLog.Debug("client connected transport=named-pipe");
            bool sawTraffic;
            try
            {
                sawTraffic = await HandleClientAsync(pipe, cancellationToken);
            }
            catch (Exception ex)
            {
                WorkerLog.Error($"HandleClientAsync crashed (named-pipe) error={ex.GetType().Name}: {ex.Message}");
                sawTraffic = true;
            }
            if (sawTraffic)
            {
                WorkerLog.Info("client disconnected transport=named-pipe; exiting so the supervisor owns respawn");
                return;
            }

            WorkerLog.Debug("client disconnected before any frame transport=named-pipe; awaiting replacement");
        }
    }

    // ── Transport: Unix Domain Socket (macOS/Linux) ──

    private async Task RunUnixSocketAsync(CancellationToken cancellationToken)
    {
        WorkerIpcHelpers.TryDeleteSocketFile(_endpoint.Address);

        using var listener = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        listener.Bind(new UnixDomainSocketEndPoint(_endpoint.Address));
        listener.Listen(backlog: 1);
        WorkerLog.Info(
            $"server listening transport=unix-domain-socket debug={WorkerLog.DebugEnabled} " +
            $"slowRequestMs={WorkerLog.SlowRequestMs}");

        try
        {
            while (true)
            {
                using var acceptCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                acceptCts.CancelAfter(FirstClientAcceptTimeout);
                Socket client;
                try
                {
                    client = await listener.AcceptAsync(acceptCts.Token);
                }
                catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                {
                    WorkerLog.Warn("no client connected before the accept deadline; exiting");
                    return;
                }

                WorkerLog.Debug("client connected transport=unix-domain-socket");
                bool sawTraffic;
                using (client)
                {
                    await using var stream = new NetworkStream(client, ownsSocket: true);
                    try
                    {
                        sawTraffic = await HandleClientAsync(stream, cancellationToken);
                    }
                    catch (Exception ex)
                    {
                        WorkerLog.Error($"HandleClientAsync crashed (unix-socket) error={ex.GetType().Name}: {ex.Message}");
                        sawTraffic = true;
                    }
                }

                if (sawTraffic)
                {
                    WorkerLog.Info("client disconnected transport=unix-domain-socket; exiting so the supervisor owns respawn");
                    return;
                }

                WorkerLog.Debug("client disconnected before any frame transport=unix-domain-socket; awaiting replacement");
            }
        }
        finally
        {
            WorkerIpcHelpers.TryDeleteSocketFile(_endpoint.Address);
        }
    }

    // ── Client handling ──

    private async Task<bool> HandleClientAsync(Stream stream, CancellationToken cancellationToken)
    {
        using var clientCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        using var writeLock = new SemaphoreSlim(1, 1);
        using var dispatchSlots = new SemaphoreSlim(MaxConcurrentRequests, MaxConcurrentRequests);
        var activeRequests = new ConcurrentDictionary<string, CancellationTokenSource>(StringComparer.Ordinal);
        var dispatchTasks = new ConcurrentDictionary<Task, byte>();
        var sawTraffic = false;
        var outstandingRequests = 0;

        try
        {
            while (!clientCts.IsCancellationRequested)
            {
                var frame = await MessagePackFrameProtocol.ReadFrameAsync(stream, clientCts.Token);
                if (frame is null)
                {
                    break;
                }

                sawTraffic = true;
                ParsedWorkerRequest request;
                try
                {
                    request = ParsedWorkerRequest.Parse(frame);
                }
                catch (Exception ex)
                {
                    var invalidResponse = MessagePackFrameProtocol.EncodeResponse(
                        WorkerResponse.Error($"Invalid worker request: {ex.Message}"),
                        id: null);
                    await WorkerIpcHelpers.WritePayloadAsync(stream, writeLock, invalidResponse, clientCts.Token);
                    continue;
                }

                if (string.Equals(request.Method, "worker/cancel", StringComparison.Ordinal))
                {
                    WorkerIpcHelpers.CancelRequest(request.Parameters, activeRequests);
                    request.Dispose();
                    continue;
                }

                if (Interlocked.Increment(ref outstandingRequests) > MaxOutstandingRequests)
                {
                    Interlocked.Decrement(ref outstandingRequests);
                    var busyResponse = MessagePackFrameProtocol.EncodeResponse(
                        WorkerResponse.Error(
                            $"Worker request quota exceeded ({MaxOutstandingRequests} outstanding requests)."),
                        request.Id);
                    request.Dispose();
                    await WorkerIpcHelpers.WritePayloadAsync(stream, writeLock, busyResponse, clientCts.Token);
                    continue;
                }

                var requestCts = CancellationTokenSource.CreateLinkedTokenSource(clientCts.Token);
                var requestKey = WorkerIpcHelpers.FormatRequestKey(request.Id);
                if (requestKey is not null && !activeRequests.TryAdd(requestKey, requestCts))
                {
                    Interlocked.Decrement(ref outstandingRequests);
                    requestCts.Dispose();
                    var duplicateResponse = MessagePackFrameProtocol.EncodeResponse(
                        WorkerResponse.Error("Duplicate worker request id."),
                        request.Id);
                    request.Dispose();
                    await WorkerIpcHelpers.WritePayloadAsync(stream, writeLock, duplicateResponse, clientCts.Token);
                    continue;
                }

                var task = Task.Run(
                    async () =>
                    {
                        var slotAcquired = false;
                        try
                        {
                            await dispatchSlots.WaitAsync(requestCts.Token);
                            slotAcquired = true;
                            await HandleRequestAsync(
                                stream,
                                writeLock,
                                request,
                                requestCts.Token,
                                clientCts.Token);
                        }
                        catch (Exception ex)
                        {
                            WorkerLog.Warn(
                                $"request task stopped method={request.Method} " +
                                $"error={ex.GetType().Name}: {ex.Message}");
                        }
                        finally
                        {
                            if (slotAcquired)
                            {
                                dispatchSlots.Release();
                            }
                            if (requestKey is not null)
                            {
                                activeRequests.TryRemove(
                                    new KeyValuePair<string, CancellationTokenSource>(requestKey, requestCts));
                            }
                            requestCts.Dispose();
                            request.Dispose();
                            Interlocked.Decrement(ref outstandingRequests);
                        }
                    },
                    CancellationToken.None);
                dispatchTasks.TryAdd(task, 0);
                _ = task.ContinueWith(
                    completed => dispatchTasks.TryRemove(completed, out _),
                    CancellationToken.None,
                    TaskContinuationOptions.ExecuteSynchronously,
                    TaskScheduler.Default);
            }
        }
        finally
        {
            await clientCts.CancelAsync();
            foreach (var activeRequest in activeRequests.Values)
            {
                activeRequest.Cancel();
            }
            try
            {
                // Drain with snapshots: dispatch tasks may still be added while
                // we wait (reads raced with the accept loop), so keep waiting
                // until the dictionary is empty.
                while (!dispatchTasks.IsEmpty)
                {
                    var pending = dispatchTasks.Keys.ToArray();
                    if (pending.Length == 0) break;
                    await Task.WhenAll(pending);
                }
            }
            catch (Exception ex)
            {
                WorkerLog.Warn($"request task stopped after client disconnect error={ex.GetType().Name}: {ex.Message}");
            }
        }

        return sawTraffic;
    }

    private async Task HandleRequestAsync(
        Stream stream,
        SemaphoreSlim writeLock,
        ParsedWorkerRequest request,
        CancellationToken requestCancellationToken,
        CancellationToken connectionCancellationToken)
    {
        var response = await DispatchRequestAsync(
            request,
            (eventName, writeParameters, eventCancellationToken) =>
                WorkerIpcHelpers.WriteEventFrameAsync(stream, writeLock, eventName, writeParameters, eventCancellationToken),
            (messagePackEvent, eventCancellationToken) =>
                WorkerIpcHelpers.WriteMessagePackEventFrameAsync(stream, writeLock, messagePackEvent, eventCancellationToken),
            requestCancellationToken,
            connectionCancellationToken);
        await WorkerIpcHelpers.WritePayloadAsync(stream, writeLock, response, connectionCancellationToken);
    }

    private async Task<byte[]> DispatchRequestAsync(
        ParsedWorkerRequest request,
        Func<string, Action<Utf8JsonWriter>, CancellationToken, ValueTask> emitEventAsync,
        Func<WorkerMessagePackEvent, CancellationToken, ValueTask> emitMessagePackEventAsync,
        CancellationToken requestCancellationToken,
        CancellationToken connectionCancellationToken)
    {
        var startedAt = Stopwatch.GetTimestamp();
        var id = request.Id;
        var method = request.Method;

        try
        {
            var context = new WorkerRequestContext(
                emitEventAsync,
                emitMessagePackEventAsync,
                requestCancellationToken,
                connectionCancellationToken);
            var response = await _dispatcher.DispatchAsync(method, request.Parameters, context);
            var encoded = MessagePackFrameProtocol.EncodeResponse(response, id);
            WorkerLog.RequestCompleted(
                method,
                WorkerIpcHelpers.FormatRequestId(id),
                WorkerIpcHelpers.GetElapsedMilliseconds(startedAt),
                request.FrameLength,
                encoded.Length,
                error: null);
            return encoded;
        }
        catch (Exception ex)
        {
            var errorMessage = ex is OperationCanceledException
                ? $"Worker request cancelled: {method}"
                : ex.Message;
            var encoded = MessagePackFrameProtocol.EncodeResponse(WorkerResponse.Error(errorMessage), id);
            WorkerLog.RequestCompleted(
                method,
                WorkerIpcHelpers.FormatRequestId(id),
                WorkerIpcHelpers.GetElapsedMilliseconds(startedAt),
                request.FrameLength,
                encoded.Length,
                ex);
            return encoded;
        }
    }
}

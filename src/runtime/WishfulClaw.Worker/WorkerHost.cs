using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Worker;

public sealed class WorkerHost
{
    private readonly LocalIpcWorkerServer server;

    /// <summary>
    /// Background module initialization (Goal recovery etc.). Never faults —
    /// per-module failures are logged at error level inside the builder.
    /// </summary>
    public Task ModuleInitialization { get; }

    internal WorkerHost(LocalIpcWorkerServer server, Task moduleInitialization)
    {
        this.server = server;
        ModuleInitialization = moduleInitialization;
    }

    public static WorkerHost CreateDefault(WorkerEndpoint endpoint)
    {
        return new WorkerHostBuilder()
            .UseEndpoint(endpoint)
            .UseDefaultModules()
            .Build();
    }

    public Task RunAsync(CancellationToken cancellationToken = default)
    {
        return server.RunAsync(cancellationToken);
    }
}

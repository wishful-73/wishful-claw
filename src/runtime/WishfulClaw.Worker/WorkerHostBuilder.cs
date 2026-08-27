using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Worker;

public sealed class WorkerHostBuilder
{
    private readonly List<IWorkerModule> modules = [];
    private readonly HashSet<string> moduleNames = new(StringComparer.Ordinal);
    private WorkerEndpoint? endpoint;

    public WorkerHostBuilder UseDefaultModules()
    {
        foreach (var module in WorkerModuleCatalog.Default)
        {
            AddModule(module);
        }
        return this;
    }

    public WorkerHostBuilder AddModule(IWorkerModule module)
    {
        if (!moduleNames.Add(module.Name))
        {
            throw new InvalidOperationException($"Duplicate worker module: {module.Name}");
        }

        modules.Add(module);
        return this;
    }

    public WorkerHostBuilder UseEndpoint(WorkerEndpoint workerEndpoint)
    {
        endpoint = workerEndpoint;
        return this;
    }

    public WorkerHost Build()
    {
        if (endpoint is null)
        {
            throw new InvalidOperationException("Native worker IPC endpoint is required.");
        }

        var dispatcher = new WorkerDispatcher();
        var context = new WorkerModuleContext(dispatcher);

        foreach (var module in modules)
        {
            module.Register(context);
        }

        // Initialize all modules in the background: modules that need startup
        // initialization (Goal recovery) run here. We deliberately do NOT block
        // the server on this — the main process verifies startup with a 10s
        // worker/ping and a slow recovery would deadlock spawn. Failures are
        // logged at error level and surfaced via WorkerHost.ModuleInitialization.
        var initTask = InitializeModulesAsync();

        return new WorkerHost(new LocalIpcWorkerServer(dispatcher, endpoint), initTask);
    }

    private async Task InitializeModulesAsync()
    {
        try
        {
            // Initialize DB first so modules can read from it
            DbClient.GetClient();
        }
        catch (Exception ex)
        {
            // Without the DB almost every module is broken — make this loud.
            WorkerLog.Error($"DB initialization for module init failed: {ex.Message}");
            return;
        }

        var failed = new List<string>();
        foreach (var module in modules)
        {
            try
            {
                await module.InitializeAsync();
            }
            catch (Exception ex)
            {
                // Keep running (a dead worker loses every module, not just the
                // failed one), but escalate to Error so startup damage is loud.
                failed.Add(module.Name);
                WorkerLog.Error($"Module {module.Name} InitializeAsync failed: {ex.GetType().Name}: {ex.Message}");
            }
        }

        if (failed.Count > 0)
        {
            WorkerLog.Error($"Worker module initialization finished with {failed.Count} failure(s): {string.Join(", ", failed)}");
        }
    }
}

using System.Text.Json;
using System.Threading.Tasks;
using WishfulClaw.Agent.Executors;
using WishfulClaw.Contracts;
using WishfulClaw.Agent;

namespace WishfulClaw.Agent.Modules;

/// <summary>
/// Registers the "web/fetch" Worker method so that the main process
/// (and renderer via IPC) can request URL fetches through the Worker.
/// Reuses <see cref="AgentRuntimeWebFetchExecutor"/> for the actual HTTP logic.
/// </summary>
public sealed class WebFetchModule : IWorkerModule
{
    public string Name => "webfetch";

    public void Register(IWorkerModuleContext context)
    {
        context.Register("web/fetch", async (JsonElement input, IWorkerRequestContext reqCtx) =>
        {
            // Build a synthetic tool call so we can reuse the existing executor.
            var call = new AgentRuntimeNativeToolCall(
                Id: "web-fetch",
                Name: "WebFetch",
                Input: input);

            var json = await AgentRuntimeWebFetchExecutor.ExecuteAsync(call, reqCtx.CancellationToken);
            return WorkerResponse.RawJson(json);
        });
    }
}

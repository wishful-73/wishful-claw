using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Handles explicit context compression requests from the renderer.
/// The endpoint is intentionally stateless: it returns the compressed wire
/// conversation to the caller. Session persistence and conversation replacement
/// are coordinated by the caller in the follow-up compression plan.
/// </summary>
public static class AgentRuntimeContextCompressionTools
{
    public static async Task<WorkerResponse> CompressAsync(
        JsonElement parameters,
        IWorkerRequestContext context)
    {
        var provider = AgentLoop.GetObject(parameters, "provider");
        if (provider.ValueKind != JsonValueKind.Object)
        {
            return WorkerResponse.Error("provider is required.");
        }

        var wireMessages = AgentLoop.ReadWireConversation(parameters);
        if (wireMessages.Count == 0)
        {
            return WorkerResponse.Json(
                new ContextCompressionResponse(
                    Messages: wireMessages,
                    Result: new ContextCompressionResult(false, 0, 0)),
                AgentRuntimeJsonContext.Default.ContextCompressionResponse);
        }

        var conversation = AgentLoop.ReadConversation(wireMessages);
        var originalCount = wireMessages.Count;

        try
        {
            var compression = await ContextCompression.CompactAsync(
                conversation,
                wireMessages,
                provider,
                context,
                context.CancellationToken);
            var compressedWireMessages = compression.wireConversation;

            if (compressedWireMessages.Count >= originalCount)
            {
                compressedWireMessages = ContextCompression.TruncateMessages(
                    conversation,
                    wireMessages,
                    provider).wireConversation;
            }

            var compressed = compressedWireMessages.Count < originalCount;
            WorkerLog.Info(
                $"manual context compression completed original={originalCount} " +
                $"new={compressedWireMessages.Count} compressed={compressed}");

            return WorkerResponse.Json(
                new ContextCompressionResponse(
                    Messages: compressedWireMessages,
                    Result: new ContextCompressionResult(
                        compressed,
                        originalCount,
                        compressedWireMessages.Count,
                        compressed ? Math.Max(0, originalCount - compressedWireMessages.Count) : null)),
                AgentRuntimeJsonContext.Default.ContextCompressionResponse);
        }
        catch (OperationCanceledException) when (context.CancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            WorkerLog.Warn(
                $"manual context compression failed error={ex.GetType().Name}: {ex.Message}");
            return WorkerResponse.Json(
                new ContextCompressionResponse(
                    Messages: wireMessages,
                    Result: new ContextCompressionResult(false, originalCount, originalCount, Error: ex.Message)),
                AgentRuntimeJsonContext.Default.ContextCompressionResponse);
        }
    }
}

public sealed record ContextCompressionResponse(
    List<JsonElement> Messages,
    ContextCompressionResult Result);

public sealed record ContextCompressionResult(
    bool Compressed,
    int OriginalCount,
    int NewCount,
    int? MessagesSummarized = null,
    string? Error = null);

using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

internal static partial class AgentLoop
{
    private enum LoopCompressionStatus
    {
        Compressed,
        Skipped,
        Failed,
        Cancelled
    }

    private sealed record LoopCompressionAttempt(
        LoopCompressionStatus Status,
        List<AgentRuntimeChatMessage>? Conversation = null,
        List<JsonElement>? WireConversation = null);

    private static async Task<LoopCompressionAttempt> TryCompressLoopConversationAsync(
        JsonElement provider,
        SessionConversation sessionConv,
        List<AgentRuntimeChatMessage> conversation,
        List<JsonElement> wireConversation,
        string sessionId,
        string conversationKey,
        int iteration,
        int preTokens,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        var compressionOperationId =
            $"{state.RunId}:compression:{iteration}:{wireConversation.Count}";
        await AgentRuntimeTools.EmitAsync(
            state, context,
            new AgentRuntimeStreamEvent(
                "context_compression_started",
                OperationId: compressionOperationId,
                Trigger: "auto",
                PreTokens: preTokens,
                OriginalCount: wireConversation.Count));

        if (state.IsCancellationRequested)
        {
            await AgentRuntimeTools.EmitAsync(
                state, context,
                new AgentRuntimeStreamEvent(
                    "context_compressed",
                    OperationId: compressionOperationId,
                    CompressionStatus: "cancelled",
                    Trigger: "auto",
                    PreTokens: preTokens,
                    CompressionError: "compression cancelled"));
            return new LoopCompressionAttempt(LoopCompressionStatus.Cancelled);
        }

        try
        {
            var originalCount = wireConversation.Count;
            var outcome = await ContextCompression.CompactAsync(
                conversation,
                wireConversation,
                provider,
                context,
                state.CancellationToken,
                text => new ValueTask(AgentRuntimeTools.EmitAsync(
                    state,
                    context,
                    new AgentRuntimeStreamEvent("context_compression_delta", Text: text))));
            var newConversation = outcome.Conversation;
            var newWireConversation = outcome.WireConversation;
            var summarizerFailed = outcome.SummarizerFailed;
            var messagesSummarized = outcome.MessagesSummarized;
            var compactArtifacts = ContextCompression.BuildCompactArtifacts(outcome, "auto", preTokens);
            if (newWireConversation.Count >= originalCount)
            {
                (newConversation, newWireConversation) = ContextCompression.TruncateMessages(
                    conversation, wireConversation, provider);
                summarizerFailed = true;
                messagesSummarized = 0;
                compactArtifacts = null;
            }

            if (newWireConversation.Count >= originalCount)
            {
                WorkerLog.Warn(
                    $"agent context compression made no progress runId={state.RunId} " +
                    $"count={originalCount} (LLM summary and truncation both skipped)");
                await AgentRuntimeTools.EmitAsync(
                    state, context,
                    new AgentRuntimeStreamEvent(
                        "context_compressed",
                        OperationId: compressionOperationId,
                        CompressionStatus: "skipped",
                        OriginalCount: originalCount,
                        NewCount: originalCount,
                        Trigger: "auto",
                        PreTokens: preTokens,
                        CompressionError: "nothing to compress"));
                return new LoopCompressionAttempt(LoopCompressionStatus.Skipped);
            }

            if (sessionId.Length > 0 && conversationKey == sessionId && compactArtifacts is not null)
            {
                var snapshotResult = ContextCompression.PersistSnapshot(
                    outcome, compactArtifacts, sessionId, "auto", preTokens);
                if (!snapshotResult.Success)
                {
                    await AgentRuntimeTools.EmitAsync(
                        state, context,
                        new AgentRuntimeStreamEvent(
                            "context_compressed",
                            OperationId: compressionOperationId,
                            CompressionStatus: "failed",
                            OriginalCount: originalCount,
                            NewCount: originalCount,
                            Trigger: "auto",
                            PreTokens: preTokens,
                            CompressionError: $"snapshot persistence failed: {snapshotResult.Error}"));
                    return new LoopCompressionAttempt(LoopCompressionStatus.Failed);
                }
            }

            sessionConv.Replace(newConversation, newWireConversation);
            sessionConv.MarkCompactionWatermark(newWireConversation.Count);
            conversation = sessionConv.GetConversation();
            wireConversation = sessionConv.GetWireConversation();
            await AgentRuntimeTools.EmitAsync(
                state, context,
                new AgentRuntimeStreamEvent(
                    "context_compressed",
                    OperationId: compressionOperationId,
                    CompressionStatus: "compressed",
                    OriginalCount: originalCount,
                    NewCount: newWireConversation.Count,
                    KeptMessageCount: Math.Max(0, originalCount - newWireConversation.Count),
                    Trigger: "auto",
                    PreTokens: preTokens,
                    EstimatedNewTokens: ContextCompression.EstimateMessagesTokens(newConversation),
                    SummarizerFailed: summarizerFailed,
                    MessagesSummarized: messagesSummarized > 0 ? messagesSummarized : null,
                    CompactArtifacts: compactArtifacts));
            WorkerLog.Info(
                $"agent context compression runId={state.RunId} " +
                $"original={originalCount} compressed={newWireConversation.Count} " +
                $"summarizerFailed={summarizerFailed}");
            return new LoopCompressionAttempt(
                LoopCompressionStatus.Compressed,
                conversation,
                wireConversation);
        }
        catch (OperationCanceledException) when (state.CancellationToken.IsCancellationRequested)
        {
            await AgentRuntimeTools.EmitAsync(
                state, context,
                new AgentRuntimeStreamEvent(
                    "context_compressed",
                    OperationId: compressionOperationId,
                    CompressionStatus: "cancelled",
                    Trigger: "auto",
                    PreTokens: preTokens,
                    CompressionError: "compression cancelled"));
            return new LoopCompressionAttempt(LoopCompressionStatus.Cancelled);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn(
                $"agent context compression failed runId={state.RunId} " +
                $"error={ex.GetType().Name}: {ex.Message}");
            await AgentRuntimeTools.EmitAsync(
                state, context,
                new AgentRuntimeStreamEvent(
                    "context_compressed",
                    OperationId: compressionOperationId,
                    CompressionStatus: "failed",
                    Trigger: "auto",
                    PreTokens: preTokens,
                    CompressionError: $"{ex.GetType().Name}: compression failed"));
            return new LoopCompressionAttempt(LoopCompressionStatus.Failed);
        }
    }
}

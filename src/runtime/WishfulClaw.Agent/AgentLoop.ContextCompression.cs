using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

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

    // Manual compression value floor: a manual press judges "is there enough
    // context to be worth an LLM summary", not the auto threshold. Derived from
    // the same effective-window × trigger tokens ShouldCompress uses — a quarter
    // of that trigger point — so the two token-count references cannot drift.
    internal const double ManualCompressionValueFloorFraction = 0.25;

    /// <summary>
    /// Minimum estimated pre-tokens for a manual compression to run. Below this
    /// floor (a quarter of the auto-compression trigger point on the same
    /// effective window) there is nothing an LLM summary can usefully fold —
    /// e.g. a cold-Worker restore that is already the previous compaction's
    /// product — and the request is answered "skipped".
    /// </summary>
    internal static int ManualCompressionValueFloorTokens(JsonElement provider, JsonElement parameters)
    {
        var contextLength = JsonHelpers.GetIntNullable(provider, "contextLength") ?? DefaultContextCompressionLimit;
        if (contextLength <= 0) return 0;
        var effectiveWindow = contextLength - DefaultContextCompressionReservedOutputTokens;
        if (effectiveWindow <= 0) return 0;
        var thresholdRatio = JsonHelpers.GetDoubleNullable(parameters, "contextCompressionThreshold") ?? DefaultContextCompressionThreshold;
        return (int)(effectiveWindow * thresholdRatio * ManualCompressionValueFloorFraction);
    }

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
        IWorkerRequestContext context,
        bool errorDriven)
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
            var expectedRevision = sessionId.Length > 0 && conversationKey == sessionId
                ? DbCompactionSnapshotStore.GetContextRevision(DbClient.GetClient(), sessionId)
                : null;
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
            // errorDriven (context-window overflow) must shrink at any cost —
            // truncation is the last resort before the run fails. Threshold-driven
            // compression with nothing foldable is a normal no-op, not a failure.
            if (newWireConversation.Count >= originalCount && (errorDriven || outcome.SummarizerFailed))
            {
                (newConversation, newWireConversation) = ContextCompression.TruncateMessages(
                    conversation, wireConversation, provider);
                summarizerFailed = true;
                messagesSummarized = 0;
                compactArtifacts = null;
            }

            if (newWireConversation.Count >= originalCount)
            {
                WorkerLog.Info(
                    $"agent context compression skipped runId={state.RunId} " +
                    $"count={originalCount} (nothing foldable)");
                // Mark the watermark through the current length so the loop does
                // not re-attempt compression every turn while tokens stay above
                // the threshold; new messages grow the count and reopen the gate.
                sessionConv.MarkCompactionWatermark(wireConversation.Count);
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
                    outcome, compactArtifacts, sessionId, "auto", preTokens, expectedRevision);
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

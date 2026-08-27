using System.Collections.Concurrent;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Handles explicit context compression requests from the renderer.
/// When a sessionId is supplied and the Worker still holds the session's
/// in-memory conversation, compression runs against that authoritative state
/// and replaces it on success — mirroring the automatic compression path in
/// the agent loop. Caller-supplied messages are only used as a fallback when
/// the Worker has no live conversation for the session (step 10 adds the
/// durable snapshot so a Worker restart can recover the compressed state).
/// </summary>
public static class AgentRuntimeContextCompressionTools
{
    // One manual compression per session at a time — mirrors the one-active-run
    // rule: CompactAsync + Replace must not interleave with another compaction
    // on the same SessionConversation.
    private static readonly ConcurrentDictionary<string, byte> ActiveCompressions = new(StringComparer.Ordinal);

    public static async Task<WorkerResponse> CompressAsync(
        JsonElement parameters,
        IWorkerRequestContext context)
    {
        var provider = AgentLoop.GetObject(parameters, "provider");
        if (provider.ValueKind != JsonValueKind.Object)
        {
            return WorkerResponse.Error("provider is required.");
        }

        var sessionId = JsonHelpers.GetString(parameters, "sessionId") ?? "";
        var trigger = string.Equals(JsonHelpers.GetString(parameters, "trigger"), "auto", StringComparison.Ordinal)
            ? "auto"
            : "manual";

        // Blocked: the session currently has an active agent run. Replacing the
        // conversation mid-run would corrupt the live loop's message lists.
        if (sessionId.Length > 0 && AgentRuntimeTools.HasActiveSessionRun(sessionId))
        {
            WorkerLog.Info(
                $"manual context compression blocked session={AgentLoop.FormatSessionId(sessionId)} " +
                "reason=active-run");
            return BuildResponse(
                [],
                new ContextCompressionResult(false, 0, 0, Status: "blocked", Trigger: trigger,
                    Error: "session has an active agent run"));
        }

        // Blocked: another manual compression for this session is already in flight.
        var compressionKey = sessionId.Length > 0 ? sessionId : "__stateless__";
        if (!ActiveCompressions.TryAdd(compressionKey, 0))
        {
            WorkerLog.Info(
                $"manual context compression blocked session={AgentLoop.FormatSessionId(sessionId)} " +
                "reason=already-compressing");
            return BuildResponse(
                [],
                new ContextCompressionResult(false, 0, 0, Status: "blocked", Trigger: trigger,
                    Error: "compression already in progress"));
        }

        try
        {
            // Prefer the Worker's authoritative in-memory conversation; the
            // caller's messages are only a fallback for sessions the Worker
            // has not restored yet.
            var sessionConv = sessionId.Length > 0 ? SessionConversationManager.TryGet(sessionId) : null;
            List<JsonElement> wireMessages;
            if (sessionConv is not null && sessionConv.MessageCount > 0)
            {
                wireMessages = [.. sessionConv.GetWireConversation()];
            }
            else
            {
                sessionConv = null; // stateless path — do not replace later
                wireMessages = AgentLoop.ReadWireConversation(parameters);
            }

            if (wireMessages.Count == 0)
            {
                return BuildResponse(
                    wireMessages,
                    new ContextCompressionResult(false, 0, 0, Status: "skipped", Trigger: trigger,
                        Error: "nothing to compress"));
            }

            var conversation = AgentLoop.ReadConversation(wireMessages);
            var originalCount = wireMessages.Count;

            try
            {
                var preTokens = ContextCompression.EstimateMessagesTokens(conversation);
                var outcome = await ContextCompression.CompactAsync(
                    conversation,
                    wireMessages,
                    provider,
                    context,
                    context.CancellationToken);
                var newConversation = outcome.Conversation;
                var newWireConversation = outcome.WireConversation;
                var summarizerFailed = outcome.SummarizerFailed;
                var compactArtifacts = ContextCompression.BuildCompactArtifacts(outcome, trigger, preTokens);

                if (newWireConversation.Count >= originalCount)
                {
                    // AL-6 equivalent: LLM summarization produced no reduction —
                    // fall back to mechanical truncation before giving up.
                    (newConversation, newWireConversation) = ContextCompression.TruncateMessages(
                        conversation, wireMessages, provider);
                    summarizerFailed = true;
                    compactArtifacts = null;
                }

                if (newWireConversation.Count >= originalCount)
                {
                    WorkerLog.Info(
                        $"manual context compression skipped session={AgentLoop.FormatSessionId(sessionId)} " +
                        $"count={originalCount} (nothing foldable)");
                    return BuildResponse(
                        wireMessages,
                        new ContextCompressionResult(false, originalCount, originalCount,
                            Status: "skipped", Trigger: trigger));
                }

                // Sync the Worker session so the next turn runs on the compressed
                // context — same as the automatic path's Replace in AgentLoop.
                sessionConv?.Replace(newConversation, newWireConversation);
                sessionConv?.MarkCompactionWatermark(newWireConversation.Count);
                // Persist the durable snapshot only when the Worker holds the
                // authoritative conversation; caller-supplied messages (stateless
                // path) may not match the persisted history the cursor covers.
                if (sessionConv is not null)
                {
                    ContextCompression.PersistSnapshot(outcome, sessionId, trigger, preTokens);
                }

                WorkerLog.Info(
                    $"manual context compression completed session={AgentLoop.FormatSessionId(sessionId)} " +
                    $"original={originalCount} new={newWireConversation.Count} summarizerFailed={summarizerFailed}");

                return BuildResponse(
                    newWireConversation,
                    new ContextCompressionResult(true, originalCount, newWireConversation.Count,
                        MessagesSummarized: outcome.MessagesSummarized > 0 ? outcome.MessagesSummarized : null,
                        Status: "compressed", Trigger: trigger,
                        SummarizerFailed: summarizerFailed ? true : null),
                    compactArtifacts);
            }
            catch (OperationCanceledException) when (context.CancellationToken.IsCancellationRequested)
            {
                WorkerLog.Info(
                    $"manual context compression cancelled session={AgentLoop.FormatSessionId(sessionId)}");
                return BuildResponse(
                    wireMessages,
                    new ContextCompressionResult(false, originalCount, originalCount,
                        Status: "cancelled", Trigger: trigger));
            }
            catch (Exception ex)
            {
                WorkerLog.Warn(
                    $"manual context compression failed session={AgentLoop.FormatSessionId(sessionId)} " +
                    $"error={ex.GetType().Name}: {ex.Message}");
                return BuildResponse(
                    wireMessages,
                    new ContextCompressionResult(false, originalCount, originalCount,
                        Status: "failed", Trigger: trigger, Error: ex.Message));
            }
        }
        finally
        {
            ActiveCompressions.TryRemove(compressionKey, out _);
        }
    }

    private static WorkerResponse BuildResponse(
        List<JsonElement> messages,
        ContextCompressionResult result,
        JsonElement[]? compactArtifacts = null)
    {
        return WorkerResponse.Json(
            new ContextCompressionResponse(messages, result,
                compactArtifacts is null ? null : [.. compactArtifacts]),
            AgentRuntimeJsonContext.Default.ContextCompressionResponse);
    }
}

public sealed record ContextCompressionResponse(
    List<JsonElement> Messages,
    ContextCompressionResult Result,
    List<JsonElement>? CompactArtifacts = null);

public sealed record ContextCompressionResult(
    bool Compressed,
    int OriginalCount,
    int NewCount,
    int? MessagesSummarized = null,
    string? Error = null,
    string? Status = null,
    string? Trigger = null,
    bool? SummarizerFailed = null);

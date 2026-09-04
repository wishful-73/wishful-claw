using System.Collections.Concurrent;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Handles explicit context compression requests from the renderer.
/// A sessionId always compresses the Worker's authoritative conversation. After a
/// restart that conversation is not in memory yet, so it is rebuilt here from the
/// DB first — the same lazy restore the agent loop performs on its first turn. This
/// keeps the compressed set identical to what the next run will actually send;
/// compressing the caller's transcript instead would fold a partial (paged) history
/// and, because the stateless path persists nothing, silently do nothing.
/// Caller-supplied messages are only used when no sessionId is given.
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
            // A session compresses the Worker's authoritative conversation — rebuilt
            // from the DB when this Worker is cold. The caller's transcript is only
            // the input for sessionless callers.
            SessionConversation? sessionConv;
            List<JsonElement> wireMessages;
            if (sessionId.Length > 0)
            {
                var (authoritative, restoreFailure) = EnsureAuthoritativeConversation(sessionId, parameters, trigger);
                if (restoreFailure is { } failure)
                {
                    return BuildResponse(
                        [],
                        new ContextCompressionResult(false, 0, 0, Status: "blocked", Trigger: trigger,
                            Reason: "restore_failed",
                            Error: $"session context could not be restored: {failure.Reason}"));
                }

                sessionConv = authoritative;
                wireMessages = sessionConv.MessageCount > 0
                    ? [.. sessionConv.GetWireConversation()]
                    : [];
            }
            else
            {
                sessionConv = null; // stateless path — nothing durable to replace or persist
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
                var expectedRevision = sessionId.Length > 0
                    ? DbCompactionSnapshotStore.GetContextRevision(DbClient.GetClient(), sessionId)
                    : null;
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

                // Re-check before Replace: the entry gate only covered the moment
                // the request arrived, and a new run can start while compression
                // is in flight. Replacing the conversation under a live loop would
                // orphan the messages it keeps appending to the old lists.
                if (sessionId.Length > 0 && AgentRuntimeTools.HasActiveSessionRun(sessionId))
                {
                    WorkerLog.Info(
                        $"manual context compression blocked session={AgentLoop.FormatSessionId(sessionId)} " +
                        "reason=run-started-during-compression");
                    return BuildResponse(
                        wireMessages,
                        new ContextCompressionResult(false, originalCount, originalCount,
                            Status: "blocked", Trigger: trigger,
                            Error: "an agent run started during compression"));
                }

                // Persist the durable snapshot only for the session path: a
                // sessionless caller's messages describe no persisted history, so
                // there is nothing for a snapshot to cover.
                // compactArtifacts == null marks the mechanical-truncation degrade,
                // whose outcome describes the pre-truncation conversation and must
                // never become the durable snapshot.
                if (sessionConv is not null && compactArtifacts is not null)
                {
                    var snapshotResult = ContextCompression.PersistSnapshot(
                        outcome, compactArtifacts, sessionId, trigger, preTokens, expectedRevision);
                    if (!snapshotResult.Success)
                    {
                        WorkerLog.Warn(
                            $"manual context compression failed session={AgentLoop.FormatSessionId(sessionId)} " +
                            $"reason=snapshot-persist error={snapshotResult.Error}");
                        return BuildResponse(
                            wireMessages,
                            new ContextCompressionResult(
                                false,
                                originalCount,
                                originalCount,
                                Status: "failed",
                                Trigger: trigger,
                                Error: $"snapshot persistence failed: {snapshotResult.Error}"));
                    }
                }

                // Sync the Worker session so the next turn runs on the compressed
                // context — same as the automatic path's Replace in AgentLoop.
                sessionConv?.Replace(newConversation, newWireConversation);
                sessionConv?.MarkCompactionWatermark(newWireConversation.Count);

                WorkerLog.Info(
                    $"manual context compression completed session={AgentLoop.FormatSessionId(sessionId)} " +
                    $"original={originalCount} new={newWireConversation.Count} summarizerFailed={summarizerFailed}");

                return BuildResponse(
                    newWireConversation,
                    new ContextCompressionResult(true, originalCount, newWireConversation.Count,
                        MessagesSummarized: outcome.MessagesSummarized > 0 ? outcome.MessagesSummarized : null,
                        Status: "compressed", Trigger: trigger,
                        SummarizerFailed: summarizerFailed ? true : null,
                        EstimatedPreTokens: preTokens,
                        EstimatedNewTokens: ContextCompression.EstimateMessagesTokens(newConversation)),
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

    /// <summary>
    /// The Worker's authoritative conversation for a session, rebuilt from the DB on a
    /// cold Worker exactly the way the agent loop rebuilds it before its first turn.
    /// A restore failure is reported instead of thrown so the caller can answer with a
    /// blocked status; the conversation is left untouched in that case.
    /// </summary>
    private static (SessionConversation Conversation, SessionRestoreFailure? Failure) EnsureAuthoritativeConversation(
        string sessionId,
        JsonElement parameters,
        string trigger)
    {
        var sessionConv = SessionConversationManager.GetOrCreate(sessionId);
        if (sessionConv.MessageCount > 0)
        {
            return (sessionConv, null);
        }

        DbClient.EnsureInitialized(parameters);
        var restored = SessionRestoreTools.RestoreFromDb(DbClient.GetClient(parameters), sessionId);
        if (restored.Failure is { } failure)
        {
            WorkerLog.Warn(
                $"manual context compression blocked session={AgentLoop.FormatSessionId(sessionId)} " +
                $"trigger={trigger} reason=restore-{failure.Reason} " +
                $"snapshot={failure.SnapshotId ?? "null"}");
            return (sessionConv, failure);
        }

        if (restored.WireMessages.Count > 0 &&
            sessionConv.InitializeIfEmpty(restored.WireMessages, restored.Conversation))
        {
            if (restored.FromSnapshot)
            {
                // Mirrors the restore endpoint: don't re-fold the restored summary
                // until new messages are appended beyond it.
                sessionConv.MarkCompactionWatermark(restored.WireMessages.Count);
            }
            WorkerLog.Info(
                $"manual context compression restored session={AgentLoop.FormatSessionId(sessionId)} " +
                $"trigger={trigger} source={(restored.FromSnapshot ? "snapshot" : "full")} " +
                $"messages={restored.WireMessages.Count}");
        }

        return (sessionConv, null);
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
    bool? SummarizerFailed = null,
    int? EstimatedPreTokens = null,
    int? EstimatedNewTokens = null,
    // Machine-readable blocker (e.g. "restore_failed") — the localized copy belongs
    // to the renderer, not this string.
    string? Reason = null);

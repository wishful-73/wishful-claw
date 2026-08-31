using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.Persona;

namespace WishfulClaw.Agent;

/// <summary>
/// Agent main loop. Each iteration = one provider turn.
/// Design fused from:
/// - KodaClaw: Step abstraction (iteration = model call + optional tool execution)
/// - WishfulClaw: SSE parsing, provider dispatch
/// - OpenClaw.net: TryInjectRecallAsync (iteration 7)
/// </summary>
internal static partial class AgentLoop
{
    private const double DefaultContextCompressionThreshold = 0.8;
    private const int DefaultContextCompressionReservedOutputTokens = 20_000;
    private const int DefaultContextCompressionLimit = 200_000;
    private const int ContextCompressionAutoBufferTokens = 13_000;

    /// <summary>
    /// Main execution loop. Called by AgentRuntimeTools.ExecuteRunAsync.
    /// </summary>
    public static async Task ExecuteLoopAsync(
        JsonElement parameters,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        var provider = GetObject(parameters, "provider");
        var providerType = JsonHelpers.GetString(provider, "type") ?? string.Empty;

        if (providerType is not ("openai-chat" or "anthropic" or "openai-responses"))
        {
            throw new InvalidOperationException(
                $"Provider type not supported yet: {providerType}. Supported: openai-chat, anthropic, openai-responses.");
        }

        ValidateProvider(provider);

        // -- Session conversation state (Reasonix pattern) --
        // Backend is the single source of truth for the conversation.
        // Frontend sends only the new user message each turn.
        // First turn (empty session): Initialize with the user message.
        // Subsequent turns: Append the new user message to the existing session.
        var sessionId = state.SessionId ?? "";
        // Sub-agent loops run with the parent's sessionId (for event routing),
        // but MUST NOT share the parent's SessionConversation: a background
        // sub-agent keeps running while the main conversation continues, and a
        // shared conversation would interleave both message streams (the main
        // agent's follow-up turns would execute inside the sub-agent and vice
        // versa). Isolate sub-agent conversations under their runId instead.
        var sessionModeForConv = JsonHelpers.GetString(parameters, "sessionMode");
        var isSubAgentLoop = string.Equals(sessionModeForConv, "subAgent", StringComparison.Ordinal);
        var isGoalSubAgentLoop = string.Equals(sessionModeForConv, "goalSubAgent", StringComparison.Ordinal);
        var goalContextId = JsonHelpers.GetString(parameters, "goalContextId");
        var conversationKey = isGoalSubAgentLoop && !string.IsNullOrWhiteSpace(goalContextId)
            ? $"__goal__{goalContextId}"
            : isSubAgentLoop ? $"__subagent__{state.RunId}" : sessionId;
        var sessionConv = SessionConversationManager.GetOrCreate(conversationKey);

        List<AgentRuntimeChatMessage> conversation;
        List<JsonElement> wireConversation;
        var lazilyRestored = false;

        if (sessionConv.MessageCount == 0)
        {
            // ── Lazy session restore ──
            // Entering a history session only renders the frontend, so the
            // backend conversation is rebuilt here on the first agent/run
            // instead of eagerly on session open. Only real sessions qualify:
            // the shared __default__ instance (empty sessionId) and the
            // __subagent__/__goal__ conversations have no DB history.
            if (sessionId.Length > 0 && conversationKey == sessionId)
            {
                DbClient.EnsureInitialized(parameters);
                var restored = SessionRestoreTools.RestoreFromDb(DbClient.GetClient(parameters), sessionId);
                if (restored.WireMessages.Count > 0 &&
                    sessionConv.InitializeIfEmpty(restored.WireMessages, restored.Conversation))
                {
                    if (restored.FromSnapshot)
                    {
                        // Mirrors the restore endpoint; the Append below resets the
                        // watermark to 0, after which the compression gate is driven
                        // by the seeded token estimate (known behavior, harmless).
                        sessionConv.MarkCompactionWatermark(restored.WireMessages.Count);
                    }
                    lazilyRestored = true;
                    WorkerLog.Info(
                        $"agent loop lazy-restore session={FormatSessionId(sessionId)} " +
                        $"source={(restored.FromSnapshot ? "snapshot" : "full")} " +
                        $"messages={restored.WireMessages.Count}");
                }
            }

            if (lazilyRestored || sessionConv.MessageCount > 0)
            {
                // Restored (or concurrently populated) history: append this
                // turn's new user message, same as a subsequent turn.
                var newWireMessages = ReadWireConversation(parameters);
                var newConversation = ReadConversation(newWireMessages);
                sessionConv.Append(newWireMessages, newConversation);
                conversation = sessionConv.GetConversation();
                wireConversation = sessionConv.GetWireConversation();
                WorkerLog.Debug(
                    $"agent loop append session={FormatSessionId(sessionId)} " +
                    $"existing={sessionConv.MessageCount - newWireMessages.Count} appended={newWireMessages.Count}");
            }
            else
            {
                // First turn (fresh session): initialize with the user message.
                wireConversation = ReadWireConversation(parameters);
                conversation = ReadConversation(wireConversation);
                sessionConv.Initialize(wireConversation, conversation);
                WorkerLog.Debug(
                    $"agent loop init session={FormatSessionId(sessionId)} " +
                    $"messages={wireConversation.Count}");
            }
        }
        else
        {
            // Subsequent turn: append the new user message.
            var newWireMessages = ReadWireConversation(parameters);
            var newConversation = ReadConversation(newWireMessages);
            sessionConv.Append(newWireMessages, newConversation);
            conversation = sessionConv.GetConversation();
            wireConversation = sessionConv.GetWireConversation();
            WorkerLog.Debug(
                $"agent loop append session={FormatSessionId(sessionId)} " +
                $"existing={sessionConv.MessageCount - newWireMessages.Count} appended={newWireMessages.Count}");
        }

        // Get live references from SessionConversation for the loop to use.
        conversation = sessionConv.GetConversation();
        wireConversation = sessionConv.GetWireConversation();
        var runtimeParameters = CreateRuntimeParametersWithoutMessages(parameters);
        var rawRunContext = AgentRunContextPolicy.Resolve(runtimeParameters);
        var rawSessionMode = AgentRunContextPolicy.ResolveAvailableMode(runtimeParameters, rawRunContext);
        runtimeParameters = NormalizeRuntimeParameters(runtimeParameters, rawRunContext, rawSessionMode);
        state.ReplaceParameters(runtimeParameters);
        parameters = runtimeParameters;
        provider = GetObject(parameters, "provider");

        // ── Resolve tool definitions from backend registry ──
        // Tools live in the backend (ToolModuleState.Registry); the frontend
        // sends only a toolPreset string. This avoids a JSON round-trip that
        // breaks prefix cache stability (Reasonix pattern: backend owns tools).
        var toolPresetId = JsonHelpers.GetString(parameters, "toolPreset") ?? "full";
        var toolPreset = ToolPreset.BuiltIn.TryGetValue(toolPresetId, out var tp)
            ? tp
            : ToolPreset.BuiltIn["full"];
        var runContext = AgentRunContextPolicy.Resolve(parameters);
        var sessionMode = AgentRunContextPolicy.ResolveAvailableMode(parameters, runContext);
        var registry = ToolModuleState.Registry;
        var toolDefs = registry?.GetToolDefinitions(toolPreset, sessionMode) ?? [];
        toolDefs = AgentRunContextPolicy.FilterToolDefinitions(toolDefs, registry, runContext);

        // Filter out WebSearch/WebFetch when web search is not enabled.
        // Previously done in the frontend; now handled backend-side since
        // tools are resolved from the backend registry.
        var webSearchEnabled = JsonHelpers.GetBool(parameters, "webSearchEnabled", true);
        if (!webSearchEnabled)
        {
            toolDefs = toolDefs
                .Where(t => t.Name != "WebSearch" && t.Name != "WebFetch")
                .ToList();
        }

        // CodeGraph is globally opt-in. Keep its static definition registered for
        // tool discovery, but expose it to the Agent only when the global plugin
        // state is enabled for this request.
        var codegraphEnabled = JsonHelpers.GetBool(parameters, "codegraphEnabled", false);
        if (!codegraphEnabled)
        {
            toolDefs = toolDefs
                .Where(t => !t.Name.StartsWith("codegraph_", StringComparison.Ordinal))
                .ToList();
        }
        // ── Persona-aware system prompt ──
        var personaId = JsonHelpers.GetString(parameters, "personaId");
        if (!string.IsNullOrWhiteSpace(personaId))
        {
            var workingFolder = JsonHelpers.GetString(parameters, "workingFolder");
            var language = JsonHelpers.GetString(parameters, "language");
            var userRules = JsonHelpers.GetString(parameters, "userRules");
            var sshConnectionId = JsonHelpers.GetString(parameters, "sshConnectionId");
            var projectId = JsonHelpers.GetString(parameters, "projectId");
            WorkerLog.Warn($"agent run sshConnectionId={sshConnectionId ?? "(null)"} personaId={personaId} projectId={projectId ?? "(null)"}");
            var cacheKey = SystemPromptCache.ComputeKey(personaId, workingFolder, language, userRules, sshConnectionId, projectId, sessionMode);
            // Session Todo guidance is for ordinary session agents; the global
            // agent host opts out (its dispatch model is defined elsewhere).
            var includeSessionTodoPrompt = sessionMode != "global";
            var builtPrompt = SystemPromptCache.GetOrBuild(cacheKey, () =>
                PromptBuilder.Build(
                    PromptProfile.Main, provider, parameters, personaId, workingFolder, language, userRules,
                    includeSessionTodoPrompt: includeSessionTodoPrompt));
            provider = InjectSystemPrompt(provider, builtPrompt);
            WorkerLog.Info($"persona system prompt (cached) id={personaId} length={builtPrompt.Length}");
        }

        // Inject timestamp + memory updates directly into the user message
        // stored in SessionConversation. This makes the timestamp part of the
        // permanent conversation history, so every turn sees the SAME bytes
        // for historical messages → prefix cache stable.
        // (Timestamp uses minute-level precision to stay stable within a turn.)
        InjectTransientPrefix(conversation, state);

        var requestedMaxIterations = JsonHelpers.GetInt(parameters, "maxIterations", 0); // 0 = unlimited
        var hasIterationLimit = requestedMaxIterations > 0;
        var providerTurnOnly = JsonHelpers.GetBool(parameters, "providerTurnOnly", false);
        var lastInputTokens = 0;
        if (lazilyRestored)
        {
            // Seed the token estimate so the iteration-1 compression gate can
            // fire before the first provider call: an oversized restored
            // context (snapshot + increment, or long full history) compresses
            // first, then the request goes out with the compressed context
            // plus the new user message. Without a restore the gate stays off
            // until the first provider response reports real input tokens.
            lastInputTokens = ContextCompression.EstimateMessagesTokens(conversation);
        }
        var completed = false;

        WorkerLog.Debug(
            $"agent loop start provider={providerType} " +
            $"maxIterations={(hasIterationLimit ? requestedMaxIterations.ToString() : "unlimited")} " +
            $"providerTurnOnly={providerTurnOnly}");

        for (var iteration = 1; !hasIterationLimit || iteration <= requestedMaxIterations; iteration++)
        {
            // ── Cancellation check ──
            if (state.IsCancellationRequested)
            {
                await EmitLoopEndAsync(state, context, "aborted");
                return;
            }

            if (state.IsStopRequested)
            {
                completed = true;
                break;
            }

            // ── Context compression (LLM summarization) ──
            if (lastInputTokens > 0 &&
                sessionConv.CompactionWatermark < wireConversation.Count &&
                ShouldCompress(lastInputTokens, provider, parameters))
            {
                var compressionOperationId =
                    $"{state.RunId}:compression:{iteration}:{wireConversation.Count}";
                await AgentRuntimeTools.EmitAsync(
                    state, context,
                    new AgentRuntimeStreamEvent(
                        "context_compression_started",
                        OperationId: compressionOperationId,
                        Trigger: "auto",
                        PreTokens: lastInputTokens,
                        OriginalCount: wireConversation.Count));

                if (state.IsCancellationRequested)
                {
                    await EmitLoopEndAsync(state, context, "aborted");
                    return;
                }

                try
                {
                    var originalCount = wireConversation.Count;
                    var outcome = await ContextCompression.CompactAsync(
                        conversation, wireConversation, provider, context, state.CancellationToken);
                    var newConversation = outcome.Conversation;
                    var newWireConversation = outcome.WireConversation;
                    var summarizerFailed = outcome.SummarizerFailed;
                    var messagesSummarized = outcome.MessagesSummarized;
                    var compactArtifacts = ContextCompression.BuildCompactArtifacts(outcome, "auto", lastInputTokens);
                    if (newWireConversation.Count >= originalCount)
                    {
                        // AL-6: LLM summarization produced no reduction (nothing to
                        // fold or skipped) — fall back to mechanical truncation so
                        // the loop can still free context instead of retrying at
                        // the same size every iteration.
                        (newConversation, newWireConversation) = ContextCompression.TruncateMessages(
                            conversation, wireConversation, provider);
                        // Truncation carries no summary — flag the degraded result so
                        // the UI never presents it as an LLM summary.
                        summarizerFailed = true;
                        messagesSummarized = 0;
                        compactArtifacts = null;
                    }
                    if (newWireConversation.Count < originalCount)
                    {
                        sessionConv.Replace(newConversation, newWireConversation);
                        sessionConv.MarkCompactionWatermark(newWireConversation.Count);
                        conversation = sessionConv.GetConversation();
                        wireConversation = sessionConv.GetWireConversation();
                        // Persist the durable snapshot for main sessions only — sub-agent
                        // loops share the parent's sessionId but run an isolated conversation.
                        // compactArtifacts == null marks the mechanical-truncation degrade,
                        // whose outcome describes the pre-truncation conversation and must
                        // never become the durable snapshot.
                        if (sessionId.Length > 0 && conversationKey == sessionId && compactArtifacts is not null)
                        {
                            ContextCompression.PersistSnapshot(outcome, sessionId, "auto", lastInputTokens);
                        }
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
                                PreTokens: lastInputTokens,
                                SummarizerFailed: summarizerFailed,
                                MessagesSummarized: messagesSummarized > 0 ? messagesSummarized : null,
                                CompactArtifacts: compactArtifacts));
                        WorkerLog.Info(
                            $"agent context compression runId={state.RunId} " +
                            $"original={originalCount} compressed={newWireConversation.Count} " +
                            $"summarizerFailed={summarizerFailed}");
                    }
                    else
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
                                PreTokens: lastInputTokens,
                                CompressionError: "nothing to compress"));
                    }
                    lastInputTokens = 0;
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
                            PreTokens: lastInputTokens,
                            CompressionError: "compression cancelled"));
                    throw;
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
                            PreTokens: lastInputTokens,
                            CompressionError: $"{ex.GetType().Name}: compression failed"));
                }
            }

            // ── Drain queued messages ──
            var injectedMessages = state.DrainQueuedMessages();
            if (injectedMessages.Count > 0)
            {
                wireConversation.AddRange(injectedMessages);
                conversation.AddRange(ReadConversation(injectedMessages));
                WorkerLog.Debug(
                    $"agent loop injected queued messages runId={state.RunId} count={injectedMessages.Count}");
            }

            // ── Iteration start ──
            await AgentRuntimeTools.EmitAsync(
                state, context,
                new AgentRuntimeStreamEvent("iteration_start", Iteration: iteration));

            if (state.IsCancellationRequested)
            {
                await EmitLoopEndAsync(state, context, "aborted");
                return;
            }

            // ── Memory recall injection (iteration 7) ──
            if (iteration == 1)
            {
                await TryInjectMemoryRecallAsync(parameters, conversation, sessionConv, state, context);
            }

            // ── Execute provider turn (with retry policy for 429/5xx) ──
            // Expose SessionConversation on state so providers can attach
            // session-cumulative cache counters to message_end events.
            state.SessionConversation = sessionConv;

            var turn = await ProviderRetryPolicy.ExecuteAsync(
                () => ExecuteTurnAsync(parameters, provider, conversation, toolDefs, state, context),
                state,
                context,
                provider);

            // Clear transient memory recall after first API call — subsequent
            // iterations within the same turn don't need it re-injected.
            state.PendingMemoryRecall = null;
            conversation.Add(turn.AssistantMessage);
            var assistantWireMessage = CreateAssistantWireMessage(turn.AssistantMessage, turn.Usage);
            wireConversation.Add(assistantWireMessage);

            if (turn.Usage?.ContextTokens is > 0)
            {
                lastInputTokens = turn.Usage.ContextTokens.Value;
            }


            // ── Emit text_phase if this turn has both text and tool calls ──
            // The text was streamed before tool execution — mark it as 'pre_tool'
            // so the UI can visually distinguish planning text from final conclusions.
            if (turn.ToolCalls.Count > 0 && !string.IsNullOrWhiteSpace(turn.AssistantMessage.Text))
            {
                await AgentRuntimeTools.EmitAsync(
                    state, context,
                    new AgentRuntimeStreamEvent("text_phase", Reason: "pre_tool"));
            }

            // ── Check for tool calls ──
            if (turn.ToolCalls.Count == 0)
            {
                await AgentRuntimeTools.EmitAsync(
                    state, context,
                    new AgentRuntimeStreamEvent("iteration_end", StopReason: turn.StopReason));

                if (!state.TryCloseMessageQueueIfEmpty())
                {
                    continue;
                }
                completed = true;
                break;
            }

            // Tool calls present — providerTurnOnly skips execution
            if (providerTurnOnly)
            {
                await AgentRuntimeTools.EmitAsync(
                    state, context,
                    new AgentRuntimeStreamEvent("iteration_end", StopReason: turn.StopReason));
                completed = true;
                break;
            }

            // ── Tool execution ──
            var toolResults = await ToolCallProcessor.ExecuteAsync(
                turn.ToolCalls, parameters, state, context);

            if (state.IsCancellationRequested)
            {
                await EmitLoopEndAsync(state, context, "aborted");
                return;
            }

            // Add tool results as a user message to the conversation
            var toolResultsMessage = AgentRuntimeChatMessage.UserToolResults(toolResults);
            conversation.Add(toolResultsMessage);
            wireConversation.Add(CreateToolResultsWireMessage(toolResults));

            await AgentRuntimeTools.EmitAsync(
                state, context,
                new AgentRuntimeStreamEvent(
                    "iteration_end",
                    StopReason: "tool_use",
                    ToolResults: toolResults.ToArray()));
        }

        await EmitLoopEndAsync(
            state, context,
            state.StopReason ?? (completed ? "completed" : "max_iterations"),
            conversation);
    }

    /// <summary>
    /// Emits the loop_end event and triggers a desktop notification
    /// to alert the user that the agent has finished working.
    /// Skipped for sub-agents (SuppressTransportEvents = true).
    /// </summary>
    internal static async Task EmitLoopEndAsync(
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        string reason,
        List<AgentRuntimeChatMessage>? conversation = null)
    {
        await AgentRuntimeTools.EmitAsync(
            state, context,
            new AgentRuntimeStreamEvent("loop_end", Reason: reason));

        // Notification is handled by the renderer on loop_end event.
        // The renderer checks window focus before deciding to notify.
    }

    private static JsonElement CreateAutoNotifyInput(string reason, List<AgentRuntimeChatMessage>? conversation)
    {
        var title = reason switch
        {
            "completed" => "任务完成",
            "max_iterations" => "达到迭代上限",
            "cancelled" => "任务已取消",
            "aborted" => "任务已中断",
            _ => $"任务停止: {reason}"
        };

        // Extract last assistant message text for the notification body
        var body = "工作已完成。";
        if (conversation is not null)
        {
            for (var i = conversation.Count - 1; i >= 0; i--)
            {
                if (conversation[i].Role == "assistant" && !string.IsNullOrWhiteSpace(conversation[i].Text))
                {
                    var text = conversation[i].Text.Trim();
                    // Strip markdown formatting and take first meaningful line
                    body = TruncateNotificationBody(text, 200);
                    break;
                }
            }
        }

        var type = reason == "completed" ? "success" : "info";
        var json = $"{{\"title\":\"{EscapeJson(title)}\",\"body\":\"{EscapeJson(body)}\",\"type\":\"{type}\"}}";
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static string EscapeJson(string value)
    {
        return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }

    /// <summary>
    /// Truncates text for notification body: takes first meaningful paragraph,
    /// strips excessive whitespace, and truncates to maxChars.
    /// </summary>
    private static string TruncateNotificationBody(string text, int maxChars)
    {
        // Take first paragraph (split by double newline or single newline)
        var firstParagraph = text.Split('\n')[0].Trim();
        // Collapse multiple spaces
        firstParagraph = System.Text.RegularExpressions.Regex.Replace(firstParagraph, @"\s+", " ");
        return firstParagraph.Length <= maxChars ? firstParagraph : firstParagraph[..maxChars] + "\u2026";
    }

    // ── Provider dispatch ──

    private static async Task<AgentRuntimeProviderTurnResult> ExecuteTurnAsync(
        JsonElement parameters,
        JsonElement provider,
        List<AgentRuntimeChatMessage> conversation,
        IReadOnlyList<ToolDefinition> toolDefs,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        var providerType = JsonHelpers.GetString(provider, "type") ?? string.Empty;

        if (providerType == "anthropic")
        {
            return await AnthropicMessagesProvider.ExecuteTurnAsync(
                parameters, provider, conversation, toolDefs, state, context);
        }

        if (providerType == "openai-responses")
        {
            return await OpenAIResponsesProvider.ExecuteTurnAsync(
                parameters, provider, conversation, state, context);
        }

        // Default: openai-chat
        return await OpenAIChatProvider.ExecuteTurnAsync(
            parameters, provider, conversation, toolDefs, state, context);
    }

    // ── Provider validation ──

    private static void ValidateProvider(JsonElement provider)
    {
        var apiKey = JsonHelpers.GetString(provider, "apiKey") ?? string.Empty;
        var model = JsonHelpers.GetString(provider, "model") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException("Provider requires apiKey.");
        }
        if (string.IsNullOrWhiteSpace(model))
        {
            throw new InvalidOperationException("Provider requires model.");
        }
    }

    // ── Context compression check ──

    private static bool ShouldCompress(int inputTokens, JsonElement provider, JsonElement parameters)
    {
        // Check if compression is enabled (default: true)
        var compressionEnabled = JsonHelpers.GetBool(parameters, "contextCompressionEnabled", true);
        if (!compressionEnabled)
        {
            WorkerLog.Warn("context compression DIAG: disabled (contextCompressionEnabled=false)");
            return false;
        }

        var contextLength = JsonHelpers.GetIntNullable(provider, "contextLength") ?? DefaultContextCompressionLimit;
        if (contextLength <= 0)
        {
            WorkerLog.Warn($"context compression DIAG: contextLength<=0 value={contextLength} raw={JsonHelpers.GetString(provider, "contextLength") ?? "(null)"}");
            return false;
        }

        // Read threshold from parameters (sent by frontend settings), fallback to 0.8
        var thresholdRatio = JsonHelpers.GetDoubleNullable(parameters, "contextCompressionThreshold") ?? DefaultContextCompressionThreshold;
        // Clamp to 0.3 ~ 0.9
        thresholdRatio = Math.Min(0.9, Math.Max(0.3, thresholdRatio));

        // Align with the frontend: base the trigger on the effective window
        // (contextLength minus reserved output tokens) rather than the raw
        // contextLength, so both sides fire compression at the same token count.
        var effectiveWindow = contextLength - DefaultContextCompressionReservedOutputTokens;
        if (effectiveWindow <= 0)
        {
            WorkerLog.Warn($"context compression DIAG: effectiveWindow<=0 contextLength={contextLength} reserved={DefaultContextCompressionReservedOutputTokens}");
            return false;
        }

        var ratioThreshold = (int)(effectiveWindow * thresholdRatio);
        var bufferedThreshold = effectiveWindow - ContextCompressionAutoBufferTokens;
        bufferedThreshold = bufferedThreshold > 0 ? bufferedThreshold : ratioThreshold;
        var trigger = Math.Min(ratioThreshold, bufferedThreshold);
        var willCompress = inputTokens >= trigger;
        WorkerLog.Warn($"context compression DIAG: inputTokens={inputTokens} contextLength={contextLength} effectiveWindow={effectiveWindow} thresholdRatio={thresholdRatio:0.###} trigger={trigger} -> {(willCompress ? "WOULD COMPRESS" : "skip (below trigger)")}");
        return willCompress;
    }
}

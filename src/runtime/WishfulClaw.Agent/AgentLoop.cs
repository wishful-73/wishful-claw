// 500-line exemption (755 lines as of 2026-10-20). This file is the per-turn orchestration
// body itself: prompt assembly and its cacheKey, transient-prefix injection, the provider
// turn, the S-209 empty-turn nudge gate, assistant write-back, tool execution and its
// guaranteed result pairing, iteration_end bookkeeping, and the stop-reason handoff. The
// seam between those steps is *order*, not interface — a nudge has to happen before the
// write-back or an empty turn lands in the durable conversation; tool results have to land
// even when the run is cancelled or the next request is rejected for unpaired calls. The
// self-contained pieces have already left into partials (ContextCompression, EmptyTurn,
// SandboxTransition, Helpers, MemoryRecall, ActionGuards); what remains is the sequence
// they hang off. Splitting it further would mean passing the whole loop state between
// files to preserve an ordering that reads fine in one place. See AGENTS.md.

using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.Infrastructure.Storage;
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
    private const int MaxOverflowCompressionAttemptsPerRun = 2;
    private const int MaxToolPairingRepairAttemptsPerRun = 2;
    /// <summary>
    /// S-236（档 2）：一次 run 里最多剥图降级几次。1 次足够 —— 剥完这一轮就没有 image 块了，
    /// 再撞同一个错说明问题不在图上（留给正常报错）。留到 2 只为兜住「本轮之后工具又读了新图」
    /// 这种边角：模型在被拒后会改用 Read 重读，第二次仍然失败才算真不可用。
    /// </summary>
    private const int MaxImageStripAttemptsPerRun = 2;

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
            var skipSessionRestore = JsonHelpers.GetBool(parameters, "skipSessionRestore", false);
            if (!skipSessionRestore && sessionId.Length > 0 && conversationKey == sessionId)
            {
                DbClient.EnsureInitialized(parameters);
                var restored = SessionRestoreTools.RestoreFromDb(DbClient.GetClient(parameters), sessionId);
                if (restored.Failure is { } failure)
                {
                    WorkerLog.Warn(
                        $"agent loop lazy-restore blocked session={FormatSessionId(sessionId)} " +
                        $"snapshot={failure.SnapshotId ?? "null"} reason={failure.Reason}");
                    throw new InvalidOperationException(
                        $"Session restore blocked: reason={failure.Reason}, snapshotId={failure.SnapshotId ?? "null"}.");
                }

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

        // Timeline instrumentation (S-25.4): sub-agent run start. The task brief
        // is the first user message of the sub-agent conversation, truncated.
        if (isSubAgentLoop || isGoalSubAgentLoop)
        {
            var brief = conversation.FirstOrDefault(m => m.Role == "user")?.Text?.Trim();
            if (string.IsNullOrEmpty(brief)) brief = null;
            else if (brief.Length > 120) brief = brief[..120] + "\u2026";
            var subAgentMode = isGoalSubAgentLoop ? "goalSubAgent" : "subAgent";
            DbAgentTimelineTools.Log(
                DbClient.GetClient(),
                sessionId.Length > 0 ? sessionId : null,
                null,
                "subagent_started",
                brief,
                DbAgentTimelineTools.Metadata(("run_id", state.RunId), ("mode", subAgentMode)));
        }
        var runtimeParameters = CreateRuntimeParametersWithoutMessages(parameters);
        var rawRunContext = AgentRunContextPolicy.Resolve(runtimeParameters);
        var rawSessionMode = AgentRunContextPolicy.ResolveAvailableMode(runtimeParameters, rawRunContext);
        runtimeParameters = NormalizeRuntimeParameters(runtimeParameters, rawRunContext, rawSessionMode);
        state.ReplaceParameters(runtimeParameters);
        parameters = runtimeParameters;
        provider = GetObject(parameters, "provider");

        // Create the project data directory before anything writes into it, so on Windows it is
        // hidden from the moment it first exists. One call site instead of one per write path:
        // Directory.CreateDirectory leaves an existing directory's attributes alone, so whichever
        // writer gets there first, the directory was already created here.
        var dataDirWorkingFolder = JsonHelpers.GetString(parameters, "workingFolder");
        if (!string.IsNullOrWhiteSpace(dataDirWorkingFolder))
        {
            WishfulClawDataDir.EnsureProjectRoot(dataDirWorkingFolder);
        }

        // ── Resolve tool definitions from backend registry ──
        // Tools live in the backend (ToolModuleState.Registry); the frontend never ships them.
        // This avoids a JSON round-trip that breaks prefix cache stability
        // (Reasonix pattern: backend owns tools).
        var runContext = AgentRunContextPolicy.Resolve(parameters);
        var sessionMode = AgentRunContextPolicy.ResolveAvailableMode(parameters, runContext);
        var channelSession = AgentRunContextPolicy.IsChannelSession(parameters);
        var registry = ToolModuleState.Registry;
        // Direct injection = scope ∧ IsCore (single source in AgentRunContextPolicy).
        // Non-core tools stay registered for the use_capability proxy; the web/codegraph
        // opt-in flags ride on runContext and gate the proxy the same way.
        var toolDefs = registry is null
            ? []
            : AgentRunContextPolicy.ResolveDirectInjection(
                registry, sessionMode, runContext, channelSession);

        // The capability directory is part of the tool description, so update it after the
        // session's visibility/mode filters have been applied. This keeps the description and
        // action=list on the same run-specific category source without coupling Persona to Agent.
        toolDefs = AgentRuntimeUseCapabilityExecutor.ApplyCapabilityDescription(
            toolDefs, registry, runContext, sessionMode, channelSession).ToList();

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
            // 沙箱状态进了系统提示词，就必须进 cacheKey —— 否则用户切开关后会一直命中旧提示词，
            // 提示词和实际拦截行为对不上（一边说「在沙箱里」一边放行，或反过来）。
            var sandboxEnabled = Tools.PathBoundary.IsEnabled(parameters);
            var cacheKey = SystemPromptCache.ComputeKey(
                personaId, workingFolder, language, userRules, sshConnectionId, projectId, sessionMode,
                JsonHelpers.GetString(parameters, "pluginId"),
                JsonHelpers.GetString(parameters, "externalChatId"),
                sandboxEnabled);
            var builtPrompt = SystemPromptCache.GetOrBuild(cacheKey, () =>
                PromptBuilder.Build(
                    PromptProfile.Main, provider, parameters, personaId, workingFolder, language, userRules,
                    sandboxEnabled: sandboxEnabled));
            provider = InjectSystemPrompt(provider, builtPrompt);
            WorkerLog.Info($"persona system prompt (cached) id={personaId} length={builtPrompt.Length}");
        }

        // Session-level request-context cap (iter-32 S-73/S-84). Applied once here, after the
        // provider payload is final: every downstream reader of provider.contextLength
        // (ShouldCompress, ManualCompressionValueFloorTokens, ContextCompression's tail and
        // pin budgets) then sees the same effective window, so nothing can drift. The value
        // is already 0 when the cap was set on a different model than the one in use — the
        // renderer decides that, since it is the side that knows the model id.
        provider = ApplyContextCap(provider, JsonHelpers.GetInt(parameters, "contextCapTokens", 0));

        // Inject timestamp + memory updates directly into the user message
        // stored in SessionConversation. This makes the timestamp part of the
        // permanent conversation history, so every turn sees the SAME bytes
        // for historical messages → prefix cache stable.
        // (Timestamp uses minute-level precision to stay stable within a turn.)
        InjectTransientPrefix(conversation, state);

        // S-207：系统提示词这一轮是按哪个沙箱状态写的。用户批准「临时关闭」可以在 run
        // 进行中发生，之后每轮用 InjectSandboxTransition 比对实时判定并拉平口径。
        state.SandboxEnabledInPrompt = Tools.PathBoundary.IsEnabled(parameters);

        var requestedMaxIterations = JsonHelpers.GetInt(parameters, "maxIterations", 0); // 0 = unlimited
        // S-132：真子代理 run 不接受轮次上限（definition.MaxTurns 已降级为「轮次提醒点」）。
        // 判据在此自算，不复用 :59-60 的变量 —— 那对变量读的是归一化（:171）之前的参数，
        // 且比较用 Ordinal，等于依赖「调用方写对大小写」这个隐式约定。此处显式放宽大小写。
        // sidecar 的单轮语义（maxIterations: 1）走的不是子代理 run，不受影响。
        // 注意用 string.Equals 静态重载：sessionModeForConv 可能为 null。
        var isSubAgentRun =
            string.Equals(sessionModeForConv, "subAgent", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(sessionModeForConv, "goalSubAgent", StringComparison.OrdinalIgnoreCase);
        var hasIterationLimit = requestedMaxIterations > 0 && !isSubAgentRun;
        var providerTurnOnly = JsonHelpers.GetBool(parameters, "providerTurnOnly", false);
        // Reuse the most recent provider-reported context usage from the wire
        // conversation. Resident sessions already carry it in memory, and lazy
        // restore reconstructs it from the persisted message usage column.
        var lastInputTokens = FindRecentContextUsage(wireConversation);
        var completed = false;
        var overflowCompressionAttempts = 0;
        var overflowCompressionPendingVerification = false;
        var toolPairingRepairAttempts = 0;
        var imageStripAttempts = 0;

        WorkerLog.Debug(
            $"agent loop start provider={providerType} " +
            $"maxIterations={(hasIterationLimit ? requestedMaxIterations.ToString() : "unlimited")} " +
            $"providerTurnOnly={providerTurnOnly}");

        for (var iteration = 1; !hasIterationLimit || iteration <= requestedMaxIterations; iteration++)
        {
            // ── Cancellation check ──
            if (state.IsCancellationRequested)
            {
                await EmitLoopEndAsync(state, context, AgentLoopEndReasons.Aborted, isSubAgentLoop: isSubAgentLoop, isGoalSubAgentLoop: isGoalSubAgentLoop);
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
                var compression = await TryCompressLoopConversationAsync(
                    provider,
                    sessionConv,
                    conversation,
                    wireConversation,
                    sessionId,
                    conversationKey,
                    iteration,
                    lastInputTokens,
                    state,
                    context,
                    errorDriven: false);
                if (compression.Status == LoopCompressionStatus.Cancelled)
                {
                    await EmitLoopEndAsync(state, context, AgentLoopEndReasons.Aborted, isSubAgentLoop: isSubAgentLoop, isGoalSubAgentLoop: isGoalSubAgentLoop);
                    return;
                }
                if (compression.Status == LoopCompressionStatus.Compressed)
                {
                    conversation = compression.Conversation!;
                    wireConversation = compression.WireConversation!;
                    lastInputTokens = 0;
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
                await EmitLoopEndAsync(state, context, AgentLoopEndReasons.Aborted, isSubAgentLoop: isSubAgentLoop, isGoalSubAgentLoop: isGoalSubAgentLoop);
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

            AgentRuntimeProviderTurnResult turn;
            while (true)
            {
                try
                {
                    turn = await ProviderRetryPolicy.ExecuteAsync(
                        () => ExecuteTurnAsync(parameters, provider, conversation, toolDefs, state, context, iteration),
                        state,
                        context,
                        provider);
                    overflowCompressionPendingVerification = false;
                    break;
                }
                catch (Exception ex) when (
                    ex is not OperationCanceledException &&
                    JsonHelpers.GetBool(parameters, "contextCompressionEnabled", true) &&
                    !overflowCompressionPendingVerification &&
                    overflowCompressionAttempts < MaxOverflowCompressionAttemptsPerRun &&
                    wireConversation.Count >= 2 &&
                    ContextCompression.IsContextWindowExceededError(ex))
                {
                    overflowCompressionAttempts++;
                    WorkerLog.Warn(
                        $"agent provider turn exceeded the model context window; attempting error-driven " +
                        $"compression runId={state.RunId} attempt={overflowCompressionAttempts}/" +
                        $"{MaxOverflowCompressionAttemptsPerRun} error={ex.GetType().Name}: {ex.Message}");
                    var originalCount = wireConversation.Count;
                    var compression = await TryCompressLoopConversationAsync(
                        provider,
                        sessionConv,
                        conversation,
                        wireConversation,
                        sessionId,
                        conversationKey,
                        iteration,
                        lastInputTokens,
                        state,
                        context,
                        errorDriven: true);
                    if (compression.Status == LoopCompressionStatus.Cancelled)
                    {
                        await EmitLoopEndAsync(state, context, AgentLoopEndReasons.Aborted, isSubAgentLoop: isSubAgentLoop, isGoalSubAgentLoop: isGoalSubAgentLoop);
                        return;
                    }
                    if (compression.Status != LoopCompressionStatus.Compressed ||
                        compression.WireConversation is not { Count: > 0 } compressedWireConversation ||
                        compressedWireConversation.Count >= originalCount)
                    {
                        throw;
                    }

                    conversation = compression.Conversation!;
                    wireConversation = compressedWireConversation;
                    lastInputTokens = 0;
                    overflowCompressionPendingVerification = true;
                }
                catch (Exception ex) when (
                    ex is not OperationCanceledException &&
                    toolPairingRepairAttempts < MaxToolPairingRepairAttemptsPerRun &&
                    ToolPairingErrors.IsToolPairingError(ex))
                {
                    // 上游以「工具调用没配对」拒绝请求（HTTP 400）。坏数据可能出在常驻会话
                    // 里的历史残留上，光重试不会变好 —— 必须先把缺失的结果补上，重试才有
                    // 意义。所以这里先修，再回到循环重发同一请求。
                    var repaired = sessionConv.RepairToolPairing();
                    if (repaired == 0)
                    {
                        // 扫不出可修的地方：问题不在这条链上，别空转。
                        throw;
                    }

                    toolPairingRepairAttempts++;
                    WorkerLog.Warn(
                        $"agent provider turn was rejected for unpaired tool calls; repaired and retrying " +
                        $"runId={state.RunId} repaired={repaired} attempt={toolPairingRepairAttempts}/" +
                        $"{MaxToolPairingRepairAttemptsPerRun} error={ex.Message}");
                    conversation = sessionConv.GetConversation();
                    wireConversation = sessionConv.GetWireConversation();
                }
                catch (Exception ex) when (
                    ex is not OperationCanceledException &&
                    imageStripAttempts < MaxImageStripAttemptsPerRun &&
                    ImageInputErrors.IsImageUnsupportedError(ex))
                {
                    // S-236（档 2）：上游说「这个模型不吃图像输入」。
                    //
                    // 两道闸必须先过，否则会把别的 400 误吞成图像问题：
                    //  ① 本 run 已经降过一次还撞同一个错 ⇒ 问题不在图上，原样抛；
                    //  ② 这轮压根没有 image 块可剥 ⇒ 同样不是图的问题，原样抛。
                    // 过了这两道才值得剥图重发 —— 那一次重试才是有意义的。
                    if (state.SuppressImagesForModel || !ConversationHasImageBlocks(conversation))
                    {
                        throw;
                    }

                    imageStripAttempts++;
                    state.SuppressImagesForModel = true;

                    var unsupportedProviderId = JsonHelpers.GetString(provider, "id");
                    var unsupportedModelId = JsonHelpers.GetString(provider, "model");
                    // 记住实测结果：下次这个 (provider, model) 直接在组包时剥图，
                    // 不用再白烧一次带图的往返。失败也不影响主流程（记不住就多撞一次）。
                    ImageVisionMemory.RememberUnsupported(unsupportedProviderId, unsupportedModelId);

                    WorkerLog.Warn(
                        $"agent provider turn rejected image input; stripping image blocks and retrying " +
                        $"runId={state.RunId} provider={unsupportedProviderId ?? "?"} " +
                        $"model={unsupportedModelId ?? "?"} attempt={imageStripAttempts}/" +
                        $"{MaxImageStripAttemptsPerRun} error={ex.Message}");

                    await AgentRuntimeTools.EmitAsync(
                        state,
                        context,
                        new AgentRuntimeStreamEvent(
                            "image_input_unsupported",
                            Reason: "stripped",
                            Attempt: imageStripAttempts,
                            MaxAttempts: MaxImageStripAttemptsPerRun));
                }
            }

            // Clear transient memory recall after first API call — subsequent
            // iterations within the same turn don't need it re-injected.
            state.PendingMemoryRecall = null;
            // 这条 assistant 轮先不入账：下面 tool-calls 分支要看它是不是「空轮」，
            // 是的话既不落库也不该留在会话里（S-209）。真答复和带工具调用的轮次在
            // 那个 if 之外统一写入。
            var assistantWireMessage = CreateAssistantWireMessage(turn.AssistantMessage, turn.Usage);

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

            // ── S-209 空轮催办 ──
            // 只出思考、不吐正文也不调工具就报结束（GLM-5.3-flash 实测）—— 直接放过去
            // 就是一条静默的空回复。发一次临时提醒再催一轮，上限 2 次；额度用尽后照常收尾。
            // 催办发生在 iteration_end 之前，因为它并没有真结束。
            //
            // 判定必须放在写入会话之前：这条轮次不是答复，写进 durable conversation 会让
            // 历史多一条空气泡，也会成为下一轮压缩摘要输入的噪声（催办 2 次就留 2–3 条）。
            if (turn.ToolCalls.Count == 0 &&
                string.IsNullOrWhiteSpace(turn.AssistantMessage.Text) &&
                !string.IsNullOrWhiteSpace(turn.AssistantMessage.ReasoningContent) &&
                state.TryScheduleEmptyTurnNudge(MaxEmptyTurnNudges))
            {
                WorkerLog.Warn(
                    "provider turn produced reasoning only; nudging for a real answer " +
                    $"attempt={state.EmptyTurnNudgeCount}/{MaxEmptyTurnNudges}");
                continue;
            }

            // 走到这里这条轮次是真实产出（正式答复或带工具调用），才写入会话。
            conversation.Add(turn.AssistantMessage);
            wireConversation.Add(assistantWireMessage);

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
            // T-7.1: 结果必须在工具执行之后无条件写回，所以写回放在 finally 里 ——
            // 取消本身走 ExecuteAsync 内部的 break（正常返回部分结果），而中断和异常是
            // 直接抛出去的；写在 try 之后就整段跳过，把 assistant(tool_calls) 永远悬空在
            // 常驻会话里，之后每一次请求都被上游 400 拒绝（"...must be followed by
            // tool messages..."）。没跑出结果的调用补中断占位符，配对始终成立。
            // 写回要早于下面的取消检查 —— 取消后会话里也必须成对。
            var toolResults = new List<AgentRuntimeToolResult>();
            List<AgentRuntimeToolResult> pairedResults = [];
            try
            {
                toolResults = await ToolCallProcessor.ExecuteAsync(
                    turn.ToolCalls, parameters, state, context);
            }
            finally
            {
                pairedResults = ToolCallProcessor.EnsureEveryCallHasResult(turn.ToolCalls, toolResults);
                conversation.Add(AgentRuntimeChatMessage.UserToolResults(pairedResults));
                wireConversation.Add(CreateToolResultsWireMessage(pairedResults));
            }

            if (state.IsCancellationRequested)
            {
                await EmitLoopEndAsync(state, context, AgentLoopEndReasons.Aborted, isSubAgentLoop: isSubAgentLoop, isGoalSubAgentLoop: isGoalSubAgentLoop);
                return;
            }

            await AgentRuntimeTools.EmitAsync(
                state, context,
                new AgentRuntimeStreamEvent(
                    "iteration_end",
                    StopReason: "tool_use",
                    ToolResults: pairedResults.ToArray()));
        }

        // 真实结束原因（正常跑完 / 撞轮次上限）。写回 state 之后 SubAgentExecutor
        // 上报的 StopReason 才有值 —— 此前它恒为 null，被轮次掐断的 run 在 UI 上
        // 与正常干完的长得一模一样（iter-31 S-53）。
        var loopEndReason = state.StopReason ?? (completed ? AgentLoopEndReasons.Completed : AgentLoopEndReasons.MaxIterations);
        state.RecordStopReason(loopEndReason);

        await EmitLoopEndAsync(
            state, context,
            loopEndReason,
            conversation,
            isSubAgentLoop: isSubAgentLoop,
            isGoalSubAgentLoop: isGoalSubAgentLoop);
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
        List<AgentRuntimeChatMessage>? conversation = null,
        bool isSubAgentLoop = false,
        bool isGoalSubAgentLoop = false,
        string? errorType = null,
        int? statusCode = null)
    {
        // S-210：取消不该只有一个名字。用户点停止、父 run 收尾、会话被替换都从
        // 同一条 aborted 出口走，渲染端分不清谁按的；CancelReason 是唯一还留着
        // 「谁取消了它」的地方（agent/cancel 传的就是 "user"），RequestStop 则直接
        // 把 "user" 塞进 StopReason。两种口径都在这里归一，落库端才拿得到可据实
        // 显示的原因。
        if (reason == "user" || (reason == AgentLoopEndReasons.Aborted && state.CancelReason == "user"))
        {
            reason = AgentLoopEndReasons.UserCancelled;
        }

        await AgentRuntimeTools.EmitAsync(
            state, context,
            new AgentRuntimeStreamEvent(
                "loop_end",
                Reason: reason,
                ErrorType: errorType,
                StatusCode: statusCode));

        // Timeline instrumentation (S-25.4): sub-agent run termination.
        if (isSubAgentLoop || isGoalSubAgentLoop)
        {
            var mode = isGoalSubAgentLoop ? "goalSubAgent" : "subAgent";
            DbAgentTimelineTools.Log(
                DbClient.GetClient(),
                state.SessionId,
                null,
                "subagent_finished",
                null,
                DbAgentTimelineTools.Metadata(("run_id", state.RunId), ("mode", mode), ("reason", reason)));
        }

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
        IWorkerRequestContext context,
        int iteration)
    {
        var providerType = JsonHelpers.GetString(provider, "type") ?? string.Empty;

        // 每轮把会话 todo 现状推送到模型眼前（iter-30 S-44）。没有可注入内容时原样返回。
        // 走临时副本：conversation 本身一字不动，历史前缀因此保持稳定。
        var wireConversation = InjectSessionTodo(parameters, conversation, state);

        // 子代理的轮次提醒（iter-31 S-53）。仅子代理生效，主会话不受影响。
        wireConversation = InjectSubAgentTurnReminder(parameters, wireConversation, iteration);

        // 空回复催办（iter-40 S-209）。上一轮只出思考、没正文也没工具调用时置上的标记，
        // 在这里兑现成一条临时 user 提醒。同样走临时副本。
        wireConversation = InjectEmptyTurnNudge(state, wireConversation);

        // S-207：沙箱状态在 run 进行中被改过（用户批准/恢复正常）时，把提示词口径拉平。
        wireConversation = InjectSandboxTransition(parameters, wireConversation, state);

        // S-236（档 2）：已知这个模型不吃图像输入时，把 image 块从**临时副本**里剥掉。
        // 只剥这份，不碰 conversation —— 后者是会话的活引用，删块等于改用户历史。
        // 两种触发来源：本 run 刚撞过一次（state 标记），或以前撞过并记住了（落盘的记忆表）。
        wireConversation = StripImagesWhenModelCannotSee(provider, wireConversation, state);

        if (providerType == "anthropic")
        {
            return await AnthropicMessagesProvider.ExecuteTurnAsync(
                parameters, provider, wireConversation, toolDefs, state, context);
        }

        if (providerType == "openai-responses")
        {
            return await OpenAIResponsesProvider.ExecuteTurnAsync(
                parameters, provider, wireConversation, toolDefs, state, context);
        }

        // Default: openai-chat
        return await OpenAIChatProvider.ExecuteTurnAsync(
            parameters, provider, wireConversation, toolDefs, state, context);
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

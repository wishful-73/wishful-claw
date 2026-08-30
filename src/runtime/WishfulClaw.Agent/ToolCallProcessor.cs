using System.Buffers;
using System.Text;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// Handles tool call execution within an agent loop iteration.
/// Supports concurrency control via SemaphoreSlim and per-turn call capping.
/// Sub-agent (Task) tool calls have a separate concurrency limit.
/// </summary>
public static class ToolCallProcessor
{
    /// <summary>
    /// Maximum tool output size in bytes before head+tail truncation kicks in.
    /// Aligned with Reasonix's maxToolOutputBytes (32KB). Prevents giant tool
    /// results (e.g. WebFetch of a full webpage) from blowing the context window
    /// and destroying prefix cache hit rates.
    /// </summary>
    private const int MaxToolOutputBytes = 32 * 1024;

    private static string TruncateToolOutput(string output)
    {
        if (string.IsNullOrEmpty(output))
            return output;

        var totalBytes = Encoding.UTF8.GetByteCount(output);
        if (totalBytes <= MaxToolOutputBytes)
            return output;

        var keepBytes = MaxToolOutputBytes / 2;
        var headEnd = FindUtf8PrefixLength(output, keepBytes);
        var tailStart = FindUtf8SuffixStart(output, keepBytes);
        var head = output[..headEnd];
        var tail = output[tailStart..];
        var keptBytes = Encoding.UTF8.GetByteCount(head) + Encoding.UTF8.GetByteCount(tail);
        var omittedBytes = totalBytes - keptBytes;
        return head + "\n\n[truncated " + omittedBytes + " of " + totalBytes
            + " UTF-8 bytes — rerun with narrower args to see the middle]\n\n" + tail;
    }

    private static int FindUtf8PrefixLength(string value, int maxBytes)
    {
        var bytes = 0;
        var index = 0;
        foreach (var rune in value.EnumerateRunes())
        {
            if (bytes + rune.Utf8SequenceLength > maxBytes)
                break;
            bytes += rune.Utf8SequenceLength;
            index += rune.Utf16SequenceLength;
        }
        return index;
    }

    private static int FindUtf8SuffixStart(string value, int maxBytes)
    {
        var bytes = 0;
        var index = value.Length;
        while (index > 0)
        {
            var runeStart = index - 1;
            if (runeStart > 0
                && char.IsLowSurrogate(value[runeStart])
                && char.IsHighSurrogate(value[runeStart - 1]))
            {
                runeStart--;
            }

            var rune = Rune.GetRuneAt(value, runeStart);
            if (bytes + rune.Utf8SequenceLength > maxBytes)
                break;
            bytes += rune.Utf8SequenceLength;
            index = runeStart;
        }
        return index;
    }

    internal static string ApplyToolOutputLimit(AgentRuntimeNativeToolCall toolCall, string output)
    {
        if (AgentRuntimeUseCapabilityExecutor.IsUseCapabilityTool(toolCall.Name))
        {
            var action = (JsonHelpers.GetString(toolCall.Input, "action") ?? string.Empty)
                .Trim()
                .ToLowerInvariant();
            if (action is "list" or "inspect")
                return output;
        }

        return TruncateToolOutput(output);
    }
    /// <summary>
    /// Executes a batch of tool calls with concurrency control and per-turn capping.
    /// Returns the collected tool results in completion order.
    /// When tool calls exceed maxToolCallsPerTurn, excess calls are NOT silently
    /// dropped — they return an error result so the LLM knows to retry next turn.
    /// </summary>
    public static async Task<List<AgentRuntimeToolResult>> ExecuteAsync(
        List<AgentRuntimeNativeToolCall> toolCalls,
        JsonElement parameters,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        var runContext = AgentRunContextPolicy.Resolve(parameters);
        var workingFolder = runContext.Scope == "project"
            ? JsonHelpers.GetString(parameters, "workingFolder")
            : null;
        var projectId = runContext.Scope == "project"
            ? JsonHelpers.GetString(parameters, "projectId")
            : null;
        var sshConnectionId = runContext.Scope == "project"
            ? JsonHelpers.GetString(parameters, "sshConnectionId")
            : null;
        var maxParallelTools = Math.Max(1, JsonHelpers.GetInt(parameters, "maxParallelTools", 1));
        var maxToolCallsPerTurn = JsonHelpers.GetInt(parameters, "maxToolCallsPerTurn", 0); // 0 = unlimited
        var registry = ToolModuleState.Registry;
        var availableMode = AgentRunContextPolicy.ResolveAvailableMode(parameters, runContext);
        // "default" permission mode asks the user to confirm write/delete/execute
        // class tools before execution. "whitelist"/"fullAccess" never pause here
        // (whitelist rules are enforced on the renderer side).
        var permissionMode = JsonHelpers.GetString(parameters, "permissionMode");
        var defaultModeApproval = string.Equals(permissionMode, "default", StringComparison.OrdinalIgnoreCase);

        // Split tool calls into executable vs skipped (over per-turn limit)
        var toolCallsToExecute = toolCalls;
        var skippedToolCalls = new List<AgentRuntimeNativeToolCall>();

        if (maxToolCallsPerTurn > 0 && toolCalls.Count > maxToolCallsPerTurn)
        {
            WorkerLog.Warn(
                $"agent tool calls capped runId={state.RunId} " +
                $"requested={toolCalls.Count} max={maxToolCallsPerTurn} " +
                $"skipped={toolCalls.Count - maxToolCallsPerTurn}");

            toolCallsToExecute = toolCalls.Take(maxToolCallsPerTurn).ToList();
            skippedToolCalls = toolCalls.Skip(maxToolCallsPerTurn).ToList();
        }

        // Two semaphores: one for regular tools, one for sub-agent (Task) calls.
        // This prevents a burst of Task calls from consuming all parallel slots
        // and blocking regular tools (or vice versa).
        //
        // Approval gating: in "default" permission mode, tools that require
        // approval must NOT run concurrently with other tools — a later tool
        // (e.g. deleting the file an earlier edit creates) could execute before
        // its dependency is even approved. Gate all calls behind a shared
        // approval barrier: each call waits until every earlier call's approval
        // (if any) has been resolved before it starts.
        var toolSemaphore = new SemaphoreSlim(maxParallelTools, maxParallelTools);
        var toolTasks = new List<Task<AgentRuntimeToolResult>>();

        // Barrier task chain: each gated call awaits the previous gated call's
        // approval phase. Ungated calls still run fully parallel.
        Task? approvalBarrier = null;
        var barrierLock = new object();

        foreach (var toolCall in toolCallsToExecute)
        {
            if (state.IsCancellationRequested)
            {
                break;
            }

            var category = registry?.GetCategory(toolCall.Name);
            var allowedByContext = AgentRunContextPolicy.IsToolAllowed(runContext, toolCall.Name, category);
            var allowedByMode = registry is null || registry.IsAvailableInMode(toolCall.Name, availableMode);
            if (!allowedByContext || !allowedByMode)
            {
                toolTasks.Add(RejectUnavailableToolAsync(
                    toolCall, state, context, runContext, allowedByContext));
                continue;
            }

            // fullAccess is YOLO: never create an approval barrier or dialog.
            var needsGate = defaultModeApproval && !state.SuppressTransportEvents &&
                IsDefaultModeApprovalTool(toolCall.Name);

            if (needsGate)
            {
                var prevBarrier = approvalBarrier;
                var gateTcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                approvalBarrier = gateTcs.Task;

                var isTaskTool = SubAgentExecutor.IsTaskTool(toolCall.Name);
                if (!isTaskTool)
                {
                    await toolSemaphore.WaitAsync(state.CancellationToken);
                }
                toolTasks.Add(ExecuteGatedAsync(
                    toolCall, workingFolder, projectId, sshConnectionId, state, context,
                    isTaskTool ? null : toolSemaphore, registry,
                    defaultModeApproval, prevBarrier, gateTcs));
            }
            else
            {
                // Pick the right semaphore based on whether this is a Task (sub-agent) call
                var isTaskTool = SubAgentExecutor.IsTaskTool(toolCall.Name);
                if (!isTaskTool)
                {
                    await toolSemaphore.WaitAsync(state.CancellationToken);
                }
                toolTasks.Add(ExecuteSingleAsync(
                    toolCall, workingFolder, projectId, sshConnectionId, state, context,
                    isTaskTool ? null : toolSemaphore, registry,
                    defaultModeApproval));
            }
        }

        // Wait for all started tool tasks to complete
        var results = new List<AgentRuntimeToolResult>();
        if (toolTasks.Count > 0)
        {
            var completedResults = await Task.WhenAll(toolTasks);
            results.AddRange(completedResults);
        }

        // Generate error results for skipped tool calls so the LLM knows they
        // were not executed and can retry in the next turn.
        if (skippedToolCalls.Count > 0)
        {
            var skipMessage = maxToolCallsPerTurn > 0
                ? $"Skipped: {maxToolCallsPerTurn} tool calls per turn max. Retry this call next turn."
                : "Tool call skipped: per-turn limit exceeded. Please retry in the next turn.";

            foreach (var skipped in skippedToolCalls)
            {
                // Emit tool_call_start + tool_call_result so the UI shows the skipped call
                await AgentRuntimeTools.EmitAsync(
                    state, context,
                    new AgentRuntimeStreamEvent(
                        "tool_call_start",
                        ToolCall: new AgentRuntimeToolCallState(
                            skipped.Id,
                            skipped.Name,
                            skipped.Input,
                            "running",
                            null,
                            null,
                            false,
                            AgentLoop.NowMs(),
                            null)));

                await AgentRuntimeTools.EmitAsync(
                    state, context,
                    new AgentRuntimeStreamEvent(
                        "tool_call_result",
                        ToolCallId: skipped.Id,
                        ToolName: skipped.Name,
                        ToolCall: new AgentRuntimeToolCallState(
                            skipped.Id,
                            skipped.Name,
                            skipped.Input,
                            "error",
                            AgentRuntimeProviderSupport.CreateStringElement(skipMessage),
                            skipMessage,
                            false,
                            AgentLoop.NowMs(),
                            AgentLoop.NowMs())));

                results.Add(new AgentRuntimeToolResult(
                    skipped.Id,
                    AgentRuntimeProviderSupport.CreateStringElement(skipMessage),
                    true));
            }
        }

        return results;
    }

    private static async Task<AgentRuntimeToolResult> RejectUnavailableToolAsync(
        AgentRuntimeNativeToolCall toolCall,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        AgentRunContext runContext,
        bool allowedByContext)
    {
        var startedAt = AgentLoop.NowMs();
        var message = allowedByContext
            ? $"Tool '{toolCall.Name}' is not available for runtime role '{runContext.RuntimeRole}'."
            : $"Tool '{toolCall.Name}' is not available in {runContext.Scope}:{runContext.CollaborationMode} sessions.";

        await AgentRuntimeTools.EmitAsync(
            state, context,
            new AgentRuntimeStreamEvent(
                "tool_call_start",
                ToolCall: new AgentRuntimeToolCallState(
                    toolCall.Id,
                    toolCall.Name,
                    toolCall.Input,
                    "running",
                    null,
                    null,
                    false,
                    startedAt,
                    null)));

        var completedAt = AgentLoop.NowMs();
        await AgentRuntimeTools.EmitAsync(
            state, context,
            new AgentRuntimeStreamEvent(
                "tool_call_result",
                ToolCallId: toolCall.Id,
                ToolName: toolCall.Name,
                ToolCall: new AgentRuntimeToolCallState(
                    toolCall.Id,
                    toolCall.Name,
                    toolCall.Input,
                    "error",
                    AgentRuntimeProviderSupport.CreateStringElement(message),
                    message,
                    false,
                    startedAt,
                    completedAt)));

        return new AgentRuntimeToolResult(
            toolCall.Id,
            AgentRuntimeProviderSupport.CreateStringElement(message),
            true);
    }

    /// <summary>
    /// Executes an approval-gated tool call: waits for the previous gated call's
    /// approval to be resolved before starting its own approval + execution, so
    /// gated tools run strictly in LLM emission order even though they are
    /// dispatched concurrently. The barrier is released as soon as this call's
    /// approval phase completes (approved or rejected) — execution itself may
    /// then overlap with the next gated call's user dialog.
    /// </summary>
    private static async Task<AgentRuntimeToolResult> ExecuteGatedAsync(
        AgentRuntimeNativeToolCall toolCall,
        string? workingFolder,
        string? projectId,
        string? sshConnectionId,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        SemaphoreSlim? semaphore,
        ToolRegistry? registry,
        bool defaultModeApproval,
        Task? prevBarrier,
        TaskCompletionSource gateTcs)
    {
        try
        {
            if (prevBarrier is not null)
            {
                await prevBarrier.ConfigureAwait(false);
            }
            return await ExecuteSingleAsync(
                toolCall, workingFolder, projectId, sshConnectionId, state, context, semaphore, registry,
                defaultModeApproval).ConfigureAwait(false);
        }
        finally
        {
            // Release the chain even on rejection/cancellation so later calls
            // are not stuck behind a gate that never opens.
            gateTcs.TrySetResult();
        }
    }

    /// <summary>
    /// Executes a single tool call with event emission.
    /// The semaphore is released in a finally block to guarantee release on all paths.
    /// </summary>
    private static async Task<AgentRuntimeToolResult> ExecuteSingleAsync(
        AgentRuntimeNativeToolCall toolCall,
        string? workingFolder,
        string? projectId,
        string? sshConnectionId,
        AgentRuntimeRunState state,
        IWorkerRequestContext context,
        SemaphoreSlim? semaphore,
        ToolRegistry? registry,
        bool defaultModeApproval = false)
    {
        try
        {
            var startedAt = AgentLoop.NowMs();
            var userApproved = false;

            // Proxy display rewrite: use_capability(action=call) is surfaced to
            // the renderer as the underlying tool call (real name + arguments),
            // so the chat shows a NotebookEdit/Desktop/... card instead of an
            // opaque "use_capability" card. The LLM-facing result keeps the
            // original use_capability id — only the display events are rewritten.
            var displayName = toolCall.Name;
            var displayInput = toolCall.Input;
            if (AgentRuntimeUseCapabilityExecutor.IsUseCapabilityTool(toolCall.Name))
            {
                var action = (JsonHelpers.GetString(toolCall.Input, "action") ?? string.Empty).Trim();
                if (string.Equals(action, "call", StringComparison.OrdinalIgnoreCase))
                {
                    var proxy = AgentRuntimeUseCapabilityExecutor.ResolveProxyDisplay(
                        JsonHelpers.GetString(toolCall.Input, "capability_id"),
                        toolCall.Input);
                    if (proxy is { } p)
                    {
                        displayName = p.Name;
                        displayInput = p.Input;
                    }
                }
            }

            await AgentRuntimeTools.EmitAsync(
                state, context,
                new AgentRuntimeStreamEvent(
                    "tool_call_start",
                    ToolCall: new AgentRuntimeToolCallState(
                        toolCall.Id,
                        displayName,
                        displayInput,
                        "running",
                        null,
                        null,
                        false,
                        startedAt,
                        null)));

            // Sub-agent approval check: when running inside a sub-agent
            // (SuppressTransportEvents = true), certain tools require user
            // approval before execution. The approval request is sent via
            // reverse-request to the renderer.
            if (RequiresApprovalBeforeExecution(toolCall, state, defaultModeApproval))
            {
                // Update status to pending_approval
                await AgentRuntimeTools.EmitAsync(
                    state, context,
                    new AgentRuntimeStreamEvent(
                        "tool_call_start",
                        ToolCall: new AgentRuntimeToolCallState(
                            toolCall.Id,
                            displayName,
                            displayInput,
                            "pending_approval",
                            null,
                            null,
                            true, // RequiresApproval
                            startedAt,
                            null)));

                WorkerLog.Info(
                    $"{(defaultModeApproval ? "default-mode" : "sub-agent")} tool approval requested " +
                    $"runId={state.RunId} tool={displayName} id={toolCall.Id}");

                // Send reverse-request to renderer and wait for response
                var approvalParams = new ArrayBufferWriter<byte>();
                using (var aw = new Utf8JsonWriter(approvalParams, WriteOptions))
                {
                    aw.WriteStartObject();
                    aw.WriteString("toolCallId", toolCall.Id);
                    aw.WriteString("toolName", displayName);
                    aw.WriteString("source", defaultModeApproval ? "default-mode" : "sub-agent");
                    // Concurrent tool calls emit approval requests independently;
                    // IPC arrival order is nondeterministic. startedAt lets the
                    // renderer queue dialogs in card order instead.
                    aw.WriteNumber("startedAt", startedAt);
                    aw.WritePropertyName("input");
                    displayInput.WriteTo(aw);
                    aw.WriteEndObject();
                }
                using var approvalDoc = JsonDocument.Parse(approvalParams.WrittenMemory);
                var approvalResult = await AgentRuntimeReverseRequests.RequestAsync(
                    context, "sub-agent:approve-tool", approvalDoc.RootElement.Clone(),
                    state.CancellationToken);

                var approved = false;
                if (approvalResult.ValueKind == JsonValueKind.Object &&
                    approvalResult.TryGetProperty("approved", out var approvedVal) &&
                    approvedVal.ValueKind == JsonValueKind.True)
                {
                    approved = true;
                }
                userApproved = approved;

                if (!approved)
                {
                    // The LLM must see WHY nothing happened: the user blocked
                    // this step. Without this it assumes success and plans the
                    // next action (e.g. deleting a file the rejected edit was
                    // supposed to create) on a false premise.
                    var rejectMsg =
                        $"[USER REJECTED] The user declined to run {displayName}. " +
                        "This tool call did NOT execute. Do not assume any effect from it. " +
                        "Ask the user how to proceed or adjust your plan before retrying.";
                    var rejectAt = AgentLoop.NowMs();
                    await AgentRuntimeTools.EmitAsync(
                        state, context,
                        new AgentRuntimeStreamEvent(
                            "tool_call_result",
                            ToolCallId: toolCall.Id,
                            ToolName: displayName,
                            ToolCall: new AgentRuntimeToolCallState(
                                toolCall.Id,
                                displayName,
                                displayInput,
                                "rejected",
                                AgentRuntimeProviderSupport.CreateStringElement(rejectMsg),
                                rejectMsg,
                                false,
                                startedAt,
                                rejectAt)));

                    return new AgentRuntimeToolResult(
                        toolCall.Id,
                        AgentRuntimeProviderSupport.CreateStringElement(rejectMsg),
                        true);
                }

                // Approved — update status back to running
                await AgentRuntimeTools.EmitAsync(
                    state, context,
                    new AgentRuntimeStreamEvent(
                        "tool_call_start",
                        ToolCall: new AgentRuntimeToolCallState(
                            toolCall.Id,
                            displayName,
                            displayInput,
                            "running",
                            null,
                            null,
                            false,
                            startedAt,
                            null)));
            }

            // Dispatch to the appropriate executor
            var (toolOutput, isToolError) = await ToolDispatchRouter.DispatchAsync(
                toolCall, state, context, registry, workingFolder, projectId, sshConnectionId);

            // When this call went through user approval, tell the LLM explicitly:
            // it paused here waiting for the user, and the user allowed this step.
            // This closes the causal loop — otherwise approval is invisible to it.
            if (userApproved)
            {
                toolOutput = "[USER APPROVED] The user reviewed and allowed this step.\n\n" + toolOutput;
            }

            var completedAt = AgentLoop.NowMs();

            await AgentRuntimeTools.EmitAsync(
                state, context,
                new AgentRuntimeStreamEvent(
                    "tool_call_result",
                    ToolCallId: toolCall.Id,
                    ToolName: displayName,
                    ToolCall: new AgentRuntimeToolCallState(
                        toolCall.Id,
                        displayName,
                        displayInput,
                        isToolError ? "error" : "completed",
                        AgentRuntimeProviderSupport.CreateStringElement(toolOutput),
                        isToolError ? toolOutput : null,
                        false,
                        startedAt,
                        completedAt)));

            var truncatedOutput = ApplyToolOutputLimit(toolCall, toolOutput);
            if (!ReferenceEquals(truncatedOutput, toolOutput) && truncatedOutput != toolOutput)
            {
                WorkerLog.Warn(
                    $"agent tool output truncated runId={state.RunId} tool={toolCall.Name} " +
                    $"originalBytes={Encoding.UTF8.GetByteCount(toolOutput)} " +
                    $"truncatedBytes={Encoding.UTF8.GetByteCount(truncatedOutput)}");
            }

            WorkerLog.Debug(
                $"agent tool executed runId={state.RunId} tool={toolCall.Name} " +
                $"id={toolCall.Id} error={isToolError} outputLen={truncatedOutput.Length}");

            return new AgentRuntimeToolResult(
                toolCall.Id,
                AgentRuntimeProviderSupport.CreateStringElement(truncatedOutput),
                isToolError ? true : null);
        }
        finally
        {
            semaphore?.Release();
        }
    }

    /// <summary>
    /// Tools that require user approval when executed inside a sub-agent.
    /// Sub-agents run autonomously — routine file operations and commands
    /// should NOT require approval. Only interactive tools (like AskUserQuestion)
    /// pause for user input, and those are handled by their own executor, not here.
    /// </summary>
    private static readonly HashSet<string> SubAgentApprovalTools = new(StringComparer.Ordinal)
    {
        // Empty — sub-agents execute tools freely without per-call approval.
        // If specific tools need approval in the future, add them here.
    };

    private static bool RequiresSubAgentApproval(string toolName)
    {
        return SubAgentApprovalTools.Contains(toolName);
    }

    /// <summary>
    /// Tools that require user confirmation in "default" permission mode:
    /// write/delete/execute class operations. Read/search class tools
    /// (Read/Glob/Grep/LS/webfetch/web search/memory search) run freely.
    /// </summary>
    private static readonly HashSet<string> DefaultModeApprovalTools = new(StringComparer.Ordinal)
    {
        // File writes (incl. notebook rewrites)
        "Write", "Edit", "NotebookEdit",
        // Shell execution
        "Bash", "Shell", "ShellExec", "PowerShell",
        // Desktop input (executes real UI actions on the user's machine)
        "DesktopClick", "DesktopType", "DesktopScroll"
    };

    private static bool RequiresApprovalBeforeExecution(
        AgentRuntimeNativeToolCall toolCall,
        AgentRuntimeRunState state,
        bool defaultModeApproval)
    {
        // fullAccess/YOLO must never pause for approval, including future
        // sub-agent approval rules inherited by the main run.
        if (!defaultModeApproval)
        {
            return false;
        }

        if (state.SuppressTransportEvents && RequiresSubAgentApproval(toolCall.Name))
        {
            return true;
        }

        // Default-mode approval applies to the main agent loop (sub-agents keep
        // their own autonomous policy).
        return defaultModeApproval
            && !state.SuppressTransportEvents
            && IsDefaultModeApprovalTool(toolCall.Name);
    }

    /// <summary>
    /// Exposed for the use_capability proxy: a proxied built-in tool must be
    /// checked against the same default-mode approval set as direct calls.
    /// </summary>
    public static bool IsDefaultModeApprovalTool(string toolName)
    {
        return DefaultModeApprovalTools.Contains(toolName);
    }

    private static readonly JsonWriterOptions WriteOptions = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };
}


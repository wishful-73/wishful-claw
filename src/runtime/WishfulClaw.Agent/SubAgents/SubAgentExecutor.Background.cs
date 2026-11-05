using System.Buffers;
using System.Text.Json;
using WishfulClaw.Agent.Sessions;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;
using WishfulClaw.Agent.Executors;

namespace WishfulClaw.Agent.SubAgents;

public static partial class SubAgentExecutor
{

    private static Task<ToolResult> ExecuteBackgroundAsync(
        JsonElement input,
        JsonElement parameters,
        SubAgentDefinition definition,
        string prompt,
        int currentDepth,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        string toolCallId)
    {
        var description = JsonHelpers.GetString(input, "description") ?? definition.Name;

        // Register in the background registry so SubAgentStatus can query it
        BackgroundSubAgentRegistry.Register(toolUseId: toolCallId, agentName: definition.Name, description: description, prompt: prompt, isBackground: true, sessionId: parentState.SessionId);

        var childParameters = BuildChildParameters(
            parameters, definition, prompt, currentDepth + 1);

        var childRunId = $"subagent-bg-{toolCallId}-{Guid.NewGuid():N}";
        var childState = new AgentRuntimeRunState(childRunId, parentState.SessionId);
        childState.SuppressTransportEvents = true;

        var collector = CreateCollector(parentState, context, definition.Name, toolCallId);
        childState.EventObserver = collector.ObserveAsync;
        childState.ReplaceParameters(childParameters);

        // S-308：登记一条与父 run 生命周期无关的停止句柄。父 run 结束时会 dispose 下面那个
        // 取消联动注册 —— 那是唯一原有的取消通路，而 background 的全部价值恰恰是「活得比父
        // run 长」，于是孤儿无路可停。这条登记就是补上那条路（SubAgentStop / 渲染端停止按钮）。
        SubAgentRunControl.Register(toolCallId, childState);

        // Register parent cancellation → child cancellation. SA-2: keep the
        // registration and dispose it in the background task's finally — a
        // dropped registration leaves the callback on the parent token after
        // the child state is disposed, and a later parent cancel would call
        // Cancel() on a disposed CTS (ObjectDisposedException inside the
        // cancellation callback).
        var cancellationRegistration = parentState.CancellationToken.Register(
            static state => ((AgentRuntimeRunState)state!).Cancel("parent"),
            childState);

        // Fire-and-forget: run the child loop on a background task
        _ = Task.Run(async () =>
        {
            try
            {
                using var concurrencyLease = await AcquireSubAgentSlotAsync(
                    definition, toolCallId, input, parentState, context,
                    childState.CancellationToken);
                await AgentLoop.ExecuteLoopAsync(childParameters, childState, context);

                // Update progress before completing
                BackgroundSubAgentRegistry.UpdateProgress(
                    toolCallId, collector.ToolCallCount, collector.Iterations,
                    BuildToolCallEntries(collector.ToolCallSummaries));

                var output = collector.GetFinalOutput();
                var reportProduced = !string.IsNullOrWhiteSpace(output);
                if (!reportProduced)
                    output = "Sub-agent completed but produced no output.";

                // S-36: 后台子 agent 的流式转发同样绑在父 run 的 transport 上，父 run 一死
                // 就断；这里落库的是完整报告，主会话与界面重启后都从它取值。
                if (reportProduced)
                {
                    SubAgentReportStore.SaveFinalOutput(
                        toolCallId, parentState.SessionId, definition.Name, output,
                        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), success: true);
                }

                BackgroundSubAgentRegistry.Complete(
                    toolCallId, output, collector.ToolCallCount, collector.Iterations,
                    BuildToolCallEntries(collector.ToolCallSummaries));

                // Emit sub_agent_end so the frontend updates the card
                var resultJson = BuildResultJson(
                    definition.Name, toolCallId, output, true, childState.StopReason,
                    collector.ToolCallCount, collector.Iterations, reportProduced);

                await AgentRuntimeTools.EmitAsync(
                    parentState, context,
                    new AgentRuntimeStreamEvent(
                        "sub_agent_end",
                        SubAgentName: definition.Name,
                        ToolUseId: toolCallId,
                        Result: resultJson));

                // Inject completion notification into parent's message queue
                // so the main agent gets informed in its next iteration. When
                // the parent run already finalized, its queue is closed and
                // the injection would be silently dropped — buffer it on the
                // session instead so the renderer can wake the main agent
                // with the report attached.
                var notificationMsg = BuildSubAgentCompletionMessage(
                    toolCallId, definition.Name, description, output, collector);

                var injected = false;
                try
                {
                    injected = parentState.EnqueueMessages(
                        WorkerJsonHelper.BuildJsonElement(w =>
                        {
                            w.WriteStartObject();
                            w.WritePropertyName("messages");
                            w.WriteStartArray();
                            notificationMsg.WriteTo(w);
                            w.WriteEndArray();
                            w.WriteEndObject();
                        })) > 0;
                }
                catch
                {
                    // Parameters may already be disposed after run finalization.
                }

                if (!injected)
                {
                    // Parent queue closed (run finalized) — keep the report for
                    // the session so nothing is lost.
                    BackgroundSubAgentNotifications.Add(parentState.SessionId, notificationMsg);
                    WorkerLog.Info(
                        $"background sub-agent completion buffered session={parentState.SessionId} " +
                        $"toolUseId={toolCallId} (parent run already finalized)");
                }

                WorkerLog.Info(
                    $"background sub-agent completed parentRunId={parentState.RunId} " +
                    $"toolUseId={toolCallId} agent={definition.Name} " +
                    $"outputLen={output.Length} toolCalls={collector.ToolCallCount} " +
                    $"iterations={collector.Iterations}");
            }
            catch (OperationCanceledException) when (childState.IsCancellationRequested)
            {
                BackgroundSubAgentRegistry.MarkCancelled(toolCallId);

                await AgentRuntimeTools.EmitAsync(
                    parentState, context,
                    new AgentRuntimeStreamEvent(
                        "sub_agent_end",
                        SubAgentName: definition.Name,
                        ToolUseId: toolCallId,
                        Result: BuildResultJson(
                            definition.Name, toolCallId, "Sub-agent was cancelled.",
                            false, "cancelled", collector.ToolCallCount, collector.Iterations,
                            reportSubmitted: false)));

                WorkerLog.Info(
                    $"background sub-agent cancelled parentRunId={parentState.RunId} " +
                    $"toolUseId={toolCallId}");
            }
            catch (Exception ex)
            {
                BackgroundSubAgentRegistry.Fail(
                    toolCallId, ex.Message, collector.ToolCallCount, collector.Iterations,
                    BuildToolCallEntries(collector.ToolCallSummaries));

                try
                {
                    await AgentRuntimeTools.EmitAsync(
                        parentState, context,
                        new AgentRuntimeStreamEvent(
                            "sub_agent_end",
                            SubAgentName: definition.Name,
                            ToolUseId: toolCallId,
                            Result: BuildResultJson(
                                definition.Name, toolCallId, $"Sub-agent failed: {ex.Message}",
                                false, "error", collector.ToolCallCount, collector.Iterations,
                                reportSubmitted: false)));
                }
                catch (Exception emitEx)
                {
                    // SA-6: if the failure was a dead transport, EmitAsync would
                    // throw again inside this catch and escape as an unobserved
                    // task exception. Swallow and log instead.
                    WorkerLog.Warn(
                        $"background sub-agent failure emit also failed parentRunId={parentState.RunId} " +
                        $"toolUseId={toolCallId} emitError={emitEx.GetType().Name}: {emitEx.Message}");
                }

                WorkerLog.Warn(
                    $"background sub-agent failed parentRunId={parentState.RunId} " +
                    $"toolUseId={toolCallId} error={ex.GetType().Name}: {ex.Message}");
            }
            finally
            {
                // SA-2: detach the parent-cancellation callback before the
                // child state dies (see registration comment above).
                try { cancellationRegistration.Dispose(); } catch { }
                // S-308：停止句柄必须在 state.Dispose() **之前**注销 —— 之后再 Cancel 会被
                // AgentRuntimeRunState.Cancel 自己吞掉，一条「其实已经停了」的登记会被当成
                // 可停目标。顺序反了就是新一类状态与实际不符。
                SubAgentRunControl.Unregister(toolCallId);
                // The sub-agent conversation is isolated under its runId (see
                // AgentLoop); remove it so isolated conversations don't leak.
                SessionConversationManager.Remove($"__subagent__{childRunId}");
                childState.Dispose();
            }
        });

        // Return immediately with a placeholder result
        var placeholder =
            $"Background sub-agent started.\n" +
            $"  ID: {toolCallId}\n" +
            $"  Agent: {definition.Name}\n" +
            $"  Description: {description}\n" +
            $"The sub-agent is running in the background. Do not block, sleep, or poll for it.\n" +
            $"Continue with other work, or end your turn — when it finishes, its report is delivered to you automatically as a new message.\n" +
            $"Call SubAgentStatus only if you deliberately want a mid-flight progress check.";

        return Task.FromResult(new ToolResult(placeholder));
    }

    // ── Shared helpers ──

    private static JsonElement BuildSubAgentCompletionMessage(
        string toolUseId,
        string agentName,
        string description,
        string output,
        SubAgentRunCollector collector)
    {
        var toolCallSummary = BuildToolCallSummary(collector.ToolCallSummaries);
        var fullReport = string.IsNullOrEmpty(toolCallSummary)
            ? output
            : output + "\n\n" + toolCallSummary;

        var notificationText =
            $"[Background Sub-Agent Completed]\n" +
            $"  ID: {toolUseId}\n" +
            $"  Agent: {agentName}\n" +
            $"  Description: {description}\n" +
            $"  Tool calls: {collector.ToolCallCount}\n" +
            $"  Iterations: {collector.Iterations}\n\n" +
            $"Report:\n{fullReport}";

        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriteOptions))
        {
            writer.WriteStartObject();
            writer.WriteString("id", $"wc_bg_complete_{toolUseId}");
            writer.WriteString("role", "user");
            writer.WritePropertyName("content");
            writer.WriteStartArray();
            writer.WriteStartObject();
            writer.WriteString("type", "text");
            writer.WriteString("text", notificationText);
            writer.WriteEndObject();
            writer.WriteEndArray();
            writer.WriteNumber("createdAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            writer.WriteEndObject();
        }
        using var doc = JsonDocument.Parse(buffer.WrittenMemory);
        return doc.RootElement.Clone();
    }

    // ── Definition resolution ──
}

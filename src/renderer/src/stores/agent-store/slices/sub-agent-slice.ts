import type { StateCreator } from 'zustand'
import type { AgentStore } from '../types'
import { emitAgentRuntimeSync, isAgentRuntimeSyncSuppressed } from '../../../lib/agent-runtime-sync'
import { ipcClient } from '../../../lib/ipc/ipc-client'
import { IPC } from '../../../lib/ipc/channels'
import { MAX_STREAMING_TEXT_CHARS } from '../constants'
import { truncateText, normalizeToolCall } from '../utils/tool-call-utils'
import {
  trimSubAgentTranscript,
  finalizeAssistantMessage,
  mergeMessageUsage,
  appendThinkingToSubAgent,
  appendThinkingEncryptedToSubAgent,
  appendTextToSubAgent,
  appendBlockToSubAgent,
  upsertToolUseBlockInSubAgent,
  updateToolUseInputInSubAgent,
  upsertSubAgentHistory,
  upsertSessionSubAgentSummary,
  buildSubAgentSummary,
  rebuildRunningSubAgentDerived,
  trimCompletedSubAgentsMap,
  compactSubAgentForHistory,
  compactSubAgentListForPersistence,
  compactSessionSubAgentSummariesForPersistence,
  findSubAgentState,
  syncSessionSubAgentState
} from '../utils/sub-agent-utils'
import { changeSetBelongsToSession } from '../utils/change-set-utils'
import { buildBackgroundProcessSummary } from '../utils/background-process-utils'
import {
  queueAgentHistoryPersistence,
  invalidateAgentHistorySession,
  pendingAgentHistoryUpsertIds,
  inFlightAgentHistoryUpsertIds
} from '../sub-agent-persistence'

type Slice = StateCreator<
  AgentStore,
  [['zustand/immer', never], ['zustand/persist', unknown]],
  [],
  Pick<AgentStore, 'handleSubAgentEvent' | 'clearSessionData' | 'releaseDormantSessionData' | 'compactMemoryFootprint'>
>

export const createSubAgentSlice: Slice = (set, _get) => ({
      handleSubAgentEvent: (event, sessionId) => {
        let shouldPersistSubAgentHistory = false
        set((state) => {
          const id = event.toolUseId
          const existing = findSubAgentState(state, id, sessionId)
          switch (event.type) {
            case 'sub_agent_queued': {
              if (existing) return
              state.activeSubAgents[id] = {
                name: event.subAgentName,
                displayName: String(event.input.subagent_type ?? event.subAgentName),
                toolUseId: id,
                sessionId,
                description: String(event.input.description ?? ''),
                prompt: String(
                  event.input.prompt ??
                    event.input.query ??
                    event.input.task ??
                    event.input.target ??
                    ''
                ),
                isRunning: false,
                isQueued: true,
                success: null,
                endReason: null,
                errorMessage: null,
                iteration: 0,
                toolCalls: [],
                streamingText: '',
                transcript: [],
                currentAssistantMessageId: null,
                report: '',
                reportStatus: 'queued',
                usage: undefined,
                requestModel: undefined,
                startedAt: Date.now(),
                completedAt: null
              }
              if (sessionId) {
                syncSessionSubAgentState(state, sessionId, id, state.activeSubAgents[id])
                const previous = state.sessionSubAgentSummaries[sessionId] ?? []
                state.sessionSubAgentSummaries[sessionId] = [
                  buildSubAgentSummary(state.activeSubAgents[id]),
                  ...previous.filter((item) => item.toolUseId !== id)
                ]
                shouldPersistSubAgentHistory = true
              }
              rebuildRunningSubAgentDerived(state)
              break
            }
            case 'sub_agent_dequeued': {
              const sa = findSubAgentState(state, id, sessionId)
              if (sa?.isQueued) {
                delete state.activeSubAgents[id]
                if (sessionId) {
                  const previous = state.sessionSubAgentSummaries[sessionId] ?? []
                  state.sessionSubAgentSummaries[sessionId] = previous.filter(
                    (item) => item.toolUseId !== id
                  )
                  shouldPersistSubAgentHistory = true
                }
                rebuildRunningSubAgentDerived(state)
              }
              break
            }
            case 'sub_agent_start': {
              if (existing?.isQueued) {
                existing.isRunning = true
                existing.isQueued = false
                ;(existing as any).isBackground = Boolean(event.input?.background)
                existing.mcpServerIds = event.mcpServerIds ?? []
                existing.permissionMode = event.permissionMode ?? 'default'
                existing.reportStatus = 'pending'
                existing.transcript = [event.promptMessage]
                existing.startedAt = Date.now()
                if (sessionId) {
                  syncSessionSubAgentState(state, sessionId, id, existing)
                  const previous = state.sessionSubAgentSummaries[sessionId] ?? []
                  state.sessionSubAgentSummaries[sessionId] = [
                    buildSubAgentSummary(existing),
                    ...previous.filter((item) => item.toolUseId !== id)
                  ]
                  shouldPersistSubAgentHistory = true
                }
                rebuildRunningSubAgentDerived(state)
                break
              }
              if (existing) return
              state.activeSubAgents[id] = {
                name: event.subAgentName,
                displayName: String(event.input.subagent_type ?? event.subAgentName),
                toolUseId: id,
                sessionId,
                description: String(event.input.description ?? ''),
                prompt: String(
                  event.input.prompt ??
                    event.input.query ??
                    event.input.task ??
                    event.input.target ??
                    ''
                ),
                isRunning: true,
                isQueued: false,
                ...(Boolean(event.input?.background) ? { isBackground: true } as any : {}),
                success: null,
                endReason: null,
                errorMessage: null,
                iteration: 0,
                toolCalls: [],
                streamingText: '',
                transcript: [event.promptMessage],
                currentAssistantMessageId: null,
                report: '',
                reportStatus: 'pending',
                usage: undefined,
                requestModel: undefined,
                mcpServerIds: event.mcpServerIds ?? [],
                permissionMode: event.permissionMode ?? 'default',
                startedAt: Date.now(),
                completedAt: null
              }
              if (sessionId) {
                syncSessionSubAgentState(state, sessionId, id, state.activeSubAgents[id])
                const previous = state.sessionSubAgentSummaries[sessionId] ?? []
                state.sessionSubAgentSummaries[sessionId] = [
                  buildSubAgentSummary(state.activeSubAgents[id]),
                  ...previous.filter((item) => item.toolUseId !== id)
                ]
                shouldPersistSubAgentHistory = true
              }
              rebuildRunningSubAgentDerived(state)
              break
            }
            case 'sub_agent_iteration': {
              const sa = findSubAgentState(state, id, sessionId)
              if (sa?.isRunning) {
                sa.iteration = event.iteration
                sa.requestModel = event.assistantMessage.meta?.requestModel ?? sa.requestModel
                const currentAssistant = sa.currentAssistantMessageId
                  ? sa.transcript.find((item) => item.id === sa.currentAssistantMessageId)
                  : null
                if (!currentAssistant || currentAssistant.role !== 'assistant') {
                  sa.currentAssistantMessageId = event.assistantMessage.id
                  sa.transcript.push(event.assistantMessage)
                }
              }
              break
            }
            case 'sub_agent_thinking_delta': {
              const sa = findSubAgentState(state, id, sessionId)
              if (sa?.isRunning) appendThinkingToSubAgent(sa, event.thinking)
              break
            }
            case 'sub_agent_thinking_encrypted': {
              const sa = findSubAgentState(state, id, sessionId)
              if (sa?.isRunning) {
                appendThinkingEncryptedToSubAgent(
                  sa,
                  event.thinkingEncryptedContent,
                  event.thinkingEncryptedProvider
                )
              }
              break
            }
            case 'sub_agent_tool_use_streaming_start': {
              const sa = findSubAgentState(state, id, sessionId)
              if (sa?.isRunning) {
                upsertToolUseBlockInSubAgent(sa, {
                  type: 'tool_use',
                  id: event.toolCallId,
                  name: event.toolName,
                  input: {},
                  ...(event.toolCallExtraContent
                    ? { extraContent: event.toolCallExtraContent }
                    : {})
                })
              }
              break
            }
            case 'sub_agent_tool_use_args_delta': {
              const sa = findSubAgentState(state, id, sessionId)
              if (sa?.isRunning) {
                updateToolUseInputInSubAgent(sa, event.toolCallId, event.partialInput)
              }
              break
            }
            case 'sub_agent_tool_use_generated': {
              const sa = findSubAgentState(state, id, sessionId)
              if (sa?.isRunning) upsertToolUseBlockInSubAgent(sa, event.toolUseBlock)
              break
            }
            case 'sub_agent_image_generated': {
              const sa = findSubAgentState(state, id, sessionId)
              if (sa?.isRunning) appendBlockToSubAgent(sa, event.imageBlock)
              break
            }
            case 'sub_agent_image_error': {
              const sa = findSubAgentState(state, id, sessionId)
              if (sa?.isRunning) {
                appendBlockToSubAgent(sa, {
                  type: 'image_error',
                  code: event.imageError.code,
                  message: event.imageError.message
                })
              }
              break
            }
            case 'sub_agent_message_end': {
              const sa = findSubAgentState(state, id, sessionId)
              if (sa?.isRunning) {
                finalizeAssistantMessage(
                  sa,
                  event.usage,
                  event.providerResponseId,
                  false,
                  event.requestModel
                )
                sa.requestModel = event.requestModel ?? sa.requestModel
                if (event.usage) {
                  sa.usage = mergeMessageUsage(sa.usage, event.usage)
                }
                upsertSubAgentHistory(state.subAgentHistory, sa)
                upsertSessionSubAgentSummary(state, sa, sessionId)
                shouldPersistSubAgentHistory = true
              }
              break
            }
            case 'sub_agent_tool_result_message': {
              const sa = findSubAgentState(state, id, sessionId)
              if (sa?.isRunning) {
                sa.transcript.push(event.message)
                trimSubAgentTranscript(sa)
                upsertSubAgentHistory(state.subAgentHistory, sa)
                upsertSessionSubAgentSummary(state, sa, sessionId)
                shouldPersistSubAgentHistory = true
              }
              break
            }
            case 'sub_agent_user_message': {
              const sa = findSubAgentState(state, id, sessionId)
              if (sa?.isRunning) {
                if (sa.transcript.some((message) => message.id === event.message.id)) break
                finalizeAssistantMessage(sa)
                sa.transcript.push(event.message)
                trimSubAgentTranscript(sa)
                upsertSubAgentHistory(state.subAgentHistory, sa)
                upsertSessionSubAgentSummary(state, sa, sessionId)
                shouldPersistSubAgentHistory = true
              }
              break
            }
            case 'sub_agent_report_update': {
              const sa = findSubAgentState(state, id, sessionId)
              if (sa) {
                sa.report = event.report
                sa.reportStatus = event.status
                upsertSubAgentHistory(state.subAgentHistory, sa)
                upsertSessionSubAgentSummary(state, sa, sessionId)
                shouldPersistSubAgentHistory = true
              }
              break
            }
            case 'sub_agent_tool_call': {
              const sa = findSubAgentState(state, id, sessionId)
              if (sa?.isRunning) {
                const normalizedToolCall = normalizeToolCall(event.toolCall)
                upsertToolUseBlockInSubAgent(sa, {
                  type: 'tool_use',
                  id: normalizedToolCall.id,
                  name: normalizedToolCall.name,
                  input: normalizedToolCall.input,
                  ...(normalizedToolCall.extraContent
                    ? { extraContent: normalizedToolCall.extraContent }
                    : {})
                })
                const existingTc = sa.toolCalls.find((t) => t.id === normalizedToolCall.id)
                if (existingTc) {
                  Object.assign(existingTc, normalizedToolCall)
                } else {
                  sa.toolCalls.push(normalizedToolCall)
                }
              }
              break
            }
            case 'sub_agent_text_delta': {
              const sa = findSubAgentState(state, id, sessionId)
              if (sa?.isRunning) {
                sa.streamingText = truncateText(
                  sa.streamingText + event.text,
                  MAX_STREAMING_TEXT_CHARS
                )
                appendTextToSubAgent(sa, event.text)
              }
              break
            }
            case 'sub_agent_end': {
              const sa = findSubAgentState(state, id, sessionId)
              if (sa) {
                sa.isRunning = false
                sa.success = event.result.success
                sa.endReason =
                  event.result.endReason ?? (event.result.success ? 'completed' : 'error')
                sa.errorMessage = event.result.error ?? null
                sa.completedAt = Date.now()
                if (
                  event.result.messages?.length &&
                  event.result.messages.length >= sa.transcript.length
                ) {
                  sa.transcript = event.result.messages
                  sa.currentAssistantMessageId = null
                } else {
                  finalizeAssistantMessage(sa)
                }
                // 权威报告以 Worker 的 result.output 为准 —— 它是子 agent 全部文本输出的
                // 拼接，而 sa.report 只是流式累积：父 run 提前结束时后者只到前几轮就断了。
                // 仅当权威结果更长时才覆盖，避免用兜底文案冲掉已有的流式内容。
                const authoritativeReport = event.result.output.trim()
                if (authoritativeReport.length > sa.report.trim().length) {
                  sa.report = event.result.output
                }
                if (event.result.reportSubmitted && authoritativeReport) {
                  // 留一份给持久化，重载会话时用它把 report 补全。
                  sa.finalOutput = event.result.output
                }
                sa.usage = event.result.usage
                sa.reportStatus = event.result.reportSubmitted
                  ? sa.reportStatus === 'fallback'
                    ? 'fallback'
                    : 'submitted'
                  : 'missing'
                state.completedSubAgents[id] = sa
                const targetSessionId = sa.sessionId ?? sessionId
                if (targetSessionId) {
                  syncSessionSubAgentState(state, targetSessionId, id, sa)
                  const previous = state.sessionSubAgentSummaries[targetSessionId] ?? []
                  state.sessionSubAgentSummaries[targetSessionId] = [
                    buildSubAgentSummary(sa),
                    ...previous.filter((item) => item.toolUseId !== id)
                  ]
                }
                upsertSubAgentHistory(state.subAgentHistory, sa)
                shouldPersistSubAgentHistory = true
                trimCompletedSubAgentsMap(state.completedSubAgents)
                delete state.activeSubAgents[id]
                rebuildRunningSubAgentDerived(state)
              }
              break
            }
          }
        })
        if (shouldPersistSubAgentHistory) {
          queueAgentHistoryPersistence({ upsertIds: [event.toolUseId] })
        }
        if (!isAgentRuntimeSyncSuppressed()) {
          emitAgentRuntimeSync({ kind: 'subagent_event', event, sessionId })
        }
      },
      clearSessionData: (sessionId) => {
        const processIdsToKill: string[] = []
        const shellExecIdsToAbort: string[] = []
        set((state) => {
          for (const [key, sa] of Object.entries(state.activeSubAgents)) {
            if (sa.sessionId === sessionId) delete state.activeSubAgents[key]
          }
          rebuildRunningSubAgentDerived(state)
          for (const [key, sa] of Object.entries(state.completedSubAgents)) {
            if (sa.sessionId === sessionId) delete state.completedSubAgents[key]
          }
          state.subAgentHistory = state.subAgentHistory.filter((sa) => sa.sessionId !== sessionId)
          delete state.sessionSubAgentSummaries[sessionId]
          delete state.sessionToolCallsCache[sessionId]
          delete state.sessionSubAgentLiveCache[sessionId]

          if (state.liveSessionId === sessionId) {
            state.pendingToolCalls = []
            state.executedToolCalls = []
            state.activeSubAgents = {}
            state.completedSubAgents = {}
          }

          for (const [runId, changeSet] of Object.entries(state.runChangesByRunId)) {
            if (changeSetBelongsToSession(changeSet, sessionId)) {
              delete state.runChangesByRunId[runId]
            }
          }

          rebuildRunningSubAgentDerived(state)

          for (const [key, shellExec] of Object.entries(state.foregroundShellExecByToolUseId)) {
            if (shellExec.sessionId === sessionId) {
              shellExecIdsToAbort.push(shellExec.execId)
              delete state.foregroundShellExecByToolUseId[key]
            }
          }

          for (const [key, process] of Object.entries(state.backgroundProcesses)) {
            if (process.sessionId === sessionId) {
              processIdsToKill.push(key)
              delete state.backgroundProcesses[key]
            }
          }
          delete state.sessionBackgroundProcessSummaries[sessionId]
        })
        invalidateAgentHistorySession(sessionId)
        queueAgentHistoryPersistence({ removeSessionIds: [sessionId] })
        for (const id of processIdsToKill) {
          ipcClient.invoke(IPC.PROCESS_KILL, { id }).catch(() => {})
        }
        for (const execId of shellExecIdsToAbort) {
          ipcClient.send(IPC.SHELL_ABORT, { execId })
        }
      },
      releaseDormantSessionData: (residentSessionIds) => {
        const residentSet = new Set(residentSessionIds)
        const evictedSessionIds: string[] = []
        set((state) => {
          const targetSessionIds = new Set<string>([
            ...Object.keys(state.sessionToolCallsCache),
            ...Object.keys(state.sessionSubAgentLiveCache),
            ...Object.keys(state.sessionSubAgentSummaries),
            ...Object.keys(state.sessionBackgroundProcessSummaries),
            ...state.subAgentHistory
              .map((agent) => agent.sessionId)
              .filter((sessionId): sessionId is string => Boolean(sessionId))
          ])

          for (const sessionId of targetSessionIds) {
            if (residentSet.has(sessionId)) continue

            const subAgents = state.sessionSubAgentSummaries[sessionId] ?? []
            const hasPendingHistoryWrite =
              subAgents.some(
                (agent) =>
                  pendingAgentHistoryUpsertIds.has(agent.toolUseId) ||
                  inFlightAgentHistoryUpsertIds.has(agent.toolUseId)
              ) ||
              state.subAgentHistory.some(
                (agent) =>
                  agent.sessionId === sessionId &&
                  (pendingAgentHistoryUpsertIds.has(agent.toolUseId) ||
                    inFlightAgentHistoryUpsertIds.has(agent.toolUseId))
              )
            if (
              hasPendingHistoryWrite ||
              state.liveSessionId === sessionId ||
              state.runningSessions[sessionId] === 'running' ||
              state.runningSessions[sessionId] === 'retrying'
            ) {
              continue
            }

            delete state.sessionToolCallsCache[sessionId]
            delete state.sessionSubAgentLiveCache[sessionId]
            delete state.sessionSubAgentSummaries[sessionId]
            evictedSessionIds.push(sessionId)

            const processes = state.sessionBackgroundProcessSummaries[sessionId]
            if (processes && processes.length > 0) {
              state.sessionBackgroundProcessSummaries[sessionId] = processes.map(
                buildBackgroundProcessSummary
              )
            }
          }

          if (evictedSessionIds.length > 0) {
            const evictedSet = new Set(evictedSessionIds)
            state.subAgentHistory = state.subAgentHistory.filter(
              (agent) => !agent.sessionId || !evictedSet.has(agent.sessionId)
            )
          }
        })
        for (const sessionId of evictedSessionIds) {
          invalidateAgentHistorySession(sessionId)
        }
      },
      compactMemoryFootprint: () => {
        set((state) => {
          for (const subAgent of Object.values(state.activeSubAgents)) {
            trimSubAgentTranscript(subAgent)
            if (subAgent.streamingText.length > MAX_STREAMING_TEXT_CHARS) {
              subAgent.streamingText = truncateText(
                subAgent.streamingText,
                MAX_STREAMING_TEXT_CHARS
              )
            }
          }

          for (const [id, subAgent] of Object.entries(state.completedSubAgents)) {
            state.completedSubAgents[id] = compactSubAgentForHistory(subAgent)
          }
          trimCompletedSubAgentsMap(state.completedSubAgents)

          for (const liveState of Object.values(state.sessionSubAgentLiveCache)) {
            for (const subAgent of Object.values(liveState.active)) {
              trimSubAgentTranscript(subAgent)
            }
            for (const [id, subAgent] of Object.entries(liveState.completed)) {
              liveState.completed[id] = compactSubAgentForHistory(subAgent)
            }
            trimCompletedSubAgentsMap(liveState.completed)
          }

          state.subAgentHistory = compactSubAgentListForPersistence(state.subAgentHistory)
          state.sessionSubAgentSummaries = compactSessionSubAgentSummariesForPersistence(
            state.sessionSubAgentSummaries
          )
          rebuildRunningSubAgentDerived(state)
        })
      },
})

import type { StateCreator } from 'zustand'
import type { AgentStore } from '../types'
import { emitAgentRuntimeSync, isAgentRuntimeSyncSuppressed } from '../../../lib/agent-runtime-sync'
import { useTeamStore } from '../../team-store'
import { sigHasEntry, cloneToolCallArray } from '../utils/tool-call-utils'
import { cloneSubAgentMap, rebuildRunningSubAgentDerived } from '../utils/sub-agent-utils'
import {
  loadAgentHistorySession,
  incrementAgentHistoryLoadEpoch,
  clearLoadedAgentHistorySessionIds
} from '../sub-agent-persistence'
import { approvalResolvers } from '../approval-resolvers'

type Slice = StateCreator<
  AgentStore,
  [['zustand/immer', never], ['zustand/persist', unknown]],
  [],
  Pick<AgentStore, 'setRunning' | 'setCurrentLoopId' | 'setSessionStatus' | 'setSessionRequestRetryState' | 'isSessionActive' | 'switchToolCallSession' | 'loadSubAgentHistoryForSession' | 'resetLiveSessionExecution' | 'clearToolCalls' | 'abort'>
>

export const createSessionSlice: Slice = (set, get) => ({
      setRunning: (running) => {
        set({ isRunning: running })
        if (!isAgentRuntimeSyncSuppressed()) {
          emitAgentRuntimeSync({ kind: 'set_running', running })
        }
      },
      setCurrentLoopId: (id) => set({ currentLoopId: id }),
      setSessionStatus: (sessionId, status) => {
        set((state) => {
          if (status) {
            state.runningSessions[sessionId] = status
          } else {
            delete state.runningSessions[sessionId]
            delete state.sessionRequestRetryState[sessionId]
          }
        })
        if (!isAgentRuntimeSyncSuppressed()) {
          emitAgentRuntimeSync({ kind: 'set_session_status', sessionId, status })
        }
        if (status === 'completed') {
          setTimeout(() => {
            set((state) => {
              if (state.runningSessions[sessionId] === 'completed') {
                delete state.runningSessions[sessionId]
                delete state.sessionRequestRetryState[sessionId]
              }
            })
          }, 3000)
        }
      },
      setSessionRequestRetryState: (sessionId, requestRetryState) => {
        const previousStatus = get().runningSessions[sessionId]
        set((state) => {
          if (requestRetryState) {
            state.sessionRequestRetryState[sessionId] = requestRetryState
            state.runningSessions[sessionId] = 'retrying'
          } else {
            delete state.sessionRequestRetryState[sessionId]
            if (state.runningSessions[sessionId] === 'retrying') {
              state.runningSessions[sessionId] = 'running'
            }
          }
        })
        const nextStatus = get().runningSessions[sessionId] ?? null
        if (!isAgentRuntimeSyncSuppressed() && previousStatus !== nextStatus) {
          emitAgentRuntimeSync({ kind: 'set_session_status', sessionId, status: nextStatus })
        }
      },
      isSessionActive: (sessionId) => {
        if (!sessionId) return false
        const state = get()
        if (
          state.runningSessions[sessionId] === 'running' ||
          state.runningSessions[sessionId] === 'retrying'
        ) {
          return true
        }
        if (sigHasEntry(state.runningSubAgentSessionIdsSig, sessionId)) return true
        if (
          Object.values(state.backgroundProcesses).some(
            (process) => process.sessionId === sessionId && process.status === 'running'
          )
        ) {
          return true
        }
        if (useTeamStore.getState().activeTeam?.sessionId === sessionId) return true
        return false
      },
      switchToolCallSession: (prevSessionId, nextSessionId) => {
        set((state) => {
          if (prevSessionId) {
            state.sessionToolCallsCache[prevSessionId] = {
              pending: cloneToolCallArray(state.pendingToolCalls),
              executed: cloneToolCallArray(state.executedToolCalls)
            }
            state.sessionSubAgentLiveCache[prevSessionId] = {
              active: cloneSubAgentMap(
                Object.fromEntries(
                  Object.entries(state.activeSubAgents).filter(
                    ([, subAgent]) => subAgent.sessionId === prevSessionId
                  )
                )
              ),
              completed: cloneSubAgentMap(
                Object.fromEntries(
                  Object.entries(state.completedSubAgents).filter(
                    ([, subAgent]) => subAgent.sessionId === prevSessionId
                  )
                )
              )
            }
          }

          const cached = nextSessionId ? state.sessionToolCallsCache[nextSessionId] : undefined
          const subAgentCache = nextSessionId
            ? state.sessionSubAgentLiveCache[nextSessionId]
            : undefined
          state.liveSessionId = nextSessionId
          state.pendingToolCalls = cloneToolCallArray(cached?.pending ?? [])
          state.executedToolCalls = cloneToolCallArray(cached?.executed ?? [])
          state.activeSubAgents = cloneSubAgentMap(subAgentCache?.active ?? {})
          state.completedSubAgents = cloneSubAgentMap(subAgentCache?.completed ?? {})
          rebuildRunningSubAgentDerived(state)

          const cacheKeys = Object.keys(state.sessionToolCallsCache)
          if (cacheKeys.length > 10) {
            const toRemove = cacheKeys.slice(0, cacheKeys.length - 10)
            for (const key of toRemove) {
              delete state.sessionToolCallsCache[key]
              delete state.sessionSubAgentLiveCache[key]
            }
          }
        })
        // Sub-agent history is loaded on-demand by toolUseId when user clicks a sub-agent message
        // No bulk session-level load needed
      },
      loadSubAgentHistoryForSession: loadAgentHistorySession,

      resetLiveSessionExecution: (sessionId) => {
        set((state) => {
          delete state.sessionToolCallsCache[sessionId]

          // S-191: 只清「已结束」的子 agent。后台子 agent 的生命周期独立于父 run
          //（S-180 设计）—— 起新一轮或收尾时把仍在跑的一起清掉，它们的 sub_agent_end
          // 会因找不到收敛目标被静默丢弃，卡片永挂「工作中」。保留集同时写回 live
          // 缓存，使紧随其后的 switchToolCallSession(null, sessionId) 恢复保留集而非空表。
          const keepRunning = (map: typeof state.activeSubAgents) =>
            Object.fromEntries(
              Object.entries(map).filter(
                ([, subAgent]) => subAgent.isRunning || subAgent.isQueued
              )
            )

          if (state.liveSessionId !== sessionId) {
            const cached = state.sessionSubAgentLiveCache[sessionId]
            state.sessionSubAgentLiveCache[sessionId] = {
              active: cloneSubAgentMap(keepRunning(cached?.active ?? {})),
              completed: {}
            }
            return
          }

          state.pendingToolCalls = []
          state.executedToolCalls = []
          state.activeSubAgents = cloneSubAgentMap(keepRunning(state.activeSubAgents))
          state.completedSubAgents = {}
          state.sessionSubAgentLiveCache[sessionId] = {
            active: cloneSubAgentMap(state.activeSubAgents),
            completed: {}
          }
          rebuildRunningSubAgentDerived(state)
        })
      },
      clearToolCalls: () => {
        set((state) => {
          state.liveSessionId = null
          state.pendingToolCalls = []
          state.executedToolCalls = []
          state.activeSubAgents = {}
          state.completedSubAgents = {}
          state.runningSubAgentNamesSig = ''
          state.runningSubAgentSessionIdsSig = ''
          state.approvedToolNames = []
          state.foregroundShellExecByToolUseId = {}
          state.sessionToolCallsCache = {}
          state.sessionSubAgentLiveCache = {}
          state.sessionSubAgentSummaries = {}
          state.sessionBackgroundProcessSummaries = {}
        })
        incrementAgentHistoryLoadEpoch()
        clearLoadedAgentHistorySessionIds()
      },
      abort: () => {
        set({ isRunning: false, currentLoopId: null })
        for (const [, resolve] of approvalResolvers) {
          resolve(false)
        }
        approvalResolvers.clear()
      },
})

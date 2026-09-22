import type { StateCreator } from 'zustand'
import type { AgentStore, BackgroundProcessState, ProcessListItem, ProcessOutputEvent, BufferedProcessOutputEvent } from '../types'
import { ipcClient } from '../../../lib/ipc/ipc-client'
import { IPC } from '../../../lib/ipc/channels'
import {
  MAX_BACKGROUND_PROCESS_ENTRIES,
  BACKGROUND_PROCESS_OUTPUT_FLUSH_MS
} from '../constants'
import {
  appendBackgroundOutput,
  trimBackgroundProcessMap,
  buildBackgroundProcessSummary,
  applyProcessOutputEvent
} from '../utils/background-process-utils'
import { useAgentStore } from '../index'

let processTrackingInitialized = false

type Slice = StateCreator<
  AgentStore,
  [['zustand/immer', never], ['zustand/persist', unknown]],
  [],
  Pick<AgentStore, 'registerForegroundShellExec' | 'updateForegroundShellExec' | 'clearForegroundShellExec' | 'abortForegroundShellExec' | 'initBackgroundProcessTracking' | 'registerBackgroundProcess' | 'stopBackgroundProcess' | 'sendBackgroundProcessInput' | 'removeBackgroundProcess'>
>

export const createBackgroundProcessSlice: Slice = (set, _get) => ({
      registerForegroundShellExec: (toolUseId, execId, metadata) => {
        set((state) => {
          const now = Date.now()
          state.foregroundShellExecByToolUseId[toolUseId] = {
            execId,
            command: metadata?.command,
            cwd: metadata?.cwd,
            sessionId: metadata?.sessionId,
            startedAt: state.foregroundShellExecByToolUseId[toolUseId]?.startedAt ?? now,
            updatedAt: now
          }
        })
      },
      updateForegroundShellExec: (toolUseId, patch) => {
        set((state) => {
          const current = state.foregroundShellExecByToolUseId[toolUseId]
          if (!current) return
          state.foregroundShellExecByToolUseId[toolUseId] = {
            ...current,
            ...patch,
            updatedAt: Date.now()
          }
        })
      },
      clearForegroundShellExec: (toolUseId) => {
        set((state) => {
          delete state.foregroundShellExecByToolUseId[toolUseId]
        })
      },
      abortForegroundShellExec: async (toolUseId) => {
        const exec = useAgentStore.getState().foregroundShellExecByToolUseId[toolUseId]
        // C# 侧按 tool call id 登记运行中的进程，toolUseId 本身就是那个 id；
        // 显式 execId 只在这条老路径（foregroundShellExecByToolUseId 被填充时）才有。
        // 注册点可能为空，所以回退到 toolUseId（iter-34 S-137）。
        const execId = exec?.execId ?? toolUseId
        if (!execId) return
        await ipcClient.invoke(IPC.SHELL_ABORT, { execId })
        set((state) => {
          delete state.foregroundShellExecByToolUseId[toolUseId]
        })
      },
      initBackgroundProcessTracking: async () => {
        if (processTrackingInitialized) return
        processTrackingInitialized = true

        try {
          const list = (await ipcClient.invoke(IPC.PROCESS_LIST)) as ProcessListItem[]
          set((state) => {
            for (const item of list) {
              const existing = state.backgroundProcesses[item.id]
              const nextProcess = {
                id: item.id,
                command: item.command ?? existing?.command ?? '',
                cwd: item.cwd ?? existing?.cwd,
                sessionId: item.metadata?.sessionId ?? existing?.sessionId,
                toolUseId: item.metadata?.toolUseId ?? existing?.toolUseId,
                description: item.metadata?.description ?? existing?.description,
                source: item.metadata?.source ?? existing?.source,
                terminalId: item.metadata?.terminalId ?? existing?.terminalId,
                status: item.running === false ? 'exited' : 'running',
                output: existing?.output ?? '',
                port: item.port ?? existing?.port,
                exitCode: item.exitCode ?? existing?.exitCode,
                createdAt: item.createdAt ?? existing?.createdAt ?? Date.now(),
                updatedAt: Date.now()
              } satisfies BackgroundProcessState
              state.backgroundProcesses[item.id] = nextProcess
              if (nextProcess.sessionId) {
                const previous =
                  state.sessionBackgroundProcessSummaries[nextProcess.sessionId] ?? []
                state.sessionBackgroundProcessSummaries[nextProcess.sessionId] = [
                  buildBackgroundProcessSummary(nextProcess),
                  ...previous.filter((process) => process.id !== nextProcess.id)
                ].slice(0, MAX_BACKGROUND_PROCESS_ENTRIES)
              }
            }
            trimBackgroundProcessMap(state.backgroundProcesses)
          })
        } catch (err) {
          console.error('[AgentStore] Failed to load process list:', err)
        }

        const bufferedProcessOutputs = new Map<string, BufferedProcessOutputEvent>()
        let bufferedProcessOutputTimer: ReturnType<typeof setTimeout> | null = null

        const flushBufferedProcessOutputs = (): void => {
          if (bufferedProcessOutputTimer) {
            clearTimeout(bufferedProcessOutputTimer)
            bufferedProcessOutputTimer = null
          }
          if (bufferedProcessOutputs.size === 0) return

          const pending = Array.from(bufferedProcessOutputs.values())
          bufferedProcessOutputs.clear()
          set((state) => {
            const now = Date.now()
            for (const payload of pending) {
              const nextProcess = applyProcessOutputEvent(
                state.backgroundProcesses[payload.id],
                payload,
                now
              )
              state.backgroundProcesses[payload.id] = nextProcess
              if (nextProcess.sessionId) {
                const previous =
                  state.sessionBackgroundProcessSummaries[nextProcess.sessionId] ?? []
                state.sessionBackgroundProcessSummaries[nextProcess.sessionId] = [
                  buildBackgroundProcessSummary(nextProcess),
                  ...previous.filter((process) => process.id !== nextProcess.id)
                ].slice(0, MAX_BACKGROUND_PROCESS_ENTRIES)
              }
            }
            trimBackgroundProcessMap(state.backgroundProcesses)
          })
        }

        const scheduleBufferedProcessOutputFlush = (): void => {
          if (bufferedProcessOutputTimer) return
          bufferedProcessOutputTimer = setTimeout(() => {
            flushBufferedProcessOutputs()
          }, BACKGROUND_PROCESS_OUTPUT_FLUSH_MS)
        }

        ipcClient.on(IPC.PROCESS_OUTPUT, (...args: unknown[]) => {
          const payload = args[0] as ProcessOutputEvent | undefined
          if (!payload?.id) return

          const existing = bufferedProcessOutputs.get(payload.id)
          bufferedProcessOutputs.set(payload.id, {
            id: payload.id,
            data: `${existing?.data ?? ''}${payload.data ?? ''}`,
            port: payload.port ?? existing?.port,
            exited: payload.exited ?? existing?.exited,
            exitCode: payload.exitCode ?? existing?.exitCode,
            metadata: payload.metadata
              ? { ...(existing?.metadata ?? {}), ...payload.metadata }
              : existing?.metadata
          })

          if (payload.exited) {
            flushBufferedProcessOutputs()
            return
          }

          scheduleBufferedProcessOutputFlush()
        })
      },
      registerBackgroundProcess: (process) => {
        set((state) => {
          const now = Date.now()
          const nextProcess = {
            id: process.id,
            command: process.command,
            cwd: process.cwd,
            sessionId: process.sessionId,
            toolUseId: process.toolUseId,
            description: process.description,
            source: process.source,
            terminalId: process.terminalId,
            status: 'running',
            output: state.backgroundProcesses[process.id]?.output ?? '',
            port: state.backgroundProcesses[process.id]?.port,
            exitCode: undefined,
            createdAt: state.backgroundProcesses[process.id]?.createdAt ?? now,
            updatedAt: now
          } satisfies BackgroundProcessState
          state.backgroundProcesses[process.id] = nextProcess
          if (nextProcess.sessionId) {
            const previous = state.sessionBackgroundProcessSummaries[nextProcess.sessionId] ?? []
            state.sessionBackgroundProcessSummaries[nextProcess.sessionId] = [
              buildBackgroundProcessSummary(nextProcess),
              ...previous.filter((item) => item.id !== nextProcess.id)
            ].slice(0, MAX_BACKGROUND_PROCESS_ENTRIES)
          }
          trimBackgroundProcessMap(state.backgroundProcesses)
        })
      },
      stopBackgroundProcess: async (id) => {
        set((state) => {
          const process = state.backgroundProcesses[id]
          if (!process) return
          process.updatedAt = Date.now()
          process.status = 'stopped'
          process.output = appendBackgroundOutput(process.output, '\n[Stopping process...]\n')
        })

        const result = (await ipcClient.invoke(IPC.PROCESS_KILL, { id })) as {
          success?: boolean
          error?: string
        }

        set((state) => {
          const process = state.backgroundProcesses[id]
          if (!process) return
          process.updatedAt = Date.now()
          if (result?.success) {
            process.output = appendBackgroundOutput(process.output, '[Stopped by user]\n')
            return
          }
          if (result?.error && result.error.includes('Process not found')) {
            process.output = appendBackgroundOutput(process.output, '[Process already exited]\n')
            return
          }
          process.status = 'error'
          process.output = appendBackgroundOutput(
            process.output,
            `[Stop failed: ${result?.error ?? 'Unknown error'}]\n`
          )
        })
      },
      sendBackgroundProcessInput: async (id, input, appendNewline = true) => {
        const result = (await ipcClient.invoke(IPC.PROCESS_WRITE, {
          id,
          input,
          appendNewline
        })) as { success?: boolean; error?: string }
        set((state) => {
          const process = state.backgroundProcesses[id]
          if (!process) return
          process.updatedAt = Date.now()
          if (result?.success) {
            const displayInput = input === '\u0003' ? '^C' : input
            process.output = appendBackgroundOutput(process.output, `\n$ ${displayInput}\n`)
            return
          }
          process.status = 'error'
          process.output = appendBackgroundOutput(
            process.output,
            `\n[Input failed: ${result?.error ?? 'Unknown error'}]\n`
          )
        })
      },
      removeBackgroundProcess: (id) => {
        set((state) => {
          delete state.backgroundProcesses[id]
        })
      },
})

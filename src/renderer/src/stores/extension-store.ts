/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { ipcStorage } from '@renderer/lib/ipc/ipc-storage'
import { useChatStore } from '@renderer/stores/chat-store'
import type { ExtensionInstance } from '../../../shared/extension-types'

export interface ExtensionAggregateInfo {
  declared: {
    skills: number
    agents: number
    commands: number
    mcpServers: number
    state: boolean
  }
  workflows: string[]
  synced: {
    skills: string[]
    agents: number
    commands: number
    mcpServers: string[]
    syncedAt: number
  } | null
}

interface ExtensionStore {
  extensions: ExtensionInstance[]
  loaded: boolean
  activeExtensionIdsByProject: Record<string, string[]>
  loadExtensions: () => Promise<void>
  installFromFolder: (sourcePath: string) => Promise<{ success: boolean; error?: string }>
  updateExtension: (
    id: string,
    patch: { enabled?: boolean; config?: Record<string, string> }
  ) => Promise<{ success: boolean; error?: string; syncWarnings?: string[] }>
  getAggregateInfo: (id: string) => Promise<ExtensionAggregateInfo | null>
  removeExtension: (id: string) => Promise<{
    success: boolean
    error?: string
    /** 清理没做干净的原因（S-244）：分区目录被占用之类，不影响卸载结果 */
    cleanupWarnings?: string[]
  }>
  openExtensionFolder: (id: string) => Promise<{ success: boolean; error?: string }>
  toggleActiveExtension: (id: string, projectId?: string | null) => void
  clearActiveExtensions: (projectId?: string | null) => void
  getActiveExtensionIds: (projectId?: string | null) => string[]
  getActiveExtensions: (projectId?: string | null) => ExtensionInstance[]
}

const GLOBAL_PROJECT_EXTENSION_KEY = '__global__'

function normalizeExtensions(value: unknown): ExtensionInstance[] {
  return Array.isArray(value) ? (value as ExtensionInstance[]) : []
}

function resolveProjectExtensionKey(projectId?: string | null): string {
  return projectId ?? GLOBAL_PROJECT_EXTENSION_KEY
}

function sanitizeActiveIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function removeActiveExtensionId(
  activeExtensionIdsByProject: Record<string, string[]>,
  id: string
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(activeExtensionIdsByProject).map(([projectId, ids]) => [
      projectId,
      sanitizeActiveIds(ids).filter((activeId) => activeId !== id)
    ])
  )
}

export function resolveEffectiveActiveExtensionIds(params: {
  projectId?: string | null
  activeExtensionIdsByProject: Record<string, string[]>
  extensions: ExtensionInstance[]
}): string[] {
  const projectKey = resolveProjectExtensionKey(params.projectId)
  const availableIds = new Set(
    params.extensions.filter((extension) => extension.enabled).map((extension) => extension.id)
  )
  return sanitizeActiveIds(params.activeExtensionIdsByProject[projectKey]).filter((id) =>
    availableIds.has(id)
  )
}

export const useExtensionStore = create<ExtensionStore>()(
  persist(
    (set, get) => ({
      extensions: [],
      loaded: false,
      activeExtensionIdsByProject: {},

      loadExtensions: async () => {
        try {
          const result = await ipcClient.invoke(IPC.EXTENSION_LIST)
          set({ extensions: normalizeExtensions(result), loaded: true })
        } catch (err) {
          console.error('[Extensions] Failed to load extensions:', err)
          set({ extensions: [], loaded: true })
        }
      },

      installFromFolder: async (sourcePath) => {
        const result = (await ipcClient.invoke(IPC.EXTENSION_INSTALL_FROM_FOLDER, {
          sourcePath
        })) as { success: boolean; error?: string }
        await get().loadExtensions()
        return result
      },

      getAggregateInfo: async (id) => {
        try {
          const result = await ipcClient.invoke(IPC.EXTENSION_AGGREGATE_INFO, id)
          return (result as ExtensionAggregateInfo) ?? null
        } catch (err) {
          console.error('[Extensions] Failed to load aggregate info:', err)
          return null
        }
      },

      updateExtension: async (id, patch) => {
        const result = (await ipcClient.invoke(IPC.EXTENSION_UPDATE, {
          id,
          patch
        })) as { success: boolean; error?: string; syncWarnings?: string[] }
        await get().loadExtensions()
        if (result.success && patch.enabled === false) {
          set((state) => ({
            activeExtensionIdsByProject: removeActiveExtensionId(
              state.activeExtensionIdsByProject,
              id
            )
          }))
        }
        return result
      },

      removeExtension: async (id) => {
        const result = (await ipcClient.invoke(IPC.EXTENSION_REMOVE, id)) as {
          success: boolean
          error?: string
          cleanupWarnings?: string[]
        }
        await get().loadExtensions()
        if (result.success) {
          set((state) => ({
            activeExtensionIdsByProject: removeActiveExtensionId(
              state.activeExtensionIdsByProject,
              id
            )
          }))
        }
        return result
      },

      openExtensionFolder: async (id) => {
        return (await ipcClient.invoke(IPC.EXTENSION_OPEN_FOLDER, id)) as {
          success: boolean
          error?: string
        }
      },

      getActiveExtensionIds: (projectId) => {
        const resolvedProjectId = projectId ?? useChatStore.getState().activeProjectId ?? null
        const { activeExtensionIdsByProject, extensions } = get()
        return resolveEffectiveActiveExtensionIds({
          projectId: resolvedProjectId,
          activeExtensionIdsByProject,
          extensions
        })
      },

      getActiveExtensions: (projectId) => {
        const activeExtensionIds = get().getActiveExtensionIds(projectId)
        return get().extensions.filter(
          (extension) => extension.enabled && activeExtensionIds.includes(extension.id)
        )
      },

      toggleActiveExtension: (id, projectId) => {
        const resolvedProjectId = projectId ?? useChatStore.getState().activeProjectId ?? null
        const extension = get().extensions.find((item) => item.id === id)
        if (!extension?.enabled) return

        set((state) => {
          const projectKey = resolveProjectExtensionKey(resolvedProjectId)
          const currentIds = sanitizeActiveIds(state.activeExtensionIdsByProject[projectKey])
          const isActive = currentIds.includes(id)
          return {
            activeExtensionIdsByProject: {
              ...state.activeExtensionIdsByProject,
              [projectKey]: isActive
                ? currentIds.filter((activeId) => activeId !== id)
                : [...currentIds, id]
            }
          }
        })
      },

      clearActiveExtensions: (projectId) => {
        const resolvedProjectId = projectId ?? useChatStore.getState().activeProjectId ?? null
        set((state) => ({
          activeExtensionIdsByProject: {
            ...state.activeExtensionIdsByProject,
            [resolveProjectExtensionKey(resolvedProjectId)]: []
          }
        }))
      }
    }),
    {
      name: 'wishfulclaw-extension-activation',
      version: 1,
      storage: createJSONStorage(() => ipcStorage),
      migrate: (persisted) => {
        const state = (persisted ?? {}) as {
          activeExtensionIdsByProject?: Record<string, unknown>
        }
        return {
          activeExtensionIdsByProject:
            state.activeExtensionIdsByProject &&
            typeof state.activeExtensionIdsByProject === 'object'
              ? Object.fromEntries(
                  Object.entries(state.activeExtensionIdsByProject).map(([projectId, ids]) => [
                    projectId,
                    sanitizeActiveIds(ids)
                  ])
                )
              : {}
        }
      },
      partialize: (state) => ({
        activeExtensionIdsByProject: state.activeExtensionIdsByProject
      })
    }
  )
)

function waitForExtensionStoreHydration(): Promise<void> {
  if (useExtensionStore.persist.hasHydrated()) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = useExtensionStore.persist.onFinishHydration(() => {
      unsubscribe()
      resolve()
    })
  })
}

export async function initExtensionStore(): Promise<void> {
  await waitForExtensionStoreHydration()
  await useExtensionStore.getState().loadExtensions()
}

/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { useChatStore } from '@renderer/stores/chat-store'
import type {
  McpServerConfig,
  McpServerStatus,
  McpTool,
  McpResource,
  McpPrompt,
  McpServerInfo
} from '@renderer/lib/mcp/types'
import { IPC } from '@renderer/lib/ipc/channels'

interface McpStore {
  servers: McpServerConfig[]
  serversLoaded: boolean
  serverStatuses: Record<string, McpServerStatus>
  serverTools: Record<string, McpTool[]>
  serverResources: Record<string, McpResource[]>
  serverPrompts: Record<string, McpPrompt[]>
  serverErrors: Record<string, string | undefined>

  // Per-project activation (toggled via + menu)
  activeMcpIdsByProject: Record<string, string[]>

  // Init
  loadServers: () => Promise<void>
  ensureConversationReady: (projectId?: string | null) => Promise<void>

  // CRUD
  addServer: (config: Omit<McpServerConfig, 'id' | 'createdAt'>) => Promise<string>
  updateServer: (id: string, patch: Partial<McpServerConfig>) => Promise<void>
  removeServer: (id: string) => Promise<void>

  // Connection management
  connectServer: (id: string) => Promise<string | undefined>
  disconnectServer: (id: string) => Promise<void>
  refreshServerInfo: (id: string) => Promise<void>
  refreshAllServers: () => Promise<void>

  // Per-project activation
  toggleActiveMcp: (id: string, projectId?: string | null) => void
  clearActiveMcps: (projectId?: string | null) => void
  getActiveMcpIds: (projectId?: string | null) => string[]
  getActiveMcps: (projectId?: string | null) => McpServerConfig[]
  getActiveMcpTools: (projectId?: string | null) => Record<string, McpTool[]>
  getActiveMcpResources: (projectId?: string | null) => Record<string, McpResource[]>

  // UI
  selectedServerId: string | null
  setSelectedServer: (id: string | null) => void
}

function resolveProjectMcpKey(projectId?: string | null): string {
  return projectId ?? '__global__'
}

function matchesProject(server: McpServerConfig, projectId?: string | null): boolean {
  return !projectId || !server.projectId || server.projectId === projectId
}

export function resolveConfiguredActiveMcpIds(params: {
  projectId?: string | null
  activeMcpIdsByProject: Record<string, string[]>
  servers: McpServerConfig[]
}): string[] {
  const projectKey = resolveProjectMcpKey(params.projectId)
  const availableServerIds = new Set(
    params.servers
      .filter((server) => server.enabled && matchesProject(server, params.projectId))
      .map((server) => server.id)
  )
  const configuredIds = Object.prototype.hasOwnProperty.call(
    params.activeMcpIdsByProject,
    projectKey
  )
    ? (params.activeMcpIdsByProject[projectKey] ?? [])
    : [...availableServerIds]

  return configuredIds.filter((id) => availableServerIds.has(id))
}

function resolveStoredOrDefaultMcpIds(params: {
  projectId?: string | null
  activeMcpIdsByProject: Record<string, string[]>
  servers: McpServerConfig[]
  serverStatuses: Record<string, McpServerStatus>
}): string[] {
  return resolveConfiguredActiveMcpIds(params).filter(
    (id) => params.serverStatuses[id] === 'connected'
  )
}

const conversationInitializationPromises = new Map<string, Promise<void>>()
const serverConnectionPromises = new Map<string, Promise<string | undefined>>()

export function resolveEffectiveActiveMcpIds(params: {
  projectId?: string | null
  activeMcpIdsByProject: Record<string, string[]>
  servers: McpServerConfig[]
  serverStatuses: Record<string, McpServerStatus>
}): string[] {
  const availableServerIds = new Set(
    params.servers
      .filter(
        (server) =>
          server.enabled &&
          params.serverStatuses[server.id] === 'connected' &&
          matchesProject(server, params.projectId)
      )
      .map((server) => server.id)
  )

  return resolveStoredOrDefaultMcpIds(params).filter((id) => availableServerIds.has(id))
}

export const useMcpStore = create<McpStore>((set, get) => ({
  servers: [],
  serversLoaded: false,
  serverStatuses: {},
  serverTools: {},
  serverResources: {},
  serverPrompts: {},
  serverErrors: {},
  activeMcpIdsByProject: {},
  selectedServerId: null,

  loadServers: async () => {
    try {
      const servers = (await ipcClient.invoke(IPC.MCP_LIST)) as McpServerConfig[]
      set({ servers: Array.isArray(servers) ? servers : [], serversLoaded: true })
    } catch {
      set({ servers: [], serversLoaded: true })
    }
  },

  ensureConversationReady: async (projectId) => {
    const projectKey = resolveProjectMcpKey(projectId)
    const existing = conversationInitializationPromises.get(projectKey)
    if (existing) {
      await existing
      return
    }

    const initialization = (async (): Promise<void> => {
      let state = get()
      if (!state.serversLoaded) {
        await state.loadServers()
        state = get()
      }

      const serverIds = resolveConfiguredActiveMcpIds({
        projectId,
        activeMcpIdsByProject: state.activeMcpIdsByProject,
        servers: state.servers
      })
      if (serverIds.length === 0) return

      // Runtime status may have changed outside the renderer (for example an
      // extension config refresh disconnects a stale client). Refreshing here
      // is metadata-only and does not start an MCP process.
      await get().refreshAllServers()
      await Promise.all(
        serverIds.map(async (id) => {
          if (get().serverStatuses[id] === 'connected') return
          await get().connectServer(id)
        })
      )
    })()

    conversationInitializationPromises.set(projectKey, initialization)
    try {
      await initialization
    } finally {
      if (conversationInitializationPromises.get(projectKey) === initialization) {
        conversationInitializationPromises.delete(projectKey)
      }
    }
  },

  addServer: async (partial) => {
    const id = nanoid()
    const config: McpServerConfig = {
      ...partial,
      id,
      createdAt: Date.now()
    }
    await ipcClient.invoke(IPC.MCP_ADD, config)
    set((s) => ({ servers: [...s.servers, config] }))
    return id
  },

  updateServer: async (id, patch) => {
    await ipcClient.invoke(IPC.MCP_UPDATE, { id, patch })
    set((s) => ({
      servers: s.servers.map((srv) => (srv.id === id ? { ...srv, ...patch } : srv))
    }))
  },

  removeServer: async (id) => {
    try {
      await ipcClient.invoke(IPC.MCP_REMOVE, id)
    } catch (err) {
      console.error('[mcp-store] Failed to remove server:', err)
      throw err
    }
    set((s) => ({
      servers: s.servers.filter((srv) => srv.id !== id),
      selectedServerId: s.selectedServerId === id ? null : s.selectedServerId,
      activeMcpIdsByProject: Object.fromEntries(
        Object.entries(s.activeMcpIdsByProject).map(([projectId, ids]) => [
          projectId,
          ids.filter((mid) => mid !== id)
        ])
      )
    }))
  },

  connectServer: async (id) => {
    const existing = serverConnectionPromises.get(id)
    if (existing) return await existing

    const connection = (async (): Promise<string | undefined> => {
      set((s) => ({
        serverStatuses: { ...s.serverStatuses, [id]: 'connecting' },
        serverErrors: { ...s.serverErrors, [id]: undefined }
      }))
      try {
        const res = (await ipcClient.invoke(IPC.MCP_CONNECT, id)) as {
          success: boolean
          error?: string
        }
        if (!res.success) {
          set((s) => ({
            serverStatuses: { ...s.serverStatuses, [id]: 'error' },
            serverErrors: { ...s.serverErrors, [id]: res.error }
          }))
          return res.error ?? 'Unknown error'
        }
        // Refresh info after connect
        await get().refreshServerInfo(id)
        set((s) => ({
          serverStatuses: { ...s.serverStatuses, [id]: 'connected' }
        }))
        return undefined
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        set((s) => ({
          serverStatuses: { ...s.serverStatuses, [id]: 'error' },
          serverErrors: { ...s.serverErrors, [id]: msg }
        }))
        return msg
      }
    })()

    serverConnectionPromises.set(id, connection)
    try {
      return await connection
    } finally {
      if (serverConnectionPromises.get(id) === connection) {
        serverConnectionPromises.delete(id)
      }
    }
  },

  disconnectServer: async (id) => {
    try {
      await ipcClient.invoke(IPC.MCP_DISCONNECT, id)
    } catch {
      // ignore
    }
    set((s) => ({
      serverStatuses: { ...s.serverStatuses, [id]: 'disconnected' },
      serverTools: { ...s.serverTools, [id]: [] },
      serverResources: { ...s.serverResources, [id]: [] },
      serverPrompts: { ...s.serverPrompts, [id]: [] },
      serverErrors: { ...s.serverErrors, [id]: undefined }
    }))
  },

  refreshServerInfo: async (id) => {
    try {
      const info = (await ipcClient.invoke(IPC.MCP_SERVER_INFO, id)) as McpServerInfo | undefined
      if (info) {
        set((s) => ({
          serverStatuses: { ...s.serverStatuses, [id]: info.status },
          serverTools: { ...s.serverTools, [id]: info.tools },
          serverResources: { ...s.serverResources, [id]: info.resources },
          serverPrompts: { ...s.serverPrompts, [id]: info.prompts },
          serverErrors: { ...s.serverErrors, [id]: info.error }
        }))
      }
    } catch {
      // ignore
    }
  },

  refreshAllServers: async () => {
    try {
      const allInfo = (await ipcClient.invoke(IPC.MCP_ALL_SERVERS_INFO)) as McpServerInfo[]
      if (!Array.isArray(allInfo)) return
      const statuses: Record<string, McpServerStatus> = {}
      const tools: Record<string, McpTool[]> = {}
      const resources: Record<string, McpResource[]> = {}
      const prompts: Record<string, McpPrompt[]> = {}
      const errors: Record<string, string | undefined> = {}
      for (const info of allInfo) {
        const id = info.config.id
        statuses[id] = info.status
        tools[id] = info.tools
        resources[id] = info.resources
        prompts[id] = info.prompts
        errors[id] = info.error
      }
      set({
        serverStatuses: statuses,
        serverTools: tools,
        serverResources: resources,
        serverPrompts: prompts,
        serverErrors: errors
      })
    } catch {
      // ignore
    }
  },

  getActiveMcpIds: (projectId) => {
    const resolvedProjectId = projectId ?? useChatStore.getState().activeProjectId ?? null
    const { activeMcpIdsByProject, servers, serverStatuses } = get()
    return resolveEffectiveActiveMcpIds({
      projectId: resolvedProjectId,
      activeMcpIdsByProject,
      servers,
      serverStatuses
    })
  },

  toggleActiveMcp: (id, projectId) => {
    const resolvedProjectId = projectId ?? useChatStore.getState().activeProjectId ?? null
    set((s) => {
      const projectKey = resolveProjectMcpKey(resolvedProjectId)
      const currentIds = resolveStoredOrDefaultMcpIds({
        projectId: resolvedProjectId,
        activeMcpIdsByProject: s.activeMcpIdsByProject,
        servers: s.servers,
        serverStatuses: s.serverStatuses
      })
      const isActive = currentIds.includes(id)
      return {
        activeMcpIdsByProject: {
          ...s.activeMcpIdsByProject,
          [projectKey]: isActive ? currentIds.filter((mid) => mid !== id) : [...currentIds, id]
        }
      }
    })
  },

  clearActiveMcps: (projectId) => {
    const resolvedProjectId = projectId ?? useChatStore.getState().activeProjectId ?? null
    set((s) => ({
      activeMcpIdsByProject: {
        ...s.activeMcpIdsByProject,
        [resolveProjectMcpKey(resolvedProjectId)]: []
      }
    }))
  },

  getActiveMcps: (projectId) => {
    const { servers, serverStatuses } = get()
    const activeMcpIds = get().getActiveMcpIds(projectId)
    return servers.filter(
      (server) =>
        activeMcpIds.includes(server.id) &&
        server.enabled &&
        serverStatuses[server.id] === 'connected'
    )
  },

  getActiveMcpTools: (projectId) => {
    const activeMcpIds = get().getActiveMcpIds(projectId)
    const { serverTools } = get()
    const result: Record<string, McpTool[]> = {}
    for (const id of activeMcpIds) {
      if (serverTools[id]?.length) {
        result[id] = serverTools[id]
      }
    }
    return result
  },

  getActiveMcpResources: (projectId) => {
    const activeMcpIds = get().getActiveMcpIds(projectId)
    const { serverResources } = get()
    const result: Record<string, McpResource[]> = {}
    for (const id of activeMcpIds) {
      if (serverResources[id]?.length) {
        result[id] = serverResources[id]
      }
    }
    return result
  },

  setSelectedServer: (id) => set({ selectedServerId: id })
}))

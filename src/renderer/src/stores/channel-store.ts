import { create } from 'zustand'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'

// ── Types (mirrors backend ChannelInstance / ChannelProviderDescriptor) ──

export interface ChannelPermissions {
  allowReadHome: boolean
  readablePathPrefixes: string[]
  allowWriteOutside: boolean
  allowShell: boolean
  allowSubAgents: boolean
}

export interface ChannelFeatures {
  autoReply: boolean
  streamingReply: boolean
  autoStart: boolean
}

export interface ConfigFieldSchema {
  key: string
  label: string
  type: 'text' | 'secret'
  placeholder?: string
  required?: boolean
}

export interface ChannelProviderDescriptor {
  type: string
  displayName: string
  description: string
  icon: string
  builtin?: boolean
  configSchema: ConfigFieldSchema[]
  tools?: string[]
}

export interface PluginInstance {
  id: string
  type: string
  name: string
  enabled: boolean
  builtin?: boolean
  config: Record<string, string>
  createdAt: number
  projectId?: string | null
  tools?: Record<string, boolean>
  providerId?: string | null
  model?: string | null
  features?: ChannelFeatures
  permissions?: ChannelPermissions
}

interface ChannelStore {
  channels: PluginInstance[]
  providers: ChannelProviderDescriptor[]
  loading: boolean
  error: string | null
  selectedChannelId: string | null
  channelStatuses: Record<string, 'running' | 'stopped' | 'error'>

  loadChannels: () => Promise<void>
  loadProviders: () => Promise<void>
  updateChannel: (id: string, patch: Partial<PluginInstance>) => Promise<boolean>
  startChannel: (id: string) => Promise<boolean>
  stopChannel: (id: string) => Promise<void>
  setSelectedChannel: (id: string | null) => void
}

export const useChannelStore = create<ChannelStore>((set) => ({
  channels: [],
  providers: [],
  loading: false,
  error: null,
  selectedChannelId: null,
  channelStatuses: {},

  loadChannels: async () => {
    set({ loading: true, error: null })
    try {
      const channels = (await ipcClient.invoke(IPC.PLUGIN_LIST)) as PluginInstance[]
      // Query running status for all channels
      const statuses: Record<string, 'running' | 'stopped' | 'error'> = {}
      await Promise.all(
        channels.map(async (ch) => {
          try {
            const status = (await ipcClient.invoke(IPC.PLUGIN_STATUS, ch.id)) as string
            statuses[ch.id] = (status as 'running' | 'stopped' | 'error') || 'stopped'
          } catch {
            statuses[ch.id] = 'stopped'
          }
        })
      )
      set({ channels, channelStatuses: statuses, loading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  loadProviders: async () => {
    try {
      const providers = (await ipcClient.invoke(
        IPC.PLUGIN_LIST_PROVIDERS
      )) as ChannelProviderDescriptor[]
      set({ providers })
    } catch (err) {
      console.error('[channel-store] Failed to load providers:', err)
    }
  },

  updateChannel: async (id, patch) => {
    try {
      const result = (await ipcClient.invoke(IPC.PLUGIN_UPDATE, { id, patch })) as {
        success?: boolean
        error?: string
      }
      if (result?.success === false) {
        throw new Error(result.error || 'Channel update failed')
      }
      set((s) => ({
        channels: s.channels.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        error: null
      }))
      return true
    } catch (err) {
      console.error('[channel-store] Failed to update channel:', err)
      set({ error: err instanceof Error ? err.message : String(err) })
      return false
    }
  },

  startChannel: async (id) => {
    try {
      const result = (await ipcClient.invoke(IPC.PLUGIN_START, id)) as {
        success?: boolean
        error?: string
      }
      if (result?.success === false) {
        throw new Error(result.error || 'Channel start failed')
      }
      set((s) => ({
        channelStatuses: { ...s.channelStatuses, [id]: 'running' },
        error: null
      }))
      return true
    } catch (err) {
      console.error('[channel-store] Failed to start channel:', err)
      set((s) => ({
        channelStatuses: { ...s.channelStatuses, [id]: 'error' },
        error: err instanceof Error ? err.message : String(err)
      }))
      return false
    }
  },

  stopChannel: async (id) => {
    try {
      await ipcClient.invoke(IPC.PLUGIN_STOP, id)
      set((s) => ({
        channelStatuses: { ...s.channelStatuses, [id]: 'stopped' }
      }))
    } catch (err) {
      console.error('[channel-store] Failed to stop channel:', err)
    }
  },

  setSelectedChannel: (id) => set({ selectedChannelId: id })
}))

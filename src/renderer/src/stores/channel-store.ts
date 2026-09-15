import { create } from 'zustand'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'

// ── Types (mirrors backend ChannelInstance / ChannelProviderDescriptor) ──

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
}

/** Mirrors the Worker record — defaults live in `GlobalChannelSettings.cs`, so this store never invents a fallback value. */
export interface GlobalChannelSettings {
  autoStart: boolean
  shellRequiresApproval: boolean
}

const GLOBAL_SETTING_KEYS: readonly (keyof GlobalChannelSettings)[] = [
  'autoStart',
  'shellRequiresApproval'
]

/**
 * IPC handlers report failures as an `{ error }` payload instead of rejecting, so a failed
 * read arrives as a truthy object. Accepted as-is, its missing booleans would render OFF and
 * the next whole-object write would store `shellRequiresApproval: false` — approval waived.
 */
function parseGlobalSettings(raw: unknown): GlobalChannelSettings {
  const value = raw as (GlobalChannelSettings & { error?: string }) | null
  if (!value || typeof value !== 'object') {
    throw new Error('Global channel settings read returned nothing')
  }
  if (value.error) {
    throw new Error(value.error)
  }
  const missing = GLOBAL_SETTING_KEYS.filter((key) => value[key] === undefined)
  if (missing.length > 0) {
    throw new Error(`Global channel settings read is incomplete: ${missing.join(', ')}`)
  }
  return value
}

interface ChannelStore {
  channels: PluginInstance[]
  providers: ChannelProviderDescriptor[]
  globalSettings: GlobalChannelSettings | null
  globalSettingsError: string | null
  loading: boolean
  error: string | null
  channelStatuses: Record<string, 'running' | 'stopped' | 'error'>

  loadChannels: () => Promise<void>
  loadProviders: () => Promise<void>
  loadGlobalSettings: () => Promise<void>
  ensureGlobalSettings: () => Promise<GlobalChannelSettings | null>
  updateGlobalSettings: (patch: Partial<GlobalChannelSettings>) => Promise<boolean>
  updateChannel: (id: string, patch: Partial<PluginInstance>) => Promise<boolean>
  startChannel: (id: string) => Promise<boolean>
  stopChannel: (id: string) => Promise<void>
}

export const useChannelStore = create<ChannelStore>((set, get) => ({
  channels: [],
  providers: [],
  globalSettings: null,
  globalSettingsError: null,
  loading: false,
  error: null,
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

  loadGlobalSettings: async () => {
    try {
      const settings = parseGlobalSettings(await ipcClient.invoke(IPC.PLUGIN_SETTINGS_GET))
      set({ globalSettings: settings, globalSettingsError: null })
    } catch (err) {
      console.error('[channel-store] Failed to load global channel settings:', err)
      set({ globalSettingsError: err instanceof Error ? err.message : String(err) })
    }
  },

  ensureGlobalSettings: async () => {
    const current = get().globalSettings
    if (current) return current
    await get().loadGlobalSettings()
    return get().globalSettings
  },

  updateGlobalSettings: async (patch) => {
    // The Worker stores the whole object, so a patch must be merged onto the
    // authoritative read rather than sent as a partial.
    const current = await get().ensureGlobalSettings()
    if (!current) return false
    try {
      const result = (await ipcClient.invoke(IPC.PLUGIN_SETTINGS_SET, {
        ...current,
        ...patch
      })) as { settings?: unknown; error?: string }
      if (result?.error) throw new Error(result.error)
      set({ globalSettings: parseGlobalSettings(result?.settings), globalSettingsError: null })
      return true
    } catch (err) {
      console.error('[channel-store] Failed to update global channel settings:', err)
      set({ globalSettingsError: err instanceof Error ? err.message : String(err) })
      return false
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
  }
}))

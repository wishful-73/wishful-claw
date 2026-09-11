import {
  readPersistedSettings,
  writePersistedSettings,
  clearPersistedSettings
} from '../lib/settings-store'
import { setLogMinLevel, hasEnvLogLevelOverride } from '../lib/logger'
import { registerMessagePackHandler } from './messagepack-handler'

type MutationResult = {
  success: boolean
  error?: string
}

/** Zustand persist key of the renderer settings store inside general.json. */
const RENDERER_SETTINGS_STORAGE_KEY = 'wishfulclaw-settings'

/**
 * Push the persisted log level into the logger. Called at startup and after
 * every write of the settings store so saving the level takes effect
 * immediately (invalid/missing values fall back to the default level). The
 * env override, when set, wins for the whole session.
 */
function syncLogLevelFromPersisted(value: unknown): void {
  if (hasEnvLogLevelOverride()) return
  const persisted = value as { state?: { logLevel?: unknown } } | null | undefined
  setLogMinLevel(persisted?.state?.logLevel)
}

/** Seed the logger's minimum level from settings/general.json at boot. */
export function initializeLogLevelFromSettings(): void {
  try {
    syncLogLevelFromPersisted(readPersistedSettings(RENDERER_SETTINGS_STORAGE_KEY))
  } catch {
    // Missing or corrupt settings file — keep the default level
  }
}

export function registerSettingsHandlers(): void {
  // Read a specific store's persisted state by key (name)
  registerMessagePackHandler<string, unknown | null>('settings:get', (key) => {
    return readPersistedSettings(key)
  })

  // Write a specific store's persisted state under its key
  registerMessagePackHandler<{ key: string; value: unknown }, MutationResult>(
    'settings:set',
    ({ key, value }) => {
      if (value === undefined || value === null) {
        clearPersistedSettings(key)
        if (key === RENDERER_SETTINGS_STORAGE_KEY) syncLogLevelFromPersisted(null)
      } else {
        writePersistedSettings(value, key)
        if (key === RENDERER_SETTINGS_STORAGE_KEY) syncLogLevelFromPersisted(value)
      }
      return { success: true }
    }
  )
}

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const DATA_DIRECTORY_NAME = '.wishful-claw'
const SETTINGS_DIRECTORY_NAME = 'settings'
const SETTINGS_FILE_NAME = 'general.json'

export const SETTINGS_STORAGE_KEY = 'wishful-claw-settings'

function getDefaultDataDirectory(): string {
  const override = process.env.WISHFULCLAW_DATA_DIR?.trim()
  return override ? path.resolve(override) : path.join(os.homedir(), DATA_DIRECTORY_NAME)
}

function getSettingsFilePath(dataDirectory = getDefaultDataDirectory()): string {
  return path.join(dataDirectory, SETTINGS_DIRECTORY_NAME, SETTINGS_FILE_NAME)
}

/**
 * Read the entire settings file as a map of store-name → persisted-state.
 * Each value is the { state, version } object that Zustand persist writes.
 */
function readSettingsMap(): Record<string, unknown> {
  const filePath = getSettingsFilePath()
  try {
    if (!fs.existsSync(filePath)) return {}
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    // Legacy format: the file was a single { state, version } object.
    // Migrate it under a default key.
    if (parsed && typeof parsed === 'object' && 'state' in parsed) {
      return { __legacy__: parsed }
    }
    return {}
  } catch {
    return {}
  }
}

function writeSettingsMap(data: Record<string, unknown>): void {
  const filePath = getSettingsFilePath()
  const directory = path.dirname(filePath)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  })
}

/**
 * Read a specific store's persisted state by key name.
 * Returns null if the key doesn't exist.
 */
export function readPersistedSettings(key?: string): unknown | null {
  const map = readSettingsMap()
  if (key === undefined) {
    // Legacy callers that don't pass a key get the whole map
    return Object.keys(map).length > 0 ? map : null
  }
  return map[key] ?? null
}

/**
 * Write a specific store's persisted state under its key name.
 * Other stores' data is preserved.
 */
export function writePersistedSettings(value: unknown, key?: string): void {
  if (key === undefined) {
    // Legacy callers: write the whole map
    writeSettingsMap(value as Record<string, unknown>)
    return
  }
  const map = readSettingsMap()
  map[key] = value
  writeSettingsMap(map)
}

/**
 * Clear a specific store's entry (or the entire file if no key).
 */
export function clearPersistedSettings(key?: string): void {
  if (key === undefined) {
    const filePath = getSettingsFilePath()
    try {
      fs.rmSync(filePath, { force: true })
    } catch {
      // ignore
    }
    return
  }
  const map = readSettingsMap()
  delete map[key]
  if (Object.keys(map).length === 0) {
    const filePath = getSettingsFilePath()
    try {
      fs.rmSync(filePath, { force: true })
    } catch {
      // ignore
    }
  } else {
    writeSettingsMap(map)
  }
}

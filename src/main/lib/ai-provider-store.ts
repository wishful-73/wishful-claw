import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const DATA_DIRECTORY_NAME = '.wishful-claw'
const PROVIDER_DIRECTORY_NAME = 'ai-provider'
const INDEX_FILE_NAME = 'index.json'
const PROVIDER_FILE_PREFIX = 'provider-'
const PROVIDER_FILE_SUFFIX = '.json'
const STORAGE_FORMAT_VERSION = 1

export const AI_PROVIDER_STORAGE_KEY = 'wishful-claw-providers'

type JsonRecord = Record<string, unknown>

export interface PersistedProviderStore {
  state: JsonRecord
  version: number
}

function isPlainRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readJsonFile(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown
  } catch (error) {
    console.warn(`[AIProviderStore] Failed to read ${filePath}:`, error)
    return null
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  const directory = path.dirname(filePath)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })

  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    fs.renameSync(temporaryPath, filePath)
  } finally {
    fs.rmSync(temporaryPath, { force: true })
  }
}

function getProviderDirectory(dataDirectory: string): string {
  return path.join(dataDirectory, PROVIDER_DIRECTORY_NAME)
}

function getIndexPath(dataDirectory: string): string {
  return path.join(getProviderDirectory(dataDirectory), INDEX_FILE_NAME)
}

function getProviderFilePath(dataDirectory: string, providerId: string): string {
  return path.join(
    getProviderDirectory(dataDirectory),
    `${PROVIDER_FILE_PREFIX}${encodeURIComponent(providerId)}${PROVIDER_FILE_SUFFIX}`
  )
}

function isProviderFileName(fileName: string): boolean {
  return fileName.startsWith(PROVIDER_FILE_PREFIX) && fileName.endsWith(PROVIDER_FILE_SUFFIX)
}

function normalizeProvider(value: unknown): JsonRecord | null {
  if (!isPlainRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!id) return null
  return { ...cloneJsonValue(value), id }
}

function splitProviderState(state: JsonRecord): { providers: JsonRecord[]; metadata: JsonRecord } {
  const providersById = new Map<string, JsonRecord>()
  for (const value of Array.isArray(state.providers) ? state.providers : []) {
    const provider = normalizeProvider(value)
    if (!provider) continue
    providersById.set(provider.id as string, provider)
  }

  const { providers: _providers, ...metadata } = state
  void _providers
  return {
    providers: Array.from(providersById.values()),
    metadata: cloneJsonValue(metadata)
  }
}

function listProviderFiles(dataDirectory: string): string[] {
  const providerDirectory = getProviderDirectory(dataDirectory)
  try {
    if (!fs.existsSync(providerDirectory)) return []
    return fs
      .readdirSync(providerDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isProviderFileName(entry.name))
      .map((entry) => path.join(providerDirectory, entry.name))
  } catch (error) {
    console.warn(`[AIProviderStore] Failed to list ${providerDirectory}:`, error)
    return []
  }
}

function readProviderFile(filePath: string, expectedId?: string): JsonRecord | null {
  const provider = normalizeProvider(readJsonFile(filePath))
  if (!provider) return null
  if (expectedId && provider.id !== expectedId) return null
  return provider
}

function readProviderFiles(dataDirectory: string, providerIds?: string[]): JsonRecord[] {
  if (providerIds) {
    const result: JsonRecord[] = []
    const seen = new Set<string>()
    for (const rawId of providerIds) {
      const id = rawId.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      const provider = readProviderFile(getProviderFilePath(dataDirectory, id), id)
      if (provider) result.push(provider)
    }
    return result
  }

  const providersById = new Map<string, JsonRecord>()
  for (const filePath of listProviderFiles(dataDirectory)) {
    const provider = readProviderFile(filePath)
    if (provider) providersById.set(provider.id as string, provider)
  }
  return Array.from(providersById.values())
}

interface ProviderIndexFile {
  formatVersion: number
  providerIds: string[]
  state: JsonRecord
  version: number
}

function readProviderIndex(dataDirectory: string): ProviderIndexFile | null {
  const raw = readJsonFile(getIndexPath(dataDirectory))
  if (!isPlainRecord(raw)) return null

  const state = isPlainRecord(raw.state) ? raw.state : {}
  const providerIds = Array.isArray(raw.providerIds)
    ? raw.providerIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []

  return {
    formatVersion: typeof raw.formatVersion === 'number' ? raw.formatVersion : 0,
    providerIds: Array.from(new Set(providerIds.map((id) => id.trim()))),
    state: cloneJsonValue(state),
    version: typeof raw.version === 'number' ? raw.version : 0
  }
}

function readSplitProviderStore(dataDirectory: string): PersistedProviderStore | null {
  const index = readProviderIndex(dataDirectory)
  if (index) {
    const providers = readProviderFiles(dataDirectory, index.providerIds)
    return {
      state: { ...index.state, providers },
      version: index.version
    }
  }

  const providers = readProviderFiles(dataDirectory)
  if (providers.length === 0) return null
  return { state: { providers }, version: 0 }
}

function writeSplitProviderStore(dataDirectory: string, value: unknown): PersistedProviderStore {
  const persisted = value as PersistedProviderStore
  if (!persisted || !isPlainRecord(persisted.state)) {
    throw new Error('Invalid provider store payload')
  }

  const { providers, metadata } = splitProviderState(persisted.state)
  const providerDirectory = getProviderDirectory(dataDirectory)
  fs.mkdirSync(providerDirectory, { recursive: true, mode: 0o700 })

  const expectedPaths = new Set<string>()
  for (const provider of providers) {
    const providerId = provider.id as string
    const providerPath = getProviderFilePath(dataDirectory, providerId)
    expectedPaths.add(providerPath)
    writeJsonFile(providerPath, provider)
  }

  writeJsonFile(getIndexPath(dataDirectory), {
    formatVersion: STORAGE_FORMAT_VERSION,
    providerIds: providers.map((provider) => provider.id as string),
    state: metadata,
    version: persisted.version
  } satisfies ProviderIndexFile)

  // Clean up orphan files
  for (const filePath of listProviderFiles(dataDirectory)) {
    if (expectedPaths.has(filePath)) continue
    try {
      fs.rmSync(filePath, { force: true })
    } catch {
      // Orphan cannot reappear since index is authoritative
    }
  }

  return {
    state: { ...metadata, providers: cloneJsonValue(providers) },
    version: persisted.version
  }
}

function getDefaultDataDirectory(): string {
  const override = process.env.WISHFULCLAW_DATA_DIR?.trim()
  return override ? path.resolve(override) : path.join(os.homedir(), DATA_DIRECTORY_NAME)
}

export function readPersistedProviderStore(
  dataDirectory = getDefaultDataDirectory()
): PersistedProviderStore | null {
  return readSplitProviderStore(dataDirectory)
}

export function writePersistedProviderStore(
  value: unknown,
  dataDirectory = getDefaultDataDirectory()
): PersistedProviderStore {
  return writeSplitProviderStore(dataDirectory, value)
}

export function clearPersistedProviderStore(dataDirectory = getDefaultDataDirectory()): void {
  fs.rmSync(getProviderDirectory(dataDirectory), { recursive: true, force: true })
}

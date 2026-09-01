import { app, BrowserWindow } from 'electron'
import { logError, logInfo, logWarn } from './lib/logger'
import { readPersistedSettings } from './lib/settings-store'
import { getUpdateDistributionInfo } from './lib/distribution'
import { safeSendMessagePackToWindow } from './window-ipc'
import type {
  UpdateActionResult,
  UpdateAvailablePayload,
  UpdateCheckResult,
  UpdateDistributionInfo,
  UpdateDownloadProgressPayload,
  UpdateDownloadedPayload,
  UpdateErrorPayload,
  UpdatePhase,
  UpdateStatus
} from '../shared/updater/types'

type AutoUpdater = typeof import('electron-updater').autoUpdater
type WindowGetter = () => BrowserWindow | null
type QuitMarker = () => void

export interface UpdaterOptions {
  getMainWindow: WindowGetter
  markAppWillQuit: QuitMarker
}

interface UpdateState {
  phase: UpdatePhase
  availableVersion: string | null
  downloadedVersion: string | null
  releaseNotes: string
}

const RENDERER_SETTINGS_STORAGE_KEY = 'wishfulclaw-settings'

const INITIAL_STATE: UpdateState = {
  phase: 'idle',
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: ''
}

let updater: AutoUpdater | null = null
let initializePromise: Promise<void> | null = null
let checkPromise: Promise<UpdateCheckResult> | null = null
let downloadPromise: Promise<UpdateActionResult> | null = null
let options: UpdaterOptions | null = null
let updateState: UpdateState = { ...INITIAL_STATE }

function currentVersion(): string {
  return normalizeVersion(app.getVersion())
}

function normalizeVersion(version: string | null | undefined): string {
  return (version ?? '').trim().replace(/^v/i, '')
}

function isNewerVersion(candidate: string | null | undefined, current: string): boolean {
  const candidateParts = normalizeVersion(candidate).split('-')[0].split('.')
  const currentParts = normalizeVersion(current).split('-')[0].split('.')
  if (!candidateParts[0] || !currentParts[0]) return false

  const length = Math.max(candidateParts.length, currentParts.length)
  for (let index = 0; index < length; index += 1) {
    const candidatePart = Number.parseInt(candidateParts[index] ?? '0', 10)
    const currentPart = Number.parseInt(currentParts[index] ?? '0', 10)
    const left = Number.isFinite(candidatePart) ? candidatePart : 0
    const right = Number.isFinite(currentPart) ? currentPart : 0
    if (left !== right) return left > right
  }
  return false
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatError(error: unknown): string {
  const message = getErrorMessage(error)
  if (/latest\.yml/i.test(message) && /\b404\b/.test(message)) {
    return tr('missingMetadata')
  }
  if (/\b(ETIMEDOUT|ERR_TIMED_OUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN)\b/i.test(message)) {
    return tr('network')
  }
  return message || tr('fallback')
}

function formatReleaseNotes(notes: unknown): string {
  if (typeof notes === 'string') return notes.trim()
  if (!Array.isArray(notes)) return ''
  return notes
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const note = (item as { note?: unknown }).note
      return typeof note === 'string' ? note.trim() : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function getValidWindow(): BrowserWindow | undefined {
  const win = options?.getMainWindow()
  return win && !win.isDestroyed() ? win : undefined
}

function sendUpdateEvent<T>(channel: string, payload: T): void {
  const win = getValidWindow()
  if (win) safeSendMessagePackToWindow(win, channel, payload)
}

type UpdaterMessageKey =
  | 'missingMetadata'
  | 'network'
  | 'fallback'
  | 'unsupportedInstall'
  | 'noAvailableDownload'
  | 'updaterUnavailable'
  | 'noDownloadedUpdate'

const UPDATER_MESSAGES: Record<UpdaterMessageKey, { zh: string; en: string }> = {
  missingMetadata: {
    zh: '更新发布缺少 latest.yml 元数据，请重新生成并上传完整的发布资产。',
    en: 'The release is missing latest.yml metadata. Regenerate and upload the full release assets.'
  },
  network: {
    zh: '无法连接更新服务器，请检查网络后重试。',
    en: 'Cannot reach the update server. Check your network and try again.'
  },
  fallback: {
    zh: '更新失败，请稍后重试。',
    en: 'Update failed. Please try again later.'
  },
  unsupportedInstall: {
    zh: '当前版本不支持自动安装更新，请打开发布页手动下载。',
    en: 'This installation does not support auto-update. Open the release page to download manually.'
  },
  noAvailableDownload: {
    zh: '尚未发现可下载的更新，请先检查更新。',
    en: 'No update has been found yet. Check for updates first.'
  },
  updaterUnavailable: {
    zh: '更新服务当前不可用，请稍后重试。',
    en: 'The update service is currently unavailable. Please try again later.'
  },
  noDownloadedUpdate: {
    zh: '没有已下载并准备安装的更新。',
    en: 'No downloaded update is ready to install.'
  }
}

function readRendererSettingsState(): Record<string, unknown> {
  const persisted = readPersistedSettings(RENDERER_SETTINGS_STORAGE_KEY)
  if (!persisted || typeof persisted !== 'object') return {}
  const record = persisted as Record<string, unknown>
  return record.state && typeof record.state === 'object'
    ? (record.state as Record<string, unknown>)
    : record
}

function getPersistedAutoUpdateEnabled(): boolean {
  return readRendererSettingsState().autoUpdateEnabled !== false
}

function tr(key: UpdaterMessageKey): string {
  const language = readRendererSettingsState().language === 'en' ? 'en' : 'zh'
  return UPDATER_MESSAGES[key][language]
}

function canCheckForUpdates(): boolean {
  const distribution = getAppDistributionInfo()
  return process.platform === 'win32' &&
    (distribution.distribution === 'installer' || distribution.distribution === 'green')
}

function supportsAutoInstall(): boolean {
  return process.platform === 'win32' && getAppDistributionInfo().supportsAutoInstall
}

function getAppDistributionInfo(): UpdateDistributionInfo {
  return getUpdateDistributionInfo()
}

function setPhase(phase: UpdatePhase): void {
  updateState = { ...updateState, phase }
}

function setError(error: unknown, notify = true): string {
  const message = formatError(error)
  // Silent failures (startup auto-check, init) must not leave phase 'error':
  // the renderer would later fetch status and auto-open an empty error dialog.
  updateState = { ...updateState, phase: notify ? 'error' : 'idle' }
  logError('main', `Updater error: ${message}`, { extra: { error: getErrorMessage(error) } })
  if (notify) {
    const payload: UpdateErrorPayload = { error: message }
    sendUpdateEvent('update:error', payload)
  }
  return message
}

function configureUpdater(instance: AutoUpdater): void {
  instance.autoDownload = false
  instance.autoInstallOnAppQuit = false
  instance.allowPrerelease = false
  instance.allowDowngrade = false
  if (!app.isPackaged) instance.forceDevUpdateConfig = true
  instance.logger = {
    info: (message?: unknown) => logInfo('main', `[updater] ${String(message ?? '')}`),
    warn: (message?: unknown) => logWarn('main', `[updater] ${String(message ?? '')}`),
    error: (message?: unknown) => logError('main', `[updater] ${String(message ?? '')}`),
    debug: (message?: unknown) => logInfo('main', `[updater:debug] ${String(message ?? '')}`)
  }
}

function attachEvents(instance: AutoUpdater): void {
  instance.on('checking-for-update', () => {
    logInfo('main', 'Updater check started')
    setPhase('checking')
  })

  instance.on('update-available', (info) => {
    const version = normalizeVersion(info.version)
    if (!isNewerVersion(version, currentVersion())) {
      logWarn('main', `Updater ignored non-newer version: ${version}`)
      setPhase('idle')
      return
    }

    updateState = {
      phase: 'available',
      availableVersion: version,
      downloadedVersion: null,
      releaseNotes: formatReleaseNotes(info.releaseNotes)
    }
    const payload: UpdateAvailablePayload = {
      currentVersion: currentVersion(),
      newVersion: version,
      releaseNotes: updateState.releaseNotes,
      ...getAppDistributionInfo()
    }
    logInfo('main', `Updater found version ${version}`)
    sendUpdateEvent('update:available', payload)
  })

  instance.on('update-not-available', (info) => {
    updateState = {
      ...updateState,
      phase: 'idle',
      availableVersion: updateState.downloadedVersion ? updateState.availableVersion : null,
      releaseNotes: updateState.downloadedVersion ? updateState.releaseNotes : ''
    }
    logInfo('main', `Updater found no newer version (latest: ${info.version})`)
  })

  instance.on('download-progress', (progress) => {
    setPhase('downloading')
    const payload: UpdateDownloadProgressPayload = {
      percent: Math.max(0, Math.min(100, progress.percent))
    }
    const win = getValidWindow()
    if (win) {
      win.setProgressBar(payload.percent / 100, { mode: 'normal' })
      safeSendMessagePackToWindow(win, 'update:download-progress', payload)
    }
  })

  instance.on('update-downloaded', (info) => {
    const version = normalizeVersion(info.version)
    updateState = { ...updateState, phase: 'downloaded', downloadedVersion: version }
    const win = getValidWindow()
    if (win) win.setProgressBar(-1)
    const payload: UpdateDownloadedPayload = { version }
    logInfo('main', `Updater downloaded version ${version}`)
    sendUpdateEvent('update:downloaded', payload)
  })

  instance.on('error', (error) => {
    if (updateState.phase === 'checking' && !downloadPromise) {
      logWarn('main', `Background updater check failed: ${formatError(error)}`)
      setPhase('idle')
      return
    }
    const win = getValidWindow()
    if (win) win.setProgressBar(-1)
    setError(error)
  })
}

async function ensureInitialized(): Promise<void> {
  if (updater) return
  initializePromise ??= (async () => {
    if (!canCheckForUpdates()) return
    const module = await import('electron-updater')
    updater = module.autoUpdater
    configureUpdater(updater)
    attachEvents(updater)
  })().catch((error) => {
    initializePromise = null
    setError(error, false)
    throw error
  })
  await initializePromise
}

async function checkForUpdatesInternal(): Promise<UpdateCheckResult> {
  const distribution = getAppDistributionInfo()
  const current = currentVersion()
  if (!canCheckForUpdates()) {
    return {
      success: true,
      available: false,
      currentVersion: current,
      latestVersion: null,
      skipped: true,
      ...distribution
    }
  }

  try {
    await ensureInitialized()
    if (!updater) {
      return {
        success: true,
        available: false,
        currentVersion: current,
        latestVersion: null,
        skipped: true,
        ...distribution
      }
    }
    logInfo('main', 'Updater check requested')
    const result = await updater.checkForUpdates()
    const latest = normalizeVersion(result?.updateInfo?.version) || null
    const available = latest ? isNewerVersion(latest, current) : updateState.availableVersion !== null
    return {
      success: true,
      available,
      currentVersion: current,
      latestVersion: latest ?? updateState.availableVersion,
      skipped: result === null,
      ...distribution
    }
  } catch (error) {
    const message = setError(error, false)
    return { success: false, error: message }
  }
}

export async function requestUpdateCheck(): Promise<UpdateCheckResult> {
  if (!checkPromise) {
    checkPromise = checkForUpdatesInternal().finally(() => {
      checkPromise = null
    })
  }
  return checkPromise
}

export async function requestUpdateDownload(): Promise<UpdateActionResult> {
  if (!supportsAutoInstall()) {
    return { success: false, error: tr('unsupportedInstall') }
  }
  if (updateState.downloadedVersion) return { success: true }
  if (!updateState.availableVersion) {
    return { success: false, error: tr('noAvailableDownload') }
  }
  if (!updater) {
    try {
      await ensureInitialized()
    } catch (error) {
      return { success: false, error: formatError(error) }
    }
  }
  if (!updater) return { success: false, error: tr('updaterUnavailable') }

  if (!downloadPromise) {
    setPhase('downloading')
    logInfo('main', `Updater download requested for ${updateState.availableVersion}`)
    downloadPromise = updater.downloadUpdate()
      .then(() => ({ success: true as const }))
      .catch((error) => ({ success: false as const, error: setError(error) }))
      .finally(() => {
        downloadPromise = null
      })
  }
  return downloadPromise
}

export function getUpdateStatus(): UpdateStatus {
  return {
    success: true,
    currentVersion: currentVersion(),
    availableVersion: updateState.availableVersion,
    downloadedVersion: updateState.downloadedVersion,
    releaseNotes: updateState.releaseNotes,
    phase: updateState.phase,
    ...getAppDistributionInfo()
  }
}

export function requestUpdateInstall(): UpdateActionResult {
  if (!supportsAutoInstall()) {
    return { success: false, error: tr('unsupportedInstall') }
  }
  if (!updater || !updateState.downloadedVersion) {
    return { success: false, error: tr('noDownloadedUpdate') }
  }
  if (updateState.phase === 'installing') {
    return { success: true }
  }

  setPhase('installing')
  logInfo('main', `Updater install requested for ${updateState.downloadedVersion}`)
  setTimeout(() => {
    try {
      options?.markAppWillQuit()
      updater?.quitAndInstall(false, true)
    } catch (error) {
      setError(error)
    }
  }, 100)
  return { success: true }
}

export async function initializeUpdater(nextOptions: UpdaterOptions): Promise<void> {
  if (options === null) options = nextOptions
  await ensureInitialized()
  if (!app.isPackaged || !canCheckForUpdates() || !getPersistedAutoUpdateEnabled()) return
  void requestUpdateCheck().catch((error) => {
    logWarn('main', `Startup updater check failed: ${formatError(error)}`)
  })
}

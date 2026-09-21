import { app, BrowserWindow } from 'electron'
import { logError, logInfo, logWarn } from './lib/logger'
import { readPersistedSettings } from './lib/settings-store'
import { getUpdateDistributionInfo } from './lib/distribution'
import { safeSendMessagePackToWindow } from './window-ipc'
import {
  createUpdateDownloadGate,
  createUpdateInstallGate,
  createUpdaterStateCoordinator,
  observeDownload,
  pickProgressSnapshot,
  type UpdateDownloadGate,
  type UpdateDownloadObservation,
  type UpdateInstallGate,
  type UpdaterStateCoordinator
} from './updater-state'
import { NO_UPDATE_OPERATION_ID } from '../shared/updater/types'
import type {
  UpdateActionResult,
  UpdateAvailablePayload,
  UpdateCheckResult,
  UpdateDistributionInfo,
  UpdateDownloadProgressPayload,
  UpdateDownloadedPayload,
  UpdateDownloadStartResult,
  UpdateErrorPayload,
  UpdateStateSnapshot,
  UpdateStatus
} from '../shared/updater/types'

type AutoUpdater = typeof import('electron-updater').autoUpdater
type WindowGetter = () => BrowserWindow | null
type QuitMarker = () => void

export interface UpdaterOptions {
  getMainWindow: WindowGetter
  markAppWillQuit: QuitMarker
}

const RENDERER_SETTINGS_STORAGE_KEY = 'wishfulclaw-settings'

/**
 * electron-updater fires `download-progress` on every chunk. Logging each one would bury the native
 * `[updater]` lines that carry the `Full` / `To download` evidence, so our own progress lines are
 * spaced out — while the UI and the coordinator still see every event.
 */
const PROGRESS_LOG_INTERVAL_MS = 5_000
/**
 * 后台巡检间隔。这个软件的定位是 24 小时常驻、电脑不关机 —— 只在启动时查一次，等于永远停在
 * 开机那一刻的版本判断上，一直开着的用户反而永远看不到新版本。
 *
 * 6 小时是折中：半天里总有一次机会发现新版本，又不至于让 GitHub 直连时通时不通的机器反复去问。
 * 一旦真发现有新版本，巡检就自行停掉（见 runPeriodicRecheck），所以这只是「多久空跑一次」。
 */
const PERIODIC_RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let updater: AutoUpdater | null = null
let initializePromise: Promise<void> | null = null
let checkPromise: Promise<UpdateCheckResult> | null = null
let periodicRecheckTimer: ReturnType<typeof setInterval> | null = null
/**
 * 当前这次检查是否来自后台巡检。只影响「发现的更新要不要立刻弹窗」—— 巡检时用户多半不在
 * 跟前，横幅提示就够了，抢焦点是打扰。
 */
let checkIsPeriodic = false
let downloadGate: UpdateDownloadGate | null = null
let installGate: UpdateInstallGate | null = null
let options: UpdaterOptions | null = null
let coordinator: UpdaterStateCoordinator | null = null
let activeOperationId = NO_UPDATE_OPERATION_ID
let lastProgressLogAt = 0

function updaterState(): UpdaterStateCoordinator {
  coordinator ??= createUpdaterStateCoordinator({ currentVersion: currentVersion() })
  return coordinator
}

function getDownloadGate(instance: AutoUpdater): UpdateDownloadGate {
  downloadGate ??= createUpdateDownloadGate({
    coordinator: updaterState(),
    start: () => instance.downloadUpdate(),
    onFailure: (error) => {
      // Read before the phase flips to `error`: these are the last bytes this attempt reported.
      setError(error, true, { ...observeDownload(updaterState().snapshot()) })
    }
  })
  return downloadGate
}

/**
 * Holds the one and only `quitAndInstall` call site. The gate decides whether it may run at all, so
 * nothing but an explicit user request can reach it — and the delay keeps the IPC reply ahead of the
 * teardown it triggers.
 */
function getInstallGate(instance: AutoUpdater): UpdateInstallGate {
  installGate ??= createUpdateInstallGate({
    coordinator: updaterState(),
    install: () => {
      setTimeout(() => {
        try {
          options?.markAppWillQuit()
          instance.quitAndInstall(false, true)
        } catch (error) {
          setError(error)
        }
      }, 100)
    },
    onFailure: (error) => {
      setError(error)
    }
  })
  return installGate
}

/**
 * 丢掉已被新版本取代的安装包。
 *
 * 状态层面 `applyAvailable` 已经清掉 `downloadedVersion`，所以那个包再也装不上 —— 但磁盘上那份
 * 还在，不删就一直占着缓存目录。`downloadedUpdateHelper` 在 electron-updater 里是 protected 且
 * 懒创建，只能结构化访问：拿不到就说明这台机器还没下载过东西，本来也无事可做。
 *
 * 只允许在 `applyAvailable` 成功之后调用 —— 那条分支已经排除了「正在下载」的相位，所以这里不可能
 * 清掉一个正在被写入的缓存目录。
 */
async function discardDownloadedPackage(instance: AutoUpdater): Promise<void> {
  const helper = (
    instance as unknown as { downloadedUpdateHelper?: { clear(): Promise<void> } | null }
  ).downloadedUpdateHelper
  if (!helper) return
  try {
    await helper.clear()
    logInfo('main', 'Updater discarded the superseded downloaded package')
  } catch (error) {
    // 删不掉只是多占点磁盘，不影响「重新下载最新版」这条路，所以不往外抛。
    logWarn('main', `Updater could not discard the superseded package: ${getErrorMessage(error)}`)
  }
}

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

/**
 * The part of `UpdateInfo` we read. Typed structurally on purpose: electron-updater is an optional
 * dependency loaded lazily, and its entry point does not re-export `UpdateInfo`.
 */
interface UpdateOfferMetadata {
  path?: string
  files?: Array<{ url?: string; size?: number } | null | undefined> | null
}

/**
 * `ProgressInfo` reports no installer size, so the release metadata is the only baseline available.
 * Without it a transferred total far below the package cannot be told apart from a truncated
 * download — which is the whole distinction between differential and full.
 */
function resolveDeclaredInstallerSize(info: UpdateOfferMetadata): number | null {
  const files = info.files ?? []
  const primary = files.find((file) => file?.url === info.path) ?? files[0]
  const size = primary?.size
  // A declared 0 is not a baseline, so it stays unknown rather than posing as an observation.
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : null
}

/**
 * One field set for start, progress, completion and failure. Keeping them identical is what lets a
 * report join our own lines to electron-updater's native `[updater]` output by operationId, and it
 * means the numbers in the log are the same numbers the renderer was just shown.
 */
function logDownload(message: string, observation: UpdateDownloadObservation): void {
  logInfo('main', message, { extra: { ...observation } })
}

/**
 * `lastProgressLogAt` is reset when a download starts, so the first observation of every attempt is
 * logged even if the previous attempt ended moments earlier.
 */
function logDownloadProgress(snapshot: UpdateStateSnapshot): void {
  const nowMs = Date.now()
  if (nowMs - lastProgressLogAt < PROGRESS_LOG_INTERVAL_MS) return
  lastProgressLogAt = nowMs
  logDownload(`Updater download progress (operation ${snapshot.operationId})`, observeDownload(snapshot))
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

function setError(error: unknown, notify = true, extra?: Record<string, unknown>): string {
  const message = formatError(error)
  logError('main', `Updater error: ${message}`, {
    extra: { error: getErrorMessage(error), ...extra }
  })
  // Silent failures (startup auto-check, init) must not leave phase 'error':
  // the renderer would later fetch status and auto-open an empty error dialog.
  if (notify) {
    updaterState().fail(message)
    const payload: UpdateErrorPayload = { error: message }
    sendUpdateEvent('update:error', payload)
  } else {
    updaterState().failSilently()
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
    updaterState().beginCheck()
  })

  instance.on('update-available', (info) => {
    const version = normalizeVersion(info.version)
    if (!isNewerVersion(version, currentVersion())) {
      logWarn('main', `Updater ignored non-newer version: ${version}`)
      updaterState().applyNotAvailable()
      return
    }
    // 磁盘上躺着的就是这个版本 ⇒ 这次「发现」没带来任何新东西，状态不必推倒重来。用户点图标重查
    // 走的正是这条路，若照常 applyAvailable，那个已经下载好的包会被当成作废，只能重下一遍。
    if (updaterState().snapshot().downloadedVersion === version) {
      logInfo('main', `Updater kept the already-downloaded version ${version}`)
      return
    }

    const releaseNotes = formatReleaseNotes(info.releaseNotes)
    const declaredInstallerSize = resolveDeclaredInstallerSize(info)
    // 取在 applyAvailable 之前 —— 清掉 downloadedVersion 的正是那一步，而「上一个包被取代了」这个
    // 判断要的是改之前的值。
    const supersededVersion = updaterState().snapshot().downloadedVersion
    if (
      !updaterState().applyAvailable({ newVersion: version, releaseNotes, declaredInstallerSize })
    ) {
      logWarn('main', `Updater dropped update-available for ${version} in current phase`)
      return
    }
    // 旧包已经作废（coordinator 再不认它，「重启安装」会以 noDownloadedUpdate 被拒），磁盘上那份
    // 也一起丢掉，让用户重新下载的就是最新版本。
    if (supersededVersion && supersededVersion !== version) {
      void discardDownloadedPackage(instance)
    }

    const payload: UpdateAvailablePayload = {
      currentVersion: currentVersion(),
      newVersion: version,
      releaseNotes,
      ...getAppDistributionInfo(),
      ...(checkIsPeriodic ? { silent: true } : {})
    }
    logInfo('main', `Updater found version ${version}`, { extra: { declaredInstallerSize } })
    sendUpdateEvent('update:available', payload)
  })

  instance.on('update-not-available', (info) => {
    updaterState().applyNotAvailable()
    logInfo('main', `Updater found no newer version (latest: ${info.version})`)
  })

  instance.on('download-progress', (progress) => {
    const accepted = updaterState().applyProgress(activeOperationId, {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    })
    if (!accepted) return

    // Read back after applying: the coordinator has just clamped and monotonic-checked these values,
    // so the payload, the taskbar bar and the log line all quote what the state actually holds.
    const snapshot = updaterState().snapshot()
    const payload: UpdateDownloadProgressPayload = pickProgressSnapshot(snapshot)

    const win = getValidWindow()
    if (win) {
      // An unmeasured download must not sit the taskbar bar at 0%: that reads as stalled.
      if (payload.percent === null) win.setProgressBar(-1, { mode: 'indeterminate' })
      else win.setProgressBar(payload.percent / 100, { mode: 'normal' })
    }
    sendUpdateEvent('update:download-progress', payload)
    logDownloadProgress(snapshot)
  })

  instance.on('update-downloaded', (info) => {
    const version = normalizeVersion(info.version)
    if (!updaterState().applyDownloaded(activeOperationId, version)) {
      logWarn('main', `Updater dropped update-downloaded for ${version} (operation ${activeOperationId})`)
      return
    }

    const win = getValidWindow()
    if (win) win.setProgressBar(-1)
    // The coordinator freezes elapsedMs and keeps the last observed byte counts on completion, so
    // this snapshot is the final measurement of the attempt — the numbers the report quotes.
    const snapshot = updaterState().snapshot()
    const payload: UpdateDownloadedPayload = { version, ...pickProgressSnapshot(snapshot) }
    logDownload(`Updater downloaded version ${version}`, observeDownload(snapshot))
    sendUpdateEvent('update:downloaded', payload)
  })

  instance.on('error', (error) => {
    // Captured first: `setError` moves the phase to `error`, and the failure log should still say
    // how far the download got before it broke.
    const snapshot = updaterState().snapshot()
    if (snapshot.phase === 'checking' && !downloadGate?.isInFlight()) {
      logWarn('main', `Background updater check failed: ${formatError(error)}`)
      updaterState().failSilently()
      return
    }
    const win = getValidWindow()
    if (win) win.setProgressBar(-1)
    setError(error, true, { ...observeDownload(snapshot) })
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
    const knownAvailable = updaterState().snapshot().availableVersion
    const available = latest ? isNewerVersion(latest, current) : knownAvailable !== null
    return {
      success: true,
      available,
      currentVersion: current,
      latestVersion: latest ?? knownAvailable,
      skipped: result === null,
      ...distribution
    }
  } catch (error) {
    const message = setError(error, false)
    return { success: false, error: message }
  }
}

export async function requestUpdateCheck(request?: { periodic?: boolean }): Promise<UpdateCheckResult> {
  if (!checkPromise) {
    checkIsPeriodic = request?.periodic === true
    checkPromise = checkForUpdatesInternal().finally(() => {
      checkPromise = null
      checkIsPeriodic = false
    })
  }
  // A shared in-flight check keeps its first caller's origin: if a manual check is already running,
  // the poll rides along with it and the update still gets announced — the user asked for it.
  return checkPromise
}

export async function requestUpdateDownload(): Promise<UpdateDownloadStartResult> {
  if (!supportsAutoInstall()) {
    return { success: false, error: tr('unsupportedInstall') }
  }
  const downloaded = updaterState().snapshot()
  if (downloaded.downloadedVersion) {
    return { success: true, operationId: downloaded.operationId }
  }
  if (!updater) {
    try {
      await ensureInitialized()
    } catch (error) {
      return { success: false, error: formatError(error) }
    }
  }
  if (!updater) return { success: false, error: tr('updaterUnavailable') }

  const snapshot = updaterState().snapshot()
  const ack = snapshot.availableVersion
    ? getDownloadGate(updater).request(snapshot.availableVersion)
    : null
  if (!ack?.accepted) {
    return { success: false, error: tr('noAvailableDownload') }
  }

  activeOperationId = ack.operationId
  // Reset so the first progress event of this attempt logs even if a previous one just ended.
  lastProgressLogAt = 0
  logDownload(
    `Updater download started for ${snapshot.availableVersion} (operation ${ack.operationId})`,
    observeDownload(updaterState().snapshot())
  )
  return { success: true, operationId: ack.operationId }
}

export function getUpdateStatus(): UpdateStatus {
  return {
    success: true,
    ...updaterState().snapshot(),
    ...getAppDistributionInfo()
  }
}

export function requestUpdateInstall(): UpdateActionResult {
  if (!supportsAutoInstall()) {
    return { success: false, error: tr('unsupportedInstall') }
  }
  const snapshot = updaterState().snapshot()
  if (!updater || !snapshot.downloadedVersion) {
    return { success: false, error: tr('noDownloadedUpdate') }
  }

  const outcome = getInstallGate(updater).request()
  if (outcome === 'refused') {
    return { success: false, error: tr('noDownloadedUpdate') }
  }
  // 'already-installing' stays silent: a repeated click is a no-op, not a second restart.
  if (outcome === 'started') {
    logInfo('main', `Updater install requested for ${snapshot.downloadedVersion}`)
  }
  return { success: true }
}

function stopPeriodicRecheck(): void {
  if (periodicRecheckTimer === null) return
  clearInterval(periodicRecheckTimer)
  periodicRecheckTimer = null
}

/**
 * 一次后台巡检。三道门每次都重判 —— 设置可能中途被关掉，分发方式也可能变；已经知道有新版本
 * 就直接停下，不再反复问 GitHub（横幅一直亮着，等用户处理或下次启动就够）。
 */
async function runPeriodicRecheck(): Promise<void> {
  if (!app.isPackaged || !canCheckForUpdates() || !getPersistedAutoUpdateEnabled()) {
    stopPeriodicRecheck()
    return
  }
  const snapshot = updaterState().snapshot()
  if (snapshot.availableVersion || snapshot.downloadedVersion) {
    stopPeriodicRecheck()
    return
  }
  try {
    await requestUpdateCheck({ periodic: true })
  } catch (error) {
    // 失败只落日志。checkForUpdatesInternal 内部走的是 setError(error, false)，本就不会推事件、
    // 也不会把相位留在 error —— GitHub 直连时通时不通，每小时弹一次「检查失败」没人受得了。
    logWarn('main', `Periodic updater check failed: ${formatError(error)}`)
  }
}

function startPeriodicRecheck(): void {
  if (periodicRecheckTimer !== null) return
  periodicRecheckTimer = setInterval(() => {
    void runPeriodicRecheck()
  }, PERIODIC_RECHECK_INTERVAL_MS)
  app.once('will-quit', stopPeriodicRecheck)
}

export async function initializeUpdater(nextOptions: UpdaterOptions): Promise<void> {
  if (options === null) options = nextOptions
  await ensureInitialized()
  if (!app.isPackaged || !canCheckForUpdates() || !getPersistedAutoUpdateEnabled()) return
  void requestUpdateCheck().catch((error) => {
    logWarn('main', `Startup updater check failed: ${formatError(error)}`)
  })
  startPeriodicRecheck()
}

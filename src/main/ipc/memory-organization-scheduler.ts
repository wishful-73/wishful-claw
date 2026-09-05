// Memory organization trigger system (S8).
//
// Two user-selectable modes read from the persisted renderer settings:
//   - startup: fire once shortly after app start when the last run is older
//     than the throttle window (guards against frequent restarts).
//   - nightly: schedule a one-shot timer for the configured local time-of-day,
//     with a five-minute polling fallback. A normal app startup never fires
//     nightly organization early, even when the watermark is not from today.
// Main never runs the organization itself — it pushes 'memory-organization:run'
// to the renderer, which owns the engine, provider resolution and run lock.

import { logInfo } from '../lib/logger'
import { readPersistedSettings } from '../lib/settings-store'
import { registerMessagePackHandler } from './messagepack-handler'
import { safeSendMessagePackToAllWindows } from '../window-ipc'

// zustand persist name of the renderer settings store (settings-store.ts).
const SETTINGS_STORAGE_KEY = 'wishfulclaw-settings'
// Key written by the renderer via config:set after each successful run.
const WATERMARK_CONFIG_KEY = 'memoryOrganizationLastRunAt'

const RUN_CHANNEL = 'memory-organization:run'
const SETTINGS_CHANGED_CHANNEL = 'memory-organization:settings-changed'

const STARTUP_DELAY_MS = 60_000
const STARTUP_THROTTLE_MS = 20 * 60 * 60 * 1000
const TICK_INTERVAL_MS = 5 * 60 * 1000

type OrganizationTrigger = 'startup' | 'nightly' | 'catchup'

interface OrganizationSettings {
  enabled: boolean
  schedule: 'nightly' | 'startup'
  nightlyTime: string
}

let startupTimer: NodeJS.Timeout | null = null
let nightlyTimer: NodeJS.Timeout | null = null
let tickTimer: NodeJS.Timeout | null = null
let lastTickAt = 0
let firedDayKey: string | null = null

function readOrganizationSettings(): OrganizationSettings {
  const persisted = readPersistedSettings(SETTINGS_STORAGE_KEY) as
    | { state?: Record<string, unknown> }
    | null
  const state = persisted?.state ?? {}
  const schedule = state.memoryOrganizationSchedule === 'startup' ? 'startup' : 'nightly'
  const rawTime = state.memoryOrganizationNightlyTime
  const nightlyTime =
    typeof rawTime === 'string' && /^\d{2}:\d{2}$/.test(rawTime) ? rawTime : '00:00'
  return {
    enabled: state.memoryOrganizationEnabled !== false,
    schedule,
    nightlyTime
  }
}

function readWatermark(): number {
  const value = readPersistedSettings(WATERMARK_CONFIG_KEY)
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function computeNightlyTarget(nightlyTime: string, now: Date): number {
  const [hours, minutes] = nightlyTime.split(':').map(Number)
  const target = new Date(now)
  target.setHours(hours ?? 0, minutes ?? 0, 0, 0)
  return target.getTime()
}

function fireOrganization(trigger: OrganizationTrigger): void {
  logInfo('main', `[MemoryOrganization] firing trigger=${trigger}`)
  safeSendMessagePackToAllWindows(RUN_CHANNEL, { trigger })
}

function runStartupCheck(): void {
  const settings = readOrganizationSettings()
  if (!settings.enabled) {
    logInfo('main', '[MemoryOrganization] startup check skipped: organization disabled')
    return
  }
  const watermark = readWatermark()
  if (settings.schedule === 'startup') {
    if (Date.now() - watermark >= STARTUP_THROTTLE_MS) {
      fireOrganization('startup')
    } else {
      logInfo(
        'main',
        `[MemoryOrganization] startup run throttled: last run ${Math.round((Date.now() - watermark) / 3600000)}h ago (< ${STARTUP_THROTTLE_MS / 3600000}h)`
      )
    }
    return
  }
  // nightly is strictly time-based: normal startup only arms the nightly
  // timer and must not run an early catch-up when the watermark is stale.
  logInfo(
    'main',
    `[MemoryOrganization] nightly startup check skipped: waiting for ${settings.nightlyTime} local time`
  )
}

function runTick(): void {
  const now = Date.now()
  const previousTickAt = lastTickAt
  lastTickAt = now

  const settings = readOrganizationSettings()
  if (!settings.enabled || settings.schedule !== 'nightly') return

  const target = computeNightlyTarget(settings.nightlyTime, new Date(now))
  const crossed = target > previousTickAt && target <= now
  if (!crossed) return

  const dayKey = localDayKey(now)
  if (firedDayKey === dayKey) return
  firedDayKey = dayKey
  fireOrganization('nightly')
}

function scheduleStartupCheck(): void {
  if (startupTimer) {
    clearTimeout(startupTimer)
    startupTimer = null
  }
  const settings = readOrganizationSettings()
  if (!settings.enabled) return
  startupTimer = setTimeout(() => {
    startupTimer = null
    runStartupCheck()
  }, STARTUP_DELAY_MS)
}

function scheduleNightlyTimer(): void {
  if (nightlyTimer) {
    clearTimeout(nightlyTimer)
    nightlyTimer = null
  }
  const settings = readOrganizationSettings()
  if (!settings.enabled || settings.schedule !== 'nightly') return

  const now = Date.now()
  let target = computeNightlyTarget(settings.nightlyTime, new Date(now))
  if (target <= now) {
    const nextDay = new Date(now)
    nextDay.setDate(nextDay.getDate() + 1)
    target = computeNightlyTarget(settings.nightlyTime, nextDay)
  }
  const delay = Math.max(1_000, target - now)
  nightlyTimer = setTimeout(() => {
    nightlyTimer = null
    const current = readOrganizationSettings()
    if (current.enabled && current.schedule === 'nightly') {
      const dayKey = localDayKey(Date.now())
      if (firedDayKey !== dayKey) {
        firedDayKey = dayKey
        fireOrganization('nightly')
      }
    }
    scheduleNightlyTimer()
  }, delay)
}

export function installMemoryOrganizationScheduler(): void {
  registerMessagePackHandler<unknown, { ok: boolean }>(SETTINGS_CHANGED_CHANNEL, () => {
    const settings = readOrganizationSettings()
    scheduleStartupCheck()
    scheduleNightlyTimer()
    logInfo(
      'main',
      `[MemoryOrganization] settings changed and schedule recalculated: enabled=${settings.enabled} schedule=${settings.schedule} nightlyTime=${settings.nightlyTime}`
    )
    return { ok: true }
  })

  const settings = readOrganizationSettings()
  logInfo(
    'main',
    `[MemoryOrganization] scheduler installed: enabled=${settings.enabled} schedule=${settings.schedule} nightlyTime=${settings.nightlyTime} tickMs=${TICK_INTERVAL_MS}`
  )

  lastTickAt = Date.now()
  scheduleStartupCheck()
  scheduleNightlyTimer()
  tickTimer = setInterval(runTick, TICK_INTERVAL_MS)
}

export function shutdownMemoryOrganizationScheduler(): void {
  if (startupTimer) {
    clearTimeout(startupTimer)
    startupTimer = null
  }
  if (nightlyTimer) {
    clearTimeout(nightlyTimer)
    nightlyTimer = null
  }
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
}

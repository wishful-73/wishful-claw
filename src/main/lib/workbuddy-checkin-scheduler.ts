/**
 * WorkBuddy 每日签到 —— 主进程内的静默定时器。
 *
 * 口径（2026-10-23）：
 *   - 北京时间 08:00 之后触发，再随机错开几分钟，不踩整点
 *   - 一天只尝试一次；失败不重试，留给用户手动点（设置页「授权 AI 服务商」里的签到）
 *   - 界面不出现「自动签到」这类字样
 *
 * 为什么挂在主进程：产品按 24 小时不关机设计，但窗口可能收到托盘里 —— 定时器放在渲染
 * 进程会跟着窗口一起消失。这里在 whenReady 之后起一个每分钟的 tick，并在启动时立刻判
 * 一次，所以「开机时已经过了窗口」也能补上，不依赖某一个时刻的启动事件。
 *
 * 签到接口与前端 workbuddy-checkin.ts 同源（计量接口没有 /v2 前缀，按 code 10001 判今日
 * 已签），这里独立实现是因为主进程用不了渲染进程的 ipcClient。
 */
import * as fs from 'fs'
import * as path from 'path'
import { readPersistedProviderStore } from './ai-provider-store'
import { resolveDataDir } from './data-dir'

const STATE_FILE_NAME = 'workbuddy-checkin.json'
const CHECKIN_START_HOUR = 8
/** 08:00 之后再错开的上限（分钟） */
const MAX_DELAY_MINUTES = 10
const TICK_MS = 60_000
const UA_VERSION = '5.5.6'
const PRESS_PATH = '/billing/meter/daily-checkin'
const CODE_ALREADY = 10001
/** 北京时间相对 UTC 的偏移 */
const CN_OFFSET_MS = 8 * 60 * 60 * 1000

/** 会走签到的内置服务商 */
const CHECKIN_BUILTIN_IDS = new Set(['workbuddy', 'workbuddy-ai'])

type JsonRecord = Record<string, unknown>

interface CheckinState {
  /** 最后一次尝试的北京日期，形如 `2026-10-23` */
  lastAttemptDate?: string
}

let tickTimer: ReturnType<typeof setInterval> | null = null
/** 防止一次 tick 还没跑完，下一分钟的 tick 又进来 */
let running = false

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

function statePath(): string {
  return path.join(resolveDataDir(), STATE_FILE_NAME)
}

function readState(): CheckinState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as unknown
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const date = textOf((raw as JsonRecord).lastAttemptDate).trim()
      return date ? { lastAttemptDate: date } : {}
    }
  } catch {
    // 没有状态文件、或者坏了：当作今天还没签到
  }
  return {}
}

function writeState(state: CheckinState): void {
  const target = statePath()
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const temporary = `${target}.${process.pid}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8' })
    fs.renameSync(temporary, target)
  } catch (error) {
    console.warn('[WorkBuddyCheckin] failed to persist state:', error)
  }
}

/** 北京时间的日期与当日分钟数 */
function beijingClock(now: number): { date: string; minutes: number } {
  const shifted = new Date(now + CN_OFFSET_MS)
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  }
}

/**
 * 当天的错开分钟数。用日期做种子，同一天算出来是同一个值 —— 否则每分钟重新随机，
 * 触发时刻会一直往后漂，永远等不到。
 */
function delayMinutesFor(date: string): number {
  let hash = 0
  for (let index = 0; index < date.length; index += 1) {
    hash = (hash * 31 + date.charCodeAt(index)) % 100_000
  }
  return 1 + (hash % MAX_DELAY_MINUTES)
}

/** baseUrl 形如 `https://copilot.tencent.com/v2`，计量接口在根上 */
function endpointOf(provider: JsonRecord): string {
  const base = textOf(provider.baseUrl).replace(/\/+$/, '')
  return base.endsWith('/v2') ? base.slice(0, -'/v2'.length) : base
}

function pickCheckinProviders(): JsonRecord[] {
  const store = readPersistedProviderStore()
  const providers = Array.isArray(store?.state?.providers) ? (store.state.providers as JsonRecord[]) : []
  return providers.filter((provider) => {
    const builtinId = textOf(provider.builtinId)
    const oauth = provider.oauth as JsonRecord | undefined
    if (!CHECKIN_BUILTIN_IDS.has(builtinId)) return false
    if (textOf(oauth?.accessToken).length === 0) return false
    // 默认开：只认显式的 false
    return oauth?.autoCheckin !== false
  })
}

async function pressCheckin(provider: JsonRecord): Promise<void> {
  const endpoint = endpointOf(provider)
  if (!endpoint) return

  const oauth = provider.oauth as JsonRecord
  const enterpriseId = textOf(oauth.enterpriseId).trim()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': `WorkBuddy/${UA_VERSION}`,
    Authorization: `Bearer ${textOf(oauth.accessToken)}`,
    'X-User-Id': textOf(oauth.uid),
    'X-Domain': textOf(oauth.domain) || new URL(endpoint).host,
    'X-Product': 'SaaS',
    'X-IDE-Type': 'WorkBuddy'
  }
  if (enterpriseId) {
    headers['X-Enterprise-Id'] = enterpriseId
    headers['X-Tenant-Id'] = enterpriseId
  }

  const response = await fetch(`${endpoint}${PRESS_PATH}`, {
    method: 'POST',
    headers,
    body: '{}',
    signal: AbortSignal.timeout(20_000)
  })

  let envelope: JsonRecord = {}
  try {
    envelope = (await response.json()) as JsonRecord
  } catch {
    // 非 JSON 就看状态码
  }
  const code = Number.parseInt(String(envelope.code ?? ''), 10) || 0

  if (code === CODE_ALREADY) return
  if (response.ok && code === 0) return

  throw new Error(textOf(envelope.msg) || `error ${code || response.status}`)
}

async function runTick(): Promise<void> {
  if (running) return
  running = true
  try {
    const now = Date.now()
    const { date, minutes } = beijingClock(now)
    if (minutes < CHECKIN_START_HOUR * 60 + delayMinutesFor(date)) return

    const state = readState()
    if (state.lastAttemptDate === date) return

    const providers = pickCheckinProviders()
    if (providers.length === 0) return

    // 先落盘再请求：失败了也不在今天重试，避免服务端被反复捅
    writeState({ lastAttemptDate: date })

    for (const provider of providers) {
      try {
        await pressCheckin(provider)
      } catch (error) {
        console.warn(
          `[WorkBuddyCheckin] ${textOf(provider.name) || textOf(provider.id)}:`,
          error instanceof Error ? error.message : error
        )
      }
    }
  } finally {
    running = false
  }
}

/** 启动定时器。重复调用无副作用。 */
export function startWorkbuddyCheckinScheduler(): void {
  if (tickTimer) return
  void runTick()
  tickTimer = setInterval(() => void runTick(), TICK_MS)
  // 定时器不该拖住进程退出
  tickTimer.unref?.()
}

export function stopWorkbuddyCheckinScheduler(): void {
  if (!tickTimer) return
  clearInterval(tickTimer)
  tickTimer = null
}

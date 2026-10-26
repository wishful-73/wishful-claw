/**
 * WorkBuddy 每日签到（S-218）。
 *
 * 两个 build 共用 POST /billing/meter/daily-checkin —— 注意计量接口没有 /v2 前缀。
 * 首次签到答 HTTP 200 `{code:0, data:{credit, streak_days, is_streak_day}}`；当天重复
 * 答 HTTP 400 + code 10001。**必须按 code 判，不能看 HTTP 状态**。
 *
 * 签到状态以服务端为准（/billing/meter/checkin-activity-status），不做本地「今天签过没」
 * 记录 —— 换设备、清缓存都不该让用户以为漏签。
 */
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import type { AIProvider } from '@renderer/lib/api/types'

/** WorkBuddy 接口按 UA 识别客户端 */
const UA_VERSION = '5.5.6'
const PRESS_PATH = '/billing/meter/daily-checkin'
const ACTIVITY_PATH = '/billing/meter/checkin-activity-status'
/** 当天已签过 */
const CODE_ALREADY = 10001
/** 服务端要人机验证 —— 只能让用户自己去点 */
const CAPTCHA_HINT = /captcha|验证码|人机|滑块/i

export type CheckinOutcome = 'claimed' | 'done' | 'captcha' | 'failed'

export interface CheckinResult {
  outcome: CheckinOutcome
  /** 本次（或今天早些时候）拿到的额度 */
  credit?: number
  /** 连续签到天数 */
  streak?: number
  /** failed / captcha 时的原因 */
  message?: string
}

interface ApiRequestResult {
  statusCode?: number
  error?: string
  body?: string
}

interface MeterAnswer {
  status: number
  code: number
  msg: string
  data: Record<string, unknown> | null
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

/** baseUrl 形如 `https://copilot.tencent.com/v2`，计量接口在根上 */
function endpointOf(provider: AIProvider): string {
  const base = (provider.baseUrl ?? '').replace(/\/+$/, '')
  return base.endsWith('/v2') ? base.slice(0, -'/v2'.length) : base
}

const countOf = (value: unknown): number => {
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof numeric === 'number' && Number.isFinite(numeric) ? Math.max(0, numeric) : 0
}

async function postMeter(provider: AIProvider, path: string, body: unknown = {}): Promise<MeterAnswer> {
  const endpoint = endpointOf(provider)
  if (!endpoint) throw new Error('该服务商没有 baseUrl，无法签到')

  const oauth = provider.oauth
  if (!oauth?.accessToken) throw new Error('尚未登录，请先授权账号')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': `WorkBuddy/${UA_VERSION}`,
    Authorization: `Bearer ${oauth.accessToken}`,
    'X-User-Id': oauth.uid ?? '',
    'X-Domain': oauth.domain || new URL(endpoint).host,
    'X-Product': 'SaaS',
    'X-IDE-Type': 'WorkBuddy'
  }
  const enterpriseId = oauth.enterpriseId?.trim()
  if (enterpriseId) {
    headers['X-Enterprise-Id'] = enterpriseId
    headers['X-Tenant-Id'] = enterpriseId
  }

  const result = (await ipcClient.invoke('api:request', {
    url: `${endpoint}${path}`,
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    useSystemProxy: provider.useSystemProxy
  })) as ApiRequestResult | undefined

  if (!result) throw new Error('请求没有返回结果')
  if (result.error) throw new Error(result.error)

  const raw = result.body ?? ''
  let envelope: Record<string, unknown> = {}
  try {
    envelope = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // 非 JSON：下面按状态码与空 code 处理
  }

  return {
    status: result.statusCode ?? 0,
    code: Number.parseInt(String(envelope.code ?? ''), 10) || 0,
    msg: textOf(envelope.msg) || textOf(envelope.message),
    data: envelope.data && typeof envelope.data === 'object' ? (envelope.data as Record<string, unknown>) : null
  }
}

/** 当天签到情况：今天拿到的额度与连续天数。查不到就给 0，不报错。 */
export async function fetchCheckinStatus(provider: AIProvider): Promise<{ credit: number; streak: number }> {
  try {
    const answer = await postMeter(provider, ACTIVITY_PATH)
    if (answer.code === 0 && answer.data) {
      return {
        credit: countOf(answer.data.today_credit),
        streak: countOf(answer.data.streak_days)
      }
    }
  } catch {
    // 状态是加分项，拿不到不影响签到本身
  }
  return { credit: 0, streak: 0 }
}

/** 点一次签到。 */
export async function pressCheckin(provider: AIProvider): Promise<CheckinResult> {
  const answer = await postMeter(provider, PRESS_PATH)

  if (answer.code === 0 && answer.status >= 200 && answer.status < 300) {
    return {
      outcome: 'claimed',
      credit: countOf(answer.data?.credit),
      streak: countOf(answer.data?.streak_days)
    }
  }

  if (answer.code === CODE_ALREADY) {
    const earlier = await fetchCheckinStatus(provider)
    return { outcome: 'done', credit: earlier.credit, streak: earlier.streak }
  }

  const message = answer.msg || (answer.code ? `error ${answer.code}` : `HTTP ${answer.status}`)
  return { outcome: CAPTCHA_HINT.test(message) ? 'captcha' : 'failed', message }
}

/**
 * Feishu OAuth Device Flow — scan-to-bind registration.
 *
 * Ported from Reasonix's bot_connection_app.go (startFeishuConnectionInstall / pollFeishuConnectionInstall).
 *
 * Flow:
 *   1. POST {base}/oauth/v1/app/registration  action=begin → device_code + verification_uri_complete
 *   2. Frontend renders verification_uri_complete as QR code
 *   3. User scans with Feishu app and authorizes
 *   4. POST same endpoint action=poll device_code=xxx → client_id (App ID) + client_secret (App Secret)
 *   5. Return credentials to the renderer, which saves them to channel config, enables, and starts the channel
 */

export type FeishuDomain = 'feishu' | 'lark'

export interface FeishuInstallSession {
  installId: string
  deviceCode: string
  userCode: string
  verifyUrl: string
  qrUrl: string
  domain: FeishuDomain
  pollDomain: FeishuDomain
  startedAt: number
  expireAt: number
  interval: number
}

export interface FeishuInstallResult {
  ok: boolean
  installId?: string
  qrUrl?: string
  userCode?: string
  expireIn?: number
  interval?: number
  message?: string
}

export interface FeishuPollResult {
  done: boolean
  status: 'pending' | 'connected' | 'error'
  message?: string
  error?: string
  appId?: string
  appSecret?: string
  domain?: FeishuDomain
  userId?: string
}

const sessions = new Map<string, FeishuInstallSession>()

function accountsBase(domain: FeishuDomain): string {
  return domain === 'lark'
    ? 'https://accounts.larksuite.com'
    : 'https://accounts.feishu.cn'
}

function randomId(): string {
  return `fs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

async function postInstallForm(
  base: string,
  body: Record<string, string>
): Promise<{ data: Record<string, unknown>; status: number }> {
  const formBody = new URLSearchParams(body).toString()
  const resp = await fetch(`${base}/oauth/v1/app/registration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody,
    signal: AbortSignal.timeout(15_000)
  })

  const text = await resp.text()
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(text)
  } catch {
    // non-JSON response
  }

  return { data, status: resp.status }
}

function stringValue(data: Record<string, unknown>, key: string): string {
  const v = data[key]
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return ''
}

function intValue(data: Record<string, unknown>, key: string, fallback: number): number {
  const v = data[key]
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = parseInt(v, 10)
    if (!isNaN(n) && n > 0) return n
  }
  return fallback
}

function resolveDomain(fallback: FeishuDomain, data: Record<string, unknown>): FeishuDomain {
  const userInfo = data['user_info'] as Record<string, unknown> | undefined
  if (userInfo && typeof userInfo === 'object') {
    const brand = stringValue(userInfo as Record<string, unknown>, 'tenant_brand')
    if (brand.toLowerCase() === 'lark') return 'lark'
    return 'feishu'
  }
  return fallback
}

function resolveUserId(data: Record<string, unknown>): string {
  const userInfo = data['user_info'] as Record<string, unknown> | undefined
  if (userInfo && typeof userInfo === 'object') {
    const info = userInfo as Record<string, unknown>
    return stringValue(info, 'open_id') || stringValue(info, 'union_id') || stringValue(info, 'user_id')
  }
  return ''
}

function buildQrUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    url.searchParams.set('from', 'sdk')
    url.searchParams.set('tp', 'sdk')
    url.searchParams.set('source', 'node-sdk')
    return url.toString()
  } catch {
    return rawUrl
  }
}

/**
 * Start a Feishu/Lark bot registration via OAuth Device Flow.
 * Returns a QR code URL for the user to scan with their Feishu app.
 */
export async function startFeishuInstall(domain: FeishuDomain = 'feishu'): Promise<FeishuInstallResult> {
  const beginDomain: FeishuDomain = 'feishu'
  const { data, status } = await postInstallForm(accountsBase(beginDomain), {
    action: 'begin',
    archetype: 'PersonalAgent',
    auth_method: 'client_secret',
    request_user_info: 'open_id'
  })

  if (status >= 400) {
    const msg = stringValue(data, 'error_description') || stringValue(data, 'message') || `HTTP ${status}`
    return { ok: false, message: msg }
  }

  const deviceCode = stringValue(data, 'device_code')
  const verifyUrl = stringValue(data, 'verification_uri_complete')
  const userCode = stringValue(data, 'user_code')

  if (!deviceCode || !verifyUrl) {
    return { ok: false, message: '飞书授权响应缺少 device_code 或二维码 URL' }
  }

  const qrUrl = buildQrUrl(verifyUrl)
  const installId = randomId()
  const interval = intValue(data, 'interval', 5)
  const expireIn = intValue(data, 'expire_in', 300) || intValue(data, 'expires_in', 300)

  sessions.set(installId, {
    installId,
    deviceCode,
    userCode,
    verifyUrl,
    qrUrl,
    domain,
    pollDomain: beginDomain,
    startedAt: Date.now(),
    expireAt: Date.now() + expireIn * 1000,
    interval
  })

  return {
    ok: true,
    installId,
    qrUrl,
    userCode,
    expireIn,
    interval,
    message: '请使用飞书扫描二维码完成授权绑定'
  }
}

/**
 * Poll for the user's authorization status.
 * When done, returns the App ID and App Secret.
 */
export async function pollFeishuInstall(installId: string): Promise<FeishuPollResult> {
  const session = sessions.get(installId)
  if (!session) {
    return { done: false, status: 'error', error: '无效或已过期的安装会话' }
  }

  if (Date.now() > session.expireAt) {
    sessions.delete(installId)
    return { done: false, status: 'error', error: '二维码已过期，请重新获取' }
  }

  const pollDomain = session.pollDomain || session.domain || 'feishu'
  const { data, status } = await postInstallForm(accountsBase(pollDomain), {
    action: 'poll',
    device_code: session.deviceCode
  })

  const errText = stringValue(data, 'error')
  if (errText) {
    if (errText === 'authorization_pending' || errText === 'slow_down') {
      return { done: false, status: 'pending', message: '等待扫码授权...' }
    }
    sessions.delete(installId)
    const desc = stringValue(data, 'error_description') || errText
    return { done: false, status: 'error', error: desc }
  }

  if (status >= 400) {
    sessions.delete(installId)
    return { done: false, status: 'error', error: `HTTP ${status}` }
  }

  // Detect Lark tenant — switch poll domain for subsequent requests
  const detectedDomain = resolveDomain(session.domain, data)
  if (detectedDomain === 'lark' && pollDomain !== 'lark') {
    session.pollDomain = 'lark'
    return { done: false, status: 'pending', message: '已识别为 Lark 授权，继续等待授权完成...' }
  }

  const appId = stringValue(data, 'client_id')
  const appSecret = stringValue(data, 'client_secret')

  if (!appId || !appSecret) {
    return { done: false, status: 'pending', message: '等待授权完成...' }
  }

  // Success — clean up session
  sessions.delete(installId)

  return {
    done: true,
    status: 'connected',
    message: '飞书授权成功',
    appId,
    appSecret,
    domain: detectedDomain,
    userId: resolveUserId(data)
  }
}

/**
 * Cancel / clean up an install session.
 */
export function cancelFeishuInstall(installId: string): void {
  sessions.delete(installId)
}

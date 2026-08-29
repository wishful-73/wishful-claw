import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import type { OAuthConfig, OAuthToken } from '@renderer/lib/api/types'
import { isMoonshotOAuthConfig, buildMoonshotCommonHeaders } from './oauth-utils'

function parseJwtAccountId(token: string | undefined): string | undefined {
  if (!token) return undefined
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  const payload = parts[1]
  try {
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const json = JSON.parse(decoded) as Record<string, unknown>
    const accountId =
      (typeof json.account_id === 'string' && json.account_id) ||
      (typeof json.accountId === 'string' && json.accountId) ||
      (typeof json.sub === 'string' && json.sub)
    return accountId || undefined
  } catch {
    return undefined
  }
}

function parseExpiryTimestamp(value: unknown): number | undefined {
  if (value == null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) {
      return numeric > 10_000_000_000 ? Math.floor(numeric) : Math.floor(numeric * 1000)
    }
    const parsed = Date.parse(trimmed)
    if (!Number.isNaN(parsed)) return parsed
  }
  return undefined
}

function normalizeTokenResponse(raw: Record<string, unknown>, deviceId?: string): OAuthToken {
  const accessToken = String(raw.access_token ?? '')
  const refreshToken = raw.refresh_token ? String(raw.refresh_token) : undefined
  const scope = raw.scope ? String(raw.scope) : undefined
  const tokenType = raw.token_type ? String(raw.token_type) : undefined
  const idToken = raw.id_token ? String(raw.id_token) : undefined

  const expiresIn =
    typeof raw.expires_in === 'number'
      ? raw.expires_in
      : typeof raw.expiresIn === 'number'
        ? raw.expiresIn
        : Number(raw.expires_in ?? raw.expiresIn)
  const expiresAt =
    parseExpiryTimestamp(
      raw.expires_at ??
        raw.expiresAt ??
        raw.expired_at ??
        raw.expiredAt ??
        raw.expire_at ??
        raw.expireAt
    ) ?? (Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : undefined)
  const accountId =
    (typeof raw.account_id === 'string' && raw.account_id) ||
    (typeof raw.accountId === 'string' && raw.accountId) ||
    parseJwtAccountId(accessToken)

  return {
    accessToken,
    refreshToken,
    expiresAt,
    scope,
    tokenType,
    accountId,
    ...(idToken ? { idToken } : {}),
    ...(deviceId ? { deviceId } : {})
  }
}

function buildTokenHeaders(
  mode: 'form' | 'json',
  overrides?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = { ...(overrides ?? {}) }
  if (!headers['Content-Type']) {
    headers['Content-Type'] =
      mode === 'json' ? 'application/json' : 'application/x-www-form-urlencoded'
  }
  if (!headers.Accept) {
    headers.Accept = 'application/json'
  }
  return headers
}

async function buildOAuthRequestHeaders(
  config: OAuthConfig,
  mode: 'form' | 'json',
  overrides?: Record<string, string>,
  deviceId?: string
): Promise<Record<string, string>> {
  const headers = buildTokenHeaders(mode, overrides)
  if (!isMoonshotOAuthConfig(config)) return headers
  return {
    ...(await buildMoonshotCommonHeaders(deviceId)),
    ...headers
  }
}

async function requestOAuthJson(args: {
  url: string
  body: string
  headers: Record<string, string>
  useSystemProxy?: boolean
}): Promise<{ statusCode?: number; data: Record<string, unknown>; rawBody: string }> {
  const result = (await ipcClient.invoke('api:request', {
    url: args.url,
    method: 'POST',
    headers: args.headers,
    body: args.body,
    useSystemProxy: args.useSystemProxy
  })) as { statusCode?: number; error?: string; body?: string }

  if (result?.error) {
    throw new Error(result.error)
  }
  if (!result?.body) {
    throw new Error('Empty token response')
  }

  let data: Record<string, unknown>
  try {
    data = JSON.parse(result.body) as Record<string, unknown>
  } catch {
    const snippet = result.body.slice(0, 500)
    console.error(
      `[OAuth] JSON parse failed for ${args.url} status=${result.statusCode} body=${snippet}`
    )
    if (result.statusCode && result.statusCode >= 400) {
      throw new Error(`HTTP ${result.statusCode}: ${snippet}`)
    }
    throw new Error(`Invalid JSON token response: ${snippet}`)
  }

  return { statusCode: result.statusCode, data, rawBody: result.body }
}

async function sendTokenRequest(
  config: OAuthConfig,
  body: string,
  headers: Record<string, string>,
  deviceId?: string
): Promise<OAuthToken> {
  const { statusCode, data, rawBody } = await requestOAuthJson({
    url: config.tokenUrl,
    body,
    headers,
    useSystemProxy: config.useSystemProxy
  })

  if (statusCode && statusCode >= 400) {
    throw new Error(`HTTP ${statusCode}: ${rawBody.slice(0, 200)}`)
  }

  const token = normalizeTokenResponse(data, deviceId)
  if (!token.accessToken) {
    throw new Error('Missing access_token in response')
  }
  return token
}

export async function refreshOAuthFlow(
  config: OAuthConfig,
  refreshToken: string,
  deviceId?: string
): Promise<OAuthToken> {
  if (!config.tokenUrl || !config.clientId) {
    throw new Error('OAuth config missing tokenUrl/clientId')
  }

  const mode = config.refreshRequestMode ?? 'form'
  const scope = config.refreshScope ?? config.scope
  const headers = await buildOAuthRequestHeaders(
    config,
    mode,
    config.refreshRequestHeaders,
    deviceId
  )

  if (mode === 'json') {
    const payload: Record<string, string> = {
      grant_type: 'refresh_token',
      client_id: config.clientId,
      refresh_token: refreshToken
    }
    if (scope) payload.scope = scope
    return sendTokenRequest(config, JSON.stringify(payload), headers, deviceId)
  }

  const body = new URLSearchParams()
  body.set('grant_type', 'refresh_token')
  body.set('client_id', config.clientId)
  body.set('refresh_token', refreshToken)
  if (scope) body.set('scope', scope)

  return sendTokenRequest(config, body.toString(), headers, deviceId)
}

/**
 * WorkBuddy 登录 —— server_poll 流程。
 *
 * 与 authorization_code / device_code 不同：没有 client_id、没有 redirect_uri、
 * 没有 PKCE。服务端先铸一个 state 和登录页地址，用户在浏览器里登录，前端轮询
 * token 与 account 两个端点取回凭据。
 *
 * 对齐参考实现 src_signin.mjs（Apache-2.0）的 browserSignIn：
 *   1. POST {stateUrl}?platform=…      → { state, authUrl }
 *   2. 打开 authUrl（追加 version / loginSessionId）
 *   3. 轮询 GET {tokenUrl}?state=…      重试 code 11217（尚未登录）
 *   4. 轮询 GET {accountUrl}?state=…    重试 code 12151（账号尚未就绪）
 *   5. 非个人账号再查 {accountsUrl} 挑 enterpriseId
 */
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import type { AIProvider, OAuthConfig, OAuthToken } from '@renderer/lib/api/types'

/** WorkBuddy 接口按 UA 识别客户端 */
const UA_VERSION = '5.5.6'
/** 登录页 version 查询参数的缺省值 */
const DEFAULT_AUTH_PAGE_VERSION = '2.0.0'
const DEFAULT_POLL_MS = 1_000
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000
/** 「还没登录」 */
const CODE_NOT_SIGNED_IN = 11217
/** 「账号信息还没就绪」 */
const CODE_ACCOUNT_PENDING = 12151

/** WorkBuddy 插件接口的业务错误：HTTP 状态 + 信封里的 code / msg */
export class WorkBuddyApiError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly status: number
  ) {
    super(message)
    this.name = 'WorkBuddyApiError'
  }
}

interface ApiRequestResult {
  statusCode?: number
  error?: string
  body?: string
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * 调一次插件接口。WorkBuddy 的信封是 `{ code, msg, data }`，code 非 0 即失败，
 * 与 HTTP 状态无关 —— 两者都要判。
 */
async function callPluginApi(
  config: OAuthConfig,
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<Record<string, unknown>> {
  const result = (await ipcClient.invoke('api:request', {
    url,
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': `WorkBuddy/${UA_VERSION}`,
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    useSystemProxy: config.useSystemProxy
  })) as ApiRequestResult | undefined

  if (!result) throw new WorkBuddyApiError('请求没有返回结果', 0, 0)
  if (result.error) throw new WorkBuddyApiError(result.error, 0, result.statusCode ?? 0)

  const raw = result.body ?? ''
  let envelope: Record<string, unknown> = {}
  try {
    envelope = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // 非 JSON（网关错误页之类）：交给下面的状态码分支
  }

  const status = result.statusCode ?? 0
  const code = Number.parseInt(String(envelope.code ?? ''), 10) || 0
  const msg = textOf(envelope.msg) || textOf(envelope.message)

  if (status < 200 || status >= 300) {
    throw new WorkBuddyApiError(msg || raw.slice(0, 200) || `HTTP ${status}`, code, status)
  }
  if (code) throw new WorkBuddyApiError(msg || `error ${code}`, code, status)

  const data = envelope.data
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function poll(
  config: OAuthConfig,
  url: string,
  headers: Record<string, string>,
  retryCodes: readonly number[],
  deadline: number,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  for (;;) {
    if (signal?.aborted) throw new Error('登录已取消')
    if (Date.now() > deadline) throw new Error('登录超时（5 分钟），请重新发起')

    try {
      const data = await callPluginApi(config, 'GET', url, headers)
      if (Object.keys(data).length > 0) return data
    } catch (error) {
      const retriable =
        error instanceof WorkBuddyApiError &&
        (retryCodes.includes(error.code) || error.status === 408 || error.status === 429)
      if (!retriable) throw error
    }

    await sleep(config.pollIntervalMs ?? DEFAULT_POLL_MS)
  }
}

function randomHex(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/**
 * 登录所属的企业号。WorkBuddy 自己的客户端（mergeCurrentAccountDetails）也是这么挑：
 * 同类型的唯一一个，否则最近登录的唯一一个，否则唯一的一个；都没有就是个人账号。
 */
async function resolveEnterpriseId(
  config: OAuthConfig,
  accessToken: string,
  domain: string,
  who: Record<string, unknown>
): Promise<string> {
  const own = textOf(who.enterpriseId).trim()
  if (own) return own

  const type = String(who.type ?? '')
    .trim()
    .toLowerCase()
  if (!type || type === 'personal' || !config.accountsUrl) return ''

  let list: Record<string, unknown>
  try {
    list = await callPluginApi(config, 'GET', config.accountsUrl, {
      Authorization: `Bearer ${accessToken}`,
      'X-Domain': domain
    })
  } catch {
    return ''
  }

  const accounts = Array.isArray(list.accounts) ? (list.accounts as Record<string, unknown>[]) : []
  const uid = textOf(who.uid)
  const mine = accounts.filter((item) => item.uid === uid && textOf(item.enterpriseId).trim() !== '')
  const sameType = mine.filter(
    (item) =>
      String(item.type ?? '')
        .trim()
        .toLowerCase() === type
  )
  const lastLogin = mine.filter((item) => Boolean(item.lastLogin))
  const pick =
    sameType.length === 1
      ? sameType[0]
      : lastLogin.length === 1
        ? lastLogin[0]
        : mine.length === 1
          ? mine[0]
          : undefined

  return pick ? textOf(pick.enterpriseId).trim() : ''
}

export interface WorkBuddySignInResult {
  token: OAuthToken
  /** 已带 version / loginSessionId 的登录页地址，便于面板展示或重开浏览器 */
  authUrl: string
}

/**
 * 走完一次 WorkBuddy 登录。会自己打开系统浏览器，返回后凭据已可用于拼请求头。
 *
 * 注意：不做 token 刷新 —— 刷新逻辑跟其它服务商一样由上层统一处理。
 */
export async function signInWithWorkBuddy(
  provider: AIProvider,
  signal?: AbortSignal
): Promise<WorkBuddySignInResult> {
  const config = provider.oauthConfig
  if (!config) throw new Error('该服务商没有 OAuth 配置')

  const { stateUrl, tokenUrl, accountUrl } = config
  if (!stateUrl || !tokenUrl || !accountUrl) {
    throw new Error('WorkBuddy 登录配置不完整（缺 stateUrl / tokenUrl / accountUrl）')
  }

  const name = provider.name || 'WorkBuddy'
  const deadline = Date.now() + (config.pollTimeoutMs ?? DEFAULT_TIMEOUT_MS)

  // 1. 铸 state
  const stateQuery = new URLSearchParams({ ...(config.stateQuery ?? {}) })
  if (config.platform) stateQuery.set('platform', config.platform)
  const search = stateQuery.toString()
  const minted = await callPluginApi(
    config,
    'POST',
    search ? `${stateUrl}?${search}` : stateUrl,
    config.stateRequestHeaders ?? {},
    {}
  )

  const state = textOf(minted.state).trim()
  if (!state) throw new Error(`${name} 没有返回登录状态`)

  // 2. 组装登录页地址
  let authUrl: URL
  try {
    authUrl = new URL(textOf(minted.authUrl).trim())
  } catch {
    throw new Error(`${name} 没有返回可用的登录页`)
  }
  if (authUrl.protocol !== 'https:') throw new Error(`${name} 的登录页不是 https`)

  authUrl.searchParams.set('version', config.extraParams?.version ?? DEFAULT_AUTH_PAGE_VERSION)
  authUrl.searchParams.set('loginSessionId', randomHex())
  const loginUrl = authUrl.toString()

  // 3. 交给系统浏览器
  await ipcClient.invoke('shell:openExternal', loginUrl)

  // 4. 等 token
  const q = encodeURIComponent(state)
  const tokenData = await poll(config, `${tokenUrl}?state=${q}`, {}, [CODE_NOT_SIGNED_IN], deadline, signal)

  const accessToken = textOf(tokenData.accessToken)
  if (!accessToken) throw new Error(`${name} 没有返回 accessToken`)
  const domain = textOf(tokenData.domain) || hostOf(tokenUrl)

  // 5. 等账号
  const who = await poll(
    config,
    `${accountUrl}?state=${q}`,
    {
      Authorization: `Bearer ${accessToken}`,
      'X-Domain': domain,
      'X-No-User-Id': 'true',
      'X-No-Enterprise-Id': 'true'
    },
    [CODE_ACCOUNT_PENDING],
    deadline,
    signal
  )

  const uid = textOf(who.uid)
  const enterpriseId = await resolveEnterpriseId(config, accessToken, domain, who)

  const expiresAt = resolveExpiresAt(tokenData as Record<string, unknown>)

  // 账号显示名：昵称 → 手机号 → uid → 站点名
  const displayName =
    textOf(who.nickname).trim() || textOf(who.phoneNumber).trim() || uid || name

  return {
    authUrl: loginUrl,
    token: {
      accessToken,
      refreshToken: textOf(tokenData.refreshToken) || undefined,
      expiresAt,
      tokenType: textOf(tokenData.tokenType) || undefined,
      accountId: displayName,
      uid: uid || undefined,
      enterpriseId: enterpriseId || undefined,
      domain: domain || undefined
    }
  }
}

/**
 * 解析 token 到期时刻（S-218 §3）。
 *
 * 参考实现先认绝对时刻 `expiresAt`，再认相对秒 `expiresIn` —— 服务端两种都出现过。
 * 只认 `expiresIn` 时，若这次回来的是 `expiresAt`，`expiresAt` 会落成 undefined，
 * 而 `provider-auth-accounts.ts` 的两处续期判定都是 `if (expiresAt && …)`，
 * 整条短路 ⇒ 一小时后全链路 401 且不会自愈。所以这里必须两种都认。
 *
 * 秒级时间戳（10 位）转毫秒，已经是毫秒的（13 位）原样用。
 */
function resolveExpiresAt(source: Record<string, unknown>, fallback?: number): number | undefined {
  const absolute = Number(source.expiresAt)
  if (Number.isFinite(absolute) && absolute > 0) {
    return absolute < 1e12 ? absolute * 1000 : absolute
  }
  const relative = Number(source.expiresIn ?? source.expires_in ?? source.expires)
  if (Number.isFinite(relative) && relative > 0) return Date.now() + relative * 1000
  return fallback
}

/**
 * 用 refreshToken 换一枚新 accessToken。
 *
 * 与 authorization_code 那套不同：刷新端点不收 body，凭 `X-Refresh-Token` 头认身份，
 * `X-Auth-Refresh-Source: plugin` 说明是第三方客户端在续期。
 */
export async function refreshWorkBuddyToken(
  provider: AIProvider,
  token: OAuthToken
): Promise<OAuthToken> {
  const config = provider.oauthConfig
  if (!config?.refreshUrl) throw new Error('该服务商没有配置刷新地址')
  if (!token.refreshToken) throw new Error('登录状态已失效，请重新授权')

  const domain = token.domain || hostOf(config.refreshUrl)
  const headers: Record<string, string> = {
    'X-Refresh-Token': token.refreshToken,
    'X-Auth-Refresh-Source': 'plugin',
    'X-Domain': domain
  }
  const enterpriseId = token.enterpriseId?.trim()
  if (enterpriseId) {
    headers['X-Enterprise-Id'] = enterpriseId
    headers['X-Tenant-Id'] = enterpriseId
  }

  const got = await callPluginApi(config, 'POST', config.refreshUrl, headers, {})
  const accessToken = textOf(got.accessToken)
  if (!accessToken) throw new Error('刷新没有返回新的 accessToken')

  const expiresAt = resolveExpiresAt(got as Record<string, unknown>, token.expiresAt)

  return {
    ...token,
    accessToken,
    refreshToken: textOf(got.refreshToken) || token.refreshToken,
    expiresAt,
    domain: textOf(got.domain) || token.domain,
    tokenType: textOf(got.tokenType) || token.tokenType
  }
}

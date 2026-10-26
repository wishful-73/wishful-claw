/*
 * `api:request` —— renderer 侧通用 HTTP 转发通道。
 *
 * 背景：`lib/auth/{oauth,copilot,workbuddy-signin,workbuddy-checkin}.ts` 从
 * OpenCowork 移植时就调用本通道，但主进程一直没有 handler —— 2026-08-27 的审计
 * 5faa16ba 把消息压缩白名单里那行当「无主进程通道的死代码」删掉了，于是每次调用
 * 都落到裸 ipcRenderer.invoke，直接抛
 * "Error invoking remote method 'api:request': No handler registered"。
 *
 * 这里补上实现：走 Chromium 网络栈（net.request），因此自动继承系统代理与证书
 * 策略；`useSystemProxy === false` 时换到强制 direct 的内存 session 直连。
 * 返回 `{ statusCode, headers, body }`，失败统一返回 `{ error }` —— 调用方都是
 * 先判 `error` 再判状态码，异常不往外抛，交给 renderer 决定文案。
 */

import { Buffer } from 'node:buffer'
import { net, session, type Session } from 'electron'
import { registerMessagePackHandler } from './messagepack-handler'

interface ApiRequestArgs {
  url?: string
  method?: string
  headers?: Record<string, string>
  body?: string
  timeout?: number
  /** 未传视为「跟随系统代理」；显式 false 才走直连。 */
  useSystemProxy?: boolean
}

interface ApiRequestResult {
  statusCode?: number
  headers?: Record<string, string | string[]>
  body?: string
  error?: string
}

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

/** 直连出口专用 session：内存态、不落 cookie、代理强制 direct。
 *  首次使用时异步建好，避免请求跑在还没切到 direct 的继承代理上。 */
let directSessionPromise: Promise<Session> | null = null

function getDirectSession(): Promise<Session> {
  if (!directSessionPromise) {
    directSessionPromise = (async () => {
      const target = session.fromPartition('wishful-api-direct', { cache: false })
      await target.setProxy({ mode: 'direct' })
      return target
    })()
  }
  return directSessionPromise
}

/** 只有 http(s) 能从这里出去 —— file://、javascript: 之类的 scheme 一律拒绝。 */
function isHttpUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url.trim()) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function clampTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.trunc(value)))
}

async function requestOnce(args: ApiRequestArgs): Promise<ApiRequestResult> {
  if (!isHttpUrl(args.url)) {
    return { error: 'Only http(s) URLs can be requested' }
  }

  const url = args.url
  const method = (args.method ?? 'GET').toUpperCase()
  const timeoutMs = clampTimeout(args.timeout)
  const targetSession = args.useSystemProxy === false ? await getDirectSession() : undefined

  return new Promise<ApiRequestResult>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (result: ApiRequestResult): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    let request: ReturnType<typeof net.request>
    try {
      request = net.request({
        url,
        method,
        useSessionCookies: false,
        ...(targetSession ? { session: targetSession } : {})
      })
    } catch (error) {
      finish({ error: error instanceof Error ? error.message : String(error) })
      return
    }

    timer = setTimeout(() => {
      finish({ error: `Request timed out after ${timeoutMs}ms` })
      try {
        request.abort()
      } catch {
        // 已经结束的请求再 abort 会抛，忽略
      }
    }, timeoutMs)

    // 头一律走 setHeader 逐条设置：electron 对非法头会抛，单条失败不该拖垮整次请求。
    for (const [key, value] of Object.entries(args.headers ?? {})) {
      if (typeof value !== 'string') continue
      try {
        request.setHeader(key, value)
      } catch (error) {
        finish({ error: `Invalid header "${key}": ${error instanceof Error ? error.message : String(error)}` })
        try {
          request.abort()
        } catch {
          // ignore
        }
        return
      }
    }

    request.on('error', (error) => {
      finish({ error: error instanceof Error ? error.message : String(error) })
    })

    request.on('response', (response) => {
      const chunks: Buffer[] = []
      let size = 0

      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_RESPONSE_BYTES) {
          finish({ error: `Response body exceeded ${MAX_RESPONSE_BYTES} bytes` })
          try {
            request.abort()
          } catch {
            // ignore
          }
          return
        }
        chunks.push(chunk)
      })

      response.on('end', () => {
        finish({
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8')
        })
      })

      response.on('error', (error) => {
        finish({ error: error instanceof Error ? error.message : String(error) })
      })
    })

    if (typeof args.body === 'string' && args.body.length > 0) {
      request.write(args.body)
    }
    request.end()
  })
}

export function registerApiRequestHandlers(): void {
  registerMessagePackHandler<ApiRequestArgs>('api:request', (args) => requestOnce(args))
}

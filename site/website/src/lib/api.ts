/**
 * 官网 API 客户端（需求 S-226 §8.2）—— **两层**。
 *
 * ```ts
 * apiRequest<T>(path, init)  // 原样返回信封，调用方自己判 code
 * apiData<T>(path, init)     // code !== 0 抛 ApiError；成功直接给 data
 * ```
 *
 * 为什么分两层：列表接口只关心拿到数组（`apiData` 一行），
 * 而提交接口要按码给不同反馈（`TOO_FREQUENT` 要提示等待、`TOO_LONG` 要把焦点打回输入框），
 * 这时用 `apiRequest` 拿全貌，比 catch 一个有 code 的异常顺手。
 *
 * 路径一律相对（`./api/feedback`）—— 与站点其他数据源（`./stats.json`、
 * `./downloads/latest.yml`）同一口径，站点未来挂到子路径也不会全崩。
 */

import { CODE } from './api-codes'

export interface ApiResult<T> {
  code: number
  msg: string
  data: T | null
}

/** 没拿到信封时的码：负数，与服务端码表不冲突 */
export const CODE_TRANSPORT = -1

export class ApiError extends Error {
  readonly code: number

  constructor(code: number, msg: string) {
    super(msg)
    this.name = 'ApiError'
    this.code = code
  }

  /** 是不是「网络/解析失败」这类跟业务无关的错 —— 决定要不要提示重试 */
  get isTransport(): boolean {
    return this.code === CODE_TRANSPORT
  }
}

/**
 * 底层：任何情况都返回信封。
 *
 * 只有**拿不到信封**才抛 ApiError（网络断、nginx 返 HTML、JSON 坏了）。
 * 业务失败（参数错、限流、拒绝）是正常返回，code 非 0 而已 ——
 * 这正是「HTTP 200 承载业务成败」在客户端的落地。
 */
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  let res: Response
  try {
    res = await fetch(path, {
      // 反馈内容随时变（刚审过就该看得见），别让中间层缓存
      cache: 'no-store',
      ...init,
      headers
    })
  } catch {
    throw new ApiError(CODE_TRANSPORT, '网络好像不通，检查一下连接')
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    // nginx 的 error_page、网关的 502 页面都会走到这里
    throw new ApiError(CODE_TRANSPORT, res.ok ? '服务器返回的内容看不懂' : `服务器暂时不可用（${res.status}）`)
  }

  const envelope = body as Partial<ApiResult<T>> | null
  if (!envelope || typeof envelope.code !== 'number') {
    throw new ApiError(CODE_TRANSPORT, '服务器返回的内容看不懂')
  }

  return {
    code: envelope.code,
    msg: typeof envelope.msg === 'string' ? envelope.msg : '',
    data: (envelope.data ?? null) as T | null
  }
}

/** 便捷层：成功直接给 data；`code !== 0` 抛 `ApiError(code, msg)` */
export async function apiData<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiRequest<T>(path, init)
  if (r.code !== CODE.OK) {
    throw new ApiError(r.code, r.msg || '请求没成功')
  }
  return r.data as T
}

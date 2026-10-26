/**
 * 统一响应信封（需求 S-226 §6.1）。
 *
 * **HTTP 状态码只表达「请求是否到达并被正确处理」，业务成败全看 `code`。**
 * 这条口径的价值在于：nginx 的 `error_page`、浏览器的 4xx 处理、前端的
 * `res.ok` 判断，全都不会再参与业务语义 —— 前端只有一条判断路径 `code === 0`。
 *
 * 因此 `writeJson` 的 status 只有三处会传非 200：
 *   · 404 路由不存在（JSON 体仍是同一信封）
 *   · 500 未捕获异常（同上）
 * 其余一律 200，包括参数错、限流、业务拒绝。
 */

import { CODE, CODE_MSG } from './codes.mjs'

export const ok = (data = null) => ({ code: CODE.OK, msg: CODE_MSG[CODE.OK], data })

export const fail = (code, msg) => ({
  code,
  msg: msg || CODE_MSG[code] || '出错了，稍后再试',
  data: null
})

/**
 * 写一个 JSON 响应。
 * 不设 CORS 头 —— 服务与站点同域（nginx 反代 `/api/`），跨域不在范围内。
 */
export function writeJson(res, body, status = 200, extraHeaders = {}) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    // 反馈内容随时会变（刚审过就该看得见），不让浏览器和中间层缓存
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
    ...extraHeaders
  })
  res.end(text)
}

/**
 * 读 JSON 请求体。
 * @returns {Promise<{ok: true, value: unknown} | {ok: false, code: number}>}
 *
 * 超限时**不缓存整个 body**，边读边累加计数，到点就断开——否则一个 100 MB 的
 * 请求体能直接把 7.6 G 的机器磨到换页。
 */
export function readJsonBody(req, { maxBytes = 32 * 1024 } = {}) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    let settled = false

    const done = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > maxBytes) {
        // ⚠️ 这里**不能** req.destroy()：socket 一毁，路由层接着要写的
        // `writeJson` 也写不出去了 —— 客户端只会看到连接重置，而不是那个 10003。
        // 正确做法是把剩余的流吃掉（丢弃、不累积），让响应还能正常发出去。
        chunks.length = 0
        done({ ok: false, code: CODE.TOO_LONG })
        req.resume()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (settled) return
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) return done({ ok: false, code: CODE.PARAM })
      try {
        done({ ok: true, value: JSON.parse(raw) })
      } catch {
        done({ ok: false, code: CODE.BAD_JSON })
      }
    })

    req.on('error', () => done({ ok: false, code: CODE.BAD_JSON }))
  })
}

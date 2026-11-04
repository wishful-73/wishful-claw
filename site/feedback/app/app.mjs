/**
 * 反馈服务 HTTP 入口（需求 S-226）。
 *
 * 只监听 127.0.0.1 —— 对外由 nginx 反代（`deploy/feedback/nginx-location.conf`），
 * 管理面的口令校验在 nginx basic auth 完成，所以**进程内没有登录/口令这一层**。
 *
 * 响应一律走 `lib/envelope.mjs` 的信封：HTTP 200 承载业务成败，
 * 只有「路由不存在」和「未捕获异常」才用 404 / 500（体仍是同一信封）。
 *
 * 环境变量：
 *   WC_FEEDBACK_DIR    数据目录，默认 /data/services/wishfulclaw-feedback
 *   WC_FEEDBACK_PORT   端口，默认 7860
 *   WC_IP_SALT         IP 哈希盐，默认取一个固定串（只防明文落库，不是密码学用途）
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CODE } from './lib/codes.mjs'
import { fail, ok, readJsonBody, writeJson } from './lib/envelope.mjs'
import { createRateLimiter } from './lib/rate-limit.mjs'
import { canTransition, isValidStatus, normalizeStatus } from './lib/status.mjs'
import { validateSubmit } from './lib/validate.mjs'
import {
  countRecent,
  getStatuses,
  insertFeedback,
  listForReview,
  listPublic,
  openDb,
  setNote,
  setStatus,
  stats
} from './lib/db.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.WC_FEEDBACK_DIR || '/data/services/wishfulclaw-feedback'
const PORT = Number(process.env.WC_FEEDBACK_PORT || 7860)
const IP_SALT = process.env.WC_IP_SALT || 'wishfulclaw-feedback-v1'

/** 默认产品号：心相 App 复用同一张表时传自己的 `product` */
const DEFAULT_PRODUCT = 'wishfulclaw'

mkdirSync(DATA_DIR, { recursive: true })
const db = openDb(join(DATA_DIR, 'feedback.db'))
const limiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 })

/**
 * 管理页在**启动时读一次**并缓存：它没有变量、没有模板拼接，
 * 改这个文件要重启服务 —— 换掉「每次请求都读盘」换「内容天然不可注入」。
 */
const ADMIN_HTML = readFileSync(join(HERE, 'admin', 'index.html'), 'utf8')

const ADMIN_HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store'
}

/** 永不公开的字段：公开读只走 db.listPublic 的白名单，这里是兜底注释，别在别处漏 */
const log = (...args) => console.log(new Date().toISOString(), ...args)

function clientIp(req) {
  // nginx 反代会带 x-forwarded-for；服务只监听 127.0.0.1，伪造这个头的前提是
  // 已经能直连本机 7860 —— 那时候也没有防线可讲了。
  //
  // ⚠️ 取**最后一段**，不是第一段。nginx 用 `$remote_addr` 覆盖写时只有一段，两种取法
  // 等价；但万一哪天有人把它改回 `$proxy_add_x_forwarded_for`（追加写），客户端自带的
  // `X-Forwarded-For: 1.2.3.4` 会顶到最前面 —— 取第一段等于让攻击者每次换个 IP 就绕过
  // 5 次/小时的提交限流。最后一段始终是 nginx 自己看到的那一跳。
  const fwd = req.headers['x-forwarded-for']
  const raw = Array.isArray(fwd) ? fwd.join(',') : fwd
  const parts = raw
    ? raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : []
  return parts.length > 0 ? parts[parts.length - 1] : (req.socket.remoteAddress || '').trim()
}

/**
 * IP 哈希：只用于限流与去重，**永不公开**。
 * sha256 前 16 位足够避免撞车，也不至于在 7.6 G 的运维现场看不出是同一来源。
 */
function hashIp(ip) {
  return createHash('sha256').update(`${IP_SALT}:${ip}`).digest('hex').slice(0, 16)
}

/* ── 对外：提交 ─────────────────────────────────────────────────────────── */
async function handleSubmit(req, res) {
  const body = await readJsonBody(req)
  if (!body.ok) return writeJson(res, fail(body.code))

  const checked = validateSubmit(body.value)
  if (!checked.ok) return writeJson(res, fail(checked.code))

  const ipHash = hashIp(clientIp(req))
  const gate = limiter.check(ipHash)
  if (!gate.allowed) {
    log('rate-limited', ipHash, `retry_after_ms=${gate.retryAfterMs}`)
    return writeJson(res, fail(CODE.TOO_FREQUENT))
  }

  const id = insertFeedback(db, checked.data, ipHash)
  log('submit', id, checked.data.type, checked.data.product, ipHash)
  // 只回 id —— 不回显正文，也不回显任何审核侧字段
  return writeJson(res, ok({ id }))
}

/* ── 对外：公开读 ───────────────────────────────────────────────────────── */
function handlePublicList(req, res, url) {
  const product = (url.searchParams.get('product') || DEFAULT_PRODUCT).toLowerCase()
  const limit = Number(url.searchParams.get('limit') || 50)
  const items = listPublic(db, { product, limit })
  // 公开集由 SQL 的 `status in ('todo','done')` 保证，这里不再过滤
  return writeJson(res, ok(items))
}

/* ── 管理：列表 ─────────────────────────────────────────────────────────── */
function handleAdminList(res, url) {
  const product = (url.searchParams.get('product') || DEFAULT_PRODUCT).toLowerCase()
  const rawStatus = url.searchParams.get('status')
  if (rawStatus && !isValidStatus(rawStatus)) {
    return writeJson(res, fail(CODE.PARAM, '状态只能是 pending / todo / done / rejected'))
  }
  const status = rawStatus ? normalizeStatus(rawStatus) : null
  const items = listForReview(db, { product, status })
  return writeJson(res, ok({ items, stats: stats(db, { product }), recent24h: countRecent(db, { product }) }))
}

/* ── 管理：改状态 ───────────────────────────────────────────────────────── */
async function handleAdminSet(req, res) {
  const body = await readJsonBody(req)
  if (!body.ok) return writeJson(res, fail(body.code))
  const payload = body.value ?? {}

  const ids = (Array.isArray(payload.ids) ? payload.ids : [payload.id])
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0)
  if (!ids.length) return writeJson(res, fail(CODE.PARAM, '要指定至少一条反馈'))

  if (!isValidStatus(payload.status)) {
    return writeJson(res, fail(CODE.PARAM, '状态只能是 pending / todo / done / rejected'))
  }
  const target = normalizeStatus(payload.status)

  // 逐条判「能不能改」：已处于目标状态的跳过（不算错，批量操作里很常见）
  // 一次 in (...) 查齐当前状态，不在这里循环单查
  const current = new Map(getStatuses(db, ids).map((r) => [r.id, r.status]))
  const changed = []
  const skipped = []
  for (const id of ids) {
    const from = current.get(id)
    if (from === undefined) {
      skipped.push({ id, reason: 'not-found' })
      continue
    }
    const verdict = canTransition(from, target)
    if (!verdict.ok) {
      skipped.push({ id, reason: verdict.reason })
      continue
    }
    changed.push(id)
  }

  const n = changed.length ? setStatus(db, changed, target, payload.by === 'owner' ? 'owner' : 'assistant') : 0
  log('set-status', target, `changed=${n}`, `skipped=${skipped.length}`)
  return writeJson(res, ok({ changed: n, ids: changed, skipped }))
}

/* ── 管理：内部备注 ─────────────────────────────────────────────────────── */
async function handleAdminNote(req, res) {
  const body = await readJsonBody(req)
  if (!body.ok) return writeJson(res, fail(body.code))
  const payload = body.value ?? {}

  const id = Number(payload.id)
  if (!Number.isInteger(id) || id <= 0) return writeJson(res, fail(CODE.PARAM, '要指定反馈编号'))

  const note = typeof payload.note === 'string' ? payload.note.slice(0, 1000) : ''
  const n = setNote(db, id, note)
  if (!n) return writeJson(res, fail(CODE.NOT_FOUND))

  log('set-note', id, `${note.length} 字`)
  return writeJson(res, ok({ id, note }))
}

function handleAdminStats(res, url) {
  const product = (url.searchParams.get('product') || DEFAULT_PRODUCT).toLowerCase()
  return writeJson(res, ok({ ...stats(db, { product }), recent24h: countRecent(db, { product }) }))
}

/* ── 路由 ───────────────────────────────────────────────────────────────── */
async function route(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const path = url.pathname.replace(/\/{2,}/g, '/')
  const method = req.method || 'GET'

  // 管理页本体（nginx 的 `location ^~ /admin/feedback/` 会把这一类全兜给本进程）
  if (method === 'GET' && (path === '/admin/feedback/' || path === '/admin/feedback/index.html')) {
    res.writeHead(200, ADMIN_HTML_HEADERS)
    res.end(ADMIN_HTML)
    return
  }

  if (method === 'POST' && path === '/api/feedback') return handleSubmit(req, res)
  if (method === 'GET' && path === '/api/feedback') return handlePublicList(req, res, url)

  if (method === 'GET' && path === '/admin/feedback/api/list') return handleAdminList(res, url)
  if (method === 'POST' && path === '/admin/feedback/api/set') return handleAdminSet(req, res)
  if (method === 'POST' && path === '/admin/feedback/api/note') return handleAdminNote(req, res)
  if (method === 'GET' && path === '/admin/feedback/api/stats') return handleAdminStats(res, url)

  // 健康检查给 systemd / 运维用
  if (method === 'GET' && path === '/api/health') return writeJson(res, ok({ up: true }))

  return writeJson(res, fail(CODE.ROUTE, `${method} ${path} 不存在`), 404)
}

const server = createServer((req, res) => {
  // 兜底：任何漏网异常都必须是同一信封，不能吐 HTML 栈
  Promise.resolve()
    .then(() => route(req, res))
    .catch((err) => {
      log('ERROR', req.method, req.url, err?.stack || err?.message || String(err))
      if (res.headersSent) {
        res.end()
        return
      }
      writeJson(res, fail(CODE.STORAGE), 500)
    })
})

server.listen(PORT, '127.0.0.1', () => {
  log(`feedback service listening on 127.0.0.1:${PORT}`)
  log(`data dir: ${DATA_DIR}`)
})

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log(`${signal} received, closing`)
    server.close(() => {
      try {
        db.close()
      } catch {
        /* 关不掉就算了，进程要退 */
      }
      process.exit(0)
    })
  })
}

/**
 * 反馈库（需求 S-226 §7）—— `better-sqlite3`，同步 API。
 *
 * 三个必须钉住的点：
 *  1. **数据在 `/data/services/wishfulclaw-feedback/`，不在站点目录里** ——
 *     `deploy site` 是整目录原子替换，放站点里等于一次发布清库。
 *  2. **WAL + `busy_timeout=5000`**（§7.3）：单进程串行写，但管理页与公开读并发时
 *     仍可能撞上 checkpoint，超时比直接抛 SQLITE_BUSY 体面。
 *  3. **公开查询在 SQL 里就带 `status in ('todo','done')`**，不靠应用层过滤 ——
 *     应用层漏一处就是一个信息泄露。
 *
 * 备份一律 `.backup`，**禁止裸 `cp`**（WAL 下会丢未 checkpoint 的数据）。见 `deploy/feedback/backup.sh`。
 */

import Database from 'better-sqlite3'

/** 公开集：SQL 片段与 `lib/status.mjs` 的 PUBLIC_STATUSES 必须一致 */
const PUBLIC_SQL = "('todo','done')"

const SCHEMA = `
create table if not exists fb_entry (
  id             integer primary key autoincrement,
  product        text not null default 'wishfulclaw',
  type           text not null,
  title          text not null,
  content        text not null,
  contact        text,
  page           text,
  status         text not null default 'pending',
  ip_hash        text,
  reviewed_at    text,
  reviewed_by    text,
  review_note    text,
  requirement_id text,
  created_at     text not null,
  updated_at     text not null
);

create index if not exists IX_fb_entry_product_status_created
  on fb_entry(product, status, created_at desc);

create index if not exists IX_fb_entry_created
  on fb_entry(created_at desc);
`

export function openDb(dbPath) {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.exec(SCHEMA)
  return db
}

const now = () => new Date().toISOString()

/**
 * 插入一条待审反馈。
 * @param {{type:string,title:string,content:string,contact:string|null,page:string|null,product:string}} data
 * @returns {number} 新行 id
 */
export function insertFeedback(db, data, ipHash) {
  const t = now()
  const info = db
    .prepare(
      `insert into fb_entry (product, type, title, content, contact, page, status, ip_hash, created_at, updated_at)
       values (@product, @type, @title, @content, @contact, @page, 'pending', @ip_hash, @t, @t)`
    )
    .run({ ...data, ip_hash: ipHash ?? null, t })
  return Number(info.lastInsertRowid)
}

/**
 * 公开读。**只出 whitelisted 字段** —— `contact` / `ip_hash` / `page` /
 * `reviewed_by` / `review_note` 一个都不带出去，哪怕前端不看。
 *
 * @returns {Array<{id:number,type:string,title:string,content:string,status:string,created_at:string}>}
 */
export function listPublic(db, { product = 'wishfulclaw', limit = 50 } = {}) {
  return db
    .prepare(
      `select id, type, title, content, status, created_at
         from fb_entry
        where product = ? and status in ${PUBLIC_SQL}
        order by created_at desc
        limit ?`
    )
    .all(product, clampLimit(limit))
}

/** 管理列表。`status` 为空则全量（含 pending / rejected）。 */
export function listForReview(db, { product = 'wishfulclaw', status = null, limit = 200 } = {}) {
  const base = `select id, product, type, title, content, contact, page, status,
                       reviewed_at, reviewed_by, review_note, requirement_id,
                       created_at, updated_at
                  from fb_entry
                 where product = ?`
  if (status) {
    return db
      .prepare(`${base} and status = ? order by created_at desc limit ?`)
      .all(product, status, clampLimit(limit))
  }
  return db.prepare(`${base} order by created_at desc limit ?`).all(product, clampLimit(limit))
}

export function getById(db, id) {
  return db.prepare('select * from fb_entry where id = ?').get(id) ?? null
}

/**
 * 批量取当前状态，给「批量改状态」判转移用。
 * 一次 `in (...)` 而不是循环单查 —— 审核页选 200 条时能少 199 次往返。
 * @returns {Array<{id:number, status:string}>} 不存在的 id 不会出现在结果里
 */
export function getStatuses(db, ids) {
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  return db.prepare(`select id, status from fb_entry where id in (${placeholders})`).all(...ids)
}

/**
 * 改状态，支持批量。**任意方向回退**（§9.7）—— 不在这里驳回，合法性由
 * `lib/status.mjs` 的 `canTransition` 在路由层先判。
 * @returns {number} 实际改动的行数
 */
export function setStatus(db, ids, status, reviewedBy = 'assistant') {
  const t = now()
  const stmt = db.prepare(
    `update fb_entry set status = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? where id = ?`
  )
  const many = db.transaction((list) => {
    let n = 0
    for (const id of list) n += stmt.run(status, t, reviewedBy, t, id).changes
    return n
  })
  return many(ids)
}

/** 写内部备注。**永不公开** —— 驳回理由 / 并入哪条 / 修在哪个版本都记这儿。 */
export function setNote(db, id, note) {
  const t = now()
  return db
    .prepare('update fb_entry set review_note = ?, updated_at = ? where id = ?')
    .run(note || null, t, id).changes
}

/** 各状态计数 + 全量 */
export function stats(db, { product = 'wishfulclaw' } = {}) {
  const rows = db
    .prepare('select status, count(*) as n from fb_entry where product = ? group by status')
    .all(product)
  const out = { pending: 0, todo: 0, done: 0, rejected: 0, total: 0 }
  for (const r of rows) {
    out[r.status] = r.n
    out.total += r.n
  }
  return out
}

/** 最近 24 小时新增（「距上次审核新增多少条」用） */
export function countRecent(db, { product = 'wishfulclaw', hours = 24 } = {}) {
  const since = new Date(Date.now() - hours * 3600_000).toISOString()
  const row = db
    .prepare('select count(*) as n from fb_entry where product = ? and created_at >= ?')
    .get(product, since)
  return row?.n ?? 0
}

function clampLimit(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return 50
  return Math.min(Math.trunc(v), 500)
}

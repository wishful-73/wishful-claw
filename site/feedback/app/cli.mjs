#!/usr/bin/env node
/**
 * 反馈审核 CLI（需求 S-226 §9.6）—— 我在服务器上用这条通道审，老大用管理页。
 *
 * 打的是同一组管理端点（`/admin/feedback/api/*`），只是入口不同：
 * 服务只监听 127.0.0.1，所以本命令**必须在服务器上跑**。
 *
 *   node cli.mjs list  [--status pending] [--json] [--limit 50]
 *   node cli.mjs set   <id,id,...> <status>        # 批量、任意方向回退
 *   node cli.mjs note  <id> "备注内容"              # 永不公开
 *   node cli.mjs stats
 *
 * 环境变量 `WC_FEEDBACK_URL` 可改基址（默认 http://127.0.0.1:7860）。
 */

const BASE = process.env.WC_FEEDBACK_URL || 'http://127.0.0.1:7860'
const STATUS_LABEL = { pending: '待审', todo: '待办', done: '已做', rejected: '驳回' }
const TYPE_LABEL = { bug: 'Bug', feature: '需求' }

const [action, ...rest] = process.argv.slice(2)

function flag(name, fallback) {
  const i = rest.indexOf(name)
  return i === -1 ? fallback : rest[i + 1]
}
const has = (name) => rest.includes(name)

async function req(path, init) {
  let res
  try {
    res = await fetch(BASE + path, { cache: 'no-store', ...init })
  } catch (e) {
    die(`连不上 ${BASE}（服务没起？）: ${e.message}`)
  }
  let body
  try {
    body = await res.json()
  } catch {
    die(`服务返回的不是 JSON（HTTP ${res.status}）`)
  }
  if (body.code !== 0) die(`${body.msg}（code=${body.code}）`)
  return body.data
}

function die(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function pad(s, n) {
  // 中文按两个宽度算，终端里才对齐
  const width = [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)
  return String(s) + ' '.repeat(Math.max(0, n - width))
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function cmdList() {
  const status = flag('--status', '')
  const limit = Number(flag('--limit', 50))
  const qs = new URLSearchParams()
  if (status) qs.set('status', status)
  const data = await req(`/admin/feedback/api/list?${qs}`)
  const items = (data.items || []).slice(0, limit)

  if (has('--json')) {
    console.log(JSON.stringify({ items, stats: data.stats, recent24h: data.recent24h }, null, 2))
    return
  }

  const s = data.stats || {}
  console.log(
    `${STATUS_LABEL.pending} ${s.pending || 0} · ${STATUS_LABEL.todo} ${s.todo || 0} · ` +
      `${STATUS_LABEL.done} ${s.done || 0} · ${STATUS_LABEL.rejected} ${s.rejected || 0} · ` +
      `共 ${s.total || 0}（最近 24h +${data.recent24h || 0}）\n`
  )

  if (!items.length) {
    console.log('（这个状态下没有条目）')
    return
  }

  for (const it of items) {
    const head = `#${pad(it.id, 4)} [${pad(TYPE_LABEL[it.type] || it.type, 4)}] ${it.title}`
    console.log(head)
    const bits = [fmtTime(it.created_at), STATUS_LABEL[it.status] || it.status]
    if (it.page) bits.push(it.page)
    if (it.contact) bits.push(`联系：${it.contact}`)
    console.log(`      ${bits.join(' · ')}`)
    console.log(
      String(it.content)
        .split('\n')
        .map((l) => `      ${l}`)
        .join('\n')
    )
    if (it.review_note) console.log(`      备注：${it.review_note}`)
    console.log('')
  }
}

async function cmdSet() {
  const [idsArg, status] = rest
  if (!idsArg || !status) die('用法：cli.mjs set <id,id,...> <status>')
  const ids = idsArg
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
  if (!ids.length) die('要给至少一个合法的反馈编号')
  if (!STATUS_LABEL[status]) die(`状态只能是 ${Object.keys(STATUS_LABEL).join(' / ')}`)

  const data = await req('/admin/feedback/api/set', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // by=assistant：这条通道是我（老郑）在用。管理页那条才是 by=owner。
    body: JSON.stringify({ ids, status, by: 'assistant' })
  })
  console.log(`✓ 改 ${data.changed} 条 → ${STATUS_LABEL[status]}`)
  for (const s of data.skipped || []) {
    console.log(`  · #${s.id} 跳过（${s.reason === 'not-found' ? '不存在' : '已是该状态'}）`)
  }
}

async function cmdNote() {
  const [idArg, ...words] = rest
  const id = Number(idArg)
  if (!Number.isInteger(id) || id <= 0) die('用法：cli.mjs note <id> "备注内容"')
  const note = words.join(' ').trim()
  await req('/admin/feedback/api/note', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, note })
  })
  console.log(`✓ #${id} 备注已保存（${note.length} 字）`)
}

async function cmdStats() {
  const data = await req('/admin/feedback/api/stats')
  console.log(`  待审     ${data.pending || 0}`)
  console.log(`  待办     ${data.todo || 0}`)
  console.log(`  已做     ${data.done || 0}`)
  console.log(`  驳回     ${data.rejected || 0}`)
  console.log(`  ─────────────`)
  console.log(`  合计     ${data.total || 0}（最近 24h +${data.recent24h || 0}）`)
}

const commands = { list: cmdList, set: cmdSet, note: cmdNote, stats: cmdStats }

if (!action || !commands[action]) {
  console.log(`反馈审核 CLI

  node cli.mjs list  [--status pending] [--json] [--limit 50]
  node cli.mjs set   <id,id,...> <pending|todo|done|rejected>
  node cli.mjs note  <id> "备注内容"
  node cli.mjs stats

  服务基址：${BASE}（改环境变量 WC_FEEDBACK_URL）

「反馈进公开」的判据只有一个：status 变成 todo 或 done。
驳回的条目永远不公开，备注永远不公开。`)
  process.exit(action ? 1 : 0)
}

commands[action]().catch((e) => die(e.message))

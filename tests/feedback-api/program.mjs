/**
 * S-226 反馈服务纯逻辑回归。
 *
 * 只测**不依赖 better-sqlite3** 的模块（校验 / 状态机 / 限流 / 公开集 / 码表一致性）——
 * 这样 Windows 本地能直接 `node tests/feedback-api/program.mjs`，不用编译原生驱动。
 * 接线层（db / 路由）靠部署后的 curl 三连验（见 plan-s226/plan.md §5.1）。
 *
 * 为什么是 .mjs 而不是 .program.ts：被测源码本身就是零构建的 ESM，
 * 多套一层 esbuild 只会让「本地跑不动」这个坑变深。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CODE, CODE_MSG } from '../../server/feedback/lib/codes.mjs'
import { validateSubmit, LIMITS, TYPES } from '../../server/feedback/lib/validate.mjs'
import {
  ALL_STATUSES,
  PUBLIC_STATUSES,
  STATUS,
  canTransition,
  isPublicStatus,
  isValidStatus,
  normalizeStatus
} from '../../server/feedback/lib/status.mjs'
import { createRateLimiter } from '../../server/feedback/lib/rate-limit.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

let passed = 0
const fail = []

function eq(actual, expected, label) {
  try {
    assert.deepEqual(actual, expected)
    passed++
  } catch {
    fail.push(`${label}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 码表：分段、不重复、每条都有中文文案
// ─────────────────────────────────────────────────────────────────────────────
{
  const values = Object.values(CODE)

  eq(new Set(values).size, values.length, '码表无重复码')
  eq(CODE.OK, 0, '0 是成功码')

  // 分段：1xxxx 公共 / 2xxxx 反馈 / 9xxxx 兜底；3xxxx 目前只有预留、不该出现在 CODE 里
  const expectSeg = { PARAM: 1, BAD_JSON: 1, TOO_LONG: 1, HONEYPOT: 1, ROUTE: 1, TYPE_INVALID: 2, TOO_FREQUENT: 2, NOT_FOUND: 2, STORAGE: 9 }
  for (const [name, seg] of Object.entries(expectSeg)) {
    const n = CODE[name]
    eq(String(n)[0], String(seg), `${name} 落在 ${seg}xxxx 段`)
  }

  // 3xxxx 预留未用：认证在 nginx，进程内不该有管理口令码
  eq(values.filter((v) => String(v)[0] === '3').length, 0, '3xxxx 段预留未用，CODE 里不应出现')

  for (const [name, n] of Object.entries(CODE)) {
    eq(typeof CODE_MSG[n], 'string', `${name} 有默认文案`)
    eq(CODE_MSG[n].length > 0, true, `${name} 文案非空`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ② 前端码表副本必须与服务端一致 —— 不同步就会「前端按 A 判断、后端按 B 返回」
// ─────────────────────────────────────────────────────────────────────────────
{
  const tsPath = resolve(ROOT, 'website/src/lib/api-codes.ts')
  const text = readFileSync(tsPath, 'utf8')
  // 抓 `  NAME: 12345,` 形态（注释掉的 30001 不会命中，因为它前面没有 `NAME:` 直接跟数字）
  for (const [name, n] of Object.entries(CODE)) {
    const re = new RegExp(`\\b${name}\\s*:\\s*(\\d+)`)
    const found = text.match(re)
    eq(found ? Number(found[1]) : null, n, `前端 api-codes.ts 的 ${name} 与服务端一致`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ 校验：正常与各类拒绝
// ─────────────────────────────────────────────────────────────────────────────
{
  const good = { type: 'bug', title: '按钮截断', content: '手机端首页按钮被截断', website: '' }
  const r = validateSubmit(good)
  eq(r.ok, true, '正常提交通过')
  eq(r.data.type, 'bug', 'type 归一')
  eq(r.data.product, 'wishfulclaw', 'product 缺省为 wishfulclaw')
  eq(r.data.contact, null, '空 contact 存 null')
  eq(r.data.page, null, '空 page 存 null')

  eq(validateSubmit(null).code, CODE.PARAM, 'null → 参数错')
  eq(validateSubmit([]).code, CODE.PARAM, '数组 → 参数错')
  eq(validateSubmit('x').code, CODE.PARAM, '字符串 → 参数错')

  // 蜜罐优先于一切：填了就不该再往下走到 type 判断
  eq(validateSubmit({ type: 'nope', website: 'http://spam' }).code, CODE.HONEYPOT, '蜜罐命中 → 10004')
  eq(validateSubmit({ ...good, website: '  ' }).ok, true, '蜜罐只有空白视为未填')

  eq(validateSubmit({ ...good, type: 'other' }).code, CODE.TYPE_INVALID, 'type 非法 → 20001')
  eq(validateSubmit({ ...good, type: ' BUG ' }).data.type, 'bug', 'type 大小写与空白容错')

  eq(validateSubmit({ ...good, title: '   ' }).code, CODE.PARAM, 'title 全空白 → 参数错')
  eq(validateSubmit({ ...good, content: '' }).code, CODE.PARAM, 'content 空 → 参数错')

  eq(validateSubmit({ ...good, title: 'a'.repeat(LIMITS.title + 1) }).code, CODE.TOO_LONG, 'title 超长 → 10003')
  eq(validateSubmit({ ...good, title: 'a'.repeat(LIMITS.title) }).ok, true, 'title 恰好上限通过')
  eq(validateSubmit({ ...good, content: 'a'.repeat(LIMITS.content + 1) }).code, CODE.TOO_LONG, 'content 超长 → 10003')
  eq(validateSubmit({ ...good, content: 'a'.repeat(LIMITS.content) }).ok, true, 'content 恰好上限通过')
  eq(validateSubmit({ ...good, contact: 'a'.repeat(LIMITS.contact + 1) }).code, CODE.TOO_LONG, 'contact 超长 → 10003')

  // 非字符串一律当空：String(['a']) 会变 'a'、String({}) 会变 '[object Object]'
  eq(validateSubmit({ ...good, title: ['a'] }).code, CODE.PARAM, '数组型 title 当空处理，不拼接')
  eq(validateSubmit({ ...good, title: { a: 1 } }).code, CODE.PARAM, '对象型 title 当空处理')
  eq(validateSubmit({ ...good, content: 123 }).code, CODE.PARAM, '数字型 content 当空处理')

  eq(validateSubmit({ ...good, title: '  首尾空白  ' }).data.title, '首尾空白', 'title 去掉首尾空白')

  // product 要进 SQL 的 where，只放行安全字符
  eq(validateSubmit({ ...good, product: 'CoHeart' }).data.product, 'coheart', 'product 转小写')
  eq(validateSubmit({ ...good, product: 'a b' }).code, CODE.PARAM, 'product 含空格 → 参数错')
  eq(validateSubmit({ ...good, product: "x'; drop table fb_entry; --" }).code, CODE.PARAM, 'product 含注入字符 → 参数错')

  eq(TYPES.length, 2, '只有两种反馈类型')
}

// ─────────────────────────────────────────────────────────────────────────────
// ④ 状态机：四状态两两共 16 组，自身的 4 组拒绝、其余 12 组放行
// ─────────────────────────────────────────────────────────────────────────────
{
  eq(ALL_STATUSES.length, 4, '四个状态')
  eq(PUBLIC_STATUSES.length, 2, '公开集两个状态')

  let allowed = 0
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      const r = canTransition(from, to)
      eq(r.ok, from !== to, `${from} → ${to}`)
      if (r.ok) allowed++
    }
  }
  eq(allowed, 12, '12 组合法转移（任意方向回退）')

  eq(canTransition('pending', 'pending').reason, 'same', '改到自己是 same')
  eq(canTransition('pending', 'archived').reason, 'invalid', '非法目标状态')
  eq(canTransition(undefined, 'todo').reason, 'invalid', 'undefined 来源')

  eq(isValidStatus(' PENDING '), true, '状态大小写与空白容错')
  eq(normalizeStatus('  DONE '), STATUS.DONE, 'normalizeStatus 归一')

  // 公开集是「信息泄露」的唯一闸门：pending / rejected 绝不能漏
  eq(isPublicStatus('todo'), true, 'todo 公开')
  eq(isPublicStatus('done'), true, 'done 公开')
  eq(isPublicStatus('pending'), false, 'pending 不公开')
  eq(isPublicStatus('rejected'), false, 'rejected 不公开')
  eq(isPublicStatus(' PENDING '), false, '带空白的 pending 也不公开')
  eq(isPublicStatus(''), false, '空串不公开')
  eq(isPublicStatus(null), false, 'null 不公开')
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 限流：小时窗滑动、互不串号、窗口过后放行
// ─────────────────────────────────────────────────────────────────────────────
{
  let t = 1_000_000
  const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t })

  eq(rl.check('1.2.3.4').allowed, true, '第 1 条放行')
  eq(rl.check('1.2.3.4').allowed, true, '第 2 条放行')
  eq(rl.check('1.2.3.4').allowed, true, '第 3 条放行')

  const blocked = rl.check('1.2.3.4')
  eq(blocked.allowed, false, '第 4 条拒绝')
  eq(blocked.retryAfterMs, 60_000, '拒绝时给出可重试等待')

  eq(rl.check('5.6.7.8').allowed, true, '换 IP 不受影响')
  eq(rl.size(), 2, '两个 IP 各自在册')

  t += 60_001
  eq(rl.check('1.2.3.4').allowed, true, '窗口滑过后重新放行')

  // 被拒的请求不该无限堆积时间戳（否则拒绝期间的洪水会撑爆内存）
  const rl2 = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t })
  rl2.check('k')
  for (let i = 0; i < 50; i++) rl2.check('k')
  eq(rl2.check('k').allowed, false, '持续请求仍被拒')

  rl.reset()
  eq(rl.size(), 0, 'reset 清空')
  eq(rl.check('1.2.3.4').allowed, true, 'reset 后放行')
}

// ─────────────────────────────────────────────────────────────────────────────
// 汇总
// ─────────────────────────────────────────────────────────────────────────────
if (fail.length) {
  console.error(`\n✗ ${fail.length} 个断言失败：`)
  for (const line of fail) console.error(`   · ${line}`)
  process.exit(1)
}

console.log(`反馈服务纯逻辑回归：passed: ${passed}`)

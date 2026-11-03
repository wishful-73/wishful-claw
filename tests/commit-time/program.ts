// iter-v3-6 S-307 — 分支视图提交行的时间格式（`formatCommitDay` / `formatCommitTime`）。
//
// 锁四件事：
//   1. 行内只给 `MM-DD`，跨年补两位年份 —— 面板窄，多两个字符就把提交说明挤没；
//   2. HoverCard 给完整 `YYYY-MM-DD HH:mm:ss`，秒不截断；
//   3. 不解析成 `Date` —— git `--date=iso` 的 `2026-11-03 15:41:07 +0800` 不是标准
//      ISO 8601，`new Date()` 依引擎解释，跨时区会偏移；
//   4. 无效值一律空串，绝不出 `NaN-NaN`。
//
// 外加一条**静态断言**（最后一段）：`CommitGraphList` 必须真的调用这两个函数。
// 本需求的原始缺陷形态恰恰是「后端给了 date、类型声明了 date、组件一次没用」——
// 只测纯函数会漏掉它：函数再正确，没人调也照样是零。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  formatCommitDay,
  formatCommitTime
} from '../../src/renderer/src/lib/utils/commit-time'

let checks = 0

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

/** 本地时间构造器。月份用 1-based（与 `Date` 的 0-based 区分开）。 */
const at = (y: number, mo: number, d: number): number => new Date(y, mo - 1, d, 12, 0, 0, 0).getTime()

// 固定「今年」= 2026。所有用例显式传入，免得跨年跑出间歇失败。
const NOW_2026 = at(2026, 11, 3)

// ── 1. 行内日期：同年只给 MM-DD ────────────────────────────────────────────
eq(formatCommitDay('2026-11-03 15:41:07 +0800', NOW_2026), '11-03', '同年 → MM-DD')
eq(formatCommitDay('2026-01-09 00:00:00 +0800', NOW_2026), '01-09', '月日都补零')
eq(formatCommitDay('2026-12-31 23:59:59 +0800', NOW_2026), '12-31', '年末仍是同年')

// ── 2. 跨年补两位年份 ─────────────────────────────────────────────────────
eq(formatCommitDay('2025-12-31 23:59:59 +0800', NOW_2026), '25-12-31', '跨年 → YY-MM-DD')
eq(formatCommitDay('2024-02-29 08:00:00 +0800', NOW_2026), '24-02-29', '闰日')
// 反向：站在 2025 看 2026 的提交，同样是「跨年」
eq(formatCommitDay('2026-01-01 00:00:01 +0800', at(2025, 12, 31)), '26-01-01', '未来年份也算跨年')

// ── 3. 不依赖 `Date` 解析：`T` 分隔、缺时区都要能吃 ──────────────────────
eq(formatCommitDay('2026-11-03T15:41:07', NOW_2026), '11-03', 'ISO 的 T 分隔')
eq(formatCommitDay('2026-11-03 15:41:07', NOW_2026), '11-03', '无时区后缀')
eq(formatCommitDay('  2026-11-03 15:41:07 +0800', NOW_2026), '', '前导空格不猜，按无效处理')

// ── 4. 无效输入一律空串 ───────────────────────────────────────────────────
eq(formatCommitDay(null, NOW_2026), '', 'null')
eq(formatCommitDay(undefined, NOW_2026), '', 'undefined')
eq(formatCommitDay('', NOW_2026), '', '空串')
eq(formatCommitDay('not-a-date', NOW_2026), '', '乱码')
eq(formatCommitDay('2026-11', NOW_2026), '', '缺时分秒')
eq(formatCommitDay('2026-11-03', NOW_2026), '', '只有日期没有时刻')

// 参照时刻自身无效时不能连累显示：退回「按提交自己的年份」，至少给 MM-DD
eq(formatCommitDay('2026-11-03 15:41:07 +0800', Number.NaN), '11-03', 'now 无效 → 仍给 MM-DD')

// ── 5. HoverCard 完整时刻：秒不许截断 ─────────────────────────────────────
eq(
  formatCommitTime('2026-11-03 15:41:07 +0800'),
  '2026-11-03 15:41:07',
  '完整到秒'
)
eq(
  formatCommitTime('2026-11-03 15:41:09 +0800'),
  '2026-11-03 15:41:09',
  '秒为 09 时不能被吞成 0 或空'
)
eq(formatCommitTime('2026-11-03T08:05:00'), '2026-11-03 08:05:00', 'T 分隔同样成立')
eq(formatCommitTime(null), '', '无效 → 空串')
eq(formatCommitTime('2026-11-03'), '', '缺时刻 → 空串')

// ── 6. 静态断言：组件必须真的调用格式化函数 ───────────────────────────────
//
// 这是本需求的病根：`CommitGraphList` 拿到 `row.commit.date` 却一次没渲染。
// 纯函数测试对此完全无感 —— 所以直接读源码锁死调用点。
const panelSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/cowork/branch-panel.tsx'),
  'utf8'
)

checks++
assert.ok(
  panelSource.includes('formatCommitDay(row.commit.date)'),
  'CommitGraphList 行内必须渲染提交日期'
)
checks++
assert.ok(
  panelSource.includes('formatCommitTime(row.commit.date)'),
  'HoverCard 必须渲染完整提交时刻'
)
checks++
assert.ok(
  panelSource.includes("from '@renderer/lib/utils/commit-time'"),
  '两个格式化函数必须来自共享模块'
)

// 防止有人把函数复制回组件内部：那样上面的 import 断言会红，但先拦一道更直白的。
checks++
assert.ok(
  !/function\s+formatCommitDay\s*\(/.test(panelSource),
  '格式化函数不许在组件内重新私有实现'
)
checks++
assert.ok(
  !/function\s+formatCommitTime\s*\(/.test(panelSource),
  '格式化函数不许在组件内重新私有实现'
)

console.log(`commit-time: ${checks} 断言全绿`)

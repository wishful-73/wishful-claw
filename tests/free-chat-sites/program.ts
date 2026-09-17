// iter-31 S-55 — 免费对话站点清单排序。
//
// 清单顺序**就是**免费对话页顶部那排选项卡的排列顺序（FreeChatPage 直接 sites.map 渲染），
// 所以这个纯函数的全部职责就是「挪一格」。
//
// 重点锁三条：
//   1. 正常挪动交换相邻两项，其余项相对顺序不变
//   2. 越界（已在首/末）、id 不存在、退化输入 → **返回原数组引用**（调用方据此跳过写盘）
//   3. 不修改入参

import assert from 'node:assert/strict'
import { moveFreeChatSite } from '../../src/renderer/src/components/free-chat/free-chat-sites'
import type { FreeChatSite } from '../../src/renderer/src/stores/settings-store-types'

let checks = 0

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

function ok(condition: unknown, message: string): void {
  checks++
  assert.ok(condition, message)
}

function site(id: string): FreeChatSite {
  return { id, name: id.toUpperCase(), url: `https://${id}.example.com` }
}

function idsOf(list: readonly FreeChatSite[]): string {
  return list.map((item) => item.id).join(',')
}

const base: FreeChatSite[] = [site('a'), site('b'), site('c')]

// ── 正常挪动 ─────────────────────────────────────────────────────────────

eq(idsOf(moveFreeChatSite(base, 'b', 'up')), 'b,a,c', '中间项上移，与左邻交换')
eq(idsOf(moveFreeChatSite(base, 'b', 'down')), 'a,c,b', '中间项下移，与右邻交换')
eq(idsOf(moveFreeChatSite(base, 'a', 'down')), 'b,a,c', '首项可以下移')
eq(idsOf(moveFreeChatSite(base, 'c', 'up')), 'a,c,b', '末项可以上移')

const moved = moveFreeChatSite(base, 'b', 'up')
eq(moved.length, base.length, '长度不变')
ok(moved.includes(base[0]), '元素仍是原对象，没有深拷贝')

// ── 越界 / 未知 id：必须返回原引用 ───────────────────────────────────────

eq(moveFreeChatSite(base, 'a', 'up'), base, '首项上移返回原引用')
eq(moveFreeChatSite(base, 'c', 'down'), base, '末项下移返回原引用')
eq(moveFreeChatSite(base, 'nope', 'up'), base, '未知 id 上移返回原引用')
eq(moveFreeChatSite(base, 'nope', 'down'), base, '未知 id 下移返回原引用')

// ── 退化输入 ─────────────────────────────────────────────────────────────

const single: FreeChatSite[] = [site('solo')]
eq(moveFreeChatSite(single, 'solo', 'up'), single, '单项数组上移返回原引用')
eq(moveFreeChatSite(single, 'solo', 'down'), single, '单项数组下移返回原引用')

const empty: FreeChatSite[] = []
eq(moveFreeChatSite(empty, 'a', 'up'), empty, '空数组返回原引用')

// ── 不可变性 ─────────────────────────────────────────────────────────────

const snapshot = idsOf(base)
moveFreeChatSite(base, 'b', 'up')
moveFreeChatSite(base, 'a', 'down')
eq(idsOf(base), snapshot, '多次调用后入参数组仍是原序')
eq(idsOf(base), 'a,b,c', '入参顺序未被就地改写')

console.log(`free-chat-sites: ${checks} assertions passed`)

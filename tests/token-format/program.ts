// iter-39 S-194 — token 数量格式化：全仓唯一实现 + 单位阶梯 + 进位升档。
//
// 背景：同一个数值（实测 1127850000）在三个位置吐出三种串 —— 上下文环 / 子 Agent 卡
// 走 `lib/format-tokens.ts` 的 `formatTokens`（小写 k，M 段一位小数），输入框计数器走
// `formatTokensDecimal`（大写 K，一律两位），设置页走 `UsagePanelParts.tsx` 里的本地
// `formatTokens`（大写 K，M 段两位）。三套还各有一个进位缺陷：`999999` 输出 `1000k`。
//
// 这里锁三件事：
//   1. 换算对照 9 行逐字符吻合（S-194.md §四）。
//   2. 进位升档（`999999` → `1.00M`）与精度分档（`< 10` 两位、`< 100` 一位、`>= 100` 整数）。
//   3. 仓内 `formatTokens` 实现**只剩一份**，且 `formatTokensDecimal` 已彻底消失。
//
// `format-tokens.ts` 顶层 import 了 gpt-tokenizer 的 encoder（`estimateTokens` 用），
// 是纯模块、不碰 electron，可静态 import。

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { formatTokens } from '../../src/renderer/src/lib/format-tokens'

let checks = 0

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

// ── 1. 防御分支 ──────────────────────────────────────────────────────────

function testGuardClauses(): void {
  eq(formatTokens(0), '0', '0 → "0"')
  eq(formatTokens(-1), '0', '负数钳到 "0"（token 无负值）')
  eq(formatTokens(Number.NaN), '0', 'NaN → "0"')
  eq(formatTokens(Number.POSITIVE_INFINITY), '0', 'Infinity → "0"')
}

// ── 2. 换算对照（S-194.md §四 表，逐字符） ───────────────────────────────

function testConversionTable(): void {
  eq(formatTokens(850), '850', '850 → "850"（< 1000 原值）')
  eq(formatTokens(1000), '1.00k', '1000 → "1.00k"（< 10 两位）')
  eq(formatTokens(1234), '1.23k', '1234 → "1.23k"')
  eq(formatTokens(12500), '12.5k', '12500 → "12.5k"（< 100 一位）')
  eq(formatTokens(123456), '123k', '123456 → "123k"（≥ 100 整数）')
  eq(formatTokens(999999), '1.00M', '999999 → "1.00M"（进位升档）')
  eq(formatTokens(1127850000), '1.13G', '1127850000 → "1.13G"（G 段 < 10 两位）')
  eq(formatTokens(1e12), '1.00T', '1e12 → "1.00T"')
}

// ── 3. 进位与精度边界 ────────────────────────────────────────────────────

function testCarryBoundaries(): void {
  eq(formatTokens(999), '999', '999 仍在原值段')
  // 三层阶梯各来一发「四舍五入后跨过 1000」。
  eq(formatTokens(999_999_999), '1.00G', 'G 段进位，而不是 "1000M"')
  eq(formatTokens(999_999_999_999), '1.00T', 'T 段进位，而不是 "1000G"')
  // 精度档位按「已四舍五入的值」判定：9.999 读数上是 10，就不该再给两位小数。
  eq(formatTokens(9_999), '10.0k', '9.999k 读作 10.0k 而不是 10.00k')
  eq(formatTokens(99_999), '100k', '99.999k 读作 100k 而不是 100.0k')
  // 非整数输入（TokenCounter 动画给的就是插值小数）先取整再换算。
  eq(formatTokens(850.4), '850', '动画小数先取整（< 1000 段）')
  eq(formatTokens(1_234.2), '1.23k', '动画小数先取整（k 段照常两位）')
  eq(formatTokens(999.6), '1.00k', '动画值取整后跨过 1000 ⇒ 升档')
}

// ── 4. 后缀大小写 ────────────────────────────────────────────────────────

function testSuffixCase(): void {
  eq(formatTokens(2_500).endsWith('k'), true, 'k 必须小写（与用户可见面最多的实现一致）')
  eq(formatTokens(2_500_000).endsWith('M'), true, 'M 大写')
  eq(formatTokens(2_500_000_000).endsWith('G'), true, 'G 大写')
  eq(formatTokens(2_500_000_000_000).endsWith('T'), true, 'T 大写')
}

// ── 5. 全仓只剩一份实现 ──────────────────────────────────────────────────

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

function testSingleImplementation(): void {
  // `__dirname` 是打包产物目录（tests/token-format/out）—— 上溯三级即仓根。
  const root = path.resolve(__dirname, '../../../src')
  const files = collectSourceFiles(root)

  const declarations: string[] = []
  const legacyRefs: string[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const count = (text.match(/function formatTokens\(/g) ?? []).length
    if (count > 0) declarations.push(`${file} x${count}`)
    if (text.includes('formatTokensDecimal')) legacyRefs.push(file)
  }

  eq(files.length > 0, true, `扫到源码文件（${files.length} 个）`)
  eq(
    declarations.length,
    1,
    `formatTokens 只能有一份实现，实际：${declarations.join(', ') || '（无）'}`
  )
  eq(
    legacyRefs.length,
    0,
    `formatTokensDecimal 已废除，仍有引用：${legacyRefs.join(', ') || '（无）'}`
  )
}

const tests: Array<[string, () => void]> = [
  ['防御：0 / 负数 / NaN / Infinity', testGuardClauses],
  ['换算对照 9 行', testConversionTable],
  ['进位与精度边界', testCarryBoundaries],
  ['后缀大小写 k / M / G / T', testSuffixCase],
  ['仓内只剩一份实现', testSingleImplementation]
]

function main(): void {
  for (const [name, run] of tests) {
    run()
    console.log(`PASS: ${name}`)
  }
  console.log(`token-format: ${checks} assertions passed`)
}

main()

// iter-30 — 内置浏览器的 UA 洗白。
//
// 内置浏览器（右侧面板 / 免费对话页）跑在 Electron 壳里，默认 UA 带
// `<应用名>/<版本>` 与 `Electron/<版本>` 两个 token。站点（如 chat.deepseek.com）
// 会据此判定「非标准客户端」并拒绝登录 —— 实测提示「当前客户端不稳定」。
//
// 这里锁住洗白结果：对外必须是一个**教科书式**的标准 Chromium UA，
// 真实的平台、真实的 Chrome 版本，其余一个多余 token 都不能有。

import assert from 'node:assert/strict'
import { stripElectronFromUserAgent } from '../../src/shared/browser-plugin'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

// 标准 Chromium UA 的形状：平台括号 + AppleWebKit/537.36 (KHTML, like Gecko) + Chrome/<ver> + Safari/537.36
const STANDARD_CHROMIUM_UA =
  /^Mozilla\/5\.0 \([^)]+\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/[\d.]+ Safari\/537\.36$/

function electronUserAgent(platform: string, chromeVersion: string): string {
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) wishful-claw/0.2.29 Chrome/${chromeVersion} Electron/43.2.0 Safari/537.36`
}

// ── 正常路径：三个平台都要洗成标准 Chromium UA ─────────────────────────────

const platforms: Array<{ label: string; platform: string }> = [
  { label: 'Windows', platform: 'Windows NT 10.0; Win64; x64' },
  { label: 'macOS', platform: 'Macintosh; Intel Mac OS X 10_15_7' },
  { label: 'Linux', platform: 'X11; Linux x86_64' }
]

for (const { label, platform } of platforms) {
  const raw = electronUserAgent(platform, '142.0.0.0')
  const cleaned = stripElectronFromUserAgent(raw)

  check(STANDARD_CHROMIUM_UA.test(cleaned), `${label}: 结果必须是标准 Chromium UA，实得 ${cleaned}`)
  check(!/Electron/i.test(cleaned), `${label}: 不能残留 Electron token`)
  check(!/wishful/i.test(cleaned), `${label}: 不能残留应用名 token`)
  check(cleaned.includes(platform), `${label}: 必须保留真实平台串`)
  check(cleaned.includes('Chrome/142.0.0.0'), `${label}: 必须保留真实 Chrome 版本`)
  eq(
    cleaned,
    `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36`,
    `${label}: 逐字结果`
  )
}

// ── 真实 Chrome 版本要跟着走，不能写死 ─────────────────────────────────────

{
  const older = stripElectronFromUserAgent(
    electronUserAgent('Windows NT 10.0; Win64; x64', '126.0.6478.234')
  )
  check(older.includes('Chrome/126.0.6478.234'), 'Chrome 版本必须取自原 UA，不能硬编码')
  check(STANDARD_CHROMIUM_UA.test(older), '换版本号后仍须是标准形态')
}

// ── 幂等：洗过的 UA 再洗一次不该变样 ───────────────────────────────────────

{
  const once = stripElectronFromUserAgent(
    electronUserAgent('Windows NT 10.0; Win64; x64', '142.0.0.0')
  )
  const twice = stripElectronFromUserAgent(once)
  eq(twice, once, '重复洗白必须幂等')
}

// ── 兜底：拿不到 Chrome 版本时不能抛错，也不能原样把 Electron 带出去 ────────

{
  const noChrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Electron/43.2.0'
  const cleaned = stripElectronFromUserAgent(noChrome)
  check(!/Electron/i.test(cleaned), '兜底分支也必须剥掉 Electron token')
  check(cleaned.includes('Windows NT 10.0; Win64; x64'), '兜底分支必须保留平台串')
}

{
  eq(stripElectronFromUserAgent(''), '', '空串不该炸，且原样返回空串')
}

console.log(`browser-user-agent: ${checks} 项断言通过`)
